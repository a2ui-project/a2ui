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
import os
import urllib.parse
import traceback
import logging

from google.adk.tools import ToolContext
from mcp.client.sse import sse_client
from mcp.client.session import ClientSession

logger = logging.getLogger(__name__)

# Global variables for Pong game.
PONG_SURFACE_ID = "pong_surface"
PONG_CURRENT_SCORE = {"player": 0, "cpu": 0}


# Define get_calculator_app tool in a way that the LlmAgent can use.
async def get_calculator_app(tool_context: ToolContext):
  """Fetches the calculator app."""
  # Connect to the MCP server via SSE
  mcp_server_host = os.getenv("MCP_SERVER_HOST", "localhost")
  mcp_server_port = os.getenv("MCP_SERVER_PORT", "8000")
  sse_url = f"http://{mcp_server_host}:{mcp_server_port}/sse"

  try:
    async with sse_client(sse_url) as streams:
      async with ClientSession(streams[0], streams[1]) as session:
        await session.initialize()

        # Read the resource
        result = await session.read_resource("ui://calculator/app")

        # Package the resource as an A2UI message
        if result.contents and hasattr(result.contents[0], "text"):
          html_content = result.contents[0].text
          encoded_html = "url_encoded:" + urllib.parse.quote(html_content)
          messages = [
              {
                  "version": "v0.9",
                  "createSurface": {
                      "surfaceId": "calculator_surface",
                      "catalogId": "a2ui.org:a2ui/v0.9/mcp_app_catalog.json",
                  },
              },
              {
                  "version": "v0.9",
                  "updateComponents": {
                      "surfaceId": "calculator_surface",
                      "components": [{
                          "id": "root",
                          "component": "McpApp",
                          "content": encoded_html,
                          "title": "Calculator",
                          "allowedTools": ["calculate"],
                      }],
                  },
              },
          ]
          tool_context.actions.skip_summarization = True
          return {"validated_a2ui_json": messages}
        else:
          logger.error("Failed to get text content from resource")
          return {"error": "Could not fetch calculator app content."}

  except Exception as e:
    logger.error(f"Error fetching calculator app: {e} {traceback.format_exc()}")
    return {"error": f"Failed to connect to MCP server or fetch app. Details: {e}"}


async def calculate_via_mcp(operation: str, a: float, b: float):
  """Calculates via the MCP server's Calculate tool.

  Args:
      operation: The mathematical operation (e.g. 'add', 'subtract', 'multiply', 'divide').
      a: First operand.
      b: Second operand.
  """
  mcp_server_host = os.getenv("MCP_SERVER_HOST", "localhost")
  mcp_server_port = os.getenv("MCP_SERVER_PORT", "8000")
  sse_url = f"http://{mcp_server_host}:{mcp_server_port}/sse"

  try:
    async with sse_client(sse_url) as streams:
      async with ClientSession(streams[0], streams[1]) as session:
        await session.initialize()

        result = await session.call_tool(
            "calculate", arguments={"operation": operation, "a": a, "b": b}
        )

        if (
            result.content
            and len(result.content) > 0
            and hasattr(result.content[0], "text")
        ):
          return result.content[0].text
        return "No result text from MCP calculate tool."
  except Exception as e:
    logger.error(f"Error calling MCP calculate: {e} {traceback.format_exc()}")
    return f"Error connecting to MCP server: {e}"


async def score_update(tool_context: ToolContext, player: str):
  """Updates the score for Pong game.

  Args:
      player: The player who scored a point. Expected values: "player" or "cpu".
  """
  global PONG_CURRENT_SCORE
  if player == "player":
    PONG_CURRENT_SCORE["player"] += 1
  elif player == "cpu":
    PONG_CURRENT_SCORE["cpu"] += 1
  else:
    logger.error(f"Invalid player for score update: {player}")
    return {"error": f"Invalid player: {player}"}

  logger.info(
      f"Score updated: Player={PONG_CURRENT_SCORE['player']},"
      f" CPU={PONG_CURRENT_SCORE['cpu']}"
  )

  # Send dataModelUpdate
  messages = [{
      "dataModelUpdate": {
          "surfaceId": PONG_SURFACE_ID,
          "path": "/",
          "contents": [{
              "key": "pong_state",
              "valueMap": [
                  {"key": "player_score", "valueNumber": PONG_CURRENT_SCORE["player"]},
                  {"key": "cpu_score", "valueNumber": PONG_CURRENT_SCORE["cpu"]},
              ],
          }],
      }
  }]
  tool_context.actions.skip_summarization = True
  return {"validated_a2ui_json": messages}


async def get_pong_app_a2ui_json(tool_context: ToolContext):
  """Fetches the Pong game app."""

  current_dir = os.path.dirname(os.path.abspath(__file__))
  html_file_path = os.path.join(current_dir, "pong_app.html")

  try:
    with open(html_file_path, "r", encoding="utf-8") as f:
      html_content = f.read()
  except FileNotFoundError:
    logger.error(f"Could not find {html_file_path}")
    return {"error": "Could not find pong app HTML file."}

  encoded_html = "url_encoded:" + urllib.parse.quote(html_content)

  # Reset score on reload
  global PONG_CURRENT_SCORE
  PONG_CURRENT_SCORE = {"player": 0, "cpu": 0}

  messages = [
      {
          "version": "v0.9",
          "createSurface": {
              "surfaceId": PONG_SURFACE_ID,
              "catalogId": "a2ui.org:a2ui/v0.9/mcp_app_catalog.json",
          },
      },
      {
          "version": "v0.9",
          "updateDataModel": {
              "surfaceId": PONG_SURFACE_ID,
              "path": "/",
              "value": {
                  "pong_state": {
                      "player_score": PONG_CURRENT_SCORE["player"],
                      "cpu_score": PONG_CURRENT_SCORE["cpu"],
                  }
              },
          },
      },
      {
          "version": "v0.9",
          "updateComponents": {
              "surfaceId": PONG_SURFACE_ID,
              "components": [{
                  "id": "root",
                  "component": "PongLayout",
                  "mcpComponent": {
                      "id": "mcp_app_root",
                      "component": "McpApp",
                      "content": encoded_html,
                      "title": "Neon Pong",
                      "allowedTools": ["score_update"],
                  },
                  "scoreboardComponent": {
                      "id": "scoreboard_root",
                      "component": "PongScoreBoard",
                      "playerScore": {"path": "/pong_state/player_score"},
                      "cpuScore": {"path": "/pong_state/cpu_score"},
                  },
              }],
          },
      },
  ]
  tool_context.actions.skip_summarization = True
  return {"validated_a2ui_json": messages}
