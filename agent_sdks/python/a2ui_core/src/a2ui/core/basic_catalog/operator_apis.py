# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# This file mirrors the TypeScript API definitions in:
# renderers/web_core/src/v0_9/basic_catalog/functions/basic_functions_api.ts

from typing import Any, Dict, List, Optional
from pydantic import Field
from ..schema.common_types import StrictBaseModel, DynamicString, DynamicNumber, DynamicBoolean, DynamicValue, DynamicStringList
from ..catalog.functions import FunctionApi


class AddArgs(StrictBaseModel):
    a: DynamicNumber = Field(...)
    b: DynamicNumber = Field(...)


class AddApi(FunctionApi):
    name = "add"
    schema = AddArgs
    return_type = "number"


class SubtractArgs(StrictBaseModel):
    a: DynamicNumber = Field(...)
    b: DynamicNumber = Field(...)


class SubtractApi(FunctionApi):
    name = "subtract"
    schema = SubtractArgs
    return_type = "number"


class MultiplyArgs(StrictBaseModel):
    a: DynamicNumber = Field(...)
    b: DynamicNumber = Field(...)


class MultiplyApi(FunctionApi):
    name = "multiply"
    schema = MultiplyArgs
    return_type = "number"


class DivideArgs(StrictBaseModel):
    a: DynamicNumber = Field(...)
    b: DynamicNumber = Field(...)


class DivideApi(FunctionApi):
    name = "divide"
    schema = DivideArgs
    return_type = "number"


class EqualsArgs(StrictBaseModel):
    a: Any = Field(...)
    b: Any = Field(...)


class EqualsApi(FunctionApi):
    name = "equals"
    schema = EqualsArgs
    return_type = "boolean"


class NotEqualsArgs(StrictBaseModel):
    a: Any = Field(...)
    b: Any = Field(...)


class NotEqualsApi(FunctionApi):
    name = "not_equals"
    schema = NotEqualsArgs
    return_type = "boolean"


class GreaterThanArgs(StrictBaseModel):
    a: DynamicNumber = Field(...)
    b: DynamicNumber = Field(...)


class GreaterThanApi(FunctionApi):
    name = "greater_than"
    schema = GreaterThanArgs
    return_type = "boolean"


class LessThanArgs(StrictBaseModel):
    a: DynamicNumber = Field(...)
    b: DynamicNumber = Field(...)


class LessThanApi(FunctionApi):
    name = "less_than"
    schema = LessThanArgs
    return_type = "boolean"


class ContainsArgs(StrictBaseModel):
    string: DynamicString = Field(...)
    substring: DynamicString = Field(...)


class ContainsApi(FunctionApi):
    name = "contains"
    schema = ContainsArgs
    return_type = "boolean"


class StartsWithArgs(StrictBaseModel):
    string: DynamicString = Field(...)
    prefix: DynamicString = Field(...)


class StartsWithApi(FunctionApi):
    name = "starts_with"
    schema = StartsWithArgs
    return_type = "boolean"


class EndsWithArgs(StrictBaseModel):
    string: DynamicString = Field(...)
    suffix: DynamicString = Field(...)


class EndsWithApi(FunctionApi):
    name = "ends_with"
    schema = EndsWithArgs
    return_type = "boolean"
