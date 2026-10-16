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

"""Cross-language A2UI Agent SDK bridges for evaluation.

The TypeScript and Dart bridges are imported lazily. The Python bridge's worker
processes import this package, and they must stay free of the heavier evaluation
dependencies those bridges pull in.
"""

from __future__ import annotations

import importlib
import threading
from typing import TYPE_CHECKING, Any

from .base import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    SDK_ALIASES,
    SDK_SUPPORTED_FORMATS,
    SDK_SUPPORTED_STRATEGIES,
    SDK_SUPPORTED_VERSIONS,
    SUPPORTED_SDKS,
    AgentSdkBridge,
    normalize_protocol_version,
    normalize_sdk_name,
    validate_sdk_format,
    validate_sdk_strategy,
    validate_sdk_version,
)
from .python_bridge import (
    PythonSdkBridge,
    get_python_strategy,
    parse_and_validate_in_process,
)

if TYPE_CHECKING:
    from .dart_bridge import DartSdkBridge
    from .ts_bridge import TypeScriptSdkBridge

_LAZY_EXPORTS: dict[str, str] = {
    "DartSdkBridge": ".dart_bridge",
    "TypeScriptSdkBridge": ".ts_bridge",
}

_BRIDGE_CLASSES: dict[str, str] = {
    "python": "PythonSdkBridge",
    "ts": "TypeScriptSdkBridge",
    "dart": "DartSdkBridge",
}

_bridges: dict[str, AgentSdkBridge] = {}
_bridges_lock = threading.Lock()


def __getattr__(name: str) -> Any:
    module_name = _LAZY_EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(importlib.import_module(module_name, __name__), name)
    globals()[name] = value
    return value


def get_sdk_bridge(sdk: str = "python") -> AgentSdkBridge:
    """Returns the shared AgentSdkBridge instance for the specified SDK."""
    norm = normalize_sdk_name(sdk)
    with _bridges_lock:
        bridge = _bridges.get(norm)
        if bridge is None:
            bridge_class = globals().get(_BRIDGE_CLASSES[norm]) or __getattr__(
                _BRIDGE_CLASSES[norm]
            )
            bridge = bridge_class()
            _bridges[norm] = bridge
        return bridge


__all__ = [
    "AgentSdkBridge",
    "DEFAULT_PARSE_TIMEOUT_SEC",
    "DartSdkBridge",
    "PythonSdkBridge",
    "SDK_ALIASES",
    "SDK_SUPPORTED_FORMATS",
    "SDK_SUPPORTED_STRATEGIES",
    "SDK_SUPPORTED_VERSIONS",
    "SUPPORTED_SDKS",
    "TypeScriptSdkBridge",
    "get_python_strategy",
    "get_sdk_bridge",
    "normalize_protocol_version",
    "normalize_sdk_name",
    "parse_and_validate_in_process",
    "validate_sdk_format",
    "validate_sdk_strategy",
    "validate_sdk_version",
]
