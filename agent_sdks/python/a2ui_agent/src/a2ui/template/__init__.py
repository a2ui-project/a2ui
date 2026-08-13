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

"""A2UI Template module providing parameterized component expansion and dynamic resolvers."""

from .models import (
    Template,
    StaticTemplate,
    DynamicTemplate,
    BaseTemplate,
    Param,
    ParamType,
    ParamRef,
    Concat,
    FormatExpr,
    TemplateLoop,
    TemplateComponent,
    normalize_a2ui_type_to_jsonschema,
)
from .processor import TemplateProcessor
from .format import TemplateInferenceFormat, A2uiTemplateManager, TemplateParser

__all__ = [
    "Template",
    "StaticTemplate",
    "DynamicTemplate",
    "BaseTemplate",
    "Param",
    "ParamType",
    "ParamRef",
    "Concat",
    "FormatExpr",
    "TemplateLoop",
    "TemplateComponent",
    "normalize_a2ui_type_to_jsonschema",
    "TemplateProcessor",
    "TemplateInferenceFormat",
    "A2uiTemplateManager",
    "TemplateParser",
]
