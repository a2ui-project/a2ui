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

"""A2UI Express parser, compiler, and generator package.

Provides high-performance conversion utilities to compile A2UI Express DSL syntax
into A2UI messages (v0.9, v0.9.1 or v1.0) and vice-versa.
"""

from __future__ import annotations

from .compiler import ExpressCompiler
from .constants import SurfaceOperation
from .decompiler import ExpressDecompiler
from .errors import ExpressCompilerError
from .errors import ExpressDuplicateParamError
from .errors import ExpressDuplicatePropertyError
from .errors import ExpressForbiddenDatabindingError
from .errors import ExpressInvalidParamError
from .errors import ExpressParseError
from .errors import ExpressUndefinedChildError
from .errors import ExpressUndefinedRootError
from .errors import ExpressUnknownPropertyError
from .errors import ExpressValidationError
from .format import ExpressFormat
from .format import ExpressFormatFactory
from .parser import ExpressParser
from .prompt_generator import EXPRESS_RULES
from .prompt_generator import ExpressPromptGenerator

__all__ = [
    "EXPRESS_RULES",
    "ExpressCompiler",
    "ExpressCompilerError",
    "ExpressDecompiler",
    "ExpressDuplicateParamError",
    "ExpressDuplicatePropertyError",
    "ExpressForbiddenDatabindingError",
    "ExpressFormat",
    "ExpressFormatFactory",
    "ExpressInvalidParamError",
    "ExpressParseError",
    "ExpressParser",
    "ExpressPromptGenerator",
    "ExpressUndefinedChildError",
    "ExpressUndefinedRootError",
    "ExpressUnknownPropertyError",
    "ExpressValidationError",
    "SurfaceOperation",
]
