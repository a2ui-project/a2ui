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

"""Module for `a2ui_rpc_interceptor`, which completes A2UI RPC tasks.

ADK's `A2aAgentExecutor` marks a task `completed` only when the agent sent
something. A request holding only `rendererFunctionResponse` messages has
nothing to send back, so `a2ui_rpc_callback` answers it with an empty
response, and the executor would end the task in the `working` state. The
interceptor ends such tasks `completed` instead.

Usage Example:

  ```python
  config = A2aAgentExecutorConfig(
      event_converter=A2uiEventConverter(a2ui_processor=processors.get),
      execute_interceptors=[a2ui_rpc_interceptor()],
  )
  ```
"""

from __future__ import annotations

from a2a.server.agent_execution.context import RequestContext
from a2a.types import TaskState, TaskStatusUpdateEvent
from google.adk.a2a.executor.config import ExecuteInterceptor
from google.adk.a2a.executor.executor_context import ExecutorContext
from google.adk.utils.feature_decorator import experimental

from ._rpc import is_renderer_rpc_only

# Tasks whose request held only RPC messages, between `before_agent` and
# `after_agent`. A request that fails in between never reaches
# `after_agent`, so the oldest entries are dropped past this size.
_MAX_TRACKED_TASKS = 1024


class _RpcTaskTracker:
    """Remembers which tasks' requests held only renderer RPC messages."""

    def __init__(self) -> None:
        # A dict keeps insertion order, so the first key is the oldest.
        self._rpc_task_ids: dict[str, None] = {}

    async def before_agent(self, context: RequestContext) -> RequestContext:
        if (
            context.task_id is not None
            and context.message is not None
            and is_renderer_rpc_only(context.message.parts)
        ):
            self._rpc_task_ids[context.task_id] = None
            while len(self._rpc_task_ids) > _MAX_TRACKED_TASKS:
                del self._rpc_task_ids[next(iter(self._rpc_task_ids))]
        return context

    async def after_agent(
        self, executor_context: ExecutorContext, final_event: TaskStatusUpdateEvent
    ) -> TaskStatusUpdateEvent:
        if final_event.task_id not in self._rpc_task_ids:
            return final_event
        del self._rpc_task_ids[final_event.task_id]
        status = final_event.status
        if status.state != TaskState.working or (
            status.message is not None and status.message.parts
        ):
            return final_event
        return final_event.model_copy(
            update={"status": status.model_copy(update={"state": TaskState.completed})}
        )


@experimental
def a2ui_rpc_interceptor() -> ExecuteInterceptor:
    """Returns an `A2aAgentExecutor` interceptor that completes RPC-only tasks.

    Its `before_agent` hook checks the request message: when every part is an
    A2UI `callAgentFunction` or `rendererFunctionResponse` message, it notes
    the task. Its `after_agent` hook then changes that task's final status
    from `working`, which ADK's executor reports when the agent sent nothing,
    to `completed`. Other final states, such as `failed`, `input_required` or
    a `completed` task with a result, and every other task, are left as they
    are.

    It reads the request itself, so it doesn't depend on `a2ui_rpc_callback`,
    though the two are meant to be used together. Use one interceptor per
    executor.

    Returns:
        The interceptor, for `A2aAgentExecutorConfig.execute_interceptors`.
    """
    tracker = _RpcTaskTracker()
    return ExecuteInterceptor(
        before_agent=tracker.before_agent, after_agent=tracker.after_agent
    )
