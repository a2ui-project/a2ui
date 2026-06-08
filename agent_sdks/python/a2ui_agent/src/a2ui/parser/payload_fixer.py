# Copyright 2026 Google LLC
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

import json
import logging
import re
from typing import Any, Dict, List


logger = logging.getLogger(__name__)


def parse_and_fix(payload: str) -> List[Dict[str, Any]]:
  """Validates and applies autofixes to a raw JSON string and returns the parsed payload.

  Args:
    payload: The raw JSON string from the LLM.

  Returns:
    A parsed and potentially fixed payload (list of dicts).
  """
  normalized_payload = _normalize_smart_quotes(payload)
  try:
    a2ui_json = _parse(normalized_payload)
    return a2ui_json
  except (
      json.JSONDecodeError,
      ValueError,
  ) as e:
    logger.warning(f"Initial A2UI payload validation failed: {e}")
    updated_payload = _remove_trailing_commas(normalized_payload)
    a2ui_json = _parse(updated_payload)
    return a2ui_json


def _parse(payload: str) -> List[Dict[str, Any]]:
  """Parses the payload and returns a list of A2UI JSON objects."""
  try:
    a2ui_json = json.loads(payload)
    if not isinstance(a2ui_json, list):
      logger.info("Received a single JSON object, wrapping in a list for validation.")
      a2ui_json = [a2ui_json]
    return a2ui_json
  except json.JSONDecodeError as e:
    logger.error(f"Failed to parse JSON: {e}")
    raise ValueError(f"Failed to parse JSON: {e}")


def _normalize_smart_quotes(json_str: str) -> str:
  """Replaces smart (curly) quotes with standard straight quotes."""
  return (
      json_str.replace("\u201C", '"')
      .replace("\u201D", '"')
      .replace("\u2018", "'")
      .replace("\u2019", "'")
  )


def _remove_trailing_commas(json_str: str) -> str:
  """Attempts to remove trailing commas from a JSON string.

  Args:
    json_str: The raw JSON string from the LLM.

  Returns:
    A potentially fixed JSON string.
  """
  # Fix trailing commas: identifying commas followed by optional whitespace and a closing bracket (]) or brace (}).
  fixed_json = re.sub(r",(?=\s*[\]}])", "", json_str)

  if fixed_json != json_str:
    logger.warning("Detected trailing commas in LLM output; applied autofix.")

  return fixed_json
