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

from collections.abc import Mapping, Sequence, Set as AbstractSet
from dataclasses import dataclass
import json
import math
import re
from typing import Any, Literal

from a2ui.core import (
    A2uiCatalogError,
    A2uiParseError,
    A2uiValidationError,
    CatalogApi,
)
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

SUPPORTED_WIRE_VERSIONS = frozenset({"v0.9", "v0.9.1", "1.0"})

_HEALING_NEW_COMPONENT_PATTERN = re.compile(
    r"\s*(?:"
    r"[A-Z][^\W\d]*[\w]*\s*\("
    r"|<[A-Za-z0-9_]+"
    r"|(?:(?:var|val|let|\$[^\W\d][\w]*|[^\W\d][\w]*)\s*[:=]\s*)?[A-Z][\w]*\s*\("
    r")"
)

_OUTER_OPEN_TAG_RE = re.compile(
    r"^\s*<(?:a2ui-vertical|a2ui)(?:\s[^>]*)?>", re.IGNORECASE
)
_OUTER_CLOSE_TAG_RE = re.compile(r"</(?:a2ui-vertical|a2ui)\s*>\s*$", re.IGNORECASE)
_OUTER_LEADING_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n")
_OUTER_TRAILING_FENCE_RE = re.compile(r"(?:\r?\n)?[ \t]*```[a-zA-Z0-9_-]*\s*$")
_ASSIGN_PREFIX_RE = re.compile(
    r"^(?:(?:var|val|let)\s+)?(?:\$[^\W\d][\w]*|[^\W\d][\w]*)\s*[:=](?!=)\s*"
)
_CALL_HEADER_RE = re.compile(r"^(@?[^\W\d][\w]*)\s*\((.*)\)\s*;?$", re.DOTALL)
_UNCLOSED_CALL_HEADER_RE = re.compile(r"^(@?[^\W\d][\w]*)\s*\((.*)$", re.DOTALL)
_BARE_CHECK_IDENT_RE = re.compile(r"^[^\W\d][\w]*$")
_JSX_STMT_RE = re.compile(
    r"^<([^\W\d][\w]*)\b([^>]*)(?:/>|>(?:.*?</\1>)?)\s*;?$",
    re.DOTALL,
)
_JSX_ATTR_RE = re.compile(r'([^\W\d][\w]*)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s/>]+))')
_NUMBER_RE = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")
_INTEGER_STR_RE = re.compile(r"^[+-]?[0-9]+$")


class VerticalParseError(A2uiParseError):
    """Raised when a Vertical block cannot be lexed or parsed."""


class VerticalValidationError(A2uiValidationError):
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
    """Normalizes and validates a protocol version to its canonical wire spelling.

    v1.0 uses `'1.0'` without a leading `'v'`; v0.9 and v0.9.1 carry `'v'`.

    Raises:
        A2uiCatalogError: If `version` is not supported by the Vertical format.
    """
    cleaned = version.strip()
    normalized: str | None = None
    try:
        normalized = to_protocol_version(cleaned).value
    except ValueError:
        pass
    if normalized not in SUPPORTED_WIRE_VERSIONS:
        raise A2uiCatalogError(
            "Vertical format supports protocol versions v0.9, v0.9.1, and 1.0,"
            f" got {version!r}."
        )
    return normalized


def _strip_outer_tags_and_fences(text: str) -> str:
    """Removes outer sentinel tags and outer markdown code fences without touching interior literals."""
    if not text:
        return ""
    work = text.strip()
    work = _OUTER_LEADING_FENCE_RE.sub("", work, count=1)
    work = _OUTER_TRAILING_FENCE_RE.sub("", work, count=1).strip()

    open_m = _OUTER_OPEN_TAG_RE.match(work)
    if open_m:
        work = work[open_m.end() :]
        close_m = _OUTER_CLOSE_TAG_RE.search(work)
        if close_m:
            work = work[: close_m.start()]
        work = work.strip()

    work = _OUTER_LEADING_FENCE_RE.sub("", work, count=1)
    work = _OUTER_TRAILING_FENCE_RE.sub("", work, count=1).strip()
    if (
        len(work) >= 2
        and work.startswith("`")
        and work.endswith("`")
        and not work.startswith("```")
        and "`" not in work[1:-1]
    ):
        work = work[1:-1].strip()
    return work


def is_line_comment_start(text: str, i: int) -> int:
    """Returns comment marker length (1 for `#`, 2 for `//`) if `i` starts a line comment, else 0."""
    ch = text[i]
    if ch == "#":
        marker_len = 1
    elif text.startswith("//", i):
        marker_len = 2
    else:
        return 0

    if i > 0 and text[i - 1] not in (
        " ",
        "\t",
        "\r",
        "\n",
        ",",
        ";",
        "(",
        "[",
        "{",
        ")",
    ):
        return 0

    if marker_len == 1:
        j = i - 1
        while j >= 0 and text[j] in (" ", "\t"):
            j -= 1
        if (
            j >= 0
            and text[j] in ("=", ":")
            and i + 1 < len(text)
            and (text[i + 1].isalnum() or text[i + 1] == "_")
        ):
            return 0

    return marker_len


def _strip_comments_outside_strings(text: str, *, is_final: bool = True) -> str:
    """Strips `#`, `//`, and `/* ... */` comments outside string literals."""
    if not text:
        return ""
    out: list[str] = []
    in_quote: str | None = None
    raw_quote = False
    i = 0
    n = len(text)

    while i < n:
        ch = text[i]
        if in_quote is not None:
            if not raw_quote and ch == "\\":
                if i + 1 < n:
                    out.append(text[i : i + 2])
                    i += 2
                    continue
                out.append(ch)
                i += 1
                continue
            if text.startswith(in_quote, i):
                out.append(in_quote)
                i += len(in_quote)
                in_quote = None
                raw_quote = False
                continue
            out.append(ch)
            i += 1
            continue

        if text.startswith("/*", i):
            close_idx = text.find("*/", i + 2)
            if close_idx < 0:
                if not is_final:
                    out.append(text[i:])
                break
            segment = text[i + 2 : close_idx]
            newlines = "\n" * segment.count("\n")
            out.append(newlines if newlines else " ")
            i = close_idx + 2
            continue

        if is_line_comment_start(text, i):
            nl_idx = text.find("\n", i)
            if nl_idx < 0:
                break
            i = nl_idx
            continue

        if (
            ch in ("r", "R")
            and i + 1 < n
            and text[i + 1] in ('"', "'")
            and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] == "_"))
        ):
            q = text[i + 1]
            in_quote = q * 3 if text.startswith(q * 3, i + 1) else q
            raw_quote = True
            out.append(text[i : i + 1 + len(in_quote)])
            i += 1 + len(in_quote)
            continue

        if ch in ('"', "'"):
            in_quote = ch * 3 if text.startswith(ch * 3, i) else ch
            raw_quote = False
            out.append(in_quote)
            i += len(in_quote)
            continue

        out.append(ch)
        i += 1

    return "".join(out)


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
        if seg and seg != ";":
            cleaned = _OUTER_LEADING_FENCE_RE.sub("", seg, count=1)
            cleaned = _OUTER_TRAILING_FENCE_RE.sub("", cleaned, count=1).strip()
            if cleaned.endswith(";"):
                cleaned = cleaned[:-1].strip()
            if (
                len(cleaned) >= 2
                and cleaned.startswith("`")
                and cleaned.endswith("`")
                and not cleaned.startswith("```")
            ):
                cleaned = cleaned[1:-1].strip()
                if cleaned.endswith(";"):
                    cleaned = cleaned[:-1].strip()
            if cleaned and cleaned != "```":
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
            if (
                len(in_quote) == 1
                and ch == "\n"
                and heal_across_lines
                and _HEALING_NEW_COMPONENT_PATTERN.match(text, i + 1)
            ):
                in_quote = None
                raw_quote = False
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

        if text.startswith("/*", i):
            close_idx = text.find("*/", i + 2)
            if close_idx < 0:
                if is_final:
                    i = n
                break
            i = close_idx + 2
            continue

        at_top = paren_depth == 0 and bracket_depth == 0 and brace_depth == 0
        if is_line_comment_start(text, i):
            if at_top and text[stmt_start:i].strip():
                _flush(i)
            nl_idx = text.find("\n", i)
            if nl_idx < 0:
                if at_top:
                    stmt_start = n
                i = n
                break
            if at_top:
                stmt_start = nl_idx + 1
            i = nl_idx + 1
            continue

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
                paren_depth == 0
                and bracket_depth == 0
                and brace_depth == 0
                and saw_open_paren
            ):
                lead_slice = text[stmt_start:i].lstrip()
                if lead_slice.startswith("`") and not lead_slice.startswith("```"):
                    if i == n and not is_final:
                        break
                    if i < n and text[i] == "`":
                        i += 1
                if i < n and text[i] == ";":
                    i += 1
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
    cleaned_args = _strip_comments_outside_strings(args_str, is_final=True)
    chunks: list[str] = []
    chunk_start = 0
    paren_depth = 0
    bracket_depth = 0
    brace_depth = 0
    in_quote: str | None = None
    raw_quote = False
    i = 0
    n = len(cleaned_args)

    while i < n:
        ch = cleaned_args[i]
        if in_quote is not None:
            if not raw_quote and ch == "\\":
                i += 2
                continue
            if cleaned_args.startswith(in_quote, i):
                i += len(in_quote)
                in_quote = None
                raw_quote = False
                continue
            i += 1
            continue

        if (
            ch in ("r", "R")
            and i + 1 < n
            and cleaned_args[i + 1] in ('"', "'")
            and (
                i == 0
                or not (cleaned_args[i - 1].isalnum() or cleaned_args[i - 1] == "_")
            )
        ):
            q = cleaned_args[i + 1]
            in_quote = q * 3 if cleaned_args.startswith(q * 3, i + 1) else q
            raw_quote = True
            i += 1 + len(in_quote)
            continue

        if ch in ('"', "'"):
            in_quote = ch * 3 if cleaned_args.startswith(ch * 3, i) else ch
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
            piece = cleaned_args[chunk_start:i].strip()
            if piece:
                chunks.append(piece)
            chunk_start = i + 1

        i += 1

    tail = cleaned_args[chunk_start:].strip()
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

    # Leading colon syntax (:key "val" or :key = "val")
    if chunk.startswith(":") and len(chunk) > 1 and not chunk.startswith("::"):
        rest = chunk[1:].strip()
        eq_m = re.match(r"^([^\W\d][\w]*)\s*[:=]\s*(.+)$", rest, re.DOTALL)
        if eq_m:
            return eq_m.group(1), _parse_raw_value(eq_m.group(2))
        parts = rest.split(None, 1)
        if len(parts) == 2 and re.match(r"^[^\W\d][\w]*$", parts[0]):
            return parts[0], _parse_raw_value(parts[1])

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
        if parsed_key is not None:
            return parsed_key, _parse_raw_value(val_raw)
        key_str = key_raw[1:] if key_raw.startswith(":") else key_raw
        return key_str, _parse_raw_value(val_raw)

    return None, _parse_raw_value(chunk)


def _parse_call_args(inner: str) -> tuple[list[Any], dict[str, Any]]:
    """Parses comma-separated positional and keyword arguments inside `(...)`."""
    pos_args: list[Any] = []
    kw_args: dict[str, Any] = {}
    for arg_chunk in _split_args(inner):
        k, v = _parse_arg_chunk(arg_chunk)
        if k is not None:
            if k in kw_args:
                raise VerticalValidationError(f"Duplicate keyword argument {k!r}.")
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
        is_float_literal = (
            "." in num_candidate
            or "e" in num_candidate.lower()
            or val_str.endswith("%")
        )
        try:
            parsed_num: int | float = (
                float(num_candidate) if is_float_literal else int(num_candidate)
            )
        except OverflowError as err:
            raise VerticalParseError(
                f"Numeric literal out of range: {val_str!r}"
            ) from err
        except ValueError:
            parsed_num = float("nan")
        else:
            if isinstance(parsed_num, float) and not math.isfinite(parsed_num):
                raise VerticalParseError(f"Numeric literal out of range: {val_str!r}")
            return parsed_num

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
        if _BARE_CHECK_IDENT_RE.match(check_body):
            return _RawCheck(check_body, [], {})
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
            if k is None:
                raise VerticalParseError(
                    f"Malformed map literal entry {entry!r}; expected 'key: value'."
                )
            res_dict[k] = v
        return res_dict

    # 8. Call expression: Event(...), fn(...), @index(...)
    call_m = _CALL_HEADER_RE.match(val_str) or _UNCLOSED_CALL_HEADER_RE.match(val_str)
    if call_m:
        fn_name = call_m.group(1)
        inner = (call_m.group(2) or "").strip()
        pos_args, kw_args = _parse_call_args(inner)
        return _RawCall(fn_name, pos_args, kw_args)

    # 9. Permissive fallback to unquoted string literal
    return val_str


def _expected_primitive_type(schema: Any) -> str | None:
    """Resolves the expected primitive type (`number`, `integer`, `boolean`, `string`) from a schema."""
    if not isinstance(schema, Mapping):
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


def schema_allows_databinding(prop_schema: Any) -> bool:
    """Checks whether a property JSON schema permits dynamic `$path` data bindings."""
    if not isinstance(prop_schema, Mapping):
        return False
    ref = prop_schema.get("$ref")
    if isinstance(ref, str) and ("DataBinding" in ref or "Dynamic" in ref):
        return True
    props = prop_schema.get("properties")
    if (
        isinstance(props, Mapping)
        and ("path" in props or "@path" in props)
        and "componentId" not in props
    ):
        return True
    if "items" in prop_schema and schema_allows_databinding(prop_schema["items"]):
        return True
    for key in ("oneOf", "anyOf", "allOf"):
        subs = prop_schema.get(key)
        if isinstance(subs, list) and any(
            schema_allows_databinding(sub) for sub in subs
        ):
            return True
    return False


def _has_child_ref(schema: Any) -> bool:
    if not isinstance(schema, Mapping):
        return False
    ref = schema.get("$ref")
    if isinstance(ref, str) and (
        "ComponentId" in ref or ref.endswith("/Child") or ref.endswith("/ChildList")
    ):
        return True
    if "items" in schema and _has_child_ref(schema["items"]):
        return True
    for key in ("oneOf", "anyOf", "allOf"):
        subs = schema.get(key)
        if isinstance(subs, list) and any(_has_child_ref(s) for s in subs):
            return True
    return False


def is_child_slot(
    helper: CatalogSchemaHelper | None, comp_name: str, prop_name: str
) -> bool:
    """Returns True if `prop_name` on `comp_name` is a child component ID slot."""
    if helper is None or comp_name not in helper.components:
        return prop_name in ("child", "children")
    p_type = helper.get_property_type(comp_name, prop_name)
    if p_type in ("Child", "ChildList"):
        return True
    p_schema = helper.get_property_schema(comp_name, prop_name)
    if _has_child_ref(p_schema):
        return True
    if not helper.common_types_loaded and prop_name in ("child", "children"):
        if isinstance(p_schema, Mapping) and p_schema.get("type") in (
            "integer",
            "number",
            "boolean",
            "object",
        ):
            return False
        return True
    return False


def is_prop_action_slot(
    helper: CatalogSchemaHelper | None, comp_name: str, prop_name: str
) -> bool:
    """Returns True if `prop_name` on `comp_name` is an `Action` slot."""
    if helper is None or comp_name not in helper.components:
        return False
    if helper.get_property_type(comp_name, prop_name) == "Action":
        return True
    p_schema = helper.get_property_schema(comp_name, prop_name)
    if is_action_slot(p_schema):
        return True
    if (
        not helper.common_types_loaded
        and prop_name == "action"
        and isinstance(p_schema, Mapping)
        and p_schema.get("type") in (None, "Action")
    ):
        return True
    return False


def _contains_raw_path(node: Any) -> bool:
    """Returns True if `node` holds a `_RawPath` outside of any `_RawCall`."""
    if isinstance(node, _RawPath):
        return True
    if isinstance(node, dict):
        return any(_contains_raw_path(v) for v in node.values())
    if isinstance(node, list):
        return any(_contains_raw_path(v) for v in node)
    return False


def _contains_raw_call(node: Any) -> str | None:
    """Returns the first nested `_RawCall` name inside `node`, if any."""
    if isinstance(node, _RawCall):
        return node.name
    if isinstance(node, _RawCheck):
        return f"?{node.name}"
    if isinstance(node, dict):
        for v in node.values():
            found = _contains_raw_call(v)
            if found:
                return found
    if isinstance(node, list):
        for v in node:
            found = _contains_raw_call(v)
            if found:
                return found
    return None


def ordered_component_properties(
    helper: CatalogSchemaHelper, comp_name: str
) -> list[str]:
    """Returns non-structural, non-child component properties ordered by `positionalIndex` then schema order."""
    raw_props = [
        p
        for p in helper.get_component_properties(comp_name)
        if p not in ("component", "id", "catalogId", "checks", "weight")
        and not is_child_slot(helper, comp_name, p)
    ]

    def _sort_key(item: tuple[int, str]) -> tuple[int, int]:
        idx, prop = item
        schema = helper.get_property_schema(comp_name, prop)
        pos_idx = (
            schema.get("positionalIndex", 999)
            if isinstance(schema, Mapping)
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
        raw_ver = (
            version
            if version is not None
            else catalogs_protocol_version(self._catalogs)
        )
        self.version = normalize_wire_version(raw_ver)
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
        return bool(catalogs_defining(self.helpers, "component", name))

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
    ) -> tuple[str, CatalogSchemaHelper, str | None]:
        """Resolves a component or function name across active catalogs.

        Returns `(canonical_name, helper, write_catalog_id)`.
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
            if name not in defined:
                raise VerticalValidationError(
                    f"Unknown {label} '{name}' not defined in catalog '{catalog_id}'."
                )
            return name, helper, catalog_id

        matches = catalogs_defining(self.helpers, kind, name)
        if len(matches) > 1:
            raise VerticalValidationError(
                f"{label.capitalize()} '{name}' is defined in several catalogs:"
                f' {matches}. Specify catalogId="..." to disambiguate.'
            )
        if not matches:
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
            name,
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
            except json.JSONDecodeError as err:
                raise VerticalParseError(
                    f"Malformed JSON fallback statement: {stmt!r}"
                ) from err

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
        if not name.startswith("@") and not is_valid_uax31_identifier(name):
            raise VerticalParseError(f"Invalid identifier {name!r} in statement.")
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
        if len(call.pos_args) > 2:
            raise VerticalValidationError(
                "Event() accepts at most 2 positional arguments (name, context),"
                f" got {len(call.pos_args)}."
            )

        path_key = "@path" if at_least_v10 else "path"
        call_key = "@call" if at_least_v10 else "call"
        event_name: str | None = None
        context: dict[str, Any] = {}
        has_pos_context = False
        user_message: Any = None
        has_user_message = False

        if call.pos_args:
            compiled_name = self._compile_value(
                call.pos_args[0],
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

        if len(call.pos_args) == 2:
            pos_ctx = call.pos_args[1]
            if not isinstance(pos_ctx, dict):
                raise VerticalValidationError(
                    "Event() second positional argument must be a context map,"
                    f" got {pos_ctx!r}."
                )
            has_pos_context = True
            for ck, cv in pos_ctx.items():
                context[ck] = self._compile_value(
                    cv,
                    schema=None,
                    helper=None,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )

        for k, v in call.kw_args.items():
            if k == "name":
                if event_name is not None:
                    raise VerticalValidationError(
                        "Event() specifies 'name' both positionally and by keyword."
                    )
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
                compiled_um = self._compile_value(
                    v,
                    schema=None,
                    helper=None,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )
                is_binding_or_call = isinstance(compiled_um, dict) and (
                    path_key in compiled_um or call_key in compiled_um
                )
                if not isinstance(compiled_um, str) and not is_binding_or_call:
                    raise VerticalValidationError(
                        "Event() userMessage must be a string, a $path binding,"
                        f" or a function call, got {compiled_um!r}."
                    )
                has_user_message = True
                user_message = compiled_um
            elif k == "context":
                if has_pos_context:
                    raise VerticalValidationError(
                        "Event() specifies 'context' both positionally and by keyword."
                    )
                if not isinstance(v, dict):
                    raise VerticalValidationError(
                        f"Event() context= must be a map, got {v!r}."
                    )
                for ck, cv in v.items():
                    context[ck] = self._compile_value(
                        cv,
                        schema=None,
                        helper=None,
                        at_least_v10=at_least_v10,
                        target_version=target_version,
                    )
            else:
                if has_pos_context:
                    raise VerticalValidationError(
                        "Event() cannot mix positional context map with extra keyword"
                        f" {k!r}."
                    )
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
        if context or has_pos_context or "context" in call.kw_args:
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
            if k not in fn_props:
                raise VerticalValidationError(
                    f"Unknown parameter '{k}' for function '{fn_name}'."
                    f" Expected one of: {fn_props}."
                )
            if k in args_obj:
                raise VerticalValidationError(
                    f"Parameter '{k}' of function '{fn_name}' specified both"
                    " positionally and by keyword."
                )
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
        sibling_binding: dict[str, str] | None,
        at_least_v10: bool,
        target_version: str,
    ) -> dict[str, Any]:
        """Compiles a `?check(...)` rule into a protocol `CheckRule` dictionary."""
        kw = dict(check.kw_args)
        pos = list(check.pos_args)
        explicit_cat_id = kw.pop("catalogId", None)

        # Support `{catalogId: "..."}` option map as in Express
        remaining_pos: list[Any] = []
        for pos_item in pos:
            if isinstance(pos_item, dict) and "catalogId" in pos_item:
                if set(pos_item.keys()) != {"catalogId"}:
                    raise VerticalValidationError(
                        f"Check '?{check.name}' option map may only contain"
                        " 'catalogId'."
                    )
                map_cat_id = pos_item["catalogId"]
                if not isinstance(map_cat_id, str) or not map_cat_id:
                    raise VerticalValidationError(
                        f"Check '?{check.name}' catalogId must be a non-empty string,"
                        f" got: {map_cat_id!r}."
                    )
                if explicit_cat_id is not None and explicit_cat_id != map_cat_id:
                    raise VerticalValidationError(
                        f"Check '?{check.name}' specifies conflicting catalogId values."
                    )
                explicit_cat_id = map_cat_id
                continue
            remaining_pos.append(pos_item)
        pos = remaining_pos

        fn_name, fn_helper, write_cat_id = self._resolve_catalog_item(
            "function",
            check.name,
            explicit_cat_id,
            at_least_v10=at_least_v10,
            target_version=target_version,
        )

        fn_props = fn_helper.get_function_properties(fn_name)
        args_obj: dict[str, Any] = {}
        custom_message: Any = kw.pop("message", None)
        if custom_message is not None and not isinstance(custom_message, str):
            raise VerticalValidationError(
                f"Check '?{fn_name}' message must be a string, got: {custom_message!r}."
            )

        # Auto-bind first `value` parameter when component `value` is a `$path` binding
        remaining_props = list(fn_props)
        has_explicit_pos_binding = bool(pos) and isinstance(pos[0], _RawPath)
        if (
            remaining_props
            and remaining_props[0] == "value"
            and "value" not in kw
            and not has_explicit_pos_binding
        ):
            if sibling_binding is None:
                raise VerticalValidationError(
                    f"Check '?{fn_name}' requires a '$path' binding on the"
                    " component's 'value' property or as its first argument."
                )
            args_obj["value"] = sibling_binding
            remaining_props = remaining_props[1:]

        for idx, pos_val in enumerate(pos):
            if idx >= len(remaining_props):
                if (
                    idx == len(pos) - 1
                    and isinstance(pos_val, str)
                    and custom_message is None
                ):
                    custom_message = pos_val
                    continue
                raise VerticalValidationError(
                    f"Check '?{fn_name}' received too many arguments."
                )
            param_name = remaining_props[idx]
            param_schema = fn_helper.get_function_property_schema(fn_name, param_name)
            if (
                isinstance(pos_val, str)
                and _expected_primitive_type(param_schema)
                in ("integer", "number", "boolean")
                and idx == len(pos) - 1
                and custom_message is None
            ):
                custom_message = pos_val
                break
            args_obj[param_name] = self._compile_value(
                pos_val,
                schema=param_schema,
                helper=fn_helper,
                at_least_v10=at_least_v10,
                target_version=target_version,
            )

        for k, v in kw.items():
            if k not in fn_props:
                raise VerticalValidationError(
                    f"Unknown parameter '{k}' in check '?{fn_name}'."
                )
            if k in args_obj:
                raise VerticalValidationError(
                    f"Duplicate parameter '{k}' in check '?{fn_name}'."
                )
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

        if isinstance(val, _RawCheck):
            rule = self._compile_check_rule(
                val,
                sibling_binding=None,
                at_least_v10=at_least_v10,
                target_version=target_version,
            )
            return rule["condition"]

        if isinstance(val, _RawCall):
            if val.name == "Event" and "catalogId" not in val.kw_args:
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
                    in_action_slot=is_action_slot(item_schema),
                )
                for item in val
            ]

        if isinstance(val, dict):
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
                if not _NUMBER_RE.match(cleaned):
                    return val
                if expected_type == "integer":
                    if _INTEGER_STR_RE.match(cleaned):
                        return int(cleaned)
                    try:
                        f_val = float(cleaned)
                    except OverflowError as err:
                        raise VerticalValidationError(
                            f"Numeric value out of finite range: {val!r}."
                        ) from err
                    except ValueError:
                        return val
                    if not math.isfinite(f_val):
                        raise VerticalValidationError(
                            f"Numeric value out of finite range: {val!r}."
                        )
                    if f_val.is_integer():
                        try:
                            return int(f_val)
                        except OverflowError as err:
                            raise VerticalValidationError(
                                f"Numeric value out of finite range: {val!r}."
                            ) from err
                    raise VerticalValidationError(
                        f"Expected an integer value, got non-integral {val!r}."
                    )
                if "." in cleaned or "e" in cleaned.lower():
                    try:
                        f_val = float(cleaned)
                    except OverflowError as err:
                        raise VerticalValidationError(
                            f"Numeric value out of finite range: {val!r}."
                        ) from err
                    except ValueError:
                        return val
                    if not math.isfinite(f_val):
                        raise VerticalValidationError(
                            f"Numeric value out of finite range: {val!r}."
                        )
                    return f_val
                return int(cleaned)
            elif isinstance(val, float) and not isinstance(val, bool):
                if not math.isfinite(val):
                    raise VerticalValidationError(
                        f"Numeric value out of finite range: {val!r}."
                    )
                if expected_type == "integer":
                    if val.is_integer():
                        return int(val)
                    raise VerticalValidationError(
                        f"Expected an integer value, got non-integral {val!r}."
                    )
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
        nested_call = _contains_raw_call(raw_ext)
        if nested_call is not None:
            raise VerticalValidationError(
                f"Component '{comp_name}' extensions cannot contain '{nested_call}'."
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
        )

        comp_dict: dict[str, Any] = {"id": "root", "component": matched_name}
        if write_cat_id is not None:
            comp_dict["catalogId"] = write_cat_id

        declared_props = comp_helper.get_component_properties(matched_name)
        declared_set = set(declared_props)
        ordered_props = ordered_component_properties(comp_helper, matched_name)

        if "extensions" in kw and "extensions" not in declared_set:
            raw_ext = kw.pop("extensions")
            comp_dict["metadata"] = {
                "extensions": self._compile_extensions(
                    raw_ext,
                    comp_name=matched_name,
                    at_least_v10=at_least_v10,
                    target_version=target_version,
                )
            }
        elif "metadata" in kw and "metadata" not in declared_set:
            raw_meta = kw.pop("metadata")
            if isinstance(raw_meta, dict) and set(raw_meta.keys()) == {"extensions"}:
                comp_dict["metadata"] = {
                    "extensions": self._compile_extensions(
                        raw_meta["extensions"],
                        comp_name=matched_name,
                        at_least_v10=at_least_v10,
                        target_version=target_version,
                    )
                }
            else:
                raise VerticalValidationError(
                    f"Unknown property 'metadata' on component '{matched_name}'."
                )

        raw_checks: list[_RawCheck] = []
        dict_checks: list[dict[str, Any]] = []
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
            if (
                not comp_helper.is_checkable(matched_name)
                and "checks" not in declared_set
            ):
                raise VerticalValidationError(
                    f"Component '{matched_name}' does not declare validation checks."
                )
            kw_checks = kw.pop("checks")
            if isinstance(kw_checks, _RawCheck):
                raw_checks.append(kw_checks)
            elif isinstance(kw_checks, list):
                for item in kw_checks:
                    if isinstance(item, _RawCheck):
                        raw_checks.append(item)
                    elif isinstance(item, dict):
                        compiled_chk = self._compile_value(
                            item,
                            schema=None,
                            helper=comp_helper,
                            at_least_v10=at_least_v10,
                            target_version=target_version,
                        )
                        assert isinstance(compiled_chk, dict)
                        dict_checks.append(compiled_chk)
                    else:
                        raise VerticalValidationError(
                            f"Invalid check item {item!r} on component"
                            f" '{matched_name}'."
                        )
            else:
                raise VerticalValidationError(
                    f"Property 'checks' on component '{matched_name}' must be a list"
                    f" of checks, got {kw_checks!r}."
                )

        if len(pos_values) > len(ordered_props):
            raise VerticalValidationError(
                f"Component '{matched_name}' accepts at most {len(ordered_props)}"
                f" positional arguments ({ordered_props}), got {len(pos_values)}."
            )

        raw_value_ast: Any = None
        for idx, arg_val in enumerate(pos_values):
            prop_name = ordered_props[idx]
            p_schema = comp_helper.get_property_schema(matched_name, prop_name)
            if (
                _contains_raw_path(arg_val)
                and p_schema is not None
                and not schema_allows_databinding(p_schema)
            ):
                raise VerticalValidationError(
                    f"Property '{prop_name}' on component '{matched_name}' is static"
                    " and does not accept '$path' data bindings."
                )
            if prop_name == "value":
                raw_value_ast = arg_val
            comp_dict[prop_name] = self._compile_value(
                arg_val,
                schema=p_schema,
                helper=comp_helper,
                at_least_v10=at_least_v10,
                target_version=target_version,
                in_action_slot=is_prop_action_slot(
                    comp_helper, matched_name, prop_name
                ),
            )

        for k, v in kw.items():
            if k not in declared_set:
                raise VerticalValidationError(
                    f"Unknown property '{k}' on component '{matched_name}'."
                    f" Allowed properties: {declared_props}."
                )
            if k in comp_dict:
                raise VerticalValidationError(
                    f"Duplicate property '{k}' on component '{matched_name}'."
                )
            p_schema = comp_helper.get_property_schema(matched_name, k)
            if (
                _contains_raw_path(v)
                and p_schema is not None
                and not schema_allows_databinding(p_schema)
            ):
                raise VerticalValidationError(
                    f"Property '{k}' on component '{matched_name}' is static"
                    " and does not accept '$path' data bindings."
                )
            if k == "value":
                raw_value_ast = v
            comp_dict[k] = self._compile_value(
                v,
                schema=p_schema,
                helper=comp_helper,
                at_least_v10=at_least_v10,
                target_version=target_version,
                in_action_slot=is_prop_action_slot(comp_helper, matched_name, k),
            )

        if dict_checks:
            comp_dict.setdefault("checks", []).extend(dict_checks)

        if raw_checks:
            if (
                not comp_helper.is_checkable(matched_name)
                and "checks" not in declared_set
            ):
                raise VerticalValidationError(
                    f"Component '{matched_name}' does not declare validation checks."
                )
            path_key = "@path" if at_least_v10 else "path"
            sibling_binding: dict[str, str] | None = None
            if isinstance(raw_value_ast, _RawPath):
                sibling_binding = {path_key: raw_value_ast.pointer}
            elif (
                isinstance(raw_value_ast, dict)
                and set(raw_value_ast.keys()) == {path_key}
                and isinstance(raw_value_ast.get(path_key), str)
            ):
                sibling_binding = {path_key: raw_value_ast[path_key]}

            compiled_rules = [
                self._compile_check_rule(
                    chk,
                    sibling_binding=sibling_binding,
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
        existing_surface_ids: AbstractSet[str] = frozenset(),
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
        clean_text = _strip_outer_tags_and_fences(raw_text)
        if not clean_text:
            return [], surface_offset, call_offset

        statements, _ = split_complete_statements(clean_text, is_final=is_final)
        messages: list[dict[str, Any]] = []
        surf_idx = surface_offset
        call_idx = call_offset
        used_surfaces = set(existing_surface_ids)

        for stmt in statements:
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
            while True:
                candidate = (
                    resolved_surface_id
                    if surf_idx == 0
                    else f"{resolved_surface_id}_{surf_idx}"
                )
                surf_idx += 1
                if candidate not in used_surfaces:
                    surf_id = candidate
                    used_surfaces.add(surf_id)
                    break

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
        *,
        surface_id: str | None = None,
        catalog_id: str = "",
        is_final: bool = True,
        version: str | None = None,
        existing_surface_ids: AbstractSet[str] = frozenset(),
        call_offset: int = 0,
    ) -> list[AgentToRendererMessage]:
        """Compiles raw Vertical text into validated `AgentToRendererMessage` models."""
        raw_msgs, _, _ = self.compile_dicts(
            raw_text,
            surface_id=surface_id,
            catalog_id=catalog_id,
            is_final=is_final,
            version=version,
            existing_surface_ids=existing_surface_ids,
            call_offset=call_offset,
        )
        return to_message_models(raw_msgs)
