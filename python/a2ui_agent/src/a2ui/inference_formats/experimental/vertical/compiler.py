# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Compilation engine and permissive parser for A2UI Vertical inference format.

Parses plain-text standalone component instantiations into structured A2UI
protocol messages for A2UI v0.9, v0.9.1, and v1.0. Supports single-component
instantiation, vertical sequences of components (one surface per component),
multi-catalog resolution, v1.0 `@path` / `@call` / `Event(..., userMessage=...)`
/ `extensions=` / standalone `callRendererFunction`, and permissive syntax
healing for edge models.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
import json
import re
from typing import Any, Literal

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import (
    is_at_least_version,
    is_valid_uax31_identifier,
    to_protocol_version,
)
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    check_mixed_catalogs,
    is_action_slot,
    surface_catalog_id,
    to_message_models,
)

_PUBLISHED_WIRE_VERSIONS = frozenset({"v0.8", "v0.9", "v0.9.1", "1.0"})

_HEALING_NEW_COMPONENT_PATTERN = re.compile(
    r"\s*(?:"
    r"[A-Z][A-Za-z0-9_]*\s*\("
    r"|<[A-Za-z0-9_]+"
    r"|(?:(?:var|val|let|\$[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s*[:=]\s*)?[A-Z][A-Za-z0-9_]*\s*\("
    r")"
)

_OPEN_TAG_STRIP_RE = re.compile(r"</?(?:a2ui|a2ui-vertical)\b[^>]*>", re.IGNORECASE)
_FENCE_LINE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n?", re.MULTILINE)
_ASSIGN_PREFIX_RE = re.compile(
    r"^(?:(?:var|val|let)\s+)?(?:\$[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s*[:=](?!=)\s*"
)
_CALL_HEADER_RE = re.compile(r"^(@?[A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$", re.DOTALL)
_UNCLOSED_CALL_HEADER_RE = re.compile(
    r"^(@?[A-Za-z_][A-Za-z0-9_]*)\s*\((.*)$", re.DOTALL
)
_JSX_STMT_RE = re.compile(
    r"^<([A-Za-z0-9_]+)\b([^>]*)(?:/>|>(?:.*?</\1>)?)$",
    re.DOTALL | re.IGNORECASE,
)
_JSX_ATTR_RE = re.compile(r'([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))')
_SURFACE_DIRECTIVE_RE = re.compile(
    r"^(?:surface|surfaceId)\s*\(\s*['\"]([^'\"]+)['\"]\s*\)$", re.IGNORECASE
)
_NUMBER_RE = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")


class VerticalParseError(SyntaxError):
    """Raised when a Vertical block cannot be lexed or parsed."""


class VerticalValidationError(ValueError):
    """Raised when a Vertical expression violates protocol or catalog constraints."""


@dataclass(frozen=True)
class _RawCall:
    """Intermediate representation of a parsed call expression."""

    name: str
    pos_args: list[Any]
    kw_args: dict[str, Any]


@dataclass(frozen=True)
class _RawCheck:
    """Intermediate representation of a `?check(...)` rule expression."""

    name: str
    pos_args: list[Any]
    kw_args: dict[str, Any]


@dataclass(frozen=True)
class _RawPath:
    """Intermediate representation of a `$path` data binding expression."""

    pointer: str


def normalize_wire_version(version: str) -> str:
    """Normalizes a version string to its canonical wire spelling.

    v1.0 uses `'1.0'` without a leading `'v'`; v0.9 and v0.9.1 carry `'v'`.
    Forward-compatible versions follow the same convention (`'1.1'`, `'v0.9.2'`).
    """
    cleaned = version.strip()
    try:
        return to_protocol_version(cleaned).value
    except ValueError:
        pass
    if is_at_least_version(cleaned, ProtocolVersion.V1_0):
        return cleaned.removeprefix("v")
    return cleaned if cleaned.startswith("v") else f"v{cleaned}"


def _strip_markdown_and_tags(text: str) -> str:
    """Removes enclosing sentinel tags and markdown code fences."""
    if not text:
        return ""
    cleaned = _OPEN_TAG_STRIP_RE.sub("", text.strip())
    cleaned = _FENCE_LINE_RE.sub("", cleaned)
    return cleaned.strip()


def _split_statements(text: str, *, heal_across_lines: bool = True) -> list[str]:
    """Splits Vertical source text into discrete top-level statements."""
    statements, trailing = split_complete_statements(
        text, is_final=True, heal_across_lines=heal_across_lines
    )
    if trailing.strip():
        statements.append(trailing.strip())
    return statements


def split_complete_statements(
    text: str,
    *,
    is_final: bool = False,
    heal_across_lines: bool = True,
) -> tuple[list[str], str]:
    """Splits `text` into completed statements and any trailing incomplete fragment.

    When `is_final=False` (streaming), statements whose parentheses, brackets,
    braces, or quotes are still open remain in the returned trailing fragment
    unless permissive healing closes an unclosed line before a new constructor.
    """
    statements: list[str] = []
    stmt_start = 0
    paren_depth = 0
    bracket_depth = 0
    brace_depth = 0
    saw_open_paren = False
    in_quote: str | None = None
    raw_quote = False
    i = 0
    n = len(text)

    def _flush(end_idx: int) -> None:
        nonlocal stmt_start, saw_open_paren
        seg = text[stmt_start:end_idx].strip()
        if seg:
            cleaned = _FENCE_LINE_RE.sub("", seg).strip()
            if cleaned:
                statements.append(cleaned)
        stmt_start = end_idx
        saw_open_paren = False

    while i < n:
        ch = text[i]

        if in_quote is not None:
            if not raw_quote and ch == "\\":
                if i + 1 >= n:
                    break
                i += 2
                continue
            if len(in_quote) == 1 and ch == "\n":
                in_quote = None
                if (
                    heal_across_lines
                    and (is_final or _HEALING_NEW_COMPONENT_PATTERN.match(text, i + 1))
                    and _HEALING_NEW_COMPONENT_PATTERN.match(text, i + 1)
                ):
                    _flush(i)
                    paren_depth = bracket_depth = brace_depth = 0
                    stmt_start = i + 1
                i += 1
                continue
            if text.startswith(in_quote, i):
                i += len(in_quote)
                in_quote = None
                raw_quote = False
                continue
            i += 1
            continue

        # Block comments /* ... */
        if text.startswith("/*", i):
            close_idx = text.find("*/", i + 2)
            if close_idx < 0:
                if is_final:
                    i = n
                break
            i = close_idx + 2
            continue

        # Single-line comments at depth 0 (#, //, --)
        at_top = paren_depth == 0 and bracket_depth == 0 and brace_depth == 0
        if at_top and (
            ch == "#" or text.startswith("//", i) or text.startswith("--", i)
        ):
            if text[stmt_start:i].strip():
                _flush(i)
            nl_idx = text.find("\n", i)
            if nl_idx < 0:
                stmt_start = n
                i = n
                break
            stmt_start = nl_idx + 1
            i = nl_idx + 1
            continue

        # Raw / triple / single-line string openings
        if (
            ch in ("r", "R")
            and i + 1 < n
            and text[i + 1] in ('"', "'")
            and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] == "_"))
        ):
            q = text[i + 1]
            in_quote = q * 3 if text.startswith(q * 3, i + 1) else q
            raw_quote = True
            i += 1 + len(in_quote)
            continue

        if ch in ('"', "'"):
            in_quote = ch * 3 if text.startswith(ch * 3, i) else ch
            raw_quote = False
            i += len(in_quote)
            continue

        if ch == "(":
            paren_depth += 1
            saw_open_paren = True
            i += 1
            continue
        if ch == ")":
            if paren_depth > 0:
                paren_depth -= 1
            i += 1
            if (
                not is_final
                and paren_depth == 0
                and bracket_depth == 0
                and brace_depth == 0
                and saw_open_paren
            ):
                _flush(i)
            continue
        if ch == "[":
            bracket_depth += 1
            i += 1
            continue
        if ch == "]":
            if bracket_depth > 0:
                bracket_depth -= 1
            i += 1
            continue
        if ch == "{":
            brace_depth += 1
            i += 1
            continue
        if ch == "}":
            if brace_depth > 0:
                brace_depth -= 1
            i += 1
            continue

        if at_top and ch in ("\n", ";"):
            seg = text[stmt_start:i].strip()
            if seg:
                if is_final or saw_open_paren or seg.startswith(("{", "<")):
                    _flush(i)
                    stmt_start = i + 1
            else:
                stmt_start = i + 1
            i += 1
            continue

        if not at_top and ch == "\n" and heal_across_lines:
            if _HEALING_NEW_COMPONENT_PATTERN.match(text, i + 1):
                _flush(i)
                paren_depth = bracket_depth = brace_depth = 0
                stmt_start = i + 1
                i += 1
                continue

        i += 1

    trailing = text[stmt_start:]
    if is_final and trailing.strip():
        _flush(n)
        trailing = ""
    return statements, trailing


def _split_args(args_str: str) -> list[str]:
    """Splits an argument string into comma-separated chunks at depth 0."""
    chunks: list[str] = []
    chunk_start = 0
    paren_depth = 0
    bracket_depth = 0
    brace_depth = 0
    in_quote: str | None = None
    raw_quote = False
    i = 0
    n = len(args_str)

    while i < n:
        ch = args_str[i]
        if in_quote is not None:
            if not raw_quote and ch == "\\":
                i += 2
                continue
            if len(in_quote) == 1 and ch == "\n":
                in_quote = None
                i += 1
                continue
            if args_str.startswith(in_quote, i):
                i += len(in_quote)
                in_quote = None
                raw_quote = False
                continue
            i += 1
            continue

        if args_str.startswith("/*", i):
            close_idx = args_str.find("*/", i + 2)
            i = n if close_idx < 0 else close_idx + 2
            continue
        if ch == "#" or args_str.startswith(("//", "--"), i):
            nl_idx = args_str.find("\n", i)
            i = n if nl_idx < 0 else nl_idx + 1
            continue

        if (
            ch in ("r", "R")
            and i + 1 < n
            and args_str[i + 1] in ('"', "'")
            and (i == 0 or not (args_str[i - 1].isalnum() or args_str[i - 1] == "_"))
        ):
            q = args_str[i + 1]
            in_quote = q * 3 if args_str.startswith(q * 3, i + 1) else q
            raw_quote = True
            i += 1 + len(in_quote)
            continue

        if ch in ('"', "'"):
            in_quote = ch * 3 if args_str.startswith(ch * 3, i) else ch
            raw_quote = False
            i += len(in_quote)
            continue

        if ch == "(":
            paren_depth += 1
        elif ch == ")" and paren_depth > 0:
            paren_depth -= 1
        elif ch == "[":
            bracket_depth += 1
        elif ch == "]" and bracket_depth > 0:
            bracket_depth -= 1
        elif ch == "{":
            brace_depth += 1
        elif ch == "}" and brace_depth > 0:
            brace_depth -= 1
        elif ch == "," and paren_depth == 0 and bracket_depth == 0 and brace_depth == 0:
            piece = args_str[chunk_start:i].strip()
            if piece:
                chunks.append(piece)
            chunk_start = i + 1

        i += 1

    tail = args_str[chunk_start:].strip()
    if tail:
        chunks.append(tail)
    return chunks


_ESCAPE_MAP = {
    "n": "\n",
    "r": "\r",
    "t": "\t",
    "b": "\b",
    "f": "\f",
    "\\": "\\",
    '"': '"',
    "'": "'",
    "/": "/",
}


def _unescape_str(s: str) -> str:
    """Unescapes standard and `\\uXXXX` escape sequences while preserving UTF-8."""

    def _replace(match: re.Match[str]) -> str:
        seq = match.group(1)
        if seq.startswith("u") and len(seq) == 5:
            try:
                return chr(int(seq[1:], 16))
            except ValueError:
                return match.group(0)
        return _ESCAPE_MAP.get(seq, seq)

    return re.sub(r"\\(u[0-9a-fA-F]{4}|[\s\S])", _replace, s)


def _parse_string_token(val_str: str) -> str | None:
    """Parses a quoted or raw string literal (including unclosed quote healing)."""
    is_raw = False
    work = val_str
    if len(work) >= 2 and work[0] in ("r", "R") and work[1] in ('"', "'"):
        is_raw = True
        work = work[1:]

    if not work or work[0] not in ('"', "'"):
        return None

    q = work[0]
    delim = q * 3 if work.startswith(q * 3) else q
    inner = work[len(delim) :]
    if inner.endswith(delim):
        inner = inner[: -len(delim)]
    elif len(delim) == 1 and inner.endswith(q):
        inner = inner[:-1]
    return inner if is_raw else _unescape_str(inner)


def _parse_arg_chunk(chunk: str) -> tuple[str | None, Any]:
    """Splits an argument chunk into `(key, raw_ast_value)` or `(None, raw_ast_value)`."""
    chunk = chunk.strip()
    if not chunk:
        return None, ""

    # Leading colon syntax (:key "val") — only when not starting a check (?...)
    if chunk.startswith(":") and len(chunk) > 1 and not chunk.startswith("::"):
        parts = chunk[1:].split(None, 1)
        if len(parts) == 2:
            return parts[0].strip(), _parse_raw_value(parts[1].strip())

    paren_depth = 0
    bracket_depth = 0
    brace_depth = 0
    in_quote: str | None = None
    raw_quote = False
    separator_idx = -1
    i = 0
    n = len(chunk)

    while i < n:
        ch = chunk[i]
        if in_quote is not None:
            if not raw_quote and ch == "\\":
                i += 2
                continue
            if chunk.startswith(in_quote, i):
                i += len(in_quote)
                in_quote = None
                raw_quote = False
                continue
            i += 1
            continue

        if (
            ch in ("r", "R")
            and i + 1 < n
            and chunk[i + 1] in ('"', "'")
            and (i == 0 or not (chunk[i - 1].isalnum() or chunk[i - 1] == "_"))
        ):
            q = chunk[i + 1]
            in_quote = q * 3 if chunk.startswith(q * 3, i + 1) else q
            raw_quote = True
            i += 1 + len(in_quote)
            continue

        if ch in ('"', "'"):
            in_quote = ch * 3 if chunk.startswith(ch * 3, i) else ch
            raw_quote = False
            i += len(in_quote)
            continue

        if ch == "(":
            paren_depth += 1
        elif ch == ")" and paren_depth > 0:
            paren_depth -= 1
        elif ch == "[":
            bracket_depth += 1
        elif ch == "]" and bracket_depth > 0:
            bracket_depth -= 1
        elif ch == "{":
            brace_depth += 1
        elif ch == "}" and brace_depth > 0:
            brace_depth -= 1
        elif (
            paren_depth == 0
            and bracket_depth == 0
            and brace_depth == 0
            and i > 0
            and ch in ("=", ":")
        ):
            if ch == "=" and i + 1 < n and chunk[i + 1] == "=":
                i += 2
                continue
            separator_idx = i
            break

        i += 1

    if separator_idx != -1:
        key_raw = chunk[:separator_idx].strip()
        val_raw = chunk[separator_idx + 1 :].strip()
        parsed_key = _parse_string_token(key_raw)
        key_str = parsed_key if parsed_key is not None else key_raw
        if key_str.startswith(":"):
            key_str = key_str[1:]
        return key_str, _parse_raw_value(val_raw)

    return None, _parse_raw_value(chunk)


def _parse_call_args(inner: str) -> tuple[list[Any], dict[str, Any]]:
    """Parses comma-separated positional and keyword arguments inside `(...)`."""
    pos_args: list[Any] = []
    kw_args: dict[str, Any] = {}
    for arg_chunk in _split_args(inner):
        k, v = _parse_arg_chunk(arg_chunk)
        if k is not None:
            kw_args[k] = v
        else:
            pos_args.append(v)
    return pos_args, kw_args


def _parse_raw_value(val_str: str) -> Any:
    """Parses a single argument/expression string into a raw AST value."""
    val_str = val_str.strip()
    if not val_str:
        return ""

    # 1. Quoted or raw string literal
    str_val = _parse_string_token(val_str)
    if str_val is not None:
        return str_val

    # 2. Booleans & Null
    lower = val_str.lower()
    if lower == "true":
        return True
    if lower == "false":
        return False
    if lower in ("null", "none"):
        return None

    # 3. Numbers (integers, floats, and unquoted percentages like +10.9%)
    num_candidate = val_str[:-1].strip() if val_str.endswith("%") else val_str
    if _NUMBER_RE.match(num_candidate):
        try:
            if (
                "." in num_candidate
                or "e" in num_candidate.lower()
                or val_str.endswith("%")
            ):
                parsed_float = float(num_candidate)
                if not (
                    parsed_float != parsed_float
                    or parsed_float in (float("inf"), float("-inf"))
                ):
                    return parsed_float
                raise VerticalParseError(f"Numeric literal out of range: {val_str!r}")
            return int(num_candidate)
        except ValueError:
            pass

    # 4. Data binding: $/path/to/data, $path, or lone $
    if val_str.startswith("$"):
        raw_path = val_str[1:]
        if not raw_path or raw_path == "/":
            return _RawPath("/")
        if not raw_path.startswith("/"):
            raw_path = "/" + raw_path
        return _RawPath(raw_path)

    # 5. Check rule: ?required or ?regex("...", "error msg")
    if val_str.startswith("?"):
        check_body = val_str[1:].strip()
        m = _CALL_HEADER_RE.match(check_body) or _UNCLOSED_CALL_HEADER_RE.match(
            check_body
        )
        if m:
            check_name = m.group(1)
            inner = (m.group(2) or "").strip()
            pos_args, kw_args = _parse_call_args(inner)
            return _RawCheck(check_name, pos_args, kw_args)
        raise VerticalParseError(f"Malformed check expression: {val_str!r}")

    # 6. List literal: [item1, item2]
    if val_str.startswith("["):
        inner = val_str[1:]
        if inner.endswith("]"):
            inner = inner[:-1]
        return [_parse_raw_value(item) for item in _split_args(inner)]

    # 7. Map literal: {k: v, ...}
    if val_str.startswith("{"):
        inner = val_str[1:]
        if inner.endswith("}"):
            inner = inner[:-1]
        res_dict: dict[str, Any] = {}
        for entry in _split_args(inner):
            k, v = _parse_arg_chunk(entry)
            if k is not None:
                res_dict[k] = v
        return res_dict

    # 8. Call expression: Event(...), fn(...), @index(...)
    call_m = _CALL_HEADER_RE.match(val_str) or _UNCLOSED_CALL_HEADER_RE.match(val_str)
    if call_m and "(" in val_str:
        fn_name = call_m.group(1)
        inner = (call_m.group(2) or "").strip()
        pos_args, kw_args = _parse_call_args(inner)
        return _RawCall(fn_name, pos_args, kw_args)

    # 9. Permissive fallback to unquoted string literal
    return val_str


def _expected_primitive_type(schema: Any) -> str | None:
    """Resolves the expected primitive type (`number`, `integer`, `boolean`, `string`) from a schema."""
    if not isinstance(schema, dict):
        return None
    t = schema.get("type")
    if t in ("integer", "number", "boolean", "string"):
        return str(t)
    ref = schema.get("$ref")
    if isinstance(ref, str):
        if "DynamicNumber" in ref or ref.endswith("/Number"):
            return "number"
        if "DynamicInteger" in ref or ref.endswith("/Integer"):
            return "integer"
        if "DynamicBoolean" in ref or ref.endswith("/Boolean"):
            return "boolean"
        if "DynamicString" in ref and "List" not in ref:
            return "string"
    for k in ("anyOf", "oneOf", "allOf"):
        subs = schema.get(k)
        if isinstance(subs, list):
            for sub in subs:
                sub_t = _expected_primitive_type(sub)
                if sub_t:
                    return sub_t
    return None


def ordered_component_properties(
    helper: CatalogSchemaHelper, comp_name: str
) -> list[str]:
    """Returns non-structural, non-child component properties ordered by `positionalIndex` then schema order."""
    raw_props = [
        p
        for p in helper.get_component_properties(comp_name)
        if p not in ("component", "id", "catalogId", "child", "children", "checks")
        and helper.get_property_type(comp_name, p) not in ("Child", "ChildList")
    ]

    def _sort_key(item: tuple[int, str]) -> tuple[int, int]:
        idx, prop = item
        schema = helper.get_property_schema(comp_name, prop)
        pos_idx = (
            schema.get("positionalIndex", 999)
            if isinstance(schema, dict)
            and isinstance(schema.get("positionalIndex"), int)
            else 999
        )
        return (pos_idx, idx)

    return [prop for _, prop in sorted(enumerate(raw_props), key=_sort_key)]


class VerticalCompiler:
    """Compiles A2UI Vertical component constructors into A2UI protocol messages."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
        version: str | None = None,
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self.surface_id = surface_id
        self.version = (
            normalize_wire_version(version)
            if version is not None
            else catalogs_protocol_version(self._catalogs)
        )
        self.helpers = build_catalog_helpers(self._catalogs, self.version)

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs in priority order."""
        return list(self._catalogs)

    @property
    def _is_multi_catalog(self) -> bool:
        return len(self._catalogs) > 1

    def _helper_for(self, catalog_id: str) -> CatalogSchemaHelper:
        helper = self.helpers.get(catalog_id)
        if helper is None:
            raise VerticalValidationError(
                f"Unknown catalog '{catalog_id}'. Available catalogs:"
                f" {list(self.helpers.keys())}."
            )
        return helper

    def _defines_component(self, name: str, catalog_id: Any) -> bool:
        if isinstance(catalog_id, str) and catalog_id in self.helpers:
            return name in self.helpers[catalog_id].components
        if catalogs_defining(self.helpers, "component", name):
            return True
        lower = name.lower()
        return any(
            c.lower() == lower
            for helper in self.helpers.values()
            for c in helper.components
        )

    def _defines_function(self, name: str, catalog_id: Any) -> bool:
        if name.startswith("@"):
            return True
        if catalog_id is not None:
            if isinstance(catalog_id, str) and catalog_id in self.helpers:
                return name in self.helpers[catalog_id].functions
            return False
        return bool(catalogs_defining(self.helpers, "function", name))

    def _resolve_catalog_item(
        self,
        kind: Literal["component", "function"],
        name: str,
        catalog_id: Any,
        *,
        at_least_v10: bool,
        target_version: str,
        allow_unknown_single_catalog_component: bool = False,
    ) -> tuple[str, CatalogSchemaHelper | None, str | None]:
        """Resolves a component or function name across active catalogs.

        Returns `(canonical_name, helper_or_none, write_catalog_id)`.
        """
        label = kind
        if catalog_id is not None:
            if not isinstance(catalog_id, str) or not catalog_id:
                raise VerticalValidationError(
                    f"{label.capitalize()} '{name}' catalogId must be a non-empty"
                    f" string, got: {catalog_id!r}."
                )
            if not at_least_v10:
                raise VerticalValidationError(
                    f"{label.capitalize()} '{name}' sets catalogId, which requires"
                    f" A2UI v1.0 or later (target version is {target_version})."
                )
            helper = self._helper_for(catalog_id)
            defined = helper.components if kind == "component" else helper.functions
            matched_name = name
            if name not in defined and kind == "component":
                for cand in defined:
                    if cand.lower() == name.lower():
                        matched_name = cand
                        break
            if matched_name not in defined:
                raise VerticalValidationError(
                    f"Unknown {label} '{name}' not defined in catalog '{catalog_id}'."
                )
            return matched_name, helper, catalog_id

        matches = catalogs_defining(self.helpers, kind, name)
        matched_name = name
        if not matches and kind == "component":
            lower = name.lower()
            ci_matches: list[tuple[str, str]] = [
                (cat_id, cand)
                for cat_id, h in self.helpers.items()
                for cand in h.components
                if cand.lower() == lower
            ]
            if len(ci_matches) == 1:
                matches = [ci_matches[0][0]]
                matched_name = ci_matches[0][1]

        if len(matches) > 1:
            raise VerticalValidationError(
                f"{label.capitalize()} '{name}' is defined in several catalogs:"
                f' {matches}. Specify catalogId="..." to disambiguate.'
            )
        if not matches:
            if allow_unknown_single_catalog_component and not self._is_multi_catalog:
                return name, self.helpers[self._catalogs[0].catalog_id], None
            if self._is_multi_catalog:
                raise VerticalValidationError(
                    f"Unknown {label} '{name}' not defined in any active catalog:"
                    f" {list(self.helpers.keys())}."
                )
            raise VerticalValidationError(
                f"Unknown {label} '{name}' not defined in catalog"
                f" '{self._catalogs[0].catalog_id}'."
            )

        resolved_id = matches[0]
        return (
            matched_name,
            self.helpers[resolved_id],
            resolved_id if self._is_multi_catalog else None,
        )

    def _parse_statement(self, stmt: str) -> _RawCall | None:
        """Parses a single Vertical statement into a `_RawCall`."""
        stmt = stmt.strip()
        if not stmt:
            return None

        # 1. Permissive raw JSON object/array fallback
        if stmt.startswith(("{", "[")):
            try:
                data = json.loads(stmt)
                obj = (
                    data
                    if isinstance(data, dict)
                    else (
                        data[0]
                        if isinstance(data, list) and data and isinstance(data[0], dict)
                        else None
                    )
                )
                if isinstance(obj, dict) and isinstance(obj.get("component"), str):
                    comp_name = obj["component"]
                    kwargs = {
                        k: v for k, v in obj.items() if k not in ("component", "id")
                    }
                    return _RawCall(comp_name, [], kwargs)
            except json.JSONDecodeError:
                pass

        # 2. Permissive JSX-style fallback: <Text text="Hello" />
        jsx_match = _JSX_STMT_RE.match(stmt)
        if jsx_match:
            comp_name = jsx_match.group(1)
            attrs_str = jsx_match.group(2)
            kwargs = {}
            for k, val_d, val_s, val_raw in _JSX_ATTR_RE.findall(attrs_str):
                raw_attr = (
                    f'"{val_d}"'
                    if val_d != ""
                    else (f"'{val_s}'" if val_s != "" else val_raw)
                )
                kwargs[k] = _parse_raw_value(raw_attr)
            return _RawCall(comp_name, [], kwargs)

        # 3. Permissively strip accidental variable assignment prefix (e.g. root = Text(...))
        stmt = _ASSIGN_PREFIX_RE.sub("", stmt).strip()

        # 4. Constructor / function call: Identifier(args...)
        call_match = _CALL_HEADER_RE.match(stmt) or _UNCLOSED_CALL_HEADER_RE.match(stmt)
        if not call_match:
            raise VerticalParseError(f"Cannot parse Vertical statement: {stmt!r}")

        name = call_match.group(1)
        args_raw = (call_match.group(2) or "").strip()
        pos_args, kw_args = _parse_call_args(args_raw)
        return _RawCall(name, pos_args, kw_args)

    def _compile_event(
        self,
        call: _RawCall,
        *,
        at_least_v10: bool,
        target_version: str,
    ) -> dict[str, Any]:
        """Compiles an `Event(...)` helper call into an A2UI `event` action object."""
        event_name: str | None = None
        context: dict[str, Any] = {}
        user_message: Any = None
        has_user_message = False

        for idx, pos_val in enumerate(call.pos_args):
            if idx == 0:
                compiled_name = self._compile_value(
                    pos_val,
                    schema=None,
                    helper=None,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )
                if not isinstance(compiled_name, str) or not compiled_name:
                    raise VerticalValidationError(
                        "Event() requires a non-empty string event name, got:"
                        f" {compiled_name!r}."
                    )
                event_name = compiled_name
            elif idx == 1 and isinstance(pos_val, dict):
                for ck, cv in pos_val.items():
                    context[ck] = self._compile_value(
                        cv,
                        schema=None,
                        helper=None,
                        at_least_v10=at_least_v10,
                        target_version=target_version,
                    )
            else:
                context[f"arg_{idx}"] = self._compile_value(
                    pos_val,
                    schema=None,
                    helper=None,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )

        for k, v in call.kw_args.items():
            if k == "name" and event_name is None:
                compiled_name = self._compile_value(
                    v,
                    schema=None,
                    helper=None,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )
                if not isinstance(compiled_name, str) or not compiled_name:
                    raise VerticalValidationError(
                        "Event() name must be a non-empty string, got:"
                        f" {compiled_name!r}."
                    )
                event_name = compiled_name
            elif k == "userMessage":
                if not at_least_v10:
                    raise VerticalValidationError(
                        "Event() userMessage requires A2UI v1.0 or later"
                        f" (target version is {target_version})."
                    )
                has_user_message = True
                user_message = self._compile_value(
                    v,
                    schema=None,
                    helper=None,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )
            elif k == "context" and isinstance(v, dict):
                for ck, cv in v.items():
                    context[ck] = self._compile_value(
                        cv,
                        schema=None,
                        helper=None,
                        at_least_v10=at_least_v10,
                        target_version=target_version,
                    )
            else:
                context[k] = self._compile_value(
                    v,
                    schema=None,
                    helper=None,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )

        if not event_name:
            raise VerticalValidationError("Event() requires an event name.")

        event_body: dict[str, Any] = {"name": event_name}
        if has_user_message:
            event_body["userMessage"] = user_message
        if context:
            event_body["context"] = context
        return {"event": event_body}

    def _compile_function_call(
        self,
        call: _RawCall,
        *,
        at_least_v10: bool,
        target_version: str,
    ) -> dict[str, Any]:
        """Compiles a catalog function call into a `FunctionCall` object."""
        if call.name.startswith("@"):
            raise VerticalValidationError(
                f"System function '{call.name}' is only valid inside list"
                " templates, which Vertical does not support."
            )

        kw = dict(call.kw_args)
        explicit_cat_id = kw.pop("catalogId", None)
        fn_name, fn_helper, write_cat_id = self._resolve_catalog_item(
            "function",
            call.name,
            explicit_cat_id,
            at_least_v10=at_least_v10,
            target_version=target_version,
        )
        assert fn_helper is not None

        fn_props = fn_helper.get_function_properties(fn_name)
        args_obj: dict[str, Any] = {}
        for idx, pos_val in enumerate(call.pos_args):
            if idx >= len(fn_props):
                raise VerticalValidationError(
                    f"Function '{fn_name}' takes at most {len(fn_props)} positional"
                    f" arguments ({', '.join(fn_props)}), got {len(call.pos_args)}."
                )
            param_name = fn_props[idx]
            param_schema = fn_helper.get_function_property_schema(fn_name, param_name)
            args_obj[param_name] = self._compile_value(
                pos_val,
                schema=param_schema,
                helper=fn_helper,
                at_least_v10=at_least_v10,
                target_version=target_version,
            )

        for k, v in kw.items():
            param_schema = fn_helper.get_function_property_schema(fn_name, k)
            args_obj[k] = self._compile_value(
                v,
                schema=param_schema,
                helper=fn_helper,
                at_least_v10=at_least_v10,
                target_version=target_version,
            )

        call_key = "@call" if at_least_v10 else "call"
        result: dict[str, Any] = {call_key: fn_name, "args": args_obj}
        if write_cat_id is not None:
            result["catalogId"] = write_cat_id
        return result

    def _compile_check_rule(
        self,
        check: _RawCheck,
        *,
        sibling_value: Any,
        at_least_v10: bool,
        target_version: str,
    ) -> dict[str, Any]:
        """Compiles a `?check(...)` rule into a protocol `CheckRule` dictionary."""
        kw = dict(check.kw_args)
        pos = list(check.pos_args)
        explicit_cat_id = kw.pop("catalogId", None)

        # Support trailing `{catalogId: "..."}` option map as in Express
        if pos and isinstance(pos[-1], dict) and "catalogId" in pos[-1]:
            opt_map = pos.pop()
            if set(opt_map.keys()) != {"catalogId"}:
                raise VerticalValidationError(
                    f"Check '?{check.name}' option map may only contain 'catalogId'."
                )
            explicit_cat_id = opt_map["catalogId"]

        fn_name, fn_helper, write_cat_id = self._resolve_catalog_item(
            "function",
            check.name,
            explicit_cat_id,
            at_least_v10=at_least_v10,
            target_version=target_version,
        )
        assert fn_helper is not None

        fn_props = fn_helper.get_function_properties(fn_name)
        args_obj: dict[str, Any] = {}
        custom_message: str | None = kw.pop("message", None)

        # Auto-bind first `value` parameter from the component's `value` property
        remaining_props = list(fn_props)
        if (
            remaining_props
            and remaining_props[0] == "value"
            and "value" not in kw
            and sibling_value is not None
        ):
            args_obj["value"] = sibling_value
            remaining_props = remaining_props[1:]

        # Extra trailing string argument becomes CheckRule.message
        if len(pos) == len(remaining_props) + 1 and isinstance(pos[-1], str):
            custom_message = pos.pop()

        for idx, pos_val in enumerate(pos):
            if idx >= len(remaining_props):
                raise VerticalValidationError(
                    f"Check '?{fn_name}' received too many arguments."
                )
            param_name = remaining_props[idx]
            param_schema = fn_helper.get_function_property_schema(fn_name, param_name)
            args_obj[param_name] = self._compile_value(
                pos_val,
                schema=param_schema,
                helper=fn_helper,
                at_least_v10=at_least_v10,
                target_version=target_version,
            )

        for k, v in kw.items():
            param_schema = fn_helper.get_function_property_schema(fn_name, k)
            args_obj[k] = self._compile_value(
                v,
                schema=param_schema,
                helper=fn_helper,
                at_least_v10=at_least_v10,
                target_version=target_version,
            )

        call_key = "@call" if at_least_v10 else "call"
        condition: dict[str, Any] = {call_key: fn_name, "args": args_obj}
        if write_cat_id is not None:
            condition["catalogId"] = write_cat_id

        rule_message = (
            custom_message
            if custom_message is not None
            else f"{fn_name.capitalize()} check failed"
        )
        return {"condition": condition, "message": rule_message}

    def _compile_value(
        self,
        val: Any,
        *,
        schema: dict[str, Any] | None,
        helper: CatalogSchemaHelper | None,
        at_least_v10: bool,
        target_version: str,
        in_action_slot: bool = False,
    ) -> Any:
        """Compiles and schema-coerces an AST value at a schema position."""
        path_key = "@path" if at_least_v10 else "path"

        if isinstance(val, _RawPath):
            return {path_key: val.pointer}

        if isinstance(val, _RawCall):
            if (
                val.name.lower() in ("event", "action")
                and "catalogId" not in val.kw_args
            ):
                return self._compile_event(
                    val, at_least_v10=at_least_v10, target_version=target_version
                )
            call_obj = self._compile_function_call(
                val, at_least_v10=at_least_v10, target_version=target_version
            )
            if in_action_slot or is_action_slot(schema):
                return {"functionCall": call_obj}
            return call_obj

        if isinstance(val, list):
            item_schema = (
                helper.resolve_item_schema(schema)
                if helper is not None and schema is not None
                else None
            )
            return [
                self._compile_value(
                    item,
                    schema=item_schema,
                    helper=helper,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )
                for item in val
            ]

        if isinstance(val, dict):
            # Preserve pre-compiled JSON fallback dicts (e.g. {"@path": ...} or {"path": ...})
            out: dict[str, Any] = {}
            for k, v in val.items():
                sub_schema = (
                    helper.resolve_property_schema(schema, k)
                    if helper is not None and schema is not None
                    else None
                )
                out[k] = self._compile_value(
                    v,
                    schema=sub_schema,
                    helper=helper,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                    in_action_slot=is_action_slot(sub_schema),
                )
            return out

        if (in_action_slot or is_action_slot(schema)) and isinstance(val, str):
            return {"event": {"name": val}}

        return self._coerce_primitive(val, schema)

    def _coerce_primitive(self, val: Any, schema: dict[str, Any] | None) -> Any:
        """Coerces stringified numbers, percentages, and booleans per catalog schema."""
        expected_type = _expected_primitive_type(schema)
        if expected_type in ("number", "integer"):
            if isinstance(val, str):
                cleaned = val.strip()
                if cleaned.endswith("%"):
                    cleaned = cleaned[:-1].strip()
                if cleaned.startswith("+"):
                    cleaned = cleaned[1:].strip()
                try:
                    if expected_type == "integer":
                        return int(float(cleaned))
                    if "." in cleaned or "e" in cleaned.lower():
                        return float(cleaned)
                    return int(cleaned)
                except (ValueError, TypeError):
                    return val
            elif (
                isinstance(val, float)
                and not isinstance(val, bool)
                and expected_type == "integer"
                and val.is_integer()
            ):
                return int(val)
        elif expected_type == "boolean" and isinstance(val, str):
            cleaned = val.strip().lower()
            if cleaned in ("true", "1"):
                return True
            if cleaned in ("false", "0"):
                return False
        return val

    def _compile_extensions(
        self,
        raw_ext: Any,
        *,
        comp_name: str,
        at_least_v10: bool,
        target_version: str,
    ) -> dict[str, Any]:
        if not at_least_v10:
            raise VerticalValidationError(
                f"Component '{comp_name}' sets extensions, which requires A2UI v1.0"
                f" or later (target version is {target_version})."
            )
        if not isinstance(raw_ext, dict):
            raise VerticalValidationError(
                f"Component '{comp_name}' extensions must be a map, got: {raw_ext!r}."
            )
        compiled = self._compile_value(
            raw_ext,
            schema=None,
            helper=None,
            at_least_v10=at_least_v10,
            target_version=target_version,
        )
        assert isinstance(compiled, dict)
        for key in compiled:
            if not isinstance(key, str) or not is_valid_uax31_identifier(key):
                raise VerticalValidationError(
                    f"Component '{comp_name}' extension key {key!r} is not a valid"
                    " UAX #31 identifier."
                )
        return dict(compiled)

    def _compile_component_call(
        self,
        call: _RawCall,
        *,
        at_least_v10: bool,
        target_version: str,
    ) -> dict[str, Any]:
        """Compiles a parsed `_RawCall` into an A2UI component dictionary."""
        kw = dict(call.kw_args)
        explicit_cat_id = kw.pop("catalogId", None)
        kw.pop("id", None)

        matched_name, comp_helper, write_cat_id = self._resolve_catalog_item(
            "component",
            call.name,
            explicit_cat_id,
            at_least_v10=at_least_v10,
            target_version=target_version,
            allow_unknown_single_catalog_component=True,
        )

        comp_dict: dict[str, Any] = {"id": "root", "component": matched_name}
        if write_cat_id is not None:
            comp_dict["catalogId"] = write_cat_id

        declared_props = (
            comp_helper.get_component_properties(matched_name)
            if comp_helper is not None and matched_name in comp_helper.components
            else []
        )
        ordered_props = (
            ordered_component_properties(comp_helper, matched_name)
            if comp_helper is not None and matched_name in comp_helper.components
            else []
        )

        if "extensions" in kw and "extensions" not in declared_props:
            raw_ext = kw.pop("extensions")
            comp_dict["metadata"] = {
                "extensions": self._compile_extensions(
                    raw_ext,
                    comp_name=matched_name,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )
            }

        raw_checks: list[_RawCheck] = []
        pos_values: list[Any] = []
        for arg in call.pos_args:
            if isinstance(arg, _RawCheck):
                raw_checks.append(arg)
            elif (
                isinstance(arg, list)
                and arg
                and all(isinstance(x, _RawCheck) for x in arg)
            ):
                raw_checks.extend(arg)
            else:
                pos_values.append(arg)

        if "checks" in kw:
            kw_checks = kw.pop("checks")
            if isinstance(kw_checks, _RawCheck):
                raw_checks.append(kw_checks)
            elif isinstance(kw_checks, list):
                for item in kw_checks:
                    if isinstance(item, _RawCheck):
                        raw_checks.append(item)
                    elif isinstance(item, dict):
                        comp_dict.setdefault("checks", []).append(item)

        for idx, arg_val in enumerate(pos_values):
            if idx < len(ordered_props):
                prop_name = ordered_props[idx]
                p_schema = (
                    comp_helper.get_property_schema(matched_name, prop_name)
                    if comp_helper is not None
                    else None
                )
                p_type = (
                    comp_helper.get_property_type(matched_name, prop_name)
                    if comp_helper is not None
                    else None
                )
                comp_dict[prop_name] = self._compile_value(
                    arg_val,
                    schema=p_schema,
                    helper=comp_helper,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                    in_action_slot=(
                        p_type == "Action"
                        or prop_name in ("action", "onClick", "onPress")
                    ),
                )

        for k, v in kw.items():
            prop_target = k
            for p in declared_props:
                if p.lower() == k.lower():
                    prop_target = p
                    break
            p_schema = (
                comp_helper.get_property_schema(matched_name, prop_target)
                if comp_helper is not None and matched_name in comp_helper.components
                else None
            )
            p_type = (
                comp_helper.get_property_type(matched_name, prop_target)
                if comp_helper is not None and matched_name in comp_helper.components
                else None
            )
            comp_dict[prop_target] = self._compile_value(
                v,
                schema=p_schema,
                helper=comp_helper,
                at_least_v10=at_least_v10,
                target_version=target_version,
                in_action_slot=(
                    p_type == "Action"
                    or prop_target in ("action", "onClick", "onPress")
                ),
            )

        if raw_checks:
            if (
                comp_helper is not None
                and matched_name in comp_helper.components
                and not comp_helper.is_checkable(matched_name)
                and "checks" not in declared_props
            ):
                raise VerticalValidationError(
                    f"Component '{matched_name}' does not declare validation checks."
                )
            sibling_val = comp_dict.get("value")
            compiled_rules = [
                self._compile_check_rule(
                    chk,
                    sibling_value=sibling_val,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )
                for chk in raw_checks
            ]
            comp_dict.setdefault("checks", []).extend(compiled_rules)

        return comp_dict

    def _compile_standalone_function_message(
        self,
        call: _RawCall,
        *,
        call_index: int,
        at_least_v10: bool,
        target_version: str,
    ) -> dict[str, Any]:
        """Compiles a top-level function call into a v1.0 `callRendererFunction` message."""
        if not at_least_v10:
            raise VerticalValidationError(
                f"Standalone function calls are not supported in A2UI {target_version}."
            )
        if call.name.startswith("@"):
            raise VerticalValidationError(
                f"System function '{call.name}' cannot be called as a standalone"
                " statement."
            )
        kw = dict(call.kw_args)
        function_call_id = f"call_{call_index}"
        if "functionCallId" in kw:
            explicit_id = kw.pop("functionCallId")
            if not isinstance(explicit_id, str) or not explicit_id:
                raise VerticalValidationError(
                    f"functionCallId must be a non-empty string, got: {explicit_id!r}."
                )
            function_call_id = explicit_id

        compiled_call = self._compile_function_call(
            _RawCall(call.name, call.pos_args, kw),
            at_least_v10=at_least_v10,
            target_version=target_version,
        )
        resolved_cat = compiled_call.get("catalogId") or self._catalogs[0].catalog_id
        return {
            "version": target_version,
            "callRendererFunction": {
                "functionCallId": function_call_id,
                "callFunction": {
                    "catalogId": resolved_cat,
                    "@call": compiled_call["@call"],
                    "args": compiled_call.get("args", {}),
                },
            },
        }

    def _build_surface_messages_for_component(
        self,
        comp_dict: dict[str, Any],
        *,
        surf_id: str,
        target_version: str,
        at_least_v10: bool,
        catalog_id_override: str = "",
    ) -> list[dict[str, Any]]:
        """Wraps a compiled root component into protocol surface message(s)."""
        sole_cat = catalog_id_override or surface_catalog_id(self._catalogs)
        create_body: dict[str, Any] = {"surfaceId": surf_id}
        if sole_cat is not None:
            create_body["catalogId"] = sole_cat

        if at_least_v10:
            create_body["components"] = [comp_dict]
            return [{"version": target_version, "createSurface": create_body}]

        return [
            {"version": target_version, "createSurface": create_body},
            {
                "version": target_version,
                "updateComponents": {
                    "surfaceId": surf_id,
                    "components": [comp_dict],
                },
            },
        ]

    def compile_dicts(
        self,
        raw_text: str,
        *,
        surface_id: str | None = None,
        catalog_id: str = "",
        is_final: bool = True,
        version: str | None = None,
        surface_offset: int = 0,
        call_offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int, int]:
        """Compiles Vertical statements into raw message dicts, returning `(messages, next_surface_offset, next_call_offset)`."""
        target_version = (
            normalize_wire_version(version) if version is not None else self.version
        )
        at_least_v10 = is_at_least_version(target_version, ProtocolVersion.V1_0)
        if self._is_multi_catalog and not at_least_v10:
            raise A2uiCatalogError(
                "Several catalogs need A2UI v1.0 or later, but the target version is"
                f" {target_version}."
            )

        resolved_surface_id = surface_id or self.surface_id
        clean_text = _strip_markdown_and_tags(raw_text)
        if not clean_text:
            return [], surface_offset, call_offset

        statements, _ = split_complete_statements(clean_text, is_final=is_final)
        messages: list[dict[str, Any]] = []
        surf_idx = surface_offset
        call_idx = call_offset

        for stmt in statements:
            surf_m = _SURFACE_DIRECTIVE_RE.match(stmt)
            if surf_m:
                resolved_surface_id = surf_m.group(1)
                surf_idx = 0
                continue

            call = self._parse_statement(stmt)
            if call is None:
                continue

            explicit_cat = call.kw_args.get("catalogId")
            if not self._defines_component(call.name, explicit_cat) and (
                call.name.startswith("@")
                or self._defines_function(call.name, explicit_cat)
            ):
                call_idx += 1
                messages.append(
                    self._compile_standalone_function_message(
                        call,
                        call_index=call_idx,
                        at_least_v10=at_least_v10,
                        target_version=target_version,
                    )
                )
                continue

            comp_dict = self._compile_component_call(
                call,
                at_least_v10=at_least_v10,
                target_version=target_version,
            )
            surf_id = (
                resolved_surface_id
                if surf_idx == 0
                else f"{resolved_surface_id}_{surf_idx}"
            )
            surf_idx += 1
            messages.extend(
                self._build_surface_messages_for_component(
                    comp_dict,
                    surf_id=surf_id,
                    target_version=target_version,
                    at_least_v10=at_least_v10,
                    catalog_id_override=catalog_id,
                )
            )

        return messages, surf_idx, call_idx

    def compile(
        self,
        raw_text: str,
        surface_id: str | None = None,
        catalog_id: str = "",
        is_final: bool = True,
        version: str | None = None,
    ) -> list[AgentToRendererMessage] | list[dict[str, Any]]:
        """Compiles raw Vertical text into validated `AgentToRendererMessage` models."""
        target_version = (
            normalize_wire_version(version) if version is not None else self.version
        )
        raw_messages, _, _ = self.compile_dicts(
            raw_text,
            surface_id=surface_id,
            catalog_id=catalog_id,
            is_final=is_final,
            version=target_version,
        )
        if not raw_messages:
            return []
        if target_version not in _PUBLISHED_WIRE_VERSIONS:
            return raw_messages
        return to_message_models(raw_messages)
