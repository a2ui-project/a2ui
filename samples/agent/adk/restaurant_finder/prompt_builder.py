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

import glob
import json
import os

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.parser import to_message_models
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig
from a2ui.utils import to_version_number

ROLE_DESCRIPTION = (
    "You are a helpful restaurant finding assistant. Your final output MUST be an A2UI"
    " UI definition."
)

UI_DESCRIPTION = """
-   If the query is for a list of restaurants, use the restaurant data you have already received from the `get_restaurants` tool to populate the `updateDataModel` message.
-   IMPORTANT: When using updateDataModel to update items, you MUST specify `path: "/items"` in `updateDataModel`, and the `value` MUST be an array of restaurants.
-   IMPORTANT: In v0.8, write the restaurants with a `dataModelUpdate` whose `path` is `"/items"` and whose `contents` has one `valueMap` entry per restaurant, keyed "0", "1", and so on. v0.8 allows only one level of `valueMap`.
-   IMPORTANT: Always specify the path when using updateDataModel. The part message is ignored when the path is missing.
-   Show 5 or fewer restaurants in a single column, and more than 5 in two columns.
-   If the query is to book a restaurant (e.g., "USER_WANTS_TO_BOOK..."), show a booking form.
-   If the query is a booking submission (e.g., "User submitted a booking..."), show a confirmation.
"""


def get_text_prompt() -> str:
    """
    Constructs the prompt for a text-only agent.
    """
    return """
    You are a helpful restaurant finding assistant. Your final output MUST be a text response.

    To generate the response, you MUST follow these rules:
    1.  **For finding restaurants:**
        a. You MUST call the `get_restaurants` tool. Extract the cuisine, location, and a specific number (`count`) of restaurants from the user's query.
        b. After receiving the data, format the restaurant list as a clear, human-readable text response. You MUST preserve any markdown formatting (like for links) that you receive from the tool.

    2.  **For booking a table (when you receive a query like 'USER_WANTS_TO_BOOK...'):**
        a. Respond by asking the user for the necessary details to make a booking (party size, date, time, dietary requirements).

    3.  **For confirming a booking (when you receive a query like 'User submitted a booking...'):**
        a. Respond with a simple text confirmation of the booking details.
    """


def load_example_turns(
    version: ProtocolVersion,
) -> list[list[AgentToRendererMessage]]:
    """Reads the example responses of a protocol version, one turn per file.

    The generator that holds them checks them against each request's
    catalogs, and the format writes them into `processor.prompt_snippet`.
    """
    examples_dir = os.path.join(
        os.path.dirname(__file__), "examples", to_version_number(version)
    )
    turns: list[list[AgentToRendererMessage]] = []
    for path in sorted(glob.glob(os.path.join(examples_dir, "*.json"))):
        with open(path, encoding="utf-8") as f:
            turns.append(to_message_models(json.load(f)))
    return turns


def get_ui_prompt(processor: A2uiRequestProcessor) -> str:
    """Constructs the system prompt for one UI request.

    Args:
        processor: The request's processor. Its prompt snippet describes the
            catalogs it negotiated with the client, and lists the examples.
    """
    return "\n\n".join([
        ROLE_DESCRIPTION,
        f"## UI Description:\n{UI_DESCRIPTION}",
        processor.prompt_snippet,
    ])


if __name__ == "__main__":
    # Builds the prompt for a client that renders the basic catalog, the way
    # the agent does for each request.
    version = ProtocolVersion.V0_9
    generator = A2uiGenerator(
        [CatalogConfig(BasicCatalog(version))], examples=load_example_turns(version)
    )
    processor = generator.create_processor(
        {version.value: {"supportedCatalogIds": [BasicCatalog(version).catalog_id]}}
    )
    restaurant_prompt = get_ui_prompt(processor)

    print(restaurant_prompt)

    # This demonstrates how you could save the prompt to a file for inspection
    with open("generated_prompt.txt", "w") as f:
        f.write(restaurant_prompt)
    print("\nGenerated prompt saved to generated_prompt.txt")
