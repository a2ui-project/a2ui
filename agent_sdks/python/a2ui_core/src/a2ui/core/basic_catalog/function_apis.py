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

# Auto-generated. Do not edit manually.
from typing import Any, Dict, List, Literal, Optional, Union, Annotated
from pydantic import BaseModel, Field, ConfigDict

from ..schema.common_types import StrictBaseModel, DynamicString, DynamicNumber, DynamicBoolean, DynamicValue, DynamicStringList
from ..catalog.functions import FunctionApi


class RequiredArgs(StrictBaseModel):
    value: Any = Field(..., description="The value to check.")


class RequiredApi(FunctionApi):
    name = "required"
    schema = RequiredArgs
    return_type = "boolean"


class RegexArgs(StrictBaseModel):
    value: DynamicString = Field(...)
    pattern: str = Field(..., description="The regex pattern to match against.")


class RegexApi(FunctionApi):
    name = "regex"
    schema = RegexArgs
    return_type = "boolean"


class LengthArgs(StrictBaseModel):
    value: DynamicString = Field(...)
    min: Optional[int] = Field(None, description="The minimum allowed length.")
    max: Optional[int] = Field(None, description="The maximum allowed length.")


class LengthApi(FunctionApi):
    name = "length"
    schema = LengthArgs
    return_type = "boolean"


class NumericArgs(StrictBaseModel):
    value: DynamicNumber = Field(...)
    min: Optional[float] = Field(None, description="The minimum allowed value.")
    max: Optional[float] = Field(None, description="The maximum allowed value.")


class NumericApi(FunctionApi):
    name = "numeric"
    schema = NumericArgs
    return_type = "boolean"


class EmailArgs(StrictBaseModel):
    value: DynamicString = Field(...)


class EmailApi(FunctionApi):
    name = "email"
    schema = EmailArgs
    return_type = "boolean"


class FormatStringArgs(StrictBaseModel):
    value: DynamicString = Field(...)


class FormatStringApi(FunctionApi):
    name = "formatString"
    schema = FormatStringArgs
    return_type = "string"


class FormatNumberArgs(StrictBaseModel):
    value: DynamicNumber = Field(..., description="The number to format.")
    decimals: Optional[DynamicNumber] = Field(
        None,
        description=(
            "Optional. The number of decimal places to show. Defaults to 0 or 2"
            " depending on locale."
        ),
    )
    grouping: Optional[DynamicBoolean] = Field(
        None,
        description=(
            "Optional. If true, uses locale-specific grouping separators (e.g."
            " '1,000'). If false, returns raw digits (e.g. '1000'). Defaults to true."
        ),
    )


class FormatNumberApi(FunctionApi):
    name = "formatNumber"
    schema = FormatNumberArgs
    return_type = "string"


class FormatCurrencyArgs(StrictBaseModel):
    value: DynamicNumber = Field(..., description="The monetary amount.")
    currency: DynamicString = Field(
        ..., description="The ISO 4217 currency code (e.g., 'USD', 'EUR')."
    )
    decimals: Optional[DynamicNumber] = Field(
        None,
        description=(
            "Optional. The number of decimal places to show. Defaults to 0 or 2"
            " depending on locale."
        ),
    )
    grouping: Optional[DynamicBoolean] = Field(
        None,
        description=(
            "Optional. If true, uses locale-specific grouping separators (e.g."
            " '1,000'). If false, returns raw digits (e.g. '1000'). Defaults to true."
        ),
    )


class FormatCurrencyApi(FunctionApi):
    name = "formatCurrency"
    schema = FormatCurrencyArgs
    return_type = "string"


class FormatDateArgs(StrictBaseModel):
    value: DynamicValue = Field(..., description="The date to format.")
    format: DynamicString = Field(
        ...,
        description=(
            "A Unicode TR35 date pattern string.  Token Reference: - Year: 'yy' (26),"
            " 'yyyy' (2026) - Month: 'M' (1), 'MM' (01), 'MMM' (Jan), 'MMMM' (January)"
            " - Day: 'd' (1), 'dd' (01), 'E' (Tue), 'EEEE' (Tuesday) - Hour (12h): 'h'"
            " (1-12), 'hh' (01-12) - requires 'a' for AM/PM - Hour (24h): 'H' (0-23),"
            " 'HH' (00-23) - Military Time - Minute: 'mm' (00-59) - Second: 'ss'"
            " (00-59) - Period: 'a' (AM/PM)  Examples: - 'MMM dd, yyyy' -> 'Jan 16,"
            " 2026' - 'HH:mm' -> '14:30' (Military) - 'h:mm a' -> '2:30 PM' - 'EEEE, d"
            " MMMM' -> 'Friday, 16 January'"
        ),
    )


class FormatDateApi(FunctionApi):
    name = "formatDate"
    schema = FormatDateArgs
    return_type = "string"


class PluralizeArgs(StrictBaseModel):
    value: DynamicNumber = Field(
        ..., description="The numeric value used to determine the plural category."
    )
    zero: Optional[DynamicString] = Field(
        None, description="String for the 'zero' category (e.g., 0 items)."
    )
    one: Optional[DynamicString] = Field(
        None, description="String for the 'one' category (e.g., 1 item)."
    )
    two: Optional[DynamicString] = Field(
        None, description="String for the 'two' category (used in Arabic, Welsh, etc.)."
    )
    few: Optional[DynamicString] = Field(
        None,
        description=(
            "String for the 'few' category (e.g., small groups in Slavic languages)."
        ),
    )
    many: Optional[DynamicString] = Field(
        None,
        description=(
            "String for the 'many' category (e.g., large groups in various languages)."
        ),
    )
    other: DynamicString = Field(
        ..., description="The default/fallback string (used for general plural cases)."
    )


class PluralizeApi(FunctionApi):
    name = "pluralize"
    schema = PluralizeArgs
    return_type = "string"


class OpenUrlArgs(StrictBaseModel):
    url: str = Field(..., description="The URL to open.")


class OpenUrlApi(FunctionApi):
    name = "openUrl"
    schema = OpenUrlArgs
    return_type = "void"


class AndArgs(StrictBaseModel):
    values: List[DynamicBoolean] = Field(
        ..., description="The list of boolean values to evaluate."
    )


class AndApi(FunctionApi):
    name = "and"
    schema = AndArgs
    return_type = "boolean"


class OrArgs(StrictBaseModel):
    values: List[DynamicBoolean] = Field(
        ..., description="The list of boolean values to evaluate."
    )


class OrApi(FunctionApi):
    name = "or"
    schema = OrArgs
    return_type = "boolean"


class NotArgs(StrictBaseModel):
    value: DynamicBoolean = Field(..., description="The boolean value to negate.")


class NotApi(FunctionApi):
    name = "not"
    schema = NotArgs
    return_type = "boolean"


class AddArgs(StrictBaseModel):
    a: DynamicNumber = Field(..., description="The first number.")
    b: DynamicNumber = Field(..., description="The second number.")


class AddApi(FunctionApi):
    name = "add"
    schema = AddArgs
    return_type = "number"


class SubtractArgs(StrictBaseModel):
    a: DynamicNumber = Field(..., description="The number to subtract from.")
    b: DynamicNumber = Field(..., description="The number to subtract.")


class SubtractApi(FunctionApi):
    name = "subtract"
    schema = SubtractArgs
    return_type = "number"


class MultiplyArgs(StrictBaseModel):
    a: DynamicNumber = Field(..., description="The first number.")
    b: DynamicNumber = Field(..., description="The second number.")


class MultiplyApi(FunctionApi):
    name = "multiply"
    schema = MultiplyArgs
    return_type = "number"


class DivideArgs(StrictBaseModel):
    a: DynamicNumber = Field(..., description="The dividend.")
    b: DynamicNumber = Field(..., description="The divisor.")


class DivideApi(FunctionApi):
    name = "divide"
    schema = DivideArgs
    return_type = "number"


class GreaterThanArgs(StrictBaseModel):
    a: DynamicNumber = Field(..., description="The number to compare.")
    b: DynamicNumber = Field(..., description="The threshold number.")


class GreaterThanApi(FunctionApi):
    name = "greater_than"
    schema = GreaterThanArgs
    return_type = "boolean"


class LessThanArgs(StrictBaseModel):
    a: DynamicNumber = Field(..., description="The number to compare.")
    b: DynamicNumber = Field(..., description="The threshold number.")


class LessThanApi(FunctionApi):
    name = "less_than"
    schema = LessThanArgs
    return_type = "boolean"


class EqualsArgs(StrictBaseModel):
    a: Any = Field(..., description="The first value.")
    b: Any = Field(..., description="The second value.")


class EqualsApi(FunctionApi):
    name = "equals"
    schema = EqualsArgs
    return_type = "boolean"


class NotEqualsArgs(StrictBaseModel):
    a: Any = Field(..., description="The first value.")
    b: Any = Field(..., description="The second value.")


class NotEqualsApi(FunctionApi):
    name = "not_equals"
    schema = NotEqualsArgs
    return_type = "boolean"


class ContainsArgs(StrictBaseModel):
    string: DynamicString = Field(..., description="The source string.")
    substring: DynamicString = Field(..., description="The substring to search for.")


class ContainsApi(FunctionApi):
    name = "contains"
    schema = ContainsArgs
    return_type = "boolean"


class StartsWithArgs(StrictBaseModel):
    string: DynamicString = Field(..., description="The source string.")
    prefix: DynamicString = Field(..., description="The prefix to search for.")


class StartsWithApi(FunctionApi):
    name = "starts_with"
    schema = StartsWithArgs
    return_type = "boolean"


class EndsWithArgs(StrictBaseModel):
    string: DynamicString = Field(..., description="The source string.")
    suffix: DynamicString = Field(..., description="The suffix to search for.")


class EndsWithApi(FunctionApi):
    name = "ends_with"
    schema = EndsWithArgs
    return_type = "boolean"


class ClampArgs(StrictBaseModel):
    value: DynamicNumber = Field(..., description="The number to constrain.")
    min: DynamicNumber = Field(..., description="The lower bound of the range.")
    max: DynamicNumber = Field(
        ...,
        description=(
            "The upper bound of the range. If 'max' is less than 'min', the result is"
            " 'min'."
        ),
    )


class ClampApi(FunctionApi):
    name = "clamp"
    schema = ClampArgs
    return_type = "number"


class RoundArgs(StrictBaseModel):
    value: DynamicNumber = Field(..., description="The number to round.")
    decimals: Optional[DynamicNumber] = Field(
        None,
        description=(
            "Optional. The number of decimal places to round to. Defaults to 0."
        ),
    )


class RoundApi(FunctionApi):
    name = "round"
    schema = RoundArgs
    return_type = "number"


class MinArgs(StrictBaseModel):
    values: List[DynamicNumber] = Field(
        ..., description="The list of numbers to compare."
    )


class MinApi(FunctionApi):
    name = "min"
    schema = MinArgs
    return_type = "number"


class MaxArgs(StrictBaseModel):
    values: List[DynamicNumber] = Field(
        ..., description="The list of numbers to compare."
    )


class MaxApi(FunctionApi):
    name = "max"
    schema = MaxArgs
    return_type = "number"


class AbsArgs(StrictBaseModel):
    value: DynamicNumber = Field(
        ..., description="The number to take the absolute value of."
    )


class AbsApi(FunctionApi):
    name = "abs"
    schema = AbsArgs
    return_type = "number"
