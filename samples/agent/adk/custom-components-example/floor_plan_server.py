# Copyright 2024 Google LLC
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

import asyncio
from mcp.server import Server
from mcp.types import Resource, TextContent

app = Server("floor-plan-server")

RESOURCE_URI = "ui://floor-plan-server/map"
MIME_TYPE = "text/html;profile=mcp-app"


@app.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(
            uri=RESOURCE_URI,
            name="Interactive Floor Plan",
            mimeType=MIME_TYPE,
            description="A visual floor plan showing desk assignments.",
        )
    ]


@app.read_resource()
async def read_resource(uri: str) -> str | bytes:
    if str(uri) != RESOURCE_URI:
        raise ValueError(f"Unknown resource: {uri}")

    import os

    agent_static_url = os.environ.get("AGENT_STATIC_URL", "http://localhost:10004")

    from pathlib import Path

    template_path = Path(__file__).parent / "floor_plan_template.html"
    html = template_path.read_text(encoding="utf-8")
    html = html.replace("__AGENT_STATIC_URL__", agent_static_url)
    return html


import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Mount, Route
from mcp.server.sse import SseServerTransport

sse = SseServerTransport("/messages/")


async def handle_sse(request: Request):
    """Handle the initial SSE connection from the A2UI agent."""
    async with sse.connect_sse(
        request.scope, request.receive, request._send
    ) as streams:
        await app.run(streams[0], streams[1], app.create_initialization_options())
    return Response()


starlette_app = Starlette(
    routes=[
        Route("/sse", endpoint=handle_sse, methods=["GET"]),
        Mount("/messages/", app=sse.handle_post_message),
    ]
)

if __name__ == "__main__":
    uvicorn.run(starlette_app, host="127.0.0.1", port=8000)
