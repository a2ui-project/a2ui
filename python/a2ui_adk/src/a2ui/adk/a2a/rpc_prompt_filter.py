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

"""Module for `exclude_a2ui_rpc_from_prompt`, which keeps RPC out of prompts.

A2UI RPC messages (`callAgentFunction`, `agentFunctionResponse`,
`callRendererFunction`, `rendererFunctionResponse`) are exchanged between the
renderer and the agent's code, and `a2ui_rpc_callback` answers them without the
model. ADK still stores them in the session's events like any other turn, so
without a filter every later prompt would carry them. This module removes them
from the model's request, and leaves the session's events as they are.

`SendA2uiToClientToolset` does this for its agent. Agents without the toolset
pass the function as their `before_model_callback`:

  ```python
  agent = LlmAgent(..., before_model_callback=exclude_a2ui_rpc_from_prompt)
  ```
"""

from __future__ import annotations

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.utils.feature_decorator import experimental

from ._rpc import is_rpc_part


def strip_a2ui_rpc_parts(llm_request: LlmRequest) -> None:
    """Removes the A2UI RPC parts from the request's contents, in place.

    A content left without parts is removed. Other parts, including A2UI
    messages that aren't RPC, such as `createSurface` or `action`, are kept.
    """
    contents = []
    for content in llm_request.contents:
        parts = content.parts or []
        kept = [part for part in parts if not is_rpc_part(part)]
        if len(kept) == len(parts):
            contents.append(content)
        elif kept:
            contents.append(content.model_copy(update={"parts": kept}))
    llm_request.contents = contents


@experimental
def exclude_a2ui_rpc_from_prompt(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> LlmResponse | None:
    """A `before_model_callback` that keeps A2UI RPC messages out of the prompt.

    It removes, from the contents sent to the model, the parts that hold an
    A2UI RPC message in either direction: the renderer's `callAgentFunction`
    and `rendererFunctionResponse`, and the agent's `agentFunctionResponse`
    and `callRendererFunction`. A content left without parts is dropped. The
    session's events still hold them. Other A2UI messages, such as a
    renderer's `action` or the agent's `createSurface`, are kept.

    `SendA2uiToClientToolset` already does this; use the callback for agents
    without the toolset. To keep a callback of your own, pass both as a list.

    Args:
        callback_context: The callback context, which isn't used.
        llm_request: The request to the model, changed in place.

    Returns:
        None, so the model is called.
    """
    del callback_context
    strip_a2ui_rpc_parts(llm_request)
    return None
