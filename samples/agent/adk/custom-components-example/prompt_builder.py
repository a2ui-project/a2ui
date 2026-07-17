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

import json

from a2ui.schema.constants import VERSION_0_8, VERSION_0_9, A2UI_OPEN_TAG, A2UI_CLOSE_TAG
from a2ui.inference_formats.transport import TransportFormat
from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.schema.catalog_provider import A2uiCatalogProvider, FileSystemCatalogProvider
from a2ui.basic_catalog.provider import BasicCatalog
from typing import Dict, Any

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


if __name__ == "__main__":
    # Example of how to use the A2UI Schema Manager to generate a system prompt
    my_base_url = "http://localhost:8000"
    my_version = VERSION_0_9
    inline_catalog_path = f"inline_catalog_{my_version}.json"
    transport_format = TransportFormat(
        my_version,
        catalogs=[
            CatalogConfig.from_path(
                name="custom-components-example_inline_catalog",
                catalog_path=inline_catalog_path,
                examples_path=f"examples/{my_version}",
            ),
        ],
        accepts_inline_catalogs=True,
        schema_modifiers=[remove_strict_validation],
    )
    contact_prompt = transport_format.generate_system_prompt(
        role_description=ROLE_DESCRIPTION,
        workflow_description=WORKFLOW_DESCRIPTION,
        ui_description=UI_DESCRIPTION,
        include_schema=True,
        include_examples=True,
        validate_examples=False,
    )
    print(contact_prompt)
    with open("generated_prompt.txt", "w") as f:
        f.write(contact_prompt)
    print("\nGenerated prompt saved to generated_prompt.txt")

    with open(inline_catalog_path, "r", encoding="utf-8") as f:
        inline_catalog = json.load(f)

    client_ui_capabilities = {"inlineCatalogs": [inline_catalog]}
    inline_catalog = transport_format.get_selected_catalog(
        client_ui_capabilities=client_ui_capabilities,
    )
    request_prompt = inline_catalog.render_as_llm_instructions()
    print(request_prompt)
    with open("request_prompt.txt", "w") as f:
        f.write(request_prompt)
    print("\nGenerated request prompt saved to request_prompt.txt")

    basic_catalog = schema_manager.get_selected_catalog(
        client_ui_capabilities=client_ui_capabilities
    )
    examples = schema_manager.load_examples(
        basic_catalog,
        validate=True,
    )
    print(examples)
    with open("examples.txt", "w") as f:
        f.write(examples)
    print("\nGenerated examples saved to examples.txt")
