# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""A2UI over MCP Apps Dual-Mode Server Sample."""

import json
import logging
import pathlib
from typing import Any
import anyio
import click
import mcp.types as types
from mcp.server.mcpserver import MCPServer

from a2ui.mcp import (
    A2UI_MIME_TYPE,
    MCP_APPS_MIME_TYPE,
    create_a2ui_resource_contents,
    create_a2ui_tool_result,
    supports_native_a2ui,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("a2ui-mcpapps-server")

# Global counter state
COUNTER = 0


def get_counter_a2ui(count: int) -> list[dict[str, Any]]:
    """Generates the A2UI v1.0 UI specification for the counter surface."""
    return [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "counter-surface",
                "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
                "components": [
                    {
                        "id": "root",
                        "component": "Column",
                        "children": ["header", "counter_card", "controls"],
                    },
                    {
                        "id": "header",
                        "component": "Text",
                        "text": "### Native A2UI Mode (Preferred)",
                    },
                    {
                        "id": "counter_card",
                        "component": "Text",
                        "text": "Current Count: **{{/count}}**",
                    },
                    {
                        "id": "controls",
                        "component": "Row",
                        "children": ["btn_dec", "btn_inc", "btn_reset"],
                    },
                    {
                        "id": "btn_dec",
                        "component": "Button",
                        "text": "− Decrement",
                        "action": {
                            "event": {
                                "name": "decrement_counter",
                                "context": {"step": 1},
                            }
                        },
                    },
                    {
                        "id": "btn_inc",
                        "component": "Button",
                        "text": "+ Increment",
                        "action": {
                            "event": {
                                "name": "increment_counter",
                                "context": {"step": 1},
                            }
                        },
                    },
                    {
                        "id": "btn_reset",
                        "component": "Button",
                        "text": "↺ Reset",
                        "action": {
                            "event": {
                                "name": "reset_counter",
                                "context": {},
                            }
                        },
                    },
                ],
                "dataModel": {"count": count},
            }
        }
    ]


def create_server() -> MCPServer:
    """Initializes and returns the MCP Server instance."""
    app = MCPServer("a2ui-mcpapps-server")

    @app.resource(
        "ui://counter/app",
        name="Counter App (Fallback)",
        mime_type=MCP_APPS_MIME_TYPE,
        description="Self-contained sandboxed HTML iframe MCP App.",
    )
    def read_fallback_app() -> str:
        html_path = pathlib.Path(__file__).parent / "public" / "fallback_app.html"
        return html_path.read_text(encoding="utf-8")

    @app.resource(
        "a2ui://counter",
        name="Counter Specification (Native)",
        mime_type=A2UI_MIME_TYPE,
        description="Native A2UI v1.0 interface payload.",
    )
    def read_native_a2ui() -> str:
        res = create_a2ui_resource_contents(get_counter_a2ui(COUNTER), uri="a2ui://counter")
        return res.text

    @app.tool(
        name="get_counter_app",
        description=(
            "Loads the interactive counter view. Delivers native A2UI payload if "
            "client advertises application/a2ui+json support, or references fallback iframe."
        ),
        meta={
            "ui": {
                "resourceUri": "ui://counter/app",
                "visibility": ["model", "app"],
            }
        },
    )
    def get_counter_app(native: bool = False) -> types.CallToolResult:
        return create_a2ui_tool_result(
            get_counter_a2ui(COUNTER),
            text_fallback=f"Current count: {COUNTER}",
            resource_uri="a2ui://counter-view",
        )

    @app.tool(
        name="increment_counter",
        description="Increments the counter state.",
        meta={"ui": {"visibility": ["app"]}},
    )
    def increment_counter(step: int = 1) -> types.CallToolResult:
        global COUNTER
        COUNTER += step
        return create_a2ui_tool_result(
            [
                {
                    "version": "v1.0",
                    "updateDataModel": {
                        "surfaceId": "counter-surface",
                        "path": "/count",
                        "value": COUNTER,
                    },
                }
            ],
            text_fallback=f"Counter incremented to {COUNTER}",
        )

    @app.tool(
        name="decrement_counter",
        description="Decrements the counter state.",
        meta={"ui": {"visibility": ["app"]}},
    )
    def decrement_counter(step: int = 1) -> types.CallToolResult:
        global COUNTER
        COUNTER -= step
        return create_a2ui_tool_result(
            [
                {
                    "version": "v1.0",
                    "updateDataModel": {
                        "surfaceId": "counter-surface",
                        "path": "/count",
                        "value": COUNTER,
                    },
                }
            ],
            text_fallback=f"Counter decremented to {COUNTER}",
        )

    @app.tool(
        name="reset_counter",
        description="Resets the counter to zero.",
        meta={"ui": {"visibility": ["app"]}},
    )
    def reset_counter() -> types.CallToolResult:
        global COUNTER
        COUNTER = 0
        return create_a2ui_tool_result(
            [
                {
                    "version": "v1.0",
                    "updateDataModel": {
                        "surfaceId": "counter-surface",
                        "path": "/count",
                        "value": 0,
                    },
                }
            ],
            text_fallback="Counter reset to 0",
        )

    return app


@click.command()
@click.option("--port", default=8000, help="Port to listen on for SSE transport")
@click.option(
    "--transport",
    type=click.Choice(["stdio", "sse"]),
    default="sse",
    help="MCP transport type",
)
def main(port: int, transport: str) -> None:
    """Runs the A2UI Dual-Mode MCP Server."""
    app = create_server()

    if transport == "sse":
        logger.info(f"Starting A2UI MCP Server SSE on http://127.0.0.1:{port}/sse")
        anyio.run(app.run_sse_async, host="127.0.0.1", port=port)
    else:
        anyio.run(app.run_stdio_async)


if __name__ == "__main__":
    main()
