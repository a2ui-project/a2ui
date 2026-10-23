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
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor, CatalogConfig
from a2ui.utils import load_examples, to_version_number
from agent import ROLE_DESCRIPTION, WORKFLOW_DESCRIPTION, UI_DESCRIPTION


if __name__ == "__main__":
    version = ProtocolVersion.V0_9
    rizzcharts_catalog = CatalogConfig.from_path(
        catalog_path=f"../catalog_schemas/{to_version_number(version)}/rizzcharts_catalog_definition.json",
        protocol_version=version,
    ).transformed_catalog
    basic_catalog = CatalogConfig(BasicCatalog(version)).transformed_catalog
    processor = A2uiRequestProcessor(
        [rizzcharts_catalog, basic_catalog],
        format_factory=DirectJsonFormatFactory(),
    )

    # Generate prompt for rizzcharts catalog
    print("Building prompt and validating rizzcharts examples...")
    rizzcharts_examples = load_examples(
        processor.active_catalogs,
        f"../examples/rizzcharts_catalog/{to_version_number(version)}",
        validate=True,
    )
    prompt_parts = [
        ROLE_DESCRIPTION,
        f"## Workflow Description:\n{WORKFLOW_DESCRIPTION}",
        f"## UI Description:\n{UI_DESCRIPTION}",
        processor.prompt_snippet,
    ]
    if rizzcharts_examples:
        prompt_parts.append(f"### Examples:\n{rizzcharts_examples}")
    output = "\n\n".join(prompt_parts)

    # Also validate standard catalog examples
    print("Validating standard catalog examples...")
    std_examples = load_examples(
        [basic_catalog, rizzcharts_catalog],
        f"../examples/standard_catalog/{to_version_number(version)}",
        validate=True,
    )
    if std_examples:
        output += f"\n\n### Standard Catalog Examples:\n{std_examples}"

    print(output)

    with open("generated_prompt.txt", "w") as f:
        f.write(output)
    print("\nGenerated prompt saved to generated_prompt.txt")
