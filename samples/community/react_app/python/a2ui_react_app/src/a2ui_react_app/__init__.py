# Copyright 2026 Google LLC
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
that teaches a model to write apps, and a transformer that checks the apps
before they are sent to the renderer.
"""

from __future__ import annotations

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
from ._prompt import react_app_prompt
from ._transformer import ReactAppTransformer

__all__ = [
    "ALLOWED_MODULES",
    "REACT_APP_CATALOG_ID",
    "ReactAppDiagnostic",
    "ReactAppDiagnosticCode",
    "ReactAppTransformer",
    "ReactAppValidationError",
    "check_react_app",
    "react_app_catalog",
    "react_app_examples",
    "react_app_prompt",
]
