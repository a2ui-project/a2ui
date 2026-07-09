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

import os

if os.environ.get("A2UI_EXPRESS_ENABLED", "").lower() not in ("true", "1", "yes"):
    raise ImportError(
        "A2UI Elemental is an experimental proposal extension and is disabled by"
        " default. To enable it, set the environment variable"
        " A2UI_EXPRESS_ENABLED=true."
    )

from .parser import parse_elemental_response
from .compiler import ElementalCompiler
from .decompiler import ElementalDecompiler
from .prompt_generator import ElementalPromptGenerator
from .format import ElementalInferenceFormat

__all__ = [
    "parse_elemental_response",
    "ElementalCompiler",
    "ElementalDecompiler",
    "ElementalPromptGenerator",
    "ElementalInferenceFormat",
]
