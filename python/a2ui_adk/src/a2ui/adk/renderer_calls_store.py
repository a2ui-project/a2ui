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

"""Module for the A2uiRendererCallsStore.

A `RendererFunctionCalls` holds the agent's pending `callRendererFunction`
calls of one conversation, as asyncio futures, so like an
`A2uiRequestProcessor` it can't be kept in ADK session state.
`A2uiRendererCallsStore` keeps one per session in memory. A tool gets the
session's instance to call a renderer function, and the callback from
`a2ui_rpc_callback` gets the same instance to settle the call when the
renderer's `rendererFunctionResponse` arrives.

Usage Example:

  ```python
  renderer_calls = A2uiRendererCallsStore()

  # In the agent
  agent = LlmAgent(
      ...,
      before_agent_callback=a2ui_rpc_callback(
          agent_functions=registry, renderer_calls=renderer_calls.get
      ),
  )

  # In a tool
  message, result = renderer_calls.get(tool_context).call(
      catalog_id=CATALOG_ID, name="getLocation"
  )

  # When the session ends
  renderer_calls.remove(session.id)
  ```
"""

from __future__ import annotations

from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.utils.feature_decorator import experimental

from a2ui.rpc import DEFAULT_RENDERER_CALL_TIMEOUT, RendererFunctionCalls


@experimental
class A2uiRendererCallsStore:
    """Keeps a `RendererFunctionCalls` for each session, outside session state.

    `get` creates the session's instance the first time it is asked for, with
    the store's `default_timeout` and `max_pending`. Call `remove` when a
    session ends: it disposes the session's instance, which fails its pending
    calls. Nothing is evicted on its own.
    """

    def __init__(
        self,
        *,
        default_timeout: float | None = DEFAULT_RENDERER_CALL_TIMEOUT,
        max_pending: int | None = None,
    ) -> None:
        """Initializes the store.

        Args:
            default_timeout: The `default_timeout` of each session's
                `RendererFunctionCalls`.
            max_pending: The `max_pending` of each session's
                `RendererFunctionCalls`.

        Raises:
            ValueError: If `default_timeout` or `max_pending` is not positive.
        """
        if default_timeout is not None and default_timeout <= 0:
            raise ValueError("default_timeout must be positive or None.")
        if max_pending is not None and max_pending < 1:
            raise ValueError("max_pending must be at least 1.")
        self._default_timeout = default_timeout
        self._max_pending = max_pending
        self._calls: dict[str, RendererFunctionCalls] = {}

    def get(self, ctx: ReadonlyContext) -> RendererFunctionCalls:
        """Returns the `RendererFunctionCalls` of the context's session.

        It has the signature of a `RendererFunctionCallsProvider`, so it can be
        passed as the `renderer_calls` of `a2ui_rpc_callback`.
        """
        return self.get_for_session(ctx.session.id)

    def get_for_session(self, session_id: str) -> RendererFunctionCalls:
        """Returns the session's `RendererFunctionCalls`, creating it if needed.

        An instance that was disposed outside the store is replaced.
        """
        calls = self._calls.get(session_id)
        if calls is None or calls.disposed:
            calls = RendererFunctionCalls(
                default_timeout=self._default_timeout, max_pending=self._max_pending
            )
            self._calls[session_id] = calls
        return calls

    def remove(self, session_id: str, reason: str = "The session was removed.") -> None:
        """Removes and disposes the session's instance, if it has one.

        Its pending calls fail with `A2uiRpcError(reason)`.
        """
        calls = self._calls.pop(session_id, None)
        if calls is not None:
            calls.dispose(reason)

    def dispose(self, reason: str = "The store was disposed.") -> None:
        """Removes and disposes every session's instance, as on shutdown."""
        calls, self._calls = self._calls, {}
        for instance in calls.values():
            instance.dispose(reason)

    def __contains__(self, session_id: object) -> bool:
        return session_id in self._calls

    def __len__(self) -> int:
        return len(self._calls)
