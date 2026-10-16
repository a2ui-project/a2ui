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

import glob
import json
import os

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.parser import to_message_models
from a2ui.processor import A2uiGenerator, A2uiRequestProcessor, CatalogConfig

VERSION = ProtocolVersion.V1_0

_SAMPLE_DIR = os.path.dirname(os.path.abspath(__file__))

DASHBOARD_CATALOG_PATH = os.path.join(
    _SAMPLE_DIR, "catalogs", "1.0", "dashboard_catalog.json"
)

ROLE_DESCRIPTION = (
    "You are a sales analytics assistant. Your final output MUST be an A2UI UI"
    " definition."
)

UI_DESCRIPTION = """
-   To answer a question about a region's sales, you MUST call the `get_sales_metrics` tool first, and use the data it returns.
-   Show the answer on ONE surface with the id "dashboard". Its default catalog, the `catalogId` of `createSurface`, is the basic catalog.
-   Mix the two catalogs on that surface. Use the basic catalog for the layout (`Column`, `Row`), the title, the highlights and a "Refresh" `Button`. Use the dashboard catalog's `StatCard` and `ProgressBar` for the numbers.
-   Every `StatCard` and `ProgressBar` MUST set `catalogId` to the dashboard catalog's id, since they are not in the surface's default catalog. Basic components leave `catalogId` out.
-   The "Refresh" button's action is the `refresh_dashboard` event, with the region in its context.
-   Write the data with one `updateDataModel` at the path "/", and bind the components to it with `{"@path": ...}`.
-   If the tool returns an error for an unknown region, show only basic `Text` on the surface, and name the regions that have data.
-   If the query is "USER_REFRESHED_DASHBOARD: <region>", call the tool again for that region and show the dashboard again.
"""


def load_example_turns() -> list[list[AgentToRendererMessage]]:
    """Reads the example responses, one turn per file.

    The generator that holds them checks them against each request's catalogs,
    and the format writes them into `processor.prompt_snippet`.
    """
    examples_dir = os.path.join(_SAMPLE_DIR, "examples", "1.0")
    turns: list[list[AgentToRendererMessage]] = []
    for path in sorted(glob.glob(os.path.join(examples_dir, "*.json"))):
        with open(path, encoding="utf-8") as f:
            turns.append(to_message_models(json.load(f)))
    return turns


def build_generator() -> A2uiGenerator:
    """Builds the generator for the v1.0 basic catalog and the dashboard catalog."""
    return A2uiGenerator(
        [
            CatalogConfig(BasicCatalog(VERSION)),
            CatalogConfig.from_path(DASHBOARD_CATALOG_PATH),
        ],
        examples=load_example_turns(),
    )


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


def get_text_prompt() -> str:
    """Constructs the prompt for a client that renders no A2UI."""
    return (
        "You are a sales analytics assistant. Call the `get_sales_metrics` tool"
        " for the region in the user's question, and answer in plain text with the"
        " revenue, new customers, average deal, progress toward the target and the"
        " highlights."
    )


if __name__ == "__main__":
    # Builds the prompt for a client that renders both catalogs, the way the
    # agent does for each request.
    generator = build_generator()
    processor = generator.create_processor({
        VERSION.value: {
            "supportedCatalogIds": [
                c.transformed_catalog.catalog_id for c in generator.catalogs
            ]
        }
    })
    print(get_ui_prompt(processor))
