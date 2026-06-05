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

import logging
from typing import Any, Optional, List, AsyncIterable, TYPE_CHECKING

if TYPE_CHECKING:
  from a2ui.parser.streaming import A2uiStreamParser
from a2a.types import (
    Part,
    DataPart,
    TextPart,
)

logger = logging.getLogger(__name__)

MIME_TYPE_KEY = "mimeType"
A2UI_MIME_TYPE = "application/a2ui+json"
DEPRECATED_A2UI_MIME_TYPE = "application/json+a2ui"


def create_a2ui_part(a2ui_data: dict[str, Any], version: Optional[str] = None) -> Part:
  """Creates an A2A Part containing A2UI data.

  Args:
      a2ui_data: The A2UI data dictionary.
      version: Optional version string.

  Returns:
      An A2A Part with a DataPart containing the A2UI data.
  """
  mime_type = A2UI_MIME_TYPE
  if version is None or version in ("0.8", "0.9", "v0.8", "v0.9"):
    mime_type = DEPRECATED_A2UI_MIME_TYPE

  return Part(
      root=DataPart(
          data=a2ui_data,
          metadata={
              MIME_TYPE_KEY: mime_type,
          },
      )
  )


def is_a2ui_part(part: Part) -> bool:
  """Checks if an A2A Part contains A2UI data.

  Args:
      part: The A2A Part to check.

  Returns:
      True if the part contains A2UI data, False otherwise.
  """
  return (
      isinstance(part.root, DataPart)
      and part.root.metadata
      and part.root.metadata.get(MIME_TYPE_KEY)
      in (A2UI_MIME_TYPE, DEPRECATED_A2UI_MIME_TYPE)
  )


def get_a2ui_datapart(part: Part) -> Optional[DataPart]:
  """Extracts the DataPart containing A2UI data from an A2A Part, if present.

  Args:
      part: The A2A Part to extract A2UI data from.

  Returns:
      The DataPart containing A2UI data if present, None otherwise.
  """
  if is_a2ui_part(part):
    return part.root
  return None


def parse_response_to_parts(
    content: str,
    validator: Optional[Any] = None,
    fallback_text: Optional[str] = None,
    version: Optional[str] = None,
) -> List[Part]:
  """Helper to parse LLM response content into A2A Parts, with optional validation.

  Args:
      content: The LLM response content, potentially containing A2UI delimiters.
      validator: Optional validator to run against extracted JSON payloads.
      fallback_text: Optional text to return if no parts are successfully created.
      version: Optional version string.

  Returns:
      A list of A2A Part objects (TextPart and/or DataPart).
  """
  from a2ui.parser.parser import parse_response

  parts = []
  try:
    response_parts = parse_response(content)

    for part in response_parts:
      if part.text:
        parts.append(Part(root=TextPart(text=part.text)))

      if part.a2ui_json:
        json_data = part.a2ui_json
        if validator:
          validator.validate(json_data)

        if isinstance(json_data, list):
          for message in json_data:
            parts.append(create_a2ui_part(message, version=version))
        else:
          parts.append(create_a2ui_part(json_data, version=version))

  except Exception as e:
    logger.warning(f"Failed to parse or validate A2UI response: {e}")

  if not parts and fallback_text:
    parts.append(Part(root=TextPart(text=fallback_text)))

  return parts


async def stream_response_to_parts(
    parser: "A2uiStreamParser",
    token_stream: AsyncIterable[str],
    version: Optional[str] = None,
) -> AsyncIterable[Part]:
  """Helper to parse a stream of LLM tokens into A2A Parts incrementally.

  Args:
      parser: A2uiStreamParser instance to process the stream.
      token_stream: An async iterable of strings (tokens).
      version: Optional version string.

  Yields:
      A2A Part objects as they are discovered in the stream.
  """
  async for token in token_stream:
    logger.info("-----------------------------")
    logger.info(f"--- AGENT: Received token:\n{token}")
    response_parts = parser.process_chunk(token)
    logger.info(
        f"--- AGENT: Response parts:\n{[part.a2ui_json for part in response_parts]}\n"
    )
    logger.info("-----------------------------")

    for part in response_parts:
      if part.text:
        yield Part(root=TextPart(text=part.text))

      if part.a2ui_json:
        json_data = part.a2ui_json

        if isinstance(json_data, list):
          for message in json_data:
            yield create_a2ui_part(message, version=version)
        else:
          yield create_a2ui_part(json_data, version=version)
