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

from collections.abc import Sequence
import json

from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.processor import A2uiRequestProcessor, CatalogConfig
from a2ui.utils import load_examples, to_version_number
from a2ui_examples import delete_surface_message

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
    c.  If the tool returns **multiple contacts**, you MUST use the `CONTACT_LIST_EXAMPLE` template. Populate the list of contacts under the "contacts" key: in v0.8, a `dataModelUpdate` with `"path": "/contacts"` whose `contents` has one `valueMap` entry per contact (v0.8 allows only one level of `valueMap`); in v0.9+, the `updateDataModel.value`.
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


def get_existing_surfaces_rule(
    surface_ids: Sequence[str], version: ProtocolVersion
) -> str:
    """Tells the model which surfaces the client shows, and how to change them.

    Creating a surface that the client already shows is an error, so a later
    turn updates such a surface, or deletes it before it creates it again.

    Args:
        surface_ids: The surfaces the client shows.
        version: The protocol version of the request.

    Returns:
        The rule, or an empty string if the client shows no surfaces.
    """
    if not surface_ids:
        return ""
    listed = ", ".join(f"`{surface_id}`" for surface_id in surface_ids)
    delete_message = json.dumps(delete_surface_message(surface_ids[0], version))
    return (
        f"The client already shows these surfaces: {listed}. Creating one of"
        " them again is an error. To change what one of them shows, send"
        " `updateComponents` or `updateDataModel` messages for it. To show a"
        " template that creates one of them, first send a `deleteSurface`"
        " message for it, before any other message of the response, for"
        f" example `{delete_message}`. Only delete surfaces from this list."
    )


def get_ui_prompt(
    processor: A2uiRequestProcessor,
    examples_path: str | None = None,
    *,
    surfaces_rule: str = "",
    validate_examples: bool = False,
) -> str:
    """Constructs the system prompt for one UI request.

    Args:
        processor: The request's processor. The prompt describes the catalogs
            it negotiated with the client.
        examples_path: The directory of example responses.
        surfaces_rule: The rule from `get_existing_surfaces_rule` about the
            surfaces that earlier turns of the conversation left on the
            client, if any.
        validate_examples: Whether to check the examples against the
            processor's catalogs. The examples use the inline catalog, which a
            client may not send, so the agent leaves this off.
    """
    prompt_parts = [ROLE_DESCRIPTION]
    if WORKFLOW_DESCRIPTION:
        prompt_parts.append(f"## Workflow Description:\n{WORKFLOW_DESCRIPTION}")
    if UI_DESCRIPTION:
        prompt_parts.append(f"## UI Description:\n{UI_DESCRIPTION}")
    prompt_parts.append(processor.prompt_snippet)
    examples = load_examples(
        processor.active_catalogs, examples_path, validate=validate_examples
    )
    if examples:
        prompt_parts.append(f"### Examples:\n{examples}")
    if surfaces_rule:
        prompt_parts.append(f"## Surfaces on the client:\n{surfaces_rule}")
    return "\n\n".join(prompt_parts)


if __name__ == "__main__":
    # Builds the prompt for a client that renders the basic catalog and sends
    # the inline catalog, whose catalogs the request's processor holds.
    my_version = ProtocolVersion.V0_9
    inline_catalog = CatalogConfig.from_path(
        catalog_path=f"inline_catalog_{to_version_number(my_version)}.json",
        protocol_version=my_version,
    ).transformed_catalog
    basic_catalog = CatalogConfig(BasicCatalog(my_version)).transformed_catalog
    processor = A2uiRequestProcessor([basic_catalog, inline_catalog])
    contact_prompt = get_ui_prompt(
        processor,
        examples_path=f"examples/{to_version_number(my_version)}",
        validate_examples=False,
    )
    print(contact_prompt)
    with open("generated_prompt.txt", "w") as f:
        f.write(contact_prompt)
    print("\nGenerated prompt saved to generated_prompt.txt")

    examples = load_examples(
        processor.active_catalogs,
        f"examples/{to_version_number(my_version)}",
        validate=True,
    )
    print(examples)
    with open("examples.txt", "w") as f:
        f.write(examples)
    print("\nGenerated examples saved to examples.txt")
