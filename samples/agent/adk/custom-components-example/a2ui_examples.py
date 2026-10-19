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

import json
import logging
import os
from pathlib import Path
from typing import Any

from a2ui.constants import (
    A2UI_DELETE_SURFACE_KEY,
    A2UI_SURFACE_ID_KEY,
    A2UI_VERSION_KEY,
    CATALOG_ID_KEY,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.utils import to_version_number

logger = logging.getLogger(__name__)

_SAMPLE_DIR = Path(__file__).parent
FLOOR_PLAN_FILE = "floor_plan.json"
LOCATION_SURFACE_ID = "location-surface"
# The v1.0 surfaces use the basic catalog as their default catalog, and the
# custom components name the catalog that `inline_catalog_1.0.json` defines.
BASIC_CATALOG_ID_V1_0 = BasicCatalog(ProtocolVersion.V1_0).catalog_id
CUSTOM_CATALOG_ID_V1_0 = json.loads(
    (_SAMPLE_DIR / "inline_catalog_1.0.json").read_text(encoding="utf-8")
)[CATALOG_ID_KEY]


def delete_surface_message(surface_id: str, version: ProtocolVersion) -> dict[str, Any]:
    """Constructs the message that deletes a surface."""
    message: dict[str, Any] = {
        A2UI_DELETE_SURFACE_KEY: {A2UI_SURFACE_ID_KEY: surface_id}
    }
    if version == ProtocolVersion.V0_8:
        return message
    return {A2UI_VERSION_KEY: version.value, **message}


def load_floor_plan_example(
    version: ProtocolVersion, html_content: str = ""
) -> list[dict[str, Any]]:
    """Constructs the JSON for the location surface displaying the floor plan."""
    title_suffix = (
        "(MCP Apps)"
        if os.environ.get("USE_MCP_SANDBOX", "true").lower() == "true"
        else "(iFrame)"
    )
    if version == ProtocolVersion.V0_8:
        return [
            {
                "beginRendering": {
                    "surfaceId": LOCATION_SURFACE_ID,
                    "root": "floor-plan-card",
                }
            },
            {
                "surfaceUpdate": {
                    "surfaceId": LOCATION_SURFACE_ID,
                    "components": [
                        {
                            "id": "floor-plan-card",
                            "component": {"Card": {"child": "floor-plan-col"}},
                        },
                        {
                            "id": "floor-plan-col",
                            "component": {
                                "Column": {
                                    "children": {
                                        "explicitList": [
                                            "floor-plan-title",
                                            "floor-plan-comp",
                                            "dismiss-fp",
                                        ]
                                    }
                                }
                            },
                        },
                        {
                            "id": "floor-plan-title",
                            "component": {
                                "Text": {
                                    "usageHint": "h2",
                                    "text": {
                                        "literalString": (
                                            f"Office Floor Plan {title_suffix}"
                                        )
                                    },
                                }
                            },
                        },
                        {
                            "id": "floor-plan-comp",
                            "component": (
                                {
                                    "McpApp": {
                                        "htmlContent": html_content,
                                        "height": 400,
                                        "allowedTools": ["chart_node_click"],
                                    }
                                }
                                if os.environ.get("USE_MCP_SANDBOX", "true").lower()
                                == "true"
                                else {
                                    "WebFrame": {
                                        "html": html_content,
                                        "height": 400,
                                        "interactionMode": "interactive",
                                        "allowedEvents": ["chart_node_click"],
                                    }
                                }
                            ),
                        },
                        {
                            "id": "dismiss-fp-text",
                            "component": {
                                "Text": {"text": {"literalString": "Close Map"}}
                            },
                        },
                        {
                            "id": "dismiss-fp",
                            "component": {
                                "Button": {
                                    "child": "dismiss-fp-text",
                                    # Represents closing the FloorPlan overlay
                                    "action": {"name": "close_modal", "context": []},
                                }
                            },
                        },
                    ],
                }
            },
        ]

    if version == ProtocolVersion.V0_9:
        return [
            {
                "version": version.value,
                "createSurface": {
                    "surfaceId": LOCATION_SURFACE_ID,
                    "catalogId": "inline_catalog",
                },
            },
            {
                "version": version.value,
                "updateComponents": {
                    "surfaceId": LOCATION_SURFACE_ID,
                    "components": [{
                        "id": "root",
                        "component": "WebFrame",
                        "interactionMode": "interactive",
                        "height": 400,
                        "html": html_content,
                    }],
                },
            },
        ]

    if version == ProtocolVersion.V1_0:
        # v1.0 mixes catalogs on one surface: the basic catalog is the
        # surface's default, and the WebFrame names the custom catalog.
        return [
            {
                "version": version.value,
                "createSurface": {
                    "surfaceId": LOCATION_SURFACE_ID,
                    "catalogId": BASIC_CATALOG_ID_V1_0,
                },
            },
            {
                "version": version.value,
                "updateComponents": {
                    "surfaceId": LOCATION_SURFACE_ID,
                    "components": [
                        {
                            "id": "root",
                            "component": "Card",
                            "child": "floor_plan_comp",
                        },
                        {
                            "id": "floor_plan_comp",
                            "component": "WebFrame",
                            "catalogId": CUSTOM_CATALOG_ID_V1_0,
                            "interactionMode": "interactive",
                            "height": 400,
                            "html": html_content,
                        },
                    ],
                },
            },
        ]

    raise ValueError(f"No floor plan UI for A2UI {version}.")


def load_close_modal_example(version: ProtocolVersion) -> list[dict[str, Any]]:
    """Constructs the JSON for closing the floor plan modal."""
    return [delete_surface_message(LOCATION_SURFACE_ID, version)]


def load_send_message_example(contact_name: str, version: ProtocolVersion) -> str:
    """Constructs the JSON string for the send message confirmation.

    Raises:
        FileNotFoundError: If the version has no `action_confirmation.json`.
    """
    action_file = (
        _SAMPLE_DIR
        / "examples"
        / to_version_number(version)
        / "action_confirmation.json"
    )
    json_content = action_file.read_text(encoding="utf-8").strip()
    if contact_name != "Unknown":
        json_content = json_content.replace(
            "Your action has been processed.", f"Message sent to {contact_name}!"
        )
    return json_content
