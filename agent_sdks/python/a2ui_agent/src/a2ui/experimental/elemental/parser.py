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

"""Parser utilities to extract and compile A2UI Elemental HTML from LLM responses."""

import re
from typing import Any, Dict, List, Optional, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from .compiler import ElementalCompiler

_BODY_OPEN_PATTERN = re.compile(r"<body\b[^>]*>", re.IGNORECASE)


def parse_elemental_response(
    content: str,
    catalog: Union[Catalog[Any, Any], A2uiCatalog],
    surface_id: str = "main",
) -> List[ResponsePart]:
    """Parses response containing A2UI Elemental HTML and compiles it to ResponseParts.

    NOTE: This parser supports unclosed tag auto-closing for real-time streaming preview
    rendering. If the final <body> block is unclosed (truncated), it will be auto-closed
    and compiled with is_final=False to discard any trailing incomplete statements.

    Args:
        content: The raw LLM response.
        catalog: A Catalog or an A2uiCatalog.
        surface_id: The target surface ID.

    Returns:
        A list of ResponsePart objects containing compiled JSON payload list.
    """
    content_lower = content.lower()
    last_open_match = list(_BODY_OPEN_PATTERN.finditer(content))
    last_close = content_lower.rfind("</body>")

    is_truncated = False
    if last_open_match:
        last_open = last_open_match[-1].start()
        if last_open > last_close:
            content += "\n</body>"
            is_truncated = True

    from .compiler import TAG_PREFIX

    # Match <body>...</body>, <ui-delete-surface.../>, and <ui-call-function.../> blocks
    block_pattern = re.compile(
        r"<body\b[^>]*>.*</body>"
        f"|<{TAG_PREFIX}delete-surface\\b[^>]*>(?:.*?</{TAG_PREFIX}delete-surface>|/>)?"
        f"|<{TAG_PREFIX}call-function\\b[^>]*>(?:.*?</{TAG_PREFIX}call-function>|/>)?",
        re.DOTALL | re.IGNORECASE,
    )
    matches = list(block_pattern.finditer(content))

    if not matches:
        return [ResponsePart(text=content, a2ui_json=None)]

    compiler = ElementalCompiler(catalog)
    response_parts = []
    last_end = 0

    for idx, match in enumerate(matches):
        start, end = match.span()

        # Clean up markdown code block wrappers around the HTML block
        text_part = content[last_end:start]
        text_part_stripped = re.sub(
            r"```html\s*$", "", text_part, flags=re.IGNORECASE
        ).strip()

        html_content = match.group(0).strip()
        is_block_final = not (is_truncated and idx == len(matches) - 1)

        try:
            compiled_json = compiler.compile(
                html_content, surface_id=surface_id, is_final=is_block_final
            )
            response_parts.append(
                ResponsePart(
                    text=text_part_stripped if text_part_stripped else None,
                    a2ui_json=[compiled_json],
                )
            )
        except Exception as e:
            # Graceful fallback: treat malformed/unparseable blocks as plain text
            fallback_text = html_content
            full_text = f"{text_part}\n{fallback_text}" if text_part else fallback_text
            response_parts.append(ResponsePart(text=full_text, a2ui_json=None))

        last_end = end

    trailing_text = content[last_end:]
    trailing_text_stripped = re.sub(r"^\s*```", "", trailing_text).strip()
    if trailing_text_stripped:
        response_parts.append(ResponsePart(text=trailing_text_stripped, a2ui_json=None))

    return response_parts
