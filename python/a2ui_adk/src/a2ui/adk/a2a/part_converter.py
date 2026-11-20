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

"""Module for the A2UI Part Converter.

This module provides the `A2uiPartConverter` which acts as a processor-aware GenAI to A2A
part converter. It handles both tool-based A2UI (via the `send_a2ui_json_to_client` tool response)
and text-based A2UI (read with the processor's inference format), validating the structures
against the processor's catalogs and the renderer state bound to it.

Key Components:
  * `A2uiPartConverter`: A processor-aware GenAI to A2A part converter.

Usage Example:

  Typically used internally by the A2uiEventConverter or manually configured for custom part conversions:

  ```python
  converter = A2uiPartConverter(processor)
  a2a_parts = converter.convert(genai_part)
  ```
"""

from __future__ import annotations

from collections.abc import Collection
import logging
from typing import Any

from a2a import types as a2a_types
from google.adk.a2a.converters import part_converter
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

from a2ui import constants
from a2ui.a2a import create_a2ui_part, parse_content_to_parts
from a2ui.processor import A2uiRequestProcessor

logger = logging.getLogger(__name__)


@experimental
class A2uiPartConverter:
    """A processor-aware GenAI to A2A part converter.

    This converter handles both tool-based A2UI (via `send_a2ui_json_to_client`)
    and text-based A2UI (via the format's delimiter tags). The processor
    supplies everything it needs: the parser for its inference format, the
    catalogs that text-based A2UI is validated against, and the
    `RendererState` bound to it, if any, which text-based A2UI is checked
    against and applied to. Each part is labeled with its message's protocol
    version.

    Args:
        processor: The request processor for the client's catalogs.
        bypass_tool_check: If True, bypass tool validation.
        fallback_text: Optional text to fall back on if parsing fails.
        allowed_a2ui_tool_names: Optional allowlist of domain tool names whose
            `A2UI_VALIDATED_JSON_KEY` payloads (populated by trusted callbacks
            such as `make_adk_after_tool_callback`) are emitted as A2UI parts.
    """

    def __init__(
        self,
        processor: A2uiRequestProcessor,
        *,
        bypass_tool_check: bool = False,
        fallback_text: str | None = None,
        allowed_a2ui_tool_names: Collection[str] = (),
    ):
        self._processor = processor
        self._bypass_tool_check = bypass_tool_check
        self._fallback_text = fallback_text
        if isinstance(allowed_a2ui_tool_names, (str, bytes)):
            raise TypeError(
                "allowed_a2ui_tool_names must be a collection of tool names, not a"
                " string."
            )
        self._allowed_a2ui_tool_names: frozenset[str] = frozenset(
            allowed_a2ui_tool_names
        )
        self._parser = processor.parser
        self._state = processor.state

    def _convert_validated_tool_response(
        self,
        response_dict: Any,
        *,
        is_a2ui_tool: bool,
    ) -> list[a2a_types.Part] | None:
        """Converts `A2UI_VALIDATED_JSON_KEY` or `A2UI_TOOL_ERROR_KEY` responses."""
        if not isinstance(response_dict, dict):
            return [] if is_a2ui_tool else None

        if (
            is_a2ui_tool or self._bypass_tool_check
        ) and constants.A2UI_TOOL_ERROR_KEY in response_dict:
            # The error may quote the payload, so it is only logged at debug level.
            logger.warning("A2UI tool call failed.")
            logger.debug(
                "A2UI tool error: %s",
                response_dict[constants.A2UI_TOOL_ERROR_KEY],
            )
            return []

        json_data = response_dict.get(constants.A2UI_VALIDATED_JSON_KEY)
        if json_data:
            return [create_a2ui_part(message) for message in json_data]

        if is_a2ui_tool:
            logger.info("No result in A2UI tool response")
            return []
        return None

    def _convert_function_response(
        self, function_response: genai_types.FunctionResponse
    ) -> list[a2a_types.Part] | None:
        """Converts an A2UI-bearing `FunctionResponse`, or returns None to fall back."""
        is_a2ui_tool = function_response.name == constants.A2UI_TOOL_NAME
        is_allowed_tool = function_response.name in self._allowed_a2ui_tool_names

        if is_a2ui_tool or is_allowed_tool or self._bypass_tool_check:
            converted = self._convert_validated_tool_response(
                function_response.response or {},
                is_a2ui_tool=is_a2ui_tool,
            )
            if converted is not None:
                return converted

        response = function_response.response
        result = response.get("result") if isinstance(response, dict) else None
        if isinstance(result, str) and self._parser.has_format_content(result):
            return parse_content_to_parts(
                result,
                parser=self._parser,
                fallback_text=self._fallback_text,
                state=self._state,
            )
        return None

    def convert(self, part: genai_types.Part) -> list[a2a_types.Part]:
        """Converts a GenAI part to A2A parts, with A2UI validation.

        Args:
            part: The GenAI part to convert.

        Returns:
            A list of A2A parts.
        """
        # 1. Handle Tool Responses (FunctionResponse)
        if function_response := part.function_response:
            converted = self._convert_function_response(function_response)
            if converted is not None:
                return converted

        # 2. Handle Tool Calls (FunctionCall) - Skip sending to client
        if (
            function_call := part.function_call
        ) and function_call.name == constants.A2UI_TOOL_NAME:
            return []

        # 3. Handle Text-based A2UI (TextPart)
        if (text := part.text) and not part.thought:
            if self._parser.has_format_content(text):
                return parse_content_to_parts(
                    text,
                    parser=self._parser,
                    fallback_text=self._fallback_text,
                    state=self._state,
                )

        # 4. Default conversion for other parts
        converted_part = part_converter.convert_genai_part_to_a2a_part(part)
        return [converted_part] if converted_part else []
