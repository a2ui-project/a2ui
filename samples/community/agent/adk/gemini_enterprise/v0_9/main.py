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

"""Cloud Run entry point for the A2UI v0.9 Demo agent.

Cloud Run invokes the `start` script (see [project.scripts] in pyproject.toml),
which runs `serve()`. The server binds to 0.0.0.0 and the port provided by the
`PORT` environment variable (defaults to 8080).
"""

import logging
import os

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from agent import A2uiDemoAgent
from agent_executor import A2uiDemoAgentExecutor
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
import uvicorn

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def serve():
    """Starts the A2UI v0.9 Demo server."""
    try:
        host = "0.0.0.0"
        port = int(os.environ.get("PORT", 8080))

        # On Cloud Run, the public URL of the service is provided via AGENT_URL
        # (set by deploy.sh after the service is created). Fall back to the local
        # host:port for local runs.
        base_url = os.environ.get("AGENT_URL", f"http://{host}:{port}")

        agent = A2uiDemoAgent(base_url=base_url)
        agent_executor = A2uiDemoAgentExecutor(agent=agent)
        request_handler = DefaultRequestHandler(
            agent_executor=agent_executor,
            task_store=InMemoryTaskStore(),
        )
        server = A2AStarletteApplication(
            agent_card=agent.agent_card, http_handler=request_handler
        )

        app = server.build()

        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"https?://.*",
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Serve restaurant images from the local `images/` directory if present.
        images_dir = os.path.join(os.path.dirname(__file__), "images")
        if os.path.isdir(images_dir):
            app.mount("/static", StaticFiles(directory=images_dir), name="static")
        else:
            logger.warning(
                "No 'images' directory found at %s; /static will not be served.",
                images_dir,
            )

        logger.info("Running server on %s:%s (base_url=%s)", host, port, base_url)
        uvicorn.run(app, host=host, port=port)

    except Exception as e:  # pylint: disable=broad-except
        logger.error("An error occurred during server startup: %s", e)
        exit(1)


if __name__ == "__main__":
    serve()
