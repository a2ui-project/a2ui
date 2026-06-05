# Copyright 2025 Google LLC
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

This module provides the `A2uiPartConverter` which acts as a catalog-aware GenAI to A2A
part converter. It handles both tool-based A2UI (via the `send_a2ui_json_to_client` tool response)
and text-based A2UI (extracted and healed via A2UI custom tags), validating the structures
against the active A2UI catalog schema.

Key Components:
  * `A2uiPartConverter`: A catalog-aware GenAI to A2A part converter.

Usage Example:

  Typically used internally by the A2uiEventConverter or manually configured for custom part conversions:

  ```python
  converter = A2uiPartConverter(a2ui_catalog=my_catalog)
  a2a_parts = converter.convert(genai_part)
  ```
"""

import logging
from typing import Optional


from a2a import types as a2a_types
from a2ui.a2a.parts import create_a2ui_part, parse_response_to_parts
from a2ui.parser.parser import has_a2ui_parts
from a2ui.schema import constants
from a2ui.schema.catalog import A2uiCatalog
from google.adk.a2a.converters import part_converter
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

logger = logging.getLogger(__name__)


@experimental
class A2uiPartConverter:
  """A catalog-aware GenAI to A2A part converter.

  This converter handles both tool-based A2UI (via `send_a2ui_json_to_client`)
  and text-based A2UI (via A2UI delimiter tags). It uses the provided
  catalog to validate and fix JSON payloads.

  Args:
      a2ui_catalog: The A2UI catalog.
      bypass_tool_check: If True, bypass tool validation.
      fallback_text: Optional text to fall back on if parsing fails.
      version: The A2UI version to use. Defaults to "0.8".
  """

  def __init__(
      self,
      a2ui_catalog: A2uiCatalog,
      bypass_tool_check: bool = False,
      fallback_text: Optional[str] = None,
      version: str = constants.VERSION_0_8,
  ):
    self._catalog = a2ui_catalog
    self._bypass_tool_check = bypass_tool_check
    self._fallback_text = fallback_text
    self._version = version

  def convert(self, part: genai_types.Part) -> list[a2a_types.Part]:
    """Converts a GenAI part to A2A parts, with A2UI validation.

    Args:
        part: The GenAI part to convert.

    Returns:
        A list of A2A parts.
    """
    # 1. Handle Tool Responses (FunctionResponse)
    if function_response := part.function_response:
      is_send_a2ui_json_to_client_response = (
          function_response.name == constants.A2UI_TOOL_NAME
      )

      if is_send_a2ui_json_to_client_response or self._bypass_tool_check:
        response_dict = function_response.response or {}

        if constants.A2UI_TOOL_ERROR_KEY in response_dict:
          logger.warning(
              f"A2UI tool call failed: {response_dict[constants.A2UI_TOOL_ERROR_KEY]}"
          )
          return []

        if (
            isinstance(response_dict, dict)
            and constants.A2UI_VALIDATED_JSON_KEY in response_dict
        ):
          json_data = response_dict.get(constants.A2UI_VALIDATED_JSON_KEY)
          if json_data:
            return [
                create_a2ui_part(message, version=self._version)
                for message in json_data
            ]

        if is_send_a2ui_json_to_client_response:
          logger.info("No result in A2UI tool response")
          return []

      # Handle generic/other tool responses that returned a string containing A2UI tags.
      if function_response.response and function_response.response.get("result"):
        result = function_response.response.get("result")
        if has_a2ui_parts(result):
          return parse_response_to_parts(
              result,
              validator=self._catalog.validator,
              fallback_text=self._fallback_text,
              version=self._version,
          )

    # 2. Handle Tool Calls (FunctionCall) - Skip sending to client
    if (
        function_call := part.function_call
    ) and function_call.name == constants.A2UI_TOOL_NAME:
      return []

    # 3. Handle Text-based A2UI (TextPart)
    if text := part.text:
      if has_a2ui_parts(text):
        return parse_response_to_parts(
            text,
            validator=self._catalog.validator,
            fallback_text=self._fallback_text,
            version=self._version,
        )

    # 4. Default conversion for other parts
    converted_part = part_converter.convert_genai_part_to_a2a_part(part)
    return [converted_part] if converted_part else []
