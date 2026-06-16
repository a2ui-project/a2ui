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
from ..rendering import DataContext
from ..common.events import AbortSignal
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
from .locale_config import get_locale_rules, CURRENCY_SYMBOLS


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


def _format_string(
    args: Dict[str, Any],
    context: DataContext,
    abort_signal: Optional[AbortSignal] = None,
) -> str:
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


def _format_numeric_locale(
    val: float,
    decimals: Optional[int],
    grouping: bool,
    locale: Optional[str],
) -> str:
    rules = get_locale_rules(locale)

    if decimals is not None:
        raw_str = f"{val:{',' if grouping else ''}.{decimals}f}"
    else:
        raw_str = f"{val:,}" if grouping else str(val)

    if rules.decimal_separator != "." or (grouping and rules.grouping_separator != ","):
        if rules.decimal_separator == ",":
            group_sep = rules.grouping_separator
            return raw_str.replace(",", "~").replace(".", ",").replace("~", group_sep)
        elif rules.decimal_separator != ".":
            return raw_str.replace(",", rules.grouping_separator).replace(
                ".", rules.decimal_separator
            )
    return raw_str


def create_format_number_implementation(
    locale: Optional[str] = None,
) -> FunctionImplementation:
    def _format_number(
        args: Dict[str, Any],
        context: DataContext,
        abort_signal: Optional[AbortSignal] = None,
    ) -> str:
        val = _to_float(args.get("value", 0))
        decimals = int(args["decimals"]) if args.get("decimals") is not None else None
        grouping = True if args.get("grouping") is None else bool(args["grouping"])
        return _format_numeric_locale(val, decimals, grouping, locale)

    return create_function_implementation(FormatNumberApi, _format_number)


FormatNumberImplementation = create_format_number_implementation(None)


def create_format_currency_implementation(
    locale: Optional[str] = None,
) -> FunctionImplementation:
    def _format_currency(
        args: Dict[str, Any],
        context: DataContext,
        abort_signal: Optional[AbortSignal] = None,
    ) -> str:
        val = _to_float(args.get("value", 0))
        currency = str(args.get("currency", "USD")).upper()
        decimals = int(args["decimals"]) if args.get("decimals") is not None else 2
        grouping = True if args.get("grouping") is None else bool(args["grouping"])

        num_str = _format_numeric_locale(val, decimals, grouping, locale)
        symbol = CURRENCY_SYMBOLS.get(currency, currency)

        rules = get_locale_rules(locale)

        space = (
            " "
            if rules.currency_space_separated
            or (len(symbol) > 1 and symbol not in {"$", "£", "€", "¥"})
            else ""
        )
        if rules.currency_symbol_after:
            return f"{num_str}{space}{symbol}"
        return f"{symbol}{space}{num_str}"

    return create_function_implementation(FormatCurrencyApi, _format_currency)


FormatCurrencyImplementation = create_format_currency_implementation(None)


_DATE_TOKENS = re.compile(r"yyyy|yy|MMMM|MMM|MM|M|EEEE|E|dd|d|HH|H|hh|h|mm|ss|a|%")


def create_format_date_implementation(
    locale: Optional[str] = None,
) -> FunctionImplementation:
    def _format_date(
        args: Dict[str, Any],
        context: DataContext,
        abort_signal: Optional[AbortSignal] = None,
    ) -> str:
        val = args.get("value")
        fmt = str(args.get("format", "yyyy-MM-dd"))
        if not val:
            return ""
        try:
            dt = datetime.datetime.fromisoformat(str(val).replace("Z", "+00:00"))
            if fmt == "ISO":
                return dt.isoformat().replace("+00:00", ".000Z")

            rules = get_locale_rules(locale)

            def _sub(m: re.Match) -> str:
                tok = m.group(0)
                if tok == "yyyy":
                    return str(dt.year)
                if tok == "yy":
                    return str(dt.year)[-2:]
                if tok == "MMMM":
                    return rules.months_long[dt.month]
                if tok == "MMM":
                    return rules.months_short[dt.month]
                if tok == "MM":
                    return f"{dt.month:02d}"
                if tok == "M":
                    return str(dt.month)
                if tok == "EEEE":
                    return rules.weekdays_long[dt.weekday()]
                if tok == "E":
                    return rules.weekdays_short[dt.weekday()]
                if tok == "dd":
                    return f"{dt.day:02d}"
                if tok == "d":
                    return str(dt.day)
                if tok == "HH":
                    return f"{dt.hour:02d}"
                if tok == "H":
                    return str(dt.hour)
                if tok == "hh":
                    hr = dt.hour % 12
                    return f"{(hr or 12):02d}"
                if tok == "h":
                    hr = dt.hour % 12
                    return str(hr or 12)
                if tok == "mm":
                    return f"{dt.minute:02d}"
                if tok == "ss":
                    return f"{dt.second:02d}"
                if tok == "a":
                    return "AM" if dt.hour < 12 else "PM"
                return tok

            return _DATE_TOKENS.sub(_sub, fmt)
        except Exception:
            return ""

    return create_function_implementation(FormatDateApi, _format_date)


FormatDateImplementation = create_format_date_implementation(None)


def create_pluralize_implementation(
    locale: Optional[str] = None,
) -> FunctionImplementation:
    def _pluralize(
        args: Dict[str, Any],
        context: DataContext,
        abort_signal: Optional[AbortSignal] = None,
    ) -> str:
        val = _to_float(args.get("value", 0))
        rules = get_locale_rules(locale)

        category = "other"
        if val == 0 and "zero" in args:
            category = "zero"
        elif val == 1 and "one" in args:
            category = "one"
        elif val == 2 and "two" in args:
            category = "two"
        elif rules.plural_category_selector:
            category = rules.plural_category_selector(val)

        res = args.get(category) or args.get("other") or ""
        return str(res)

    return create_function_implementation(PluralizeApi, _pluralize)


PluralizeImplementation = create_pluralize_implementation(None)

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


def create_basic_catalog_functions(
    locale: Optional[str] = None,
) -> List[FunctionImplementation]:
    return [
        RequiredImplementation,
        RegexImplementation,
        LengthImplementation,
        NumericImplementation,
        EmailImplementation,
        FormatStringImplementation,
        create_format_number_implementation(locale),
        create_format_currency_implementation(locale),
        create_format_date_implementation(locale),
        create_pluralize_implementation(locale),
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


BASIC_FUNCTION_IMPLEMENTATIONS = create_basic_catalog_functions(None)
