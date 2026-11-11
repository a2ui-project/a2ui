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

"""Agent-side support for the A2UI ReactApp component (labs).

`ReactApp` lets a model write a small React app inline in its response. This
package gives the agent the ReactApp catalog and examples, the prompt fragment
that teaches a model to write apps, and a transformer that checks and compiles
the apps before they are sent to the renderer.
"""

from __future__ import annotations

from ._bindings import BINDINGS_MODULE, ReactAppBindings, react_app_bindings
from ._catalog import (
    REACT_APP_CATALOG_ID,
    react_app_catalog,
    react_app_examples,
)
from ._checks import (
    ALLOWED_MODULES,
    ReactAppDiagnostic,
    ReactAppDiagnosticCode,
    ReactAppValidationError,
    check_react_app,
)
from ._compiler import (
    CompileDiagnostic,
    CompileResult,
    ReactAppCompiler,
    default_worker_path,
)
from ._prompt import react_app_prompt
from ._repair import (
    Generate,
    RepairAttempt,
    RepairResult,
    compile_and_repair,
    gemini_generate,
    repair_prompt,
    repair_react_app,
    repair_system_instruction,
)
from ._source import ReactAppSourceFacts, react_app_source_facts
from ._transformer import (
    ReactAppCompile,
    ReactAppTransformer,
    ReactAppTransportResult,
)

__all__ = [
    "ALLOWED_MODULES",
    "BINDINGS_MODULE",
    "CompileDiagnostic",
    "CompileResult",
    "Generate",
    "REACT_APP_CATALOG_ID",
    "ReactAppBindings",
    "ReactAppCompile",
    "ReactAppCompiler",
    "ReactAppDiagnostic",
    "ReactAppDiagnosticCode",
    "ReactAppSourceFacts",
    "ReactAppTransformer",
    "ReactAppTransportResult",
    "ReactAppValidationError",
    "RepairAttempt",
    "RepairResult",
    "check_react_app",
    "compile_and_repair",
    "default_worker_path",
    "gemini_generate",
    "react_app_bindings",
    "react_app_catalog",
    "react_app_examples",
    "react_app_prompt",
    "react_app_source_facts",
    "repair_prompt",
    "repair_react_app",
    "repair_system_instruction",
]
