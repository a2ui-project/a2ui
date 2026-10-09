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

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.processor import CatalogConfig
from a2ui.schema import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
    VERSION_0_9,
)

ROLE_DESCRIPTION = (
    "You are a helpful contact lookup assistant. Your final output MUST be a a2ui UI"
    " JSON response."
)

WORKFLOW_DESCRIPTION = """
Buttons that represent the main action on a card or view (e.g., 'Follow', 'Email', 'Search') SHOULD include the `"primary": true` (for spec version v0.8) or `"variant": "primary"` attribute (for spec version v0.9+).
"""

UI_DESCRIPTION = f"""
-   **For finding contacts (e.g., "Who is Alex Jordan?"):**
    a.  You MUST call the `get_contact_info` tool.
    b.  If the tool returns a **single contact**, you MUST use the `MULTI_SURFACE_EXAMPLE` template. Provide BOTH the Contact Card and the Org Chart in a single response.
    c.  If the tool returns **multiple contacts**, you MUST use the `CONTACT_LIST_EXAMPLE` template. Populate the `dataModelUpdate.contents` (v0.8) or `updateDataModel.value` (v0.9+) with the list of contacts for the "contacts" key.
    d.  If the tool returns an **empty list**, respond with text only and an empty JSON list: "I couldn't find anyone by that name.{A2UI_OPEN_TAG}[]{A2UI_CLOSE_TAG}"

-   **For handling a profile view (e.g., "WHO_IS: Alex Jordan..."):**
    a.  You MUST call the `get_contact_info` tool with the specific name.
    b.  This will return a single contact. You MUST use the `CONTACT_CARD_EXAMPLE` template.

-   **For handling actions (e.g., "USER_WANTS_TO_EMAIL: ..."):**
    a.  You MUST use the `ACTION_CONFIRMATION_EXAMPLE` template.
    b.  Populate the `updateDataModel.value` with a confirmation title and message (e.g., title: "Email Drafted", message: "Drafting an email to Alex Jordan...").
"""


def get_text_prompt() -> str:
    """
    Constructs the prompt for a text-only agent.
    """
    return """
    You are a helpful contact lookup assistant. Your final output MUST be a text response.

    To generate the response, you MUST follow these rules:
    1.  **For finding contacts:**
        a. You MUST call the `get_contact_info` tool. Extract the name and department from the user's query.
        b. After receiving the data, format the contact(s) as a clear, human-readable text response.
        c. If multiple contacts are found, list their names and titles.
        d. If one contact is found, list all their details.

    2.  **For handling actions (e.g., "USER_WANTS_TO_EMAIL: ..."):**
        a. Respond with a simple text confirmation (e.g., "Drafting an email to...").
    """


def get_ui_prompt(
    inference_format: DirectJsonFormat,
    examples_path: str | None = None,
    *,
    validate_examples: bool = False,
) -> str:
    """Constructs the full system prompt for the UI agent."""
    from a2ui.schema import load_examples

    prompt_parts = [ROLE_DESCRIPTION]
    if WORKFLOW_DESCRIPTION:
        prompt_parts.append(f"## Workflow Description:\n{WORKFLOW_DESCRIPTION}")
    if UI_DESCRIPTION:
        prompt_parts.append(f"## UI Description:\n{UI_DESCRIPTION}")
    prompt_parts.append(inference_format.prompt_generator.generate())
    examples = load_examples(
        inference_format.catalogs, examples_path, validate=validate_examples
    )
    if examples:
        prompt_parts.append(f"### Examples:\n{examples}")
    return "\n\n".join(prompt_parts)


if __name__ == "__main__":
    from a2ui.schema import load_examples

    # Example of how to use the Direct JSON format to generate a system prompt
    my_base_url = "http://localhost:8000"
    my_version = VERSION_0_9
    inline_catalog_path = f"inline_catalog_{my_version}.json"
    inline_catalog = CatalogConfig.from_path(
        catalog_path=inline_catalog_path,
        protocol_version=my_version,
    ).transformed_catalog
    # The examples target both the basic catalog and the inline catalog.
    basic_catalog = CatalogConfig(BasicCatalog(my_version)).transformed_catalog
    direct_json_format = DirectJsonFormat([inline_catalog, basic_catalog])
    contact_prompt = get_ui_prompt(
        direct_json_format,
        examples_path=f"examples/{my_version}",
        validate_examples=False,
    )
    print(contact_prompt)
    with open("generated_prompt.txt", "w") as f:
        f.write(contact_prompt)
    print("\nGenerated prompt saved to generated_prompt.txt")

    request_prompt = direct_json_format.prompt_generator.generate_catalog_instructions(
        catalog=inline_catalog
    )
    print(request_prompt)
    with open("request_prompt.txt", "w") as f:
        f.write(request_prompt)
    print("\nGenerated request prompt saved to request_prompt.txt")

    examples = load_examples(
        direct_json_format.catalogs, f"examples/{my_version}", validate=True
    )
    print(examples)
    with open("examples.txt", "w") as f:
        f.write(examples)
    print("\nGenerated examples saved to examples.txt")
