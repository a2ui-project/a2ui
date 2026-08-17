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
import traceback
import click
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from google.adk.models import Gemini, LiteLlm
from starlette.middleware.cors import CORSMiddleware
from agent import FileUploadSummarizerAgent
from agent_executor import FileUploadSummarizerAgentExecutor
from mock_drive import handle_mock_drive_upload, handle_mock_drive_download

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MissingAPIKeyError(Exception):
    """Exception for missing API key."""


@click.command()
@click.option("--host", default="localhost")
@click.option("--port", default=10008)
def main(host, port):
    try:
        if not os.getenv("GOOGLE_GENAI_USE_VERTEXAI") == "TRUE":
            if not os.getenv("GEMINI_API_KEY"):
                logger.warning(
                    "GEMINI_API_KEY environment variable not set. Summarization calls"
                    " may fail if no API key is provided."
                )

        lite_llm_model = os.getenv("LITELLM_MODEL", "gemini/gemini-3.5-flash-lite")
        gemini_model = (
            lite_llm_model[len("gemini/") :]
            if lite_llm_model.startswith("gemini/")
            else lite_llm_model
        )
        base_url = f"http://{host}:{port}"

        try:
            model = Gemini(model=gemini_model)
        except Exception:
            model = LiteLlm(model=lite_llm_model)

        agent = FileUploadSummarizerAgent(
            model=model,
            base_url=base_url,
        )
        agent_executor = FileUploadSummarizerAgentExecutor(
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

        app = server.build()

        app.router.add_route(
            "/api/mock-drive/v3/files",
            handle_mock_drive_upload,
            methods=["POST", "OPTIONS"],
        )
        app.router.add_route(
            "/api/mock-drive/v3/files/{file_id}",
            handle_mock_drive_download,
            methods=["GET", "OPTIONS"],
        )

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        logger.info(f"Starting Mock Drive FileUpload Summarizer Agent on {base_url}")
        logger.info(
            f"Mock Drive REST API enabled at {base_url}/api/mock-drive/v3/files"
        )
        uvicorn.run(app, host=host, port=port)
    except Exception as e:
        logger.error(
            f"An error occurred during server startup: {e}\n{traceback.format_exc()}"
        )
        exit(1)


if __name__ == "__main__":
    main()
