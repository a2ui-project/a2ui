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

from a2ui.core.schema.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG

ROLE_DESCRIPTION = (
    "You are a helpful contact lookup assistant. Your final output MUST always"
    " start with a short text description and then A2UI JSON response that"
    " follows Workflow and UI descriptions."
)

WORKFLOW_DESCRIPTION = """
Buttons that represent the main action on a card or view (e.g., 'Follow', 'Email', 'Search') SHOULD include the `"primary": true` attribute.
"""

UI_DESCRIPTION = f"""
-   **For finding contacts (e.g., "Who is Alex Jordan?"):**
    a.  You MUST call the `get_contact_info` tool.
    b.  If the tool returns a **single contact**, you MUST use the `CONTACT_CARD_EXAMPLE` template. Populate the `dataModelUpdate.contents` with the contact's details (name, title, email, etc.).
    c.  If the tool returns **multiple contacts**, you MUST use the `CONTACT_LIST_EXAMPLE` template. Populate the `dataModelUpdate.contents` with the list of contacts for the "contacts" key.
    d.  If the tool returns an **empty list**, respond with text only and an empty JSON list: "I couldn't find anyone by that name.{A2UI_OPEN_TAG}[]{A2UI_CLOSE_TAG}"

-   **For handling a profile view (e.g., "WHO_IS: Alex Jordan..."):**
    a.  You MUST call the `get_contact_info` tool with the specific name.
    b.  This will return a single contact. You MUST use the `CONTACT_CARD_EXAMPLE` template.

-   **For listing all contacts (e.g., "List all contacts"):**
    a.  You MUST call the `get_contact_info` tool with `None` for the name.
    b.  This will return a multiple contacts. You MUST use the `CONTACT_LIST_EXAMPLE` template.

-   **For handling actions (e.g., "follow_contact"):**
    a.  You MUST use the `FOLLOW_SUCCESS_EXAMPLE` template.
    b.  This will render a new card with a "Successfully Followed" message.
    c.  Respond with a text confirmation like "You are now following this contact." along with the JSON.
"""


# For non-A2UI clients.
def get_text_prompt() -> str:
  """Constructs the prompt for a text-only agent."""
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
