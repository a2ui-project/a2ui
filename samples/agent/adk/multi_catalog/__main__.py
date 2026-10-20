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

import logging
import os

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
import click
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import uvicorn

from agent import SalesDashboardAgent
from agent_executor import SalesDashboardAgentExecutor

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@click.command()
@click.option("--host", default="localhost")
@click.option("--port", default=10010, type=int)
def main(host: str, port: int) -> None:
    if os.getenv("GOOGLE_GENAI_USE_VERTEXAI") != "TRUE" and not os.getenv(
        "GEMINI_API_KEY"
    ):
        logger.error(
            "GEMINI_API_KEY environment variable not set and"
            " GOOGLE_GENAI_USE_VERTEXAI is not TRUE."
        )
        raise SystemExit(1)

    agent = SalesDashboardAgent(base_url=f"http://{host}:{port}")
    request_handler = DefaultRequestHandler(
        agent_executor=SalesDashboardAgentExecutor(agent),
        task_store=InMemoryTaskStore(),
    )
    app = A2AStarletteApplication(
        agent_card=agent.agent_card, http_handler=request_handler
    ).build()
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://localhost:\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
