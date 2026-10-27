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

"""Starts the Kanban agent as an A2A server.

`KANBAN_AGENT=scripted` runs the deterministic storyline without a model;
otherwise the Gemini agent needs `GEMINI_API_KEY` (or Vertex AI credentials).
"""

import logging
import os
import sys

import click
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

from agent_executor import KanbanAgentExecutor, build_agent_card
from kanban_mcp import KanbanMcp
from turns import KanbanAgent

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-flash-lite-latest"


def build_agent(mcp: KanbanMcp) -> KanbanAgent:
    if os.getenv("KANBAN_AGENT", "").lower() == "scripted":
        from scripted import ScriptedKanbanAgent

        logger.info("Running the scripted agent (no model).")
        return ScriptedKanbanAgent(mcp)
    if os.getenv("GOOGLE_GENAI_USE_VERTEXAI") != "TRUE" and not os.getenv(
        "GEMINI_API_KEY"
    ):
        sys.exit(
            "GEMINI_API_KEY is not set (and GOOGLE_GENAI_USE_VERTEXAI is not TRUE)."
            " Set it in .env, or run with KANBAN_AGENT=scripted."
        )
    from agent import GeminiKanbanAgent

    model = os.getenv("KANBAN_MODEL", DEFAULT_MODEL)
    logger.info("Running the Gemini agent with %s.", model)
    return GeminiKanbanAgent(mcp, model)


@click.command()
@click.option("--host", default="0.0.0.0")
@click.option("--port", default=10007)
def main(host: str, port: int) -> None:
    card_host = "localhost" if host == "0.0.0.0" else host
    base_url = f"http://{card_host}:{port}"
    agent_card = build_agent_card(base_url)
    agent = build_agent(KanbanMcp())
    app = A2AStarletteApplication(
        agent_card=agent_card,
        http_handler=DefaultRequestHandler(
            agent_executor=KanbanAgentExecutor(agent, agent_card),
            task_store=InMemoryTaskStore(),
        ),
    ).build()
    # The chat host runs on another origin (the Vite dev server).
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
