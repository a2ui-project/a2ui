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

"""Processes the messages that a renderer sends to the agent (A2UI v1.0).

`RendererToAgentMessageProcessor` answers the renderer's `callAgentFunction`
messages by running the catalogs' agent functions, and passes `action`,
`error` and `rendererFunctionResponse` messages to optional callbacks.
`RendererFunctionCalls` sends `callRendererFunction` messages and matches up
the renderer's responses; its `resolve` method is the processor's
`on_renderer_function_response` callback.

The v1.0 message classes it takes and returns are re-exported here.
"""

from a2ui.core.schema.v1_0 import (
    A2uiRendererActionMessage,
    A2uiRendererErrorMessage,
    AgentFunctionResponseMessage,
    CallAgentFunctionMessage,
    RendererFunctionResponseMessage,
    RendererToAgentMessage,
)

from .processor import (
    ActionCallback,
    ErrorCallback,
    ProcessResult,
    RendererFunctionResponseCallback,
    RendererToAgentMessageInput,
    RendererToAgentMessageProcessor,
)
from .renderer_function_calls import (
    DEFAULT_RENDERER_CALL_TIMEOUT,
    RendererFunctionCalls,
    RendererFunctionResponseInput,
)

__all__ = [
    "A2uiRendererActionMessage",
    "A2uiRendererErrorMessage",
    "ActionCallback",
    "AgentFunctionResponseMessage",
    "CallAgentFunctionMessage",
    "DEFAULT_RENDERER_CALL_TIMEOUT",
    "ErrorCallback",
    "ProcessResult",
    "RendererFunctionCalls",
    "RendererFunctionResponseCallback",
    "RendererFunctionResponseInput",
    "RendererFunctionResponseMessage",
    "RendererToAgentMessage",
    "RendererToAgentMessageInput",
    "RendererToAgentMessageProcessor",
]
