# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
from typing import Any
import anyio
import click
import json
import pathlib
import mcp.types as types
from mcp.server.lowlevel import Server
import smart_editor_agent

# Set up logging for the server (especially useful for SSE debugging)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("a2ui-in-mcp-apps-server")

# Global counter state
COUNTER = 0
A2UI_MIME_TYPE = "application/a2ui+json"

@click.command()
@click.option("--port", default=8000, help="Port to listen on for SSE")
@click.option(
    "--transport",
    type=click.Choice(["stdio", "sse"]),
    default="sse",
    help="Transport type",
)
def main(port: int, transport: str) -> int:

    app = Server("a2ui-in-mcp-apps-server")

    # Load Ping A2UI JSON
    simple_counter_a2ui_json = json.loads(
        (pathlib.Path(__file__).resolve().parent / "simple_counter_a2ui.json").read_text()
    )

    @app.list_resources()
    async def list_resources() -> list[types.Resource]:
        return [
            types.Resource(
                uri="ui://basic/app",
                name="Basic App",
                mimeType="text/html;profile=mcp-app",
                description="A simple minimal application",
            ),
            types.Resource(
                uri="ui://editor/app",
                name="Editor App",
                mimeType="text/html;profile=mcp-app",
                description="A rich generative document editor",
            )
        ]

    @app.read_resource()
    async def read_resource(uri: str) -> str | bytes:
        if str(uri) == "ui://basic/app":
            try:
                app_path = pathlib.Path(__file__).parent / "apps" / "public" / "app.html"
                return app_path.read_text()
            except FileNotFoundError:
                raise ValueError(f"Resource file not found for uri: {uri} at {app_path}")
        elif str(uri) == "ui://editor/app":
            try:
                app_path = pathlib.Path(__file__).parent / "apps" / "public" / "editor.html"
                return app_path.read_text()
            except FileNotFoundError:
                raise ValueError(f"Resource file not found for uri: {uri} at {app_path}")
        raise ValueError(f"Unknown resource: {uri}")

    @app.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [
            types.Tool(
                name="get_basic_app",
                title="Get Basic App",
                description="Returns a simple A2UI-compatible HTML application.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            ),
            types.Tool(
                name="fetch_counter_a2ui",
                title="Fetch Counter A2UI",
                description="Fetches the initial counter A2UI payload.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            ),
            types.Tool(
                name="increase_counter",
                title="Increase Counter",
                description="Increments the counter and returns the updated value.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            ),
            types.Tool(
                name="get_editor_app",
                title="Get Editor App",
                description="Returns the Editor A2UI application resource.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            ),
            types.Tool(
                name="smart_editor_get_controls",
                title="Get Editor Controls",
                description="Generates A2UI tuning controls based on highlighted text.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "full_text": {"type": "string"}
                    },
                    "required": ["text"]
                }
            ),
            types.Tool(
                name="smart_editor_apply",
                title="Apply Editor Revision",
                description="Submits user-tuned slider values to rewrite text via Gemini.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "original_text": {"type": "string"}
                    },
                    "required": ["original_text"]
                }
            ),
        ]

    @app.call_tool()
    async def handle_call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any] | list[Any]:
        if name == "get_basic_app":
            # Just return a reference to the resource
            return [
                types.EmbeddedResource(
                    type="resource",
                    resource=types.TextResourceContents(
                        uri="ui://basic/app",
                        mimeType="text/html;profile=mcp-app",
                        text=""
                    )
                )
            ]
        elif name == "fetch_counter_a2ui":
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text="Ping result UI"
                    ),
                    types.EmbeddedResource(
                        type="resource",
                        resource=types.TextResourceContents(
                            uri="a2ui://ping-result",
                            mimeType=A2UI_MIME_TYPE,
                            text=json.dumps(simple_counter_a2ui_json)
                        )
                    )
                ]
            )

        elif name == "increase_counter":
            global COUNTER
            COUNTER += 1
            return types.CallToolResult(
                content=[
                    types.EmbeddedResource(
                        type="resource",
                        resource=types.TextResourceContents(
                            uri="a2ui://ping-result",
                            mimeType=A2UI_MIME_TYPE,
                            text=json.dumps([
                                {
                                    "dataModelUpdate": {
                                        "surfaceId": "ping-result",
                                        "contents": [
                                            {
                                                "key": "counter",
                                                "valueNumber": COUNTER
                                            }
                                        ]
                                    }
                                }
                            ])
                        )
                    )
                ]
            )

        elif name == "get_editor_app":
            return [
                types.EmbeddedResource(
                    type="resource",
                    resource=types.TextResourceContents(
                        uri="ui://editor/app",
                        mimeType="text/html;profile=mcp-app",
                        text=""
                    )
                )
            ]

        elif name == "smart_editor_get_controls":
            text_in = arguments.get("text", "")
            full_text = arguments.get("full_text", text_in)
            a2ui_payload = smart_editor_agent.generate_controls(text_in, full_text)
            
            return types.CallToolResult(
                content=[
                    types.EmbeddedResource(
                        type="resource",
                        resource=types.TextResourceContents(
                            uri="a2ui://editor-controls",
                            mimeType=A2UI_MIME_TYPE,
                            text=json.dumps(a2ui_payload)
                        )
                    )
                ]
            )

        elif name == "smart_editor_apply":
            # Pass all arguments as the parameter dictionary
            orig_text = arguments.get("original_text", "")
            revised_text = smart_editor_agent.apply_revision(orig_text, arguments)
            
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=revised_text
                    )
                ]
            )

        raise ValueError(f"Unknown tool: {name}")

    if transport == "sse":
        from mcp.server.sse import SseServerTransport
        from starlette.applications import Starlette
        from starlette.requests import Request
        from starlette.responses import Response
        from starlette.routing import Mount, Route
        from starlette.middleware import Middleware
        from starlette.middleware.cors import CORSMiddleware
        import uvicorn

        sse = SseServerTransport("/messages/")

        async def handle_sse(request: Request):
            logger.info("New SSE Connection Request")
            async with sse.connect_sse(request.scope, request.receive, request._send) as streams:  # type: ignore[reportPrivateUsage]
                await app.run(streams[0], streams[1], app.create_initialization_options())
            return Response()

        starlette_app = Starlette(
            debug=True,
            routes=[
                Route("/sse", endpoint=handle_sse, methods=["GET"]),
                Mount("/messages/", app=sse.handle_post_message),
            ],
            middleware=[
                Middleware(
                    CORSMiddleware,
                    # WARNING: Allowing all origins (*) with CORSMiddleware is insecure for production.
                    # It allows any website to make requests to this server.
                    # For production, restrict this to the specific origin of your client application.
                    # Example: allow_origins=["http://localhost:4200"]
                    allow_origins=["*"],
                    allow_methods=["*"],
                    allow_headers=["*"],
                )
            ],
        )

        logger.info(f"Server starting on 127.0.0.1:{port} using SSE")
        uvicorn.run(starlette_app, host="127.0.0.1", port=port)
    else:
        from mcp.server.stdio import stdio_server

        async def arun():
            async with stdio_server() as streams:
                await app.run(streams[0], streams[1], app.create_initialization_options())

        click.echo("Server running using stdio", err=True)
        anyio.run(arun)

    return 0

if __name__ == "__main__":
    main()
