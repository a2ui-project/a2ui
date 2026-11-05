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

"""Inline attribute expressions, data paths, and schema-driven coercion for A2UI XML."""

from __future__ import annotations

from dataclasses import dataclass, field
import html
import json
import math
import re
from typing import Any

from a2ui.inference_formats._shared import CatalogSchemaHelper

from .errors import A2uiXmlParseError, A2uiXmlValidationError

_RELATIVE_PATH_RE = re.compile(
    r"^\$(?:[a-zA-Z_@][a-zA-Z0-9_@/-]*|(?:0|[1-9][0-9]*)(?:/[a-zA-Z0-9_@/-]+)?)$"
)
_ABSOLUTE_PATH_RE = re.compile(r"^\$/[^\s]*$")
_SCHEMA_TYPE_CONSTRAINT_KEYS = frozenset({
    "type",
    "const",
    "enum",
    "$ref",
    "allOf",
    "oneOf",
    "anyOf",
    "properties",
    "items",
    "prefixItems",
    "not",
})
_CALL_START_RE = re.compile(
    r"^(?:\$([a-zA-Z_][a-zA-Z0-9_]*)|(Event))\s*\(([\s\S]*)\)\s*$"
)
_LENIENT_BARE_CALL_RE = re.compile(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)\s*$")
_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_NUMBER_RE = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$")


@dataclass(frozen=True)
class PathExpr:
    """Represents a dynamic data-model path reference such as ``$/user/name``."""

    path: str


@dataclass(frozen=True)
class CallExpr:
    """Represents a function or ``Event(...)`` invocation in an attribute."""

    name: str
    args: tuple[Any, ...] = ()
    kwargs: dict[str, Any] = field(default_factory=dict)
    is_event: bool = False


@dataclass(frozen=True)
class CheckExpr:
    """Represents a ``?checkName(...)`` validation rule expression."""

    name: str
    args: tuple[Any, ...] = ()
    kwargs: dict[str, Any] = field(default_factory=dict)


def unescape_xml_attr(raw: str) -> str:
    """Unescapes XML character entities in an attribute value."""
    return html.unescape(raw)


def parse_data_path(raw: str) -> PathExpr | None:
    """Parses a ``$``-prefixed data binding string if it is a valid A2UI path.

    Currency literals such as ``"$49.99"`` or ``"$1,500 USD"`` return ``None`` so
    they remain plain strings on ``DynamicString`` properties.
    """
    if raw == "$":
        return PathExpr("")
    if _ABSOLUTE_PATH_RE.match(raw):
        return PathExpr("/" + raw[2:])
    if _RELATIVE_PATH_RE.match(raw):
        return PathExpr(raw[1:])
    return None


def to_json_pointer(path_str: str) -> str:
    """Normalizes ``/foo``, ``$/foo``, ``$``, or ``$/`` into a JSON Pointer."""
    if path_str in ("", "$", "$/", "/"):
        return "/"
    if path_str.startswith("$/"):
        return "/" + path_str[2:]
    if path_str.startswith("$"):
        return "/" + path_str[1:]
    if path_str.startswith("/"):
        return path_str
    return "/" + path_str


def format_data_path(bound_path: str) -> str:
    """Formats an A2UI wire path back into A2UI XML ``$`` notation."""
    if bound_path == "":
        return "$"
    if bound_path == "/":
        return "$/"
    if bound_path.startswith("/"):
        return f"$/{bound_path[1:]}"
    return f"${bound_path}"


def schema_allows_databinding(schema: Any) -> bool:
    """Checks whether a property JSON schema permits a dynamic ``DataBinding``."""
    if not isinstance(schema, dict):
        return False
    if not any(k in schema for k in _SCHEMA_TYPE_CONSTRAINT_KEYS):
        return True
    ref = schema.get("$ref")
    if isinstance(ref, str) and ("DataBinding" in ref or "Dynamic" in ref):
        return True
    props = schema.get("properties")
    if isinstance(props, dict) and ("path" in props or "@path" in props):
        if "componentId" not in props:
            return True
    if "items" in schema and schema_allows_databinding(schema["items"]):
        return True
    for key in ("allOf", "oneOf", "anyOf"):
        subs = schema.get(key)
        if isinstance(subs, list) and any(schema_allows_databinding(s) for s in subs):
            return True
    return False


def schema_accepts_type(schema: Any, target_type: str) -> bool:
    """Checks whether ``schema`` accepts a primitive JSON type or ``Dynamic*`` ref."""
    if not isinstance(schema, dict):
        return False
    ref = schema.get("$ref")
    if isinstance(ref, str):
        ref_tail = ref.rsplit("/", 1)[-1]
        if target_type == "string" and ref_tail in (
            "DynamicString",
            "String",
            "DynamicValue",
        ):
            return True
        if target_type == "boolean" and ref_tail in (
            "DynamicBoolean",
            "Boolean",
            "DynamicValue",
        ):
            return True
        if target_type == "number" and ref_tail in (
            "DynamicNumber",
            "Number",
            "Weight",
            "DynamicValue",
        ):
            return True
        if target_type == "integer" and ref_tail in ("Integer",):
            return True
        if target_type == "array" and ref_tail in (
            "DynamicStringList",
            "ChildList",
            "DynamicValue",
        ):
            return True
    schema_type = schema.get("type")
    if schema_type == target_type:
        return True
    if target_type == "number" and schema_type == "integer":
        return True
    if isinstance(schema_type, list) and (
        target_type in schema_type
        or (target_type == "number" and "integer" in schema_type)
    ):
        return True
    if target_type == "string" and "enum" in schema:
        return all(isinstance(v, str) for v in schema["enum"])
    for key in ("allOf", "oneOf", "anyOf"):
        subs = schema.get(key)
        if isinstance(subs, list) and any(
            schema_accepts_type(s, target_type) for s in subs
        ):
            return True
    return False


def schema_is_dynamic_value(schema: Any) -> bool:
    """Returns True when ``schema`` references the untyped ``DynamicValue`` union."""
    if not isinstance(schema, dict):
        return False
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref.endswith("DynamicValue"):
        return True
    for key in ("allOf", "oneOf", "anyOf"):
        subs = schema.get(key)
        if isinstance(subs, list) and any(schema_is_dynamic_value(s) for s in subs):
            return True
    return False


def schema_is_unconstrained(
    schema: Any, helper: CatalogSchemaHelper | None = None
) -> bool:
    """Returns True when ``schema`` imposes no JSON type constraints (e.g. ``{}``)."""
    if not isinstance(schema, dict):
        return False
    ref = schema.get("$ref")
    if isinstance(ref, str) and helper is not None:
        if ref.endswith("DynamicValue"):
            return True
        if "common_types.json#/$defs/" in ref:
            def_name = ref.split("common_types.json#/$defs/", 1)[-1]
            resolved = helper.common_types.get(def_name)
            if isinstance(resolved, dict):
                return schema_is_unconstrained(resolved, helper)
        elif ref.startswith("#/$defs/"):
            defs = helper.catalog.get("$defs")
            if isinstance(defs, dict):
                resolved = defs.get(ref[8:])
                if isinstance(resolved, dict):
                    return schema_is_unconstrained(resolved, helper)
    for comb in ("allOf", "oneOf", "anyOf"):
        subs = schema.get(comb)
        if isinstance(subs, list) and subs:
            if comb == "allOf":
                return all(schema_is_unconstrained(s, helper) for s in subs)
            if any(schema_is_unconstrained(s, helper) for s in subs):
                return True
    return not any(k in schema for k in _SCHEMA_TYPE_CONSTRAINT_KEYS)


def parse_number_string(text: str, *, integer_only: bool = False) -> int | float:
    """Parses a numeric string into ``int`` or ``float``, rejecting non-finite values."""
    stripped = text.strip()
    if not _NUMBER_RE.match(stripped):
        raise A2uiXmlValidationError(f"Expected a numeric value, got {text!r}.")
    as_float = float(stripped)
    if not math.isfinite(as_float):
        raise A2uiXmlValidationError(f"Numeric literal {text!r} is out of range.")
    has_decimal = any(ch in stripped for ch in ".eE")
    if integer_only:
        if has_decimal:
            raise A2uiXmlValidationError(f"Expected an integer value, got {text!r}.")
        return int(stripped)
    if not has_decimal:
        return int(stripped)
    return as_float


class _ExprParser:
    """Recursive-descent parser for compact A2UI XML attribute expressions."""

    def __init__(self, text: str):
        self._text = text
        self._pos = 0
        self._n = len(text)

    def at_end(self) -> bool:
        self._skip_ws()
        return self._pos >= self._n

    def _skip_ws(self) -> None:
        while self._pos < self._n and self._text[self._pos].isspace():
            self._pos += 1

    def _peek(self) -> str:
        return self._text[self._pos] if self._pos < self._n else ""

    def parse_expr(self) -> Any:
        """Parses a single expression node."""
        self._skip_ws()
        if self._pos >= self._n:
            raise A2uiXmlParseError("Unexpected end of expression.")
        ch = self._peek()
        if ch in ('"', "'"):
            return self._parse_string()
        if ch == "[":
            return self._parse_list()
        if ch == "{":
            return self._parse_map()
        if ch == "?":
            return self._parse_check()
        if ch == "$":
            return self._parse_dollar()
        if (
            ch in "+-"
            or ch.isdigit()
            or (
                ch == "."
                and self._pos + 1 < self._n
                and self._text[self._pos + 1].isdigit()
            )
        ):
            return self._parse_number()
        return self._parse_ident_or_call()

    def _parse_string(self) -> str:
        quote = self._text[self._pos]
        self._pos += 1
        chars: list[str] = []
        while self._pos < self._n:
            ch = self._text[self._pos]
            self._pos += 1
            if ch == quote:
                return "".join(chars)
            if ch == "\\":
                if self._pos >= self._n:
                    raise A2uiXmlParseError(
                        "Unterminated escape sequence in string literal."
                    )
                esc = self._text[self._pos]
                self._pos += 1
                if esc == "n":
                    chars.append("\n")
                elif esc == "r":
                    chars.append("\r")
                elif esc == "t":
                    chars.append("\t")
                elif esc in ('"', "'", "\\", "$"):
                    chars.append(esc)
                else:
                    chars.append("\\" + esc)
            else:
                chars.append(ch)
        raise A2uiXmlParseError("Unterminated string literal in expression.")

    def _parse_list(self) -> list[Any]:
        self._pos += 1  # skip '['
        items: list[Any] = []
        while True:
            self._skip_ws()
            if self._pos >= self._n:
                raise A2uiXmlParseError("Unterminated '[' in expression.")
            if self._peek() == "]":
                self._pos += 1
                return items
            items.append(self.parse_expr())
            self._skip_ws()
            if self._peek() == ",":
                self._pos += 1
            elif self._peek() != "]":
                raise A2uiXmlParseError(
                    f"Expected ',' or ']' in list expression at position {self._pos}."
                )

    def _parse_map(self) -> dict[str, Any]:
        self._pos += 1  # skip '{'
        entries: dict[str, Any] = {}
        while True:
            self._skip_ws()
            if self._pos >= self._n:
                raise A2uiXmlParseError("Unterminated '{' in expression.")
            if self._peek() == "}":
                self._pos += 1
                return entries
            if self._peek() in ('"', "'"):
                key = self._parse_string()
            else:
                key = self._read_ident()
            self._skip_ws()
            if self._peek() not in (":", "="):
                raise A2uiXmlParseError(
                    f"Expected ':' after key {key!r} in map expression."
                )
            self._pos += 1
            val = self.parse_expr()
            entries[key] = val
            self._skip_ws()
            if self._peek() == ",":
                self._pos += 1
            elif self._peek() != "}":
                raise A2uiXmlParseError(
                    f"Expected ',' or '}}' in map expression at position {self._pos}."
                )

    def _parse_check(self) -> CheckExpr:
        self._pos += 1  # skip '?'
        name = self._read_ident()
        self._skip_ws()
        if self._peek() == "(":
            args, kwargs = self._parse_arg_list()
            return CheckExpr(name=name, args=tuple(args), kwargs=kwargs)
        return CheckExpr(name=name)

    def _parse_dollar(self) -> PathExpr | CallExpr:
        self._pos += 1  # skip '$'
        start = self._pos
        # Check if this is $fnName(...)
        if self._pos < self._n and (
            self._text[self._pos].isalpha() or self._text[self._pos] == "_"
        ):
            ident = self._read_ident()
            ws_end = self._pos
            while ws_end < self._n and self._text[ws_end].isspace():
                ws_end += 1
            if ws_end < self._n and self._text[ws_end] == "(":
                self._pos = ws_end
                args, kwargs = self._parse_arg_list()
                return CallExpr(name=ident, args=tuple(args), kwargs=kwargs)
            self._pos = start

        # Otherwise read path characters up to delimiter
        path_chars: list[str] = []
        while self._pos < self._n:
            ch = self._text[self._pos]
            if ch.isspace() or ch in (",", ")", "]", "}", ":"):
                break
            path_chars.append(ch)
            self._pos += 1
        raw_tail = "".join(path_chars)
        if not raw_tail:
            return PathExpr("")
        if raw_tail.startswith("/"):
            return PathExpr(raw_tail)
        return PathExpr(raw_tail)

    def _parse_number(self) -> int | float:
        match = re.match(
            r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?",
            self._text[self._pos :],
        )
        if not match:
            raise A2uiXmlParseError(
                f"Invalid number in expression at position {self._pos}."
            )
        token = match.group(0)
        self._pos += len(token)
        return parse_number_string(token)

    def _read_ident(self) -> str:
        match = re.match(r"[a-zA-Z_][a-zA-Z0-9_]*", self._text[self._pos :])
        if not match:
            raise A2uiXmlParseError(
                f"Expected identifier at position {self._pos} in {self._text!r}."
            )
        ident = match.group(0)
        self._pos += len(ident)
        return ident

    def _parse_ident_or_call(self) -> Any:
        ident = self._read_ident()
        self._skip_ws()
        if self._peek() == "(":
            args, kwargs = self._parse_arg_list()
            return CallExpr(
                name=ident,
                args=tuple(args),
                kwargs=kwargs,
                is_event=(ident == "Event"),
            )
        if ident == "true":
            return True
        if ident == "false":
            return False
        if ident == "null":
            return None
        if ident == "_":
            return None
        raise A2uiXmlParseError(
            f"Unexpected bare identifier {ident!r}; strings in expressions must be"
            " quoted."
        )

    def _parse_arg_list(self) -> tuple[list[Any], dict[str, Any]]:
        self._pos += 1  # skip '('
        args: list[Any] = []
        kwargs: dict[str, Any] = {}
        while True:
            self._skip_ws()
            if self._pos >= self._n:
                raise A2uiXmlParseError("Unterminated '(' in call expression.")
            if self._peek() == ")":
                self._pos += 1
                return args, kwargs

            # Check for named argument `key=val` or `key: val`
            kw_match = re.match(
                r"([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|:(?!=))",
                self._text[self._pos :],
            )
            if kw_match and not self._text[self._pos + kw_match.end() - 1 :].startswith(
                "=="
            ):
                key = kw_match.group(1)
                self._pos += kw_match.end()
                if key in kwargs:
                    raise A2uiXmlValidationError(f"Duplicate argument {key!r} in call.")
                kwargs[key] = self.parse_expr()
            else:
                if kwargs:
                    raise A2uiXmlParseError(
                        "Positional argument cannot follow keyword arguments in call."
                    )
                args.append(self.parse_expr())

            self._skip_ws()
            if self._peek() == ",":
                self._pos += 1
            elif self._peek() != ")":
                raise A2uiXmlParseError(
                    f"Expected ',' or ')' in argument list at position {self._pos}."
                )


def parse_expression(text: str) -> Any:
    """Parses a complete A2UI XML expression string into AST nodes or primitives."""
    parser = _ExprParser(text)
    value = parser.parse_expr()
    if not parser.at_end():
        raise A2uiXmlParseError(f"Trailing tokens in expression {text!r}.")
    return value


def parse_checks_attribute(raw: str) -> list[CheckExpr]:
    """Parses a ``checks="...\"`` attribute containing one or more ``?check`` rules."""
    stripped = raw.strip()
    if not stripped:
        return []
    if stripped.startswith("[") and stripped.endswith("]"):
        parsed = parse_expression(stripped)
        if not isinstance(parsed, list) or not all(
            isinstance(item, CheckExpr) for item in parsed
        ):
            raise A2uiXmlParseError(f"Invalid checks list expression: {raw!r}")
        return parsed

    parser = _ExprParser(stripped)
    checks: list[CheckExpr] = []
    while not parser.at_end():
        expr = parser.parse_expr()
        if isinstance(expr, CheckExpr):
            checks.append(expr)
        elif isinstance(expr, CallExpr) and not expr.is_event:
            checks.append(CheckExpr(name=expr.name, args=expr.args, kwargs=expr.kwargs))
        else:
            raise A2uiXmlParseError(
                f"Expected a ?check rule in checks attribute, got {raw!r}."
            )
        parser._skip_ws()  # pylint: disable=protected-access
        if parser._peek() == ",":  # pylint: disable=protected-access
            parser._pos += 1  # pylint: disable=protected-access
    return checks


def _try_unwrap_tuned_jsx_braces(
    stripped: str,
    raw: str,
    prop_schema: dict[str, Any] | None,
    helper: CatalogSchemaHelper | None,
    known_functions: set[str] | None,
    *,
    is_action: bool = False,
    strict: bool,
) -> tuple[bool, Any, str] | None:
    """Unwraps JSX ``{...}`` attribute wrappers in tuned mode.

    Returns ``(is_direct_value, direct_value, unwrapped_str)`` when ``stripped``
    is a JSX curly-brace wrapper around a primitive, array, quoted string, or
    A2UI XML expression; returns ``None`` when ``stripped`` should remain untouched.
    """
    if len(stripped) < 2 or not (stripped.startswith("{") and stripped.endswith("}")):
        return None
    inner = stripped[1:-1].strip()
    if not inner:
        return None

    def _reject_if_strict() -> None:
        if strict:
            raise A2uiXmlParseError(
                "Law 5 violation: do not wrap attribute values in curly"
                f" braces ({raw!r})."
            )

    accepts_str = not is_action and (
        prop_schema is None
        or schema_is_unconstrained(prop_schema, helper)
        or schema_accepts_type(prop_schema, "string")
    )

    # 1. Quoted string inside JSX braces: `text={"Quarterly Report"}` or `{'h2'}`
    if len(inner) >= 2 and inner[0] in ('"', "'") and inner[-1] == inner[0]:
        try:
            str_parser = _ExprParser(inner)
            parsed_str = str_parser.parse_expr()
            if str_parser.at_end() and isinstance(parsed_str, str):
                _reject_if_strict()
                return True, parsed_str, parsed_str
        except A2uiXmlParseError:
            pass

    if accepts_str:
        return None

    # 2. JSON array inside JSX braces: `items={["a", "b"]}`
    if inner.startswith("[") and inner.endswith("]"):
        if prop_schema is None or schema_accepts_type(prop_schema, "array"):
            _reject_if_strict()
            try:
                parsed_arr = json.loads(inner)
            except json.JSONDecodeError:
                parsed_expr = parse_expression(inner)
                if isinstance(parsed_expr, list):
                    return True, parsed_expr, inner
                return None
            if isinstance(parsed_arr, list):
                return True, parsed_arr, inner

    # 3. Primitive boolean / null / numeric literal inside JSX braces:
    #    `open={true}`, `roundedCorners="{true}"`, `cols={2}`
    if inner.lower() in ("true", "false", "null") or _NUMBER_RE.match(inner):
        _reject_if_strict()
        if prop_schema is None or schema_is_dynamic_value(prop_schema):
            low = inner.lower()
            if low == "true":
                return True, True, inner
            if low == "false":
                return True, False, inner
            if low == "null":
                return True, None, inner
            return True, parse_number_string(inner), inner
        return False, None, inner

    # 4. Path, check, Event, or catalog function call inside JSX braces
    if inner.startswith(("$", "?", "Event(")) or (
        known_functions
        and _LENIENT_BARE_CALL_RE.match(inner)
        and _LENIENT_BARE_CALL_RE.match(inner).group(1) in known_functions  # type: ignore[union-attr]
    ):
        _reject_if_strict()
        return False, None, inner

    return None


def parse_attribute_value(
    raw: str,
    prop_schema: dict[str, Any] | None,
    helper: CatalogSchemaHelper | None,
    *,
    is_action: bool = False,
    known_functions: set[str] | None = None,
    strict: bool = False,
    tuned: bool = False,
) -> tuple[Any, bool]:
    """Parses an unescaped XML attribute string according to its property schema.

    Args:
      raw: Unescaped string content of ``attr="raw"``.
      prop_schema: Catalog JSON schema for the target property, if known.
      helper: Active catalog schema helper, if known.
      is_action: True when the target slot is an ``Action`` property.
      known_functions: Active catalog function names for lenient bare-call detection.
      strict: Whether to reject lenient JSON/case fallbacks.
      tuned: Whether to enable tuned JSX brace and object/action healing.

    Returns:
      Tuple ``(parsed_value, used_lenient_recovery)``.
    """
    used_lenient = False
    candidate = raw

    # Leading backslashes before `$` escape one backslash layer (`\$...` -> `$...`,
    # `\\$...` -> `\$...`, `\\\$...` -> `\\$...`).
    if re.match(r"^\\+\$", candidate):
        return candidate[1:], False

    stripped = candidate.strip()
    has_outer_ws = candidate != stripped
    str_capable = not is_action and (
        prop_schema is None
        or schema_is_unconstrained(prop_schema, helper)
        or schema_accepts_type(prop_schema, "string")
    )

    if tuned:
        jsx_res = _try_unwrap_tuned_jsx_braces(
            stripped,
            raw,
            prop_schema,
            helper,
            known_functions,
            is_action=is_action,
            strict=strict,
        )
        if jsx_res is not None:
            is_direct, direct_val, unwrapped = jsx_res
            used_lenient = True
            if is_direct:
                if (
                    isinstance(direct_val, str)
                    and prop_schema is not None
                    and not schema_accepts_type(prop_schema, "string")
                ):
                    candidate = unwrapped
                    stripped = unwrapped.strip()
                    has_outer_ws = candidate != stripped
                else:
                    return direct_val, True
            else:
                candidate = unwrapped
                stripped = unwrapped.strip()
                has_outer_ws = candidate != stripped
    else:
        # Lenient recovery for JSX/Elemental `{...}` braces on non-string slots
        if (
            not str_capable
            and len(stripped) >= 2
            and stripped.startswith("{")
            and stripped.endswith("}")
        ):
            inner = stripped[1:-1].strip()
            if inner.startswith(("$", "?", "Event(")) or (
                known_functions
                and _LENIENT_BARE_CALL_RE.match(inner)
                and _LENIENT_BARE_CALL_RE.match(inner).group(1) in known_functions  # type: ignore[union-attr]
            ):
                if strict:
                    raise A2uiXmlParseError(
                        "Law 5 violation: do not wrap attribute expressions in curly"
                        f" braces ({raw!r})."
                    )
                used_lenient = True
                candidate = inner
                stripped = inner
                has_outer_ws = False

    # 1. Explicit `$fn(...)` or `Event(...)` call expression (without outer whitespace on string slots)
    if not (has_outer_ws and str_capable) and _CALL_START_RE.match(stripped):
        return parse_expression(stripped), used_lenient

    # 2. Lenient bare `fnName(...)` when slot is action or function is known
    bare_match = (
        None
        if (has_outer_ws and str_capable)
        else _LENIENT_BARE_CALL_RE.match(stripped)
    )
    if bare_match:
        fn_name = bare_match.group(1)
        fn_args_raw = bare_match.group(2).strip()
        if (
            tuned
            and is_action
            and not fn_args_raw
            and (known_functions is None or fn_name not in known_functions)
        ):
            # Heal JS-style `onClick="save()"` zero-arg event shorthand into `Event("save")`
            if strict:
                raise A2uiXmlParseError(
                    f"Action call {raw!r} uses unknown function {fn_name!r}."
                )
            return CallExpr(name="Event", args=(fn_name,), is_event=True), True
        if is_action or (
            known_functions is not None
            and fn_name in known_functions
            and (prop_schema is None or schema_allows_databinding(prop_schema))
        ):
            if not is_action and strict:
                raise A2uiXmlParseError(
                    "Function calls in A2UI XML attributes must start with '$' (got"
                    f" {raw!r}; write '${stripped}')."
                )
            if not is_action:
                used_lenient = True
            return parse_expression(stripped), used_lenient

    # 3. Action slot bare event name shorthand: `action="save_deal"`
    if is_action:
        if not stripped:
            raise A2uiXmlValidationError("Action attribute cannot be empty.")
        return CallExpr(name="Event", args=(stripped,), is_event=True), used_lenient

    # 4. Data binding `$path`
    path_expr = parse_data_path(stripped)
    if path_expr is not None and stripped == candidate:
        return path_expr, used_lenient

    # 5. Schema-driven primitive coercion
    if (
        prop_schema is not None
        and not schema_is_dynamic_value(prop_schema)
        and not schema_is_unconstrained(prop_schema, helper)
    ):
        accepts_str = schema_accepts_type(prop_schema, "string")
        accepts_bool = schema_accepts_type(prop_schema, "boolean")
        accepts_num = (
            helper.accepts_number(prop_schema)
            if helper is not None
            else schema_accepts_type(prop_schema, "number")
        )
        accepts_int_only = (
            schema_accepts_type(prop_schema, "integer")
            and not schema_accepts_type(prop_schema, "number")
        ) or (prop_schema.get("type") == "integer")
        accepts_arr = schema_accepts_type(prop_schema, "array")
        accepts_obj = schema_accepts_type(prop_schema, "object")

        if accepts_bool and not accepts_str:
            if stripped == "true":
                return True, used_lenient
            if stripped == "false":
                return False, used_lenient
            if not strict and stripped.lower() in ("true", "false"):
                return stripped.lower() == "true", True
            raise A2uiXmlValidationError(
                f"Expected 'true' or 'false' for boolean attribute, got {raw!r}."
            )

        if accepts_num and not accepts_str:
            return (
                parse_number_string(stripped, integer_only=accepts_int_only),
                used_lenient,
            )

        if accepts_arr and not accepts_str:
            if stripped == "[]":
                return [], used_lenient
            if strict:
                raise A2uiXmlParseError(
                    "Law 4/5 violation: array properties must use a fenced ```json"
                    f" block or child elements, not an inline attribute ({raw!r})."
                )
            try:
                parsed_json = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise A2uiXmlValidationError(
                    f"Expected an array or data binding, got {raw!r}."
                ) from exc
            if isinstance(parsed_json, list):
                return parsed_json, True
            raise A2uiXmlValidationError(
                f"Expected an array value, got {type(parsed_json).__name__}."
            )

        if tuned and accepts_obj and not accepts_str and stripped.startswith("{"):
            if strict:
                raise A2uiXmlParseError(
                    "Law 4/5 violation: object properties must use a fenced ```json"
                    f" block, not an inline attribute ({raw!r})."
                )
            try:
                parsed_obj = json.loads(stripped)
            except json.JSONDecodeError:
                parsed_obj = None
            if isinstance(parsed_obj, dict):
                return parsed_obj, True

    return candidate, used_lenient


def format_single_quoted_string(val: str) -> str:
    """Formats a string literal with single quotes for embedding inside ``attr="..."``."""
    escaped = (
        val.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f"'{escaped}'"


def format_xml_attr(val: str) -> str:
    """Escapes a string for a double-quoted A2UI XML attribute ``key="value"``."""
    escaped = (
        val.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "&#10;")
        .replace("\r", "&#13;")
        .replace("\t", "&#9;")
    )
    if escaped.endswith("\\"):
        escaped = escaped[:-1] + "&#92;"
    return f'"{escaped}"'


def format_expr_arg(val: Any) -> str:
    """Formats a Python value for use inside ``$fn(...)`` or ``Event(...)``."""
    if isinstance(val, PathExpr):
        return format_data_path(val.path)
    if isinstance(val, CallExpr):
        parts = [format_expr_arg(a) for a in val.args]
        parts.extend(f"{k}={format_expr_arg(v)}" for k, v in val.kwargs.items())
        prefix = "" if val.is_event else "$"
        return f"{prefix}{val.name}({', '.join(parts)})"
    if isinstance(val, CheckExpr):
        parts = [format_expr_arg(a) for a in val.args]
        parts.extend(f"{k}={format_expr_arg(v)}" for k, v in val.kwargs.items())
        return f"?{val.name}({', '.join(parts)})" if parts else f"?{val.name}"
    if isinstance(val, str):
        return format_single_quoted_string(val)
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        if not math.isfinite(val):
            raise A2uiXmlValidationError(f"Non-finite float {val} cannot be formatted.")
        return repr(val)
    if val is None:
        return "null"
    if isinstance(val, list):
        return "[" + ", ".join(format_expr_arg(item) for item in val) + "]"
    if isinstance(val, dict):
        entries = []
        for k, v in val.items():
            key_str = k if _IDENT_RE.match(k) else format_single_quoted_string(k)
            entries.append(f"{key_str}: {format_expr_arg(v)}")
        return "{" + ", ".join(entries) + "}"
    return format_single_quoted_string(str(val))
