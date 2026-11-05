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

"""Turns model output written in Express into validated A2UI v1.0 messages."""

from __future__ import annotations

import dataclasses
from typing import Any

from a2ui.core import MessageProcessor
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart, TextPart
from a2ui.transformers.macros import MacroExpander

from liner_notes.macros import ALL_MACROS
from liner_notes.music_catalog import load_music_catalog

PROTOCOL_VERSION = "1.0"


@dataclasses.dataclass
class RenderedTurn:
    """The renderer-facing result of one model response."""

    text: str
    messages: list[dict[str, Any]]
    macro_calls: list[str]
    inference_component_count: int
    transport_component_count: int


class A2uiRuntime:
    """Owns the catalogs, the macro expander and the Express inference format.

    The renderer gets the basic and music catalogs. The model also sees the
    macro sidecar catalog, which `MacroExpander` lowers away before anything
    reaches the renderer.
    """

    def __init__(self) -> None:
        self.basic_catalog = BasicCatalog(PROTOCOL_VERSION)
        self.music_catalog = load_music_catalog()
        self.transport_catalogs = [self.basic_catalog, self.music_catalog]
        # Raise instead of passing failed macros through, so the agent can
        # retry with the error message.
        self.expander = MacroExpander(ALL_MACROS, on_error="raise")
        self.inference_catalogs = self.expander.transform_catalogs(
            self.transport_catalogs
        )
        self.macro_names = {m.name for m in self.expander.macros}
        self.prompt_snippet = self._format("main").prompt_generator.generate()

    def _format(self, surface_id: str) -> ExpressFormat:
        return ExpressFormat(catalogs=self.inference_catalogs, surface_id=surface_id)

    def render(self, model_output: str, surface_id: str) -> RenderedTurn:
        """Parses, expands and validates a model response.

        Raises:
            A2uiError: If the output does not parse, a macro fails to expand,
                or the expanded messages fail renderer-side validation.
        """
        parts = self._format(surface_id).create_parser().parse_response(model_output)
        text_parts = [p.text.strip() for p in parts if isinstance(p, TextPart)]
        inference_messages = [
            m for p in parts if isinstance(p, A2uiPart) for m in p.a2ui
        ]

        inference_components = [
            c
            for m in inference_messages
            for c in _components(m.model_dump(by_alias=True, exclude_none=True))
        ]
        macro_calls = [
            c["component"]
            for c in inference_components
            if c.get("component") in self.macro_names
        ]
        lowered = self.expander.transform_to_transport(
            inference_messages, surface_catalogs={surface_id: None}
        )
        messages = [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
        # The Express prompt examples teach `surface("main")`, which overrides
        # the parser's surface id. Each turn must own its own surface.
        for message in messages:
            for body in message.values():
                if isinstance(body, dict) and "surfaceId" in body:
                    body["surfaceId"] = surface_id
        self.validate(messages)
        return RenderedTurn(
            text="\n\n".join(t for t in text_parts if t),
            messages=messages,
            macro_calls=macro_calls,
            inference_component_count=len(inference_components),
            transport_component_count=sum(len(_components(m)) for m in messages),
        )

    def validate(self, messages: list[dict[str, Any]]) -> None:
        """Runs the messages through a renderer-equivalent processor."""
        MessageProcessor(self.transport_catalogs).process_messages(messages)


def _components(message: dict[str, Any]) -> list[dict[str, Any]]:
    body = message.get("createSurface") or message.get("updateComponents") or {}
    return body.get("components") or []
