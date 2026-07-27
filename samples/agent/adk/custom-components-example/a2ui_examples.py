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
import logging
import os
from pathlib import Path
from typing import Optional
from a2ui.schema.constants import VERSION_0_8, VERSION_0_9

import jsonschema

logger = logging.getLogger(__name__)

FLOOR_PLAN_FILE = "floor_plan.json"
LOCATION_SURFACE_ID = "location-surface"


def load_floor_plan_example(
    version: Optional[str] = None, html_content: str = ""
) -> list[dict]:
    """Constructs the JSON for the location surface displaying the floor plan."""
    if not version:
        return []
    import os

    title_suffix = (
        "(MCP Apps)"
        if os.environ.get("USE_MCP_SANDBOX", "true").lower() == "true"
        else "(iFrame)"
    )
    if version == VERSION_0_8:
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

    if version == VERSION_0_9:
        return [
            {
                "version": "v0.9",
                "createSurface": {
                    "surfaceId": LOCATION_SURFACE_ID,
                    "catalogId": "inline_catalog",
                },
            },
            {
                "version": "v0.9",
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


def load_close_modal_example(version: Optional[str] = None) -> list[dict]:
    """Constructs the JSON for closing the floor plan modal."""
    if version == VERSION_0_8:
        return [{"deleteSurface": {"surfaceId": LOCATION_SURFACE_ID}}]
    if version == VERSION_0_9:
        return [{
            "version": "v0.9",
            "deleteSurface": {
                "surfaceId": LOCATION_SURFACE_ID,
            },
        }]


def load_send_message_example(contact_name: str, version: Optional[str] = None) -> str:
    """Constructs the JSON string for the send message confirmation."""
    from pathlib import Path

    examples_dir = Path(os.path.dirname(__file__)) / "examples" / version
    action_file = examples_dir / "action_confirmation.json"

    if action_file.exists():
        json_content = action_file.read_text(encoding="utf-8").strip()
        if contact_name != "Unknown":
            json_content = json_content.replace(
                "Your action has been processed.", f"Message sent to {contact_name}!"
            )
        return json_content
    if version == VERSION_0_8:
        return (
            '[{ "beginRendering": { "surfaceId": "action-modal", "root":'
            ' "modal-wrapper" } }, { "surfaceUpdate": { "surfaceId": "action-modal",'
            ' "components": [ { "id": "modal-wrapper", "component": { "Modal": {'
            ' "entryPointChild": "hidden", "contentChild": "msg", "open": true } } },'
            ' { "id": "hidden", "component": { "Text": { "text": {"literalString": "'
            ' "} } } }, { "id": "msg", "component": { "Text": { "text":'
            ' {"literalString": "Message Sent (Fallback)"} } } } ] } }]'
        )

    if version == VERSION_0_9:
        return (
            '[{ "version": "v0.9", "createSurface": { "surfaceId": "action-modal",'
            ' "catalogId": "inline_catalog" } }, { "version": "v0.9",'
            ' "updateComponents": { "surfaceId": "action-modal", "components": [ {'
            ' "id": "root", "component": "Modal", "trigger": "hidden", "content":'
            ' "msg", "open": true }, { "id": "hidden", "component": "Text", "text": " "'
            ' }, { "id": "msg", "component": "Text", "text": "Message Sent (Fallback)"'
            " } ] } } ]"
        )
