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

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2ui.schema.constants import VERSION_0_8
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from agent import McpAppProxyAgent
from agent_executor import McpAppProxyAgentExecutor, get_a2ui_enabled, get_a2ui_catalog, get_a2ui_examples
from dotenv import load_dotenv
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.adk.tools.tool_context import ToolContext
from mcp import ClientSession
from mcp.client.sse import sse_client
from starlette.middleware.cors import CORSMiddleware
import anyio
import click
import httpx
import logging
import os
import traceback
import urllib.parse

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MissingAPIKeyError(Exception):
  """Exception for missing API key."""


@click.command()
@click.option("--host", default="localhost")
@click.option("--port", default=10006)
def main(host, port):
  try:
    if not os.getenv("GOOGLE_GENAI_USE_VERTEXAI") == "TRUE":
      if not os.getenv("GEMINI_API_KEY"):
        raise MissingAPIKeyError(
            "GEMINI_API_KEY environment variable not set and GOOGLE_GENAI_USE_VERTEXAI"
            " is not TRUE."
        )

    lite_llm_model = os.getenv("LITELLM_MODEL", "gemini/gemini-2.5-flash")
    base_url = f"http://{host}:{port}"

    agent = McpAppProxyAgent(
        model=LiteLlm(model=lite_llm_model),
        base_url=base_url,
    )
    agent_executor = McpAppProxyAgentExecutor(
        base_url=base_url,
        agent=agent,
    )

    request_handler = DefaultRequestHandler(
        agent_executor=agent_executor,
        task_store=InMemoryTaskStore(),
    )
    server = A2AStarletteApplication(
        agent_card=agent.agent_card, http_handler=request_handler
    )
    import uvicorn

    app = server.build()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    uvicorn.run(app, host=host, port=port)
  except MissingAPIKeyError as e:
    logger.error(f"Error: {e} {traceback.format_exc()}")
    exit(1)
  except Exception as e:
    logger.error(
        f"An error occurred during server startup: {e} {traceback.format_exc()}"
    )
    exit(1)


if __name__ == "__main__":
  main()
