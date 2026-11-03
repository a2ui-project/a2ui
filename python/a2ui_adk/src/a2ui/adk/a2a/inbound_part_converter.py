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

"""Inbound A2A-to-GenAI part converter for A2UI renderer messages."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any

from a2a import types as a2a_types
from google.adk.a2a.converters.part_converter import (
    A2APartToGenAIPartConverter,
    convert_a2a_part_to_genai_part,
)
from google.genai import types as genai_types

from a2ui.a2a import is_a2ui_part
from a2ui.core.schema import ProtocolVersion
from a2ui.inbound import format_inbound_for_model, parse_inbound_message


def _infer_version(
    data: Mapping[str, Any],
    default_version: ProtocolVersion | str | None,
) -> ProtocolVersion | str:
    """Resolves the protocol version to validate an inbound A2UI DataPart against."""
    if default_version is not None:
        return default_version
    raw_version = data.get("version")
    if isinstance(raw_version, str):
        return raw_version
    if "userAction" in data:
        return ProtocolVersion.V0_8
    return ProtocolVersion.V1_0


class A2uiInboundPartConverter:
    """Converts inbound A2A parts containing A2UI messages into GenAI parts.

    When an A2A `DataPart` is tagged as an A2UI message (`is_a2ui_part`), this
    converter validates its payload via `parse_inbound_message` and formats
    user-initiated `action` (or v0.8 `userAction`) and renderer `error` messages
    into a `genai_types.Part(text=...)` via `format_inbound_for_model`. RPC
    messages (`callAgentFunction` and `rendererFunctionResponse`) return `None` so
    they are handled by the orchestration layer rather than sent as user text to
    the model. Non-A2UI parts are delegated to ADK's default
    `convert_a2a_part_to_genai_part` converter.
    """

    def __init__(
        self,
        version: ProtocolVersion | str | None = None,
        *,
        fallback_converter: A2APartToGenAIPartConverter = convert_a2a_part_to_genai_part,
        renderer_state: Any = None,
    ) -> None:
        """Initializes the inbound part converter.

        Args:
          version: Optional fixed A2UI protocol version to enforce on every A2UI
            part. When `None`, the converter infers the version from the envelope's
            `version` field (or `userAction` for v0.8, defaulting to v1.0).
          fallback_converter: Converter invoked for non-A2UI A2A parts.
        """
        self._version = version
        self._fallback_converter = fallback_converter
        self._renderer_state = renderer_state

    def convert(
        self, a2a_part: a2a_types.Part
    ) -> genai_types.Part | list[genai_types.Part] | None:
        """Converts a single A2A `Part` into a GenAI `Part` (or `None`)."""
        if not is_a2ui_part(a2a_part):
            return self._fallback_converter(a2a_part)

        inner = a2a_part.root
        assert isinstance(inner, a2a_types.DataPart)
        data = inner.data
        target_version = (
            _infer_version(data, self._version)
            if isinstance(data, Mapping)
            else (self._version or ProtocolVersion.V1_0)
        )
        if isinstance(data, Mapping) and (
            "callAgentFunction" in data or "rendererFunctionResponse" in data
        ):
            if self._renderer_state is not None:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(self._renderer_state.receive(data))
                except RuntimeError:
                    asyncio.run(self._renderer_state.receive(data))
            return None
        parsed = parse_inbound_message(data, target_version)
        formatted = format_inbound_for_model(parsed)
        if formatted is None:
            return None
        return genai_types.Part(text=formatted)

    def __call__(
        self, a2a_part: a2a_types.Part
    ) -> genai_types.Part | list[genai_types.Part] | None:
        """Allows instances to be passed directly as `a2a_part_converter`."""
        return self.convert(a2a_part)
