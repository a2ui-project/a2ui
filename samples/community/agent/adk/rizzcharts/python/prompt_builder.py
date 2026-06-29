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

"""Prompt builder for the rizzcharts agent."""

# pylint: disable=g-importing-member, line-too-long
from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from a2ui.basic_catalog.provider import BasicCatalog
from a2ui.schema.common_modifiers import remove_strict_validation
from agent import ROLE_DESCRIPTION, WORKFLOW_DESCRIPTION, UI_DESCRIPTION


if __name__ == "__main__":
  version = VERSION_0_9
  schema_manager = A2uiSchemaManager(
      version,
      catalogs=[
          CatalogConfig.from_path(
              name="rizzcharts",
              catalog_path="rizzcharts_catalog_definition.json",
              examples_path=f"../examples/rizzcharts_catalog/{version}",
          ),
          BasicCatalog.get_config(
              version=version,
              examples_path=f"../examples/standard_catalog/{version}",
          ),
      ],
      accepts_inline_catalogs=True,
      schema_modifiers=[remove_strict_validation],
  )

  # Generate prompt for rizzcharts catalog
  print("Building prompt and validating rizzcharts examples...")
  system_prompt = schema_manager.generate_system_prompt(
      role_description=ROLE_DESCRIPTION,
      workflow_description=WORKFLOW_DESCRIPTION,
      ui_description=UI_DESCRIPTION,
      include_schema=True,
      include_examples=True,
      validate_examples=True,
  )

  output = system_prompt

  # Also validate standard catalog examples
  print("Validating standard catalog examples...")
  # We can trigger this by selecting the basic catalog
  std_prompt = schema_manager.generate_system_prompt(
      role_description=ROLE_DESCRIPTION,
      workflow_description=WORKFLOW_DESCRIPTION,
      ui_description=UI_DESCRIPTION,
      client_ui_capabilities={
          "supported_catalog_ids": [
              "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
          ]
      },
      include_schema=False,
      include_examples=True,
      validate_examples=True,
  )

  if std_prompt:
    output += "\n\n### Standard Catalog Examples:\n"
    # Find the start of examples in std_prompt
    if "### Examples:" in std_prompt:
      output += std_prompt.split("### Examples:")[1]

  print(output)

  with open("generated_prompt.txt", "w") as f:
    f.write(output)
  print("\nGenerated prompt saved to generated_prompt.txt")
