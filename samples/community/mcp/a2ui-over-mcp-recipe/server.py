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

import copy
import json
import pathlib
from typing import Any

import anyio
import click
import mcp.types as types
from a2ui.basic_catalog.provider import BasicCatalog
from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager
from mcp.server.lowlevel import Server
from mcp.server.lowlevel.helper_types import ReadResourceContents
from starlette.requests import Request

from recipes import RECIPES

A2UI_MIME_TYPE = "application/a2ui+json"
BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json"



@click.command()
@click.option("--port", default=8000, help="Port to listen on for SSE")
@click.option(
    "--transport",
    type=click.Choice(["stdio", "sse"]),
    default="sse",
    help="Transport type",
)
@click.option(
    "--bypass-verification",
    is_flag=True,
    default=True,
    help="Bypass A2UI capability verification",
)
def main(port: int, transport: str, bypass_verification: bool) -> int:
  # Initialize schema manager and validate sample
  schema_manager = A2uiSchemaManager(version=VERSION_0_9, catalogs=[BasicCatalog.get_config(version=VERSION_0_9)])
  selected_catalog = schema_manager.get_selected_catalog()
  
  recipe_a2ui_json = json.loads(
      (pathlib.Path(__file__).resolve().parent / "recipe_a2ui.json").read_text()
  )
  selected_catalog.validator.validate(recipe_a2ui_json)

  recipe_form_json = json.loads(
      (pathlib.Path(__file__).resolve().parent / "recipe_form.json").read_text()
  )
  selected_catalog.validator.validate(recipe_form_json)

  app = Server("a2ui-mcp-recipe-demo")

  def verify_a2ui_capability() -> bool:
    if bypass_verification:
      return True
    try:
      ctx = app.request_context
      session = ctx.session
      client_params = session.client_params
      if not client_params or not client_params.capabilities:
        return False
      
      model_extra = client_params.capabilities.model_extra or {}
      a2ui_cap = model_extra.get("a2ui", {})
      client_caps = a2ui_cap.get("clientCapabilities", {})
      v0_9_caps = client_caps.get("v0.9", {})
      supported_catalogs = v0_9_caps.get("supportedCatalogIds", [])
      
      return BASIC_CATALOG_ID in supported_catalogs
    except LookupError:
      return False

  @app.list_resources()
  async def list_resources() -> list[types.Resource]:
    return [
        types.Resource(
            uri="a2ui://recipe-form",
            name="Recipe Form",
            mimeType=A2UI_MIME_TYPE,
            description="Form allowing users to pick cuisine and protein.",
        )
    ]

  @app.read_resource()
  async def read_resource(uri: str) -> list[ReadResourceContents]:
    if not verify_a2ui_capability():
      raise ValueError("Client does not support A2UI Basic Catalog (v0.9)")

    if str(uri) == "a2ui://recipe-form":
      return [
          ReadResourceContents(
              content=json.dumps(recipe_form_json),
              mime_type=A2UI_MIME_TYPE,
          )
      ]
    raise ValueError(f"Unknown resource: {uri}")

  @app.call_tool()
  async def handle_call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
    if name == "get_recipe_a2ui":
      if not verify_a2ui_capability():
        return types.CallToolResult(
            isError=True,
            content=[
                types.TextContent(
                    type="text",
                    text="Error: Client does not support A2UI Basic Catalog (v0.9) capability."
                )
            ]
        )

      # Resolve dynamic selections from the client form context
      style_list = arguments.get("cookingStyle", [])
      protein_list = arguments.get("protein", [])
      
      selected_style = style_list[0] if style_list else "Baked"
      selected_protein = protein_list[0] if protein_list else "Salmon"
      
      # Retrieve atomic recipe entity from database with a resilient fallback
      recipe_data = RECIPES.get(
          (selected_style, selected_protein),
          RECIPES[("Baked", "Salmon")]
      )
      
      # Make a deep copy of the base schema so we don't mutate global state
      custom_recipe_json = copy.deepcopy(recipe_a2ui_json)
      
      # Inject custom values into updateDataModel action
      for action in custom_recipe_json:
        if "updateDataModel" in action:
          action["updateDataModel"]["value"] = {
              "image": recipe_data["image"],
              "title": recipe_data["title"],
              "rating": recipe_data["rating"],
              "reviewCount": recipe_data["reviewCount"],
              "prepTime": recipe_data["prepTime"],
              "cookTime": recipe_data["cookTime"],
              "servings": recipe_data["servings"],
          }
      
      # Return the customized recipe card
      return types.CallToolResult(content=[
        types.TextContent(
          type="text",
          text=f"Generated custom {recipe_data['title']}."
        ), 
        types.EmbeddedResource(
          type="resource",
          resource=types.TextResourceContents(
              uri="a2ui://recipe-card",
              mimeType=A2UI_MIME_TYPE,
              text=json.dumps(custom_recipe_json),
            )
        )
      ])

    if name == "action":
      return types.CallToolResult(
          content=[
              types.TextContent(
                  type="text",
                  text=f"Received action {arguments.get('name')} with context {arguments.get('context')}"
              )
          ]
      )

    if name == "error":
      return types.CallToolResult(
          content=[
              types.TextContent(
                  type="text",
                  text=f"Received error {arguments.get('code')}: {arguments.get('message')}"
              )
          ]
      )

    raise ValueError(f"Unknown tool: {name}")

  @app.list_tools()
  async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="get_recipe_a2ui",
            title="Get Recipe A2UI",
            description="Returns the A2UI JSON to show a recipe as an Embedded Resource",
            inputSchema={
                "type": "object",
                "properties": {
                    "cookingStyle": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of cooking styles selected by user"
                    },
                    "protein": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of proteins selected by user"
                    }
                },
                "additionalProperties": True
            },
        ),
        types.Tool(
            name="action",
            title="A2UI Action",
            description="Handles A2UI user actions",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "context": {"type": "object"}
                },
                "required": ["name"]
            },
        ),
        types.Tool(
            name="error",
            title="A2UI Error",
            description="Handles A2UI client errors",
            inputSchema={
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "message": {"type": "string"},
                    "surfaceId": {"type": "string"}
                },
                "required": ["code", "message"]
            },
        ),
    ]

  if transport == "sse":
    from mcp.server.sse import SseServerTransport
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.middleware.cors import CORSMiddleware
    from starlette.responses import Response
    from starlette.routing import Mount, Route

    sse = SseServerTransport("/messages/")

    async def handle_sse(request: Request):
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
                allow_origins=["*"],
                allow_methods=["*"],
                allow_headers=["*"],
            )
        ],
    )

    import uvicorn

    print(f"Server running at 127.0.0.1:{port} using sse")
    uvicorn.run(starlette_app, host="127.0.0.1", port=port)
  else:
    from mcp.server.stdio import stdio_server

    async def arun():
      async with stdio_server() as streams:
        await app.run(streams[0], streams[1], app.create_initialization_options())

    click.echo("Server running using stdio", err=True)
    anyio.run(arun)

  return 0
