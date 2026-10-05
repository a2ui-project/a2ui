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

"""Prompt builder for the rizzcharts agent."""

# pylint: disable=g-importing-member, line-too-long
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.schema import CatalogConfig, VERSION_0_9, remove_strict_validation
from agent import ROLE_DESCRIPTION, WORKFLOW_DESCRIPTION, UI_DESCRIPTION


if __name__ == "__main__":
    version = VERSION_0_9
    rizzcharts_catalog = CatalogConfig.from_path(
        name="rizzcharts",
        catalog_path=f"../catalog_schemas/{version}/rizzcharts_catalog_definition.json",
    ).to_catalog(protocol_version=version, schema_modifiers=[remove_strict_validation])
    basic_catalog = CatalogConfig.from_catalog(
        "basic", BasicCatalog(version)
    ).to_catalog(protocol_version=version, schema_modifiers=[remove_strict_validation])
    inference_format = DirectJsonFormat(
        [rizzcharts_catalog, basic_catalog],
        examples_path=f"../examples/rizzcharts_catalog/{version}",
    )

    # Generate prompt for rizzcharts catalog
    print("Building prompt and validating rizzcharts examples...")
    system_prompt = inference_format.generate_system_prompt(
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
    # We can trigger this with a format that reads the standard catalog examples
    std_format = DirectJsonFormat(
        [basic_catalog, rizzcharts_catalog],
        examples_path=f"../examples/standard_catalog/{version}",
    )
    std_prompt = std_format.generate_system_prompt(
        role_description=ROLE_DESCRIPTION,
        workflow_description=WORKFLOW_DESCRIPTION,
        ui_description=UI_DESCRIPTION,
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
