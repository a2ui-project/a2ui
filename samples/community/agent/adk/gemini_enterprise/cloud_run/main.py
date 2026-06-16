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

import logging
import os

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from agent import ContactAgent
from agent_executor import ContactAgentExecutor
from dotenv import load_dotenv
import uvicorn

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def serve():
  """Starts the A2UI server."""

  try:
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", 8080))

    external_facing_base_url = os.environ.get("AGENT_URL", f"http://{host}:{port}")
    agent = ContactAgent(base_url=external_facing_base_url)
    agent_executor = ContactAgentExecutor(agent=agent)
    request_handler = DefaultRequestHandler(
        agent_executor=agent_executor,
        task_store=InMemoryTaskStore(),
    )
    server = A2AStarletteApplication(
        agent_card=agent.agent_card, http_handler=request_handler
    )

    app = server.build()

    print(f"Running server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)

  except Exception as e:
    logger.error(f"An error occurred during server startup: {e}")
    exit(1)


if __name__ == "__main__":
  serve()
