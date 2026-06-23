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

  NOTE: This parser supports unclosed tag auto-closing for real-time streaming preview
  rendering. If the final <a2ui> block is unclosed (truncated), it will be auto-closed
  and compiled with is_final=False to discard any trailing incomplete statements.
  IMPORTANT: For stateful continuations, client applications must accumulate streaming chunks
  at the string level before parsing, rather than parsing chunks in isolation.

  Args:
      content: The raw LLM response.
      catalog_path: Filepath to the catalog JSON.
      surface_id: The target surface ID.

  Returns:
      A list of ResponsePart objects containing compiled JSON payload list.
  """
  is_truncated = False
  last_open = content.rfind("<a2ui>")
  last_close = content.rfind("</a2ui>")
  if last_open != -1 and last_open > last_close:
    content += "</a2ui>"
    is_truncated = True

  matches = list(_A2UI_DSL_BLOCK_PATTERN.finditer(content))
  if not matches:
    return [ResponsePart(text=content, a2ui_json=None)]

  compiler = ExpressCompiler(catalog_path)
  response_parts = []
  last_end = 0

  for idx, match in enumerate(matches):
    start, end = match.span()
    text_part = content[last_end:start].strip()

    dsl_content = match.group(1).strip()
    is_block_final = not (is_truncated and idx == len(matches) - 1)

    try:
      compiled_json = compiler.compile(
          dsl_content, surface_id=surface_id, is_final=is_block_final
      )
      response_parts.append(
          ResponsePart(text=text_part if text_part else None, a2ui_json=[compiled_json])
      )
    except Exception:
      # Graceful fallback: treat malformed/unparseable blocks as plain text so the app doesn't crash
      fallback_text = f"<a2ui>\n{dsl_content}\n</a2ui>"
      full_text = f"{text_part}\n{fallback_text}" if text_part else fallback_text
      response_parts.append(ResponsePart(text=full_text, a2ui_json=None))

    last_end = end

  trailing_text = content[last_end:].strip()
  if trailing_text:
    response_parts.append(ResponsePart(text=trailing_text, a2ui_json=None))

  return response_parts
