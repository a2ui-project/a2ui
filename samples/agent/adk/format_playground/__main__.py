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

"""Serves the format playground as an A2A agent."""

import logging
import os
from pathlib import Path

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
import click
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware

from agent import PlaygroundAgent
from agent_executor import PlaygroundAgentExecutor
from modes import RenderMode

load_dotenv(Path.home() / ".env")
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MissingAPIKeyError(Exception):
    """Exception for missing API key."""


@click.command()
@click.option("--host", default="localhost")
@click.option("--port", default=10010)
@click.option(
    "--mode",
    type=click.Choice([m.value for m in RenderMode], case_sensitive=False),
    default=os.getenv("A2UI_PLAYGROUND_MODE") or RenderMode.DECISION.value,
    help="Initial render mode for new conversations.",
)
@click.option(
    "--backend",
    default=None,
    help=(
        "Decision backend ('mock', 'jev', 'systemone', 'step0');"
        " overrides A2UI_DECISION_BACKEND."
    ),
)
def main(host: str, port: int, mode: str, backend: str | None) -> None:
    try:
        if not os.getenv("GOOGLE_GENAI_USE_VERTEXAI") == "TRUE":
            if not os.getenv("GEMINI_API_KEY"):
                raise MissingAPIKeyError(
                    "GEMINI_API_KEY environment variable not set and"
                    " GOOGLE_GENAI_USE_VERTEXAI is not TRUE."
                )

        if backend:
            os.environ["A2UI_DECISION_BACKEND"] = backend

        base_url = f"http://{host}:{port}"
        agent = PlaygroundAgent(
            base_url=base_url,
            default_mode=RenderMode(mode.lower()),
        )
        logger.info(
            "Format playground on %s (mode %s, model %s, decision backend %s)",
            base_url,
            agent.default_mode,
            agent.model_name,
            agent.renderers.backend_name,
        )

        request_handler = DefaultRequestHandler(
            agent_executor=PlaygroundAgentExecutor(agent),
            task_store=InMemoryTaskStore(),
        )
        server = A2AStarletteApplication(
            agent_card=agent.agent_card, http_handler=request_handler
        )
        import uvicorn

        app = server.build()
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"http://localhost:\d+",
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        uvicorn.run(app, host=host, port=port)
    except MissingAPIKeyError as e:
        logger.error(f"Error: {e}")
        exit(1)
    except Exception as e:
        logger.error(f"An error occurred during server startup: {e}")
        exit(1)


if __name__ == "__main__":
    main()
