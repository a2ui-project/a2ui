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

A2UI_ASSET_PACKAGE = "a2ui.assets"
SERVER_TO_CLIENT_SCHEMA_KEY = "server_to_client"
COMMON_TYPES_SCHEMA_KEY = "common_types"
CATALOG_SCHEMA_KEY = "catalog"
CATALOG_COMPONENTS_KEY = "components"
CATALOG_ID_KEY = "catalogId"
CATALOG_STYLES_KEY = "styles"
SURFACE_ID_KEY = "surfaceId"

# Protocol constants
SUPPORTED_CATALOG_IDS_KEY = "supportedCatalogIds"
INLINE_CATALOGS_KEY = "inlineCatalogs"

A2UI_CLIENT_CAPABILITIES_KEY = "a2uiClientCapabilities"

BASE_SCHEMA_URL = "https://a2ui.org/"
INLINE_CATALOG_NAME = "inline"

VERSION_0_8 = "0.8"
VERSION_0_9 = "0.9"
VERSION_0_9_1 = "0.9.1"

SPEC_VERSION_MAP = {
    VERSION_0_8: {
        SERVER_TO_CLIENT_SCHEMA_KEY: "specification/v0_8/json/server_to_client.json",
    },
    VERSION_0_9: {
        SERVER_TO_CLIENT_SCHEMA_KEY: "specification/v0_9/json/server_to_client.json",
        COMMON_TYPES_SCHEMA_KEY: "specification/v0_9/json/common_types.json",
    },
    VERSION_0_9_1: {
        SERVER_TO_CLIENT_SCHEMA_KEY: "specification/v0_9_1/json/server_to_client.json",
        COMMON_TYPES_SCHEMA_KEY: "specification/v0_9_1/json/common_types.json",
    },
}

SPECIFICATION_DIR = "specification"

ENCODING = "utf-8"

A2UI_OPEN_TAG = "<a2ui-json>"
A2UI_CLOSE_TAG = "</a2ui-json>"

A2UI_SCHEMA_BLOCK_START = "---BEGIN A2UI JSON SCHEMA---"
A2UI_SCHEMA_BLOCK_END = "---END A2UI JSON SCHEMA---"

DEFAULT_WORKFLOW_RULES = f"""
The generated response MUST follow these rules:
- The response can contain one or more A2UI JSON blocks.
- Each A2UI JSON block MUST be wrapped in `{A2UI_OPEN_TAG}` and `{A2UI_CLOSE_TAG}` tags.
- Between or around these blocks, you can provide conversational text.
- The JSON part MUST be a single, raw JSON object (usually a list of A2UI messages) and MUST validate against the provided A2UI JSON SCHEMA.
- Top-Down Component Ordering: Within the `components` list of a message:
    - The 'root' component MUST be the FIRST element.
    - Parent components MUST appear before their child components.
    This specific ordering allows the streaming parser to yield and render the UI incrementally as it arrives.
"""


# A2UI Tool constants
A2UI_TOOL_NAME = "send_a2ui_json_to_client"
A2UI_VALIDATED_JSON_KEY = "validated_a2ui_json"
A2UI_TOOL_ERROR_KEY = "error"
