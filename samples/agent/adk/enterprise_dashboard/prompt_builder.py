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

"""Prompt construction for the enterprise dashboard sample.

Demonstrates how to build compact, visual-first system prompts
that prevent the LLM from falling back to markdown "walls of text."

Key patterns:
  - Anti-markdown rules with A2UI component alternatives
  - Layout recipes mapping data types to component compositions
  - Output ordering (A2UI JSON first, brief text after)
  - Component diversity requirements
"""

import os

from a2ui.schema.constants import VERSION_0_8
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.basic_catalog.provider import BasicCatalog

ROLE_DESCRIPTION = (
    "You are a visual-first enterprise analytics dashboard. You render "
    "all business data as compact A2UI component layouts. You NEVER "
    "respond with plain text or markdown — every response contains "
    "an A2UI JSON block as its primary content."
)

UI_DESCRIPTION = """
Layout Recipes (use the right pattern for each data type):
- KPI metrics: Row of Card components, each Card wrapping a Text child
  with bold metric name, large value, and trend indicator.
- Store/product comparisons: Row of Card components side-by-side.
- Rankings and lists: List with Card children, each showing rank +
  name + key metric.
- Multi-section responses: Tabs component organizing different views
  (e.g., Revenue tab, Products tab, Stores tab).
- Section separators: Divider between logical groups.
- Status indicators: Icon components (trending_up, trending_down,
  star, warning, check_circle).

Output Rules:
- Output A2UI JSON block(s) FIRST, then at most 1-2 sentences.
- NEVER use markdown tables — use Row + Card instead.
- NEVER use markdown bullet/numbered lists — use List + Card instead.
- NEVER use markdown headers (##) as dividers — use Divider or
  Text with usageHint "h2".
- Minimum 3 different component types per response.
- Wrap data in Card components — no bare Text at root level.
- Use bold (**text**) inside Text components for emphasis.
"""


def get_dashboard_prompt() -> str:
  """Constructs the full system prompt with A2UI schema."""
  schema_manager = A2uiSchemaManager(
      version=VERSION_0_8,
      catalogs=[BasicCatalog.get_config(
          version=VERSION_0_8,
          examples_path=os.path.join(
              os.path.dirname(os.path.abspath(__file__)), "examples/0.8"
          ),
      )],
  )
  return schema_manager.generate_system_prompt(
      role_description=ROLE_DESCRIPTION,
      ui_description=UI_DESCRIPTION,
      include_schema=True,
      include_examples=True,
  )


if __name__ == "__main__":
  prompt = get_dashboard_prompt()
  print(prompt)
  print(f"\nPrompt length: {len(prompt)} characters")
