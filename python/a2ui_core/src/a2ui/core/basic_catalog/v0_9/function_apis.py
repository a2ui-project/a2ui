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

# Auto-generated. Do not edit manually.
from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field, ConfigDict
from ...schema.v0_9.common_types import StrictBaseModel, DataBinding, DynamicBoolean, DynamicNumber, DynamicString, DynamicValue, FunctionCall
from ...catalog.functions import FunctionApi


class RequiredArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    value: Any = Field(..., description="The value to check.")


class RequiredApi(FunctionApi):
    name = "required"
    schema = RequiredArgs
    return_type = "boolean"


class RegexArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicString = Field(...)
    pattern: str = Field(..., description="The regex pattern to match against.")


class RegexApi(FunctionApi):
    name = "regex"
    schema = RegexArgs
    return_type = "boolean"


class LengthArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicString = Field(...)
    min: int | None = Field(None, description="The minimum allowed length.")
    max: int | None = Field(None, description="The maximum allowed length.")


class LengthApi(FunctionApi):
    name = "length"
    schema = LengthArgs
    return_type = "boolean"


class NumericArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicNumber = Field(...)
    min: float | None = Field(None, description="The minimum allowed value.")
    max: float | None = Field(None, description="The maximum allowed value.")


class NumericApi(FunctionApi):
    name = "numeric"
    schema = NumericArgs
    return_type = "boolean"


class EmailArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicString = Field(...)


class EmailApi(FunctionApi):
    name = "email"
    schema = EmailArgs
    return_type = "boolean"


class FormatStringArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicString = Field(...)


class FormatStringApi(FunctionApi):
    name = "formatString"
    schema = FormatStringArgs
    return_type = "string"


class FormatNumberArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicNumber = Field(..., description="The number to format.")
    decimals: DynamicNumber | None = Field(
        None,
        description=(
            "Optional. The number of decimal places to show. Defaults to 0 or 2"
            " depending on locale."
        ),
    )
    grouping: DynamicBoolean | None = Field(
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
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicNumber = Field(..., description="The monetary amount.")
    currency: DynamicString = Field(
        ..., description="The ISO 4217 currency code (e.g., 'USD', 'EUR')."
    )
    decimals: DynamicNumber | None = Field(
        None,
        description=(
            "Optional. The number of decimal places to show. Defaults to 0 or 2"
            " depending on locale."
        ),
    )
    grouping: DynamicBoolean | None = Field(
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
    model_config = ConfigDict(populate_by_name=True)
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
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicNumber = Field(
        ..., description="The numeric value used to determine the plural category."
    )
    zero: DynamicString | None = Field(
        None, description="String for the 'zero' category (e.g., 0 items)."
    )
    one: DynamicString | None = Field(
        None, description="String for the 'one' category (e.g., 1 item)."
    )
    two: DynamicString | None = Field(
        None, description="String for the 'two' category (used in Arabic, Welsh, etc.)."
    )
    few: DynamicString | None = Field(
        None,
        description=(
            "String for the 'few' category (e.g., small groups in Slavic languages)."
        ),
    )
    many: DynamicString | None = Field(
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
    model_config = ConfigDict(populate_by_name=True)
    url: str = Field(..., description="The URL to open.")


class OpenUrlApi(FunctionApi):
    name = "openUrl"
    schema = OpenUrlArgs
    return_type = "void"


class AndArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    values: list[DynamicBoolean] = Field(
        ..., description="The list of boolean values to evaluate."
    )


class AndApi(FunctionApi):
    name = "and"
    schema = AndArgs
    return_type = "boolean"


class OrArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    values: list[DynamicBoolean] = Field(
        ..., description="The list of boolean values to evaluate."
    )


class OrApi(FunctionApi):
    name = "or"
    schema = OrArgs
    return_type = "boolean"


class NotArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    value: DynamicBoolean = Field(..., description="The boolean value to negate.")


class NotApi(FunctionApi):
    name = "not"
    schema = NotArgs
    return_type = "boolean"
