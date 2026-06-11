# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import re
import datetime
import math
from typing import Any, Dict, List, Optional
from ..catalog.functions import create_function_implementation
from .function_apis import (
    RequiredApi,
    RegexApi,
    LengthApi,
    NumericApi,
    EmailApi,
    FormatStringApi,
    FormatNumberApi,
    FormatCurrencyApi,
    FormatDateApi,
    PluralizeApi,
    OpenUrlApi,
    AndApi,
    OrApi,
    NotApi,
)
from .operator_apis import (
    AddApi,
    SubtractApi,
    MultiplyApi,
    DivideApi,
    EqualsApi,
    NotEqualsApi,
    GreaterThanApi,
    LessThanApi,
    ContainsApi,
    StartsWithApi,
    EndsWithApi,
)
from .expression_parser import ExpressionParser


def _to_float(val: Any) -> float:
    try:
        return float(val)
    except (ValueError, TypeError):
        raise ValueError(f"Cannot convert to number: {val}")


def _to_bool(val: Any) -> bool:
    return bool(val)


def _to_str(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, (dict, list)):
        import json

        return json.dumps(val, separators=(",", ":"))
    if isinstance(val, bool):
        return "true" if val else "false"
    return str(val)


RequiredImplementation = create_function_implementation(
    RequiredApi,
    lambda args, context=None, abort_signal=None: _to_bool(
        args.get("value") is not None
        and args.get("value") != ""
        and args.get("value") != []
    ),
)

RegexImplementation = create_function_implementation(
    RegexApi,
    lambda args, context=None, abort_signal=None: bool(
        re.search(_to_str(args.get("pattern", "")), _to_str(args.get("value", "")))
    ),
)

LengthImplementation = create_function_implementation(
    LengthApi,
    lambda args, context=None, abort_signal=None: (
        (
            args.get("min") is None
            or len(_to_str(args.get("value", ""))) >= int(args["min"])
        )
        and (
            args.get("max") is None
            or len(_to_str(args.get("value", ""))) <= int(args["max"])
        )
    ),
)

NumericImplementation = create_function_implementation(
    NumericApi,
    lambda args, context=None, abort_signal=None: (
        (args.get("min") is None or _to_float(args["value"]) >= _to_float(args["min"]))
        and (
            args.get("max") is None
            or _to_float(args["value"]) <= _to_float(args["max"])
        )
    ),
)

EmailImplementation = create_function_implementation(
    EmailApi,
    lambda args, context=None, abort_signal=None: bool(
        re.match(
            r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
            _to_str(args.get("value", "")),
        )
    ),
)


def _format_string(args, context=None, abort_signal=None):
    template = args.get("value", "")
    if not template:
        return ""

    parser = ExpressionParser()
    try:
        parts = parser.parse(template)
    except Exception:
        return template

    if not parts:
        return ""

    resolved_parts = []
    for part in parts:
        if context and hasattr(context, "resolve_dynamic_value"):
            resolved = context.resolve_dynamic_value(part)
        else:
            resolved = part
        resolved_parts.append(_to_str(resolved) if resolved is not None else "")

    return "".join(resolved_parts)


FormatStringImplementation = create_function_implementation(
    FormatStringApi, _format_string
)


def _format_number(args, context=None, abort_signal=None):
    val = _to_float(args.get("value", 0))
    decimals = args.get("decimals")
    grouping = args.get("grouping")
    if grouping is None:
        grouping = True

    if decimals is not None:
        fmt_str = f"{{:{',' if grouping else ''}.{int(decimals)}f}}"
    else:
        fmt_str = f"{{:{',' if grouping else ''}f}}"
    return fmt_str.format(val)


FormatNumberImplementation = create_function_implementation(
    FormatNumberApi, _format_number
)


def _format_currency(args, context=None, abort_signal=None):
    val = _to_float(args.get("value", 0))
    currency = args.get("currency", "USD")
    decimals = args.get("decimals")
    if decimals is None:
        decimals = 2
    else:
        decimals = int(decimals)
    grouping = args.get("grouping")
    if grouping is None:
        grouping = True
    symbol = "$" if currency == "USD" else (currency + " ")
    fmt_str = f"{{:{',' if grouping else ''}.{decimals}f}}"
    return symbol + fmt_str.format(val)


FormatCurrencyImplementation = create_function_implementation(
    FormatCurrencyApi, _format_currency
)


_DATE_TOKENS = re.compile(r"yyyy|yy|MMMM|MMM|MM|M|EEEE|E|dd|d|HH|H|hh|h|mm|ss|a|%")
_DATE_MAP = {
    "%": "%%",
    "yyyy": "%Y",
    "yy": "%y",
    "MMMM": "%B",
    "MMM": "%b",
    "MM": "%m",
    "M": "%m",
    "EEEE": "%A",
    "E": "%a",
    "dd": "%d",
    "d": "%d",
    "HH": "%H",
    "H": "%H",
    "hh": "%I",
    "h": "%I",
    "mm": "%M",
    "ss": "%S",
    "a": "%p",
}


def _format_date(args, context=None, abort_signal=None):
    val = args.get("value")
    fmt = args.get("format", "yyyy-MM-dd")
    if not val:
        return ""
    try:
        dt = datetime.datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        if fmt == "ISO":
            return dt.isoformat().replace("+00:00", ".000Z")
        py_fmt = _DATE_TOKENS.sub(lambda m: _DATE_MAP[m.group(0)], str(fmt))
        return dt.strftime(py_fmt)
    except Exception:
        return ""


FormatDateImplementation = create_function_implementation(FormatDateApi, _format_date)


def _pluralize(args, context=None, abort_signal=None):
    val = _to_float(args.get("value", 0))
    category = "other"
    if val == 0:
        category = "zero"
    elif val == 1:
        category = "one"
    elif val == 2:
        category = "two"
    res = args.get(category) or args.get("other") or ""
    return str(res)


PluralizeImplementation = create_function_implementation(PluralizeApi, _pluralize)

OpenUrlImplementation = create_function_implementation(
    OpenUrlApi, lambda args, context=None, abort_signal=None: None
)

AndImplementation = create_function_implementation(
    AndApi,
    lambda args, context=None, abort_signal=None: all(
        _to_bool(v) for v in args.get("values", [])
    ),
)

OrImplementation = create_function_implementation(
    OrApi,
    lambda args, context=None, abort_signal=None: any(
        _to_bool(v) for v in args.get("values", [])
    ),
)

NotImplementation = create_function_implementation(
    NotApi,
    lambda args, context=None, abort_signal=None: not _to_bool(args.get("value")),
)


def _add(args, context=None, abort_signal=None):
    res = _to_float(args["a"]) + _to_float(args["b"])
    return int(res) if res.is_integer() else res


AddImplementation = create_function_implementation(AddApi, _add)


def _subtract(args, context=None, abort_signal=None):
    res = _to_float(args["a"]) - _to_float(args["b"])
    return int(res) if res.is_integer() else res


SubtractImplementation = create_function_implementation(SubtractApi, _subtract)


def _multiply(args, context=None, abort_signal=None):
    res = _to_float(args["a"]) * _to_float(args["b"])
    return int(res) if res.is_integer() else res


MultiplyImplementation = create_function_implementation(MultiplyApi, _multiply)


def _divide(args, context=None, abort_signal=None):
    a = _to_float(args["a"])
    b = _to_float(args["b"])
    if b == 0:
        if a > 0:
            return math.inf
        elif a < 0:
            return -math.inf
        else:
            return math.nan
    res = a / b
    return int(res) if res.is_integer() else res


DivideImplementation = create_function_implementation(DivideApi, _divide)


EqualsImplementation = create_function_implementation(
    EqualsApi,
    lambda args, context=None, abort_signal=None: args.get("a") == args.get("b"),
)

NotEqualsImplementation = create_function_implementation(
    NotEqualsApi,
    lambda args, context=None, abort_signal=None: args.get("a") != args.get("b"),
)

GreaterThanImplementation = create_function_implementation(
    GreaterThanApi,
    lambda args, context=None, abort_signal=None: _to_float(args.get("a"))
    > _to_float(args.get("b")),
)

LessThanImplementation = create_function_implementation(
    LessThanApi,
    lambda args, context=None, abort_signal=None: _to_float(args.get("a"))
    < _to_float(args.get("b")),
)

ContainsImplementation = create_function_implementation(
    ContainsApi,
    lambda args, context=None, abort_signal=None: _to_str(args.get("substring", ""))
    in _to_str(args.get("string", "")),
)

StartsWithImplementation = create_function_implementation(
    StartsWithApi,
    lambda args, context=None, abort_signal=None: _to_str(
        args.get("string", "")
    ).startswith(_to_str(args.get("prefix", ""))),
)

EndsWithImplementation = create_function_implementation(
    EndsWithApi,
    lambda args, context=None, abort_signal=None: _to_str(
        args.get("string", "")
    ).endswith(_to_str(args.get("suffix", ""))),
)

BASIC_FUNCTION_IMPLEMENTATIONS = [
    RequiredImplementation,
    RegexImplementation,
    LengthImplementation,
    NumericImplementation,
    EmailImplementation,
    FormatStringImplementation,
    FormatNumberImplementation,
    FormatCurrencyImplementation,
    FormatDateImplementation,
    PluralizeImplementation,
    OpenUrlImplementation,
    AndImplementation,
    OrImplementation,
    NotImplementation,
    AddImplementation,
    SubtractImplementation,
    MultiplyImplementation,
    DivideImplementation,
    EqualsImplementation,
    NotEqualsImplementation,
    GreaterThanImplementation,
    LessThanImplementation,
    ContainsImplementation,
    StartsWithImplementation,
    EndsWithImplementation,
]
