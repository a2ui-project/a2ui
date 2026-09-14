# Copyright 2024 Google LLC
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

import datetime
import math
import re
from typing import Any
from ...resolution.data_context import DataContext
from ...common.events import AbortSignal
from ...catalog.functions import (
    FunctionImplementation,
    create_function_implementation,
)
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

from ..expression_parser import ExpressionParser
from ..locale_formatting import apply_currency_spacing, get_locale
from babel.numbers import format_decimal, format_currency, get_currency_symbol
import re as _re


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
    if isinstance(val, float):
        if math.isinf(val):
            return "-Infinity" if val < 0 else "Infinity"
        if math.isnan(val):
            return "NaN"
    return str(val)


# Validation (v0.9 returns boolean)
def _required_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> bool:
    return _to_bool(
        args.get("value") is not None
        and args.get("value") != ""
        and args.get("value") != []
    )


RequiredImplementation = create_function_implementation(RequiredApi, _required_execute)


def _regex_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> bool:
    return bool(
        re.search(_to_str(args.get("pattern", "")), _to_str(args.get("value", "")))
    )


RegexImplementation = create_function_implementation(RegexApi, _regex_execute)


def _length_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> bool:
    return (
        args.get("min") is None
        or len(_to_str(args.get("value", ""))) >= int(args["min"])
    ) and (
        args.get("max") is None
        or len(_to_str(args.get("value", ""))) <= int(args["max"])
    )


LengthImplementation = create_function_implementation(LengthApi, _length_execute)


def _numeric_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> bool:
    return (
        args.get("min") is None or _to_float(args["value"]) >= _to_float(args["min"])
    ) and (
        args.get("max") is None or _to_float(args["value"]) <= _to_float(args["max"])
    )


NumericImplementation = create_function_implementation(NumericApi, _numeric_execute)


def _email_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> bool:
    return bool(
        re.match(
            r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
            _to_str(args.get("value", "")),
        )
    )


EmailImplementation = create_function_implementation(EmailApi, _email_execute)


# Formatting
def _format_string(
    args: dict[str, Any],
    context: DataContext,
    abort_signal: AbortSignal | None = None,
) -> str:
    template = _to_str(args.get("value", ""))
    if not template:
        return ""

    parser = ExpressionParser()
    parts = parser.parse(template)

    if not parts:
        return ""

    resolved_parts = []
    for part in parts:
        if context and hasattr(context, "resolve_dynamic_value"):
            resolved = context.resolve_dynamic_value(part)
        else:
            resolved = part
        resolved_parts.append(_to_str(resolved))

    return "".join(resolved_parts)


FormatStringImplementation = create_function_implementation(
    FormatStringApi, _format_string
)


def _format_numeric_locale(
    val: float,
    decimals: int | None,
    grouping: bool,
    locale: str | None,
) -> str:
    loc = get_locale(locale)
    if decimals is not None:
        pat = str(loc.decimal_formats[None].pattern)
        if decimals == 0:
            pat = _re.sub(r"0\.[0#]+", "0", pat)
        else:
            pat = _re.sub(r"0\.[0#]+", "0." + "0" * decimals, pat)
        return format_decimal(val, format=pat, locale=loc, group_separator=grouping)
    return format_decimal(val, locale=loc, group_separator=grouping)


def create_format_number_implementation(
    locale: str | None = None,
) -> FunctionImplementation:
    def _format_number(
        args: dict[str, Any],
        context: DataContext,
        abort_signal: AbortSignal | None = None,
    ) -> str:
        val = _to_float(args.get("value", 0))
        decimals = int(args["decimals"]) if args.get("decimals") is not None else None
        grouping = True if args.get("grouping") is None else bool(args["grouping"])
        return _format_numeric_locale(val, decimals, grouping, locale)

    return create_function_implementation(FormatNumberApi, _format_number)


FormatNumberImplementation = create_format_number_implementation(None)


def create_format_currency_implementation(
    locale: str | None = None,
) -> FunctionImplementation:
    def _format_currency(
        args: dict[str, Any],
        context: DataContext,
        abort_signal: AbortSignal | None = None,
    ) -> str:
        val = _to_float(args.get("value", 0))
        currency = str(args.get("currency", "USD")).upper()
        decimals = int(args["decimals"]) if args.get("decimals") is not None else 2
        grouping = True if args.get("grouping") is None else bool(args["grouping"])

        loc = get_locale(locale)
        pat = loc.currency_formats["standard"].pattern
        if decimals == 0:
            pat = _re.sub(r"0\.[0#]+", "0", pat)
        else:
            pat = _re.sub(r"0\.[0#]+", "0." + "0" * decimals, pat)
        # Babel resolves the pattern and symbol from CLDR but skips CLDR's
        # `currencySpacing`, which `Intl` applies. Without this the two engines
        # disagree for every alphabetic symbol, `CHF` and `SEK` among them.
        pat = apply_currency_spacing(pat, get_currency_symbol(currency, locale=loc))
        return format_currency(
            val,
            currency,
            format=pat,
            locale=loc,
            group_separator=grouping,
            currency_digits=False,
        )

    return create_function_implementation(FormatCurrencyApi, _format_currency)


FormatCurrencyImplementation = create_format_currency_implementation(None)

_DATE_TOKENS = re.compile(r"yyyy|yy|MMMM|MMM|MM|M|EEEE|E|dd|d|HH|H|hh|h|mm|ss|a|%")


def create_format_date_implementation(
    locale: str | None = None,
) -> FunctionImplementation:
    def _format_date(
        args: dict[str, Any],
        context: DataContext,
        abort_signal: AbortSignal | None = None,
    ) -> str:
        val = args.get("value")
        fmt = str(args.get("format", "yyyy-MM-dd"))
        if not val:
            return ""
        try:
            dt = datetime.datetime.fromisoformat(str(val).replace("Z", "+00:00"))
            if fmt == "ISO":
                return dt.isoformat().replace("+00:00", ".000Z")

            loc = get_locale(locale)

            def _sub(m: re.Match[str]) -> str:
                tok = m.group(0)
                if tok == "yyyy":
                    return str(dt.year)
                if tok == "yy":
                    return str(dt.year)[-2:]
                if tok == "MMMM":
                    return str(loc.months["format"]["wide"][dt.month])
                if tok == "MMM":
                    return str(loc.months["format"]["abbreviated"][dt.month])
                if tok == "MM":
                    return f"{dt.month:02d}"
                if tok == "M":
                    return str(dt.month)
                if tok == "EEEE":
                    return str(loc.days["format"]["wide"][dt.weekday()])
                if tok == "E":
                    return str(loc.days["format"]["abbreviated"][dt.weekday()])
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
    locale: str | None = None,
) -> FunctionImplementation:
    def _pluralize(
        args: dict[str, Any],
        context: DataContext,
        abort_signal: AbortSignal | None = None,
    ) -> str:
        val = _to_float(args.get("value", 0))
        loc = get_locale(locale)

        category = "other"
        if val == 0 and "zero" in args:
            category = "zero"
        elif val == 1 and "one" in args:
            category = "one"
        elif val == 2 and "two" in args:
            category = "two"
        else:
            category = loc.plural_form(val)

        res = args.get(category) or args.get("other") or ""
        return str(res)

    return create_function_implementation(PluralizeApi, _pluralize)


PluralizeImplementation = create_pluralize_implementation(None)


# Actions
def _open_url_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> None:
    return None


OpenUrlImplementation = create_function_implementation(OpenUrlApi, _open_url_execute)


# Logical
def _and_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> bool:
    return all(_to_bool(v) for v in args.get("values", []))


AndImplementation = create_function_implementation(AndApi, _and_execute)


def _or_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> bool:
    return any(_to_bool(v) for v in args.get("values", []))


OrImplementation = create_function_implementation(OrApi, _or_execute)


def _not_execute(
    args: dict[str, Any],
    context: Any = None,
    abort_signal: Any | None = None,
) -> bool:
    return not _to_bool(args.get("value"))


NotImplementation = create_function_implementation(NotApi, _not_execute)


def create_basic_catalog_functions(
    locale: str | None = None,
) -> list[FunctionImplementation]:
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
    ]


BASIC_FUNCTION_IMPLEMENTATIONS = create_basic_catalog_functions(None)
