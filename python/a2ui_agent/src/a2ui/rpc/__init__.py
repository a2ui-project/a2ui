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

"""Function calls between the agent and the renderer (A2UI v1.0).

`AgentFunctionRegistry` answers the renderer's `callAgentFunction` messages
by running the catalogs' agent functions. `RendererFunctionCalls` sends
`callRendererFunction` messages and matches up the renderer's responses.
`RendererMessageRouter` is one entry point for both kinds of incoming
message.
"""

from .agent_function_registry import AgentFunctionRegistry, CallAgentFunctionInput
from .renderer_function_calls import (
    DEFAULT_RENDERER_CALL_TIMEOUT,
    RendererFunctionCalls,
    RendererFunctionResponseInput,
)
from .router import RendererMessageInput, RendererMessageRouter

__all__ = [
    "AgentFunctionRegistry",
    "CallAgentFunctionInput",
    "DEFAULT_RENDERER_CALL_TIMEOUT",
    "RendererFunctionCalls",
    "RendererFunctionResponseInput",
    "RendererMessageInput",
    "RendererMessageRouter",
]
