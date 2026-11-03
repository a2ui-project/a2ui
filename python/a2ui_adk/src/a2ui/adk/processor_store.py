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

"""Module for the A2uiProcessorStore.

ADK session services save session state as JSON and copy it each time they
load a session, so an `A2uiRequestProcessor`, and the `RendererState` bound to
it, can't be kept there. `A2uiProcessorStore` keeps each session's processor in
memory instead. The agent's executor puts the request's processor in the store
before it runs the agent, and `SendA2uiToClientToolset` and `A2uiEventConverter`
read it back with `A2uiProcessorStore.get`.

Usage Example:

  ```python
  processors = A2uiProcessorStore()

  # In the agent
  toolset = SendA2uiToClientToolset(
      a2ui_enabled=processors.is_enabled,
      a2ui_processor=processors.get,
  )

  # In the executor
  config = A2aAgentExecutorConfig(
      event_converter=A2uiEventConverter(a2ui_processor=processors.get)
  )
  ...
  processors.set(session.id, processor if a2ui_active else None)
  ```
"""

from __future__ import annotations

from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.utils.feature_decorator import experimental

from a2ui.processor import A2uiRequestProcessor


@experimental
class A2uiProcessorStore:
    """Keeps the request processor of each session, outside session state.

    The store holds one processor per session id: the one for the session's
    latest request. Set it, or clear it with None, on every request, so a
    request without A2UI doesn't use the processor of an earlier one. Call
    `remove` when a session ends, since nothing is evicted on its own.
    """

    def __init__(self) -> None:
        self._processors: dict[str, A2uiRequestProcessor] = {}

    def set(self, session_id: str, processor: A2uiRequestProcessor | None) -> None:
        """Sets the session's processor, or removes it when `processor` is None."""
        if processor is None:
            self._processors.pop(session_id, None)
        else:
            self._processors[session_id] = processor

    def remove(self, session_id: str) -> None:
        """Removes the session's processor, if it has one."""
        self._processors.pop(session_id, None)

    def get(self, ctx: ReadonlyContext) -> A2uiRequestProcessor | None:
        """Returns the processor of the context's session, or None.

        It has the signature of a processor provider, so it can be passed as
        the `a2ui_processor` of `SendA2uiToClientToolset` and
        `A2uiEventConverter`.
        """
        return self._processors.get(ctx.session.id)

    def is_enabled(self, ctx: ReadonlyContext) -> bool:
        """Reports whether the context's session has a processor.

        It can be passed as the `a2ui_enabled` of `SendA2uiToClientToolset`.
        """
        return ctx.session.id in self._processors

    def __len__(self) -> int:
        return len(self._processors)
