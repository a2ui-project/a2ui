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

"""An anywidget surface and its kernel-side message bridge."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Mapping
from importlib.metadata import version
from pathlib import Path
from typing import Any, TypeAlias, TypeVar

import anywidget
from IPython import get_ipython
from ipykernel.kernelbase import Kernel
from jupyter_ui_poll import ui_events
from pydantic import BaseModel, TypeAdapter
from traitlets import Dict as TraitDict, List

from a2ui.core.schema.v1_0 import (
    A2uiRendererActionMessage,
    AgentToRendererMessage,
    RendererToAgentMessage,
)

_AGENT_MESSAGE_ADAPTER: TypeAdapter[AgentToRendererMessage] = TypeAdapter(
    AgentToRendererMessage
)
_RENDERER_MESSAGE_ADAPTER: TypeAdapter[RendererToAgentMessage] = TypeAdapter(
    RendererToAgentMessage
)

# ipykernel 7.4 dispatches comm messages while an async cell is awaiting.
# Older kernels queue them behind the running cell, so waits must pump them.
# Pumping relies on `Kernel.do_one_iteration`, which 7.1 to 7.3 do not have.
_NATIVE_COMM_DISPATCH_VERSION = (7, 4)
_NO_POLLING_VERSION = (7, 1)
_POLL_INTERVAL_SECONDS = 0.02
_LOG_SYNC_INTERVAL_SECONDS = 0.2

AgentMessageInput: TypeAlias = Mapping[str, Any] | BaseModel
RendererMessageHandler: TypeAlias = Callable[[RendererToAgentMessage], None]
_T = TypeVar("_T")


def _kernel_needs_comm_polling() -> bool:
    if not isinstance(getattr(get_ipython(), "kernel", None), Kernel):
        return False
    major, minor = (int(part) for part in version("ipykernel").split(".")[:2])
    if (major, minor) >= _NATIVE_COMM_DISPATCH_VERSION:
        return False
    if (major, minor) >= _NO_POLLING_VERSION:
        raise RuntimeError(
            f"ipykernel {major}.{minor} cannot deliver renderer messages while a"
            " cell is waiting. Install ipykernel 7.4 or newer, or a version from"
            " 6.29 to 7.0, and restart the kernel."
        )
    return True


async def _poll_kernel_until_ready(queue: asyncio.Queue[_T]) -> None:
    # Execute requests that arrive meanwhile are deferred until the cell ends.
    async with ui_events() as poll:
        while queue.empty():
            await poll(10)
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)


class A2UISurface(anywidget.AnyWidget):
    """Display an A2UI surface and receive renderer-to-agent messages.

    Live updates use custom widget messages. The synchronized message log
    supports views that mount later and notebook state restoration; it is
    synchronized at most every 200 ms and before the widget is displayed, so a
    burst of `send` calls does not resend the whole log for each message.
    """

    _esm = Path(__file__).parent / "static" / "widget.js"
    _css = Path(__file__).parent / "static" / "widget.css"

    message_log = List(TraitDict()).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._log: list[dict[str, Any]] = list(self.message_log)
        self._log_sync_handle: asyncio.TimerHandle | None = None
        self._messages: asyncio.Queue[RendererToAgentMessage] = asyncio.Queue()
        self._actions: asyncio.Queue[A2uiRendererActionMessage] = asyncio.Queue()
        self._message_handlers: list[RendererMessageHandler] = []
        self._action_handlers: list[Callable[[A2uiRendererActionMessage], None]] = []
        self.on_msg(self._handle_frontend_message)

    def send(self, messages: AgentMessageInput | Iterable[AgentMessageInput]) -> None:
        """Validate and send one or more v1.0 agent-to-renderer messages.

        All messages are validated before any are sent, so a bad item cannot
        partially apply a batch.
        """
        if isinstance(messages, BaseModel) or isinstance(messages, Mapping):
            batch = [messages]
        else:
            batch = list(messages)

        validated = [
            _AGENT_MESSAGE_ADAPTER.validate_python(message).model_dump(
                by_alias=True, exclude_unset=True
            )
            for message in batch
        ]

        for message in validated:
            entry = {"sequence": len(self._log), "message": message}
            self._log.append(entry)
            super().send({"type": "a2ui", **entry})
        self._schedule_log_sync()

    def on_message(self, handler: RendererMessageHandler) -> Callable[[], None]:
        """Register a callback for each validated renderer-to-agent message."""
        self._message_handlers.append(handler)

        def unsubscribe() -> None:
            if handler in self._message_handlers:
                self._message_handlers.remove(handler)

        return unsubscribe

    def on_action(
        self, handler: Callable[[A2uiRendererActionMessage], None]
    ) -> Callable[[], None]:
        """Register a callback for each validated action message."""
        self._action_handlers.append(handler)

        def unsubscribe() -> None:
            if handler in self._action_handlers:
                self._action_handlers.remove(handler)

        return unsubscribe

    async def next_message(self) -> RendererToAgentMessage:
        """Wait for the next validated renderer-to-agent message."""
        return await self._next_from(self._messages)

    async def next_action(self) -> A2uiRendererActionMessage:
        """Wait for the next validated action message."""
        return await self._next_from(self._actions)

    def _repr_mimebundle_(self, **kwargs: Any) -> Any:
        self._sync_log()
        return super()._repr_mimebundle_(**kwargs)

    async def _next_from(self, queue: asyncio.Queue[_T]) -> _T:
        if queue.empty() and _kernel_needs_comm_polling():
            await _poll_kernel_until_ready(queue)
        return await queue.get()

    def _schedule_log_sync(self) -> None:
        if self._log_sync_handle is not None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self._sync_log()
            return
        self._log_sync_handle = loop.call_later(
            _LOG_SYNC_INTERVAL_SECONDS, self._sync_log
        )

    def _sync_log(self) -> None:
        if self._log_sync_handle is not None:
            self._log_sync_handle.cancel()
            self._log_sync_handle = None
        if len(self.message_log) != len(self._log):
            self.message_log = list(self._log)

    def _handle_frontend_message(
        self, _widget: anywidget.AnyWidget, content: Any, _buffers: list[Any]
    ) -> None:
        if not isinstance(content, Mapping) or content.get("type") != "a2ui":
            raise ValueError("Unsupported custom message; expected type 'a2ui'.")
        message = _RENDERER_MESSAGE_ADAPTER.validate_python(content.get("message"))
        self._messages.put_nowait(message)
        for handler in tuple(self._message_handlers):
            handler(message)
        if isinstance(message, A2uiRendererActionMessage):
            self._actions.put_nowait(message)
            for action_handler in tuple(self._action_handlers):
                action_handler(message)
