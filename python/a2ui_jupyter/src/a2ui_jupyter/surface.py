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
from pathlib import Path
from typing import Any, TypeAlias

import anywidget
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

AgentMessageInput: TypeAlias = Mapping[str, Any] | BaseModel
RendererMessageHandler: TypeAlias = Callable[[RendererToAgentMessage], None]


class A2UISurface(anywidget.AnyWidget):
    """Display an A2UI surface and receive renderer-to-agent messages.

    The synchronized message log supports frontend initialization and notebook
    state restoration. Live updates also use custom widget messages.
    """

    _esm = Path(__file__).parent / "static" / "widget.js"
    _css = Path(__file__).parent / "static" / "widget.css"

    message_log = List(TraitDict()).tag(sync=True)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
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
            sequence = len(self.message_log)
            entry = {"sequence": sequence, "message": message}
            self.message_log = [*self.message_log, entry]
            super().send({"type": "a2ui", **entry})

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
        return await self._messages.get()

    async def next_action(self) -> A2uiRendererActionMessage:
        """Wait for the next validated action message."""
        return await self._actions.get()

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
