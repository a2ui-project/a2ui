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

"""A2UI Express parser, compiler, and generator package.

Provides high-performance conversion utilities to compile A2UI Express DSL syntax
into standard A2UI v1.0 wire JSON messages and vice-versa.
"""

import os

if os.environ.get("A2UI_EXPRESS_ENABLED", "").lower() not in ("true", "1", "yes"):
  raise ImportError(
      "A2UI Express is an experimental proposal extension and is disabled by default. "
      "To enable it, set the environment variable A2UI_EXPRESS_ENABLED=true."
  )

from .compiler import ExpressCompiler
from .decompiler import ExpressDecompiler
from .prompt_generator import ExpressPromptGenerator
from .constants import SurfaceOperation
from .parser import parse_express_response

__all__ = [
    "ExpressCompiler",
    "ExpressDecompiler",
    "ExpressPromptGenerator",
    "SurfaceOperation",
    "parse_express_response",
]
