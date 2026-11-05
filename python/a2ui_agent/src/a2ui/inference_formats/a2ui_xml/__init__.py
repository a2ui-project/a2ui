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

"""A2UI XML inference format for A2UI."""

from __future__ import annotations

from .compiler import A2uiXmlCompiler
from .decompiler import A2uiXmlDecompiler
from .errors import (
    A2uiXmlCompileDiagnostics,
    A2uiXmlError,
    A2uiXmlParseError,
    A2uiXmlStrictViolation,
    A2uiXmlValidationError,
)
from .format import A2uiXmlFormat, A2uiXmlFormatFactory
from .parser import A2uiXmlParser
from .prompt_generator import A2uiXmlPromptGenerator
from .response_stream import A2uiXmlResponseStream

__all__ = [
    "A2uiXmlCompileDiagnostics",
    "A2uiXmlCompiler",
    "A2uiXmlDecompiler",
    "A2uiXmlError",
    "A2uiXmlFormat",
    "A2uiXmlFormatFactory",
    "A2uiXmlParseError",
    "A2uiXmlParser",
    "A2uiXmlPromptGenerator",
    "A2uiXmlResponseStream",
    "A2uiXmlStrictViolation",
    "A2uiXmlValidationError",
]
