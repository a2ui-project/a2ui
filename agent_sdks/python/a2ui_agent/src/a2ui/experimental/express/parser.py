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

"""Parser utilities to extract and compile A2UI Express DSL from LLM responses."""

import re
from typing import List, Optional, Any
from a2ui.parser.response_part import ResponsePart
from .compiler import ExpressCompiler

_A2UI_DSL_BLOCK_PATTERN = re.compile(r"<a2ui>(.*?)</a2ui>", re.DOTALL)


def parse_express_response(
    content: str, catalog_path: str, surface_id: str = "main"
) -> List[ResponsePart]:
  """Parses response containing A2UI Express DSL and compiles it to ResponseParts.

  Args:
      content: The raw LLM response.
      catalog_path: Filepath to the catalog JSON.
      surface_id: The target surface ID.

  Returns:
      A list of ResponsePart objects containing compiled JSON payload list.

  Raises:
      ValueError: If no A2UI Express sentinel tags are found.
  """
  matches = list(_A2UI_DSL_BLOCK_PATTERN.finditer(content))

  if not matches:
    raise ValueError("A2UI Express tags '<a2ui>' and '</a2ui>' not found in response.")

  compiler = ExpressCompiler(catalog_path)
  response_parts = []
  last_end = 0

  for match in matches:
    start, end = match.span()
    text_part = content[last_end:start].strip()

    dsl_content = match.group(1).strip()
    compiled_json = compiler.compile(dsl_content, surface_id=surface_id)

    response_parts.append(ResponsePart(text=text_part, a2ui_json=[compiled_json]))
    last_end = end

  trailing_text = content[last_end:].strip()
  if trailing_text:
    response_parts.append(ResponsePart(text=trailing_text, a2ui_json=None))

  return response_parts
