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

"""Cross-language A2UI Agent SDK bridges for evaluation."""

from __future__ import annotations

from .base import (
    SDK_ALIASES,
    SDK_SUPPORTED_FORMATS,
    SDK_SUPPORTED_STRATEGIES,
    SUPPORTED_SDKS,
    AgentSdkBridge,
    normalize_sdk_name,
    validate_sdk_format,
    validate_sdk_strategy,
)
from .dart_bridge import DartSdkBridge
from .python_bridge import (
    PythonSdkBridge,
    get_python_strategy,
    parse_and_validate_in_process,
    parse_with_hard_kill_timeout,
)
from .ts_bridge import TypeScriptSdkBridge

_BRIDGES: dict[str, AgentSdkBridge] = {
    "python": PythonSdkBridge(),
    "ts": TypeScriptSdkBridge(),
    "dart": DartSdkBridge(),
}


def get_sdk_bridge(sdk: str = "python") -> AgentSdkBridge:
    """Returns the AgentSdkBridge instance for the specified SDK."""
    norm = normalize_sdk_name(sdk)
    return _BRIDGES[norm]


__all__ = [
    "AgentSdkBridge",
    "DartSdkBridge",
    "PythonSdkBridge",
    "SDK_ALIASES",
    "SDK_SUPPORTED_FORMATS",
    "SDK_SUPPORTED_STRATEGIES",
    "SUPPORTED_SDKS",
    "TypeScriptSdkBridge",
    "get_python_strategy",
    "get_sdk_bridge",
    "normalize_sdk_name",
    "parse_and_validate_in_process",
    "parse_with_hard_kill_timeout",
    "validate_sdk_format",
    "validate_sdk_strategy",
]
