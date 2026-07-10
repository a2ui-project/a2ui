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
import click
import uvicorn
from dotenv import load_dotenv

from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor, A2aAgentExecutorConfig
from google.adk.a2a.converters.event_converter import convert_event_to_a2a_events
from google.adk.artifacts import InMemoryArtifactService
from google.adk.sessions import InMemorySessionService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.server.apps import A2AStarletteApplication
from a2a.types import AgentCard, AgentSkill, AgentCapabilities
from starlette.middleware.cors import CORSMiddleware
from a2ui.schema.constants import VERSION_0_8, VERSION_0_9
from a2ui.a2a.extension import get_a2ui_agent_extension

from a2ui.basic_catalog.provider import BasicCatalog
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.adk.a2a.part_converter import A2uiPartConverter
from a2ui.schema.common_modifiers import remove_strict_validation

schema_manager = A2uiSchemaManager(
    version=VERSION_0_9,
    catalogs=[BasicCatalog.get_config(version=VERSION_0_9)],
    schema_modifiers=[remove_strict_validation],
)
my_catalog = schema_manager.get_selected_catalog()
a2ui_converter = A2uiPartConverter(a2ui_catalog=my_catalog, version=VERSION_0_9)

load_dotenv()
logging.basicConfig(level=logging.INFO)


@click.command()
@click.option("--host", default="localhost", type=str)
@click.option("--port", default=10014, type=int)
def main(host, port):
    lite_llm_model = os.getenv("LITELLM_MODEL", "gemini/gemini-3.5-flash")
    agent = LlmAgent(
        name="subagent_room_service",
        description="Hotel room service agent",
        instruction="""You are the hotel room service agent. You handle ordering food to rooms. If the user asks for food, return this A2UI form:
<a2ui-json>
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "room_service",
    "catalogId": "basic"
  }
}
</a2ui-json>
<a2ui-json>
{
  "version": "v0.9",
  "updateComponents": {
    "surfaceId": "room_service",
    "components": [
      {
        "id": "root",
        "component": "Column",
        "children": ["room_num", "food_menu", "submit_btn"]
      },
      {
        "id": "room_num",
        "component": "TextField",
        "label": "Room Number"
      },
      {
        "id": "food_menu",
        "component": "ChoicePicker",
        "label": "Menu Item",
        "options": [
          {"label": "Burger", "value": "burger"},
          {"label": "Pizza", "value": "pizza"},
          {"label": "Salad", "value": "salad"}
        ],
        "value": []
      },
      {
        "id": "submit_btn",
        "component": "Button",
        "child": "submit_btn_txt",
        "action": {
          "event": {
            "name": "order_food"
          }
        }
      },
      {
        "id": "submit_btn_txt",
        "component": "Text",
        "text": "Order"
      }
    ]
  }
}
</a2ui-json>""",
        model=LiteLlm(model=lite_llm_model),
        tools=[],
    )

    runner = Runner(
        app_name=agent.name,
        agent=agent,
        artifact_service=InMemoryArtifactService(),
        session_service=InMemorySessionService(),
        memory_service=InMemoryMemoryService(),
    )

    extensions = [
        get_a2ui_agent_extension(VERSION_0_8, False, []),
        get_a2ui_agent_extension(VERSION_0_9, False, []),
    ]

    agent_card = AgentCard(
        name="Room Service",
        description="Hotel room service agent",
        url=f"http://{host}:{port}",
        version="1.0.0",
        default_input_modes=["text"],
        default_output_modes=["text"],
        capabilities=AgentCapabilities(streaming=True, extensions=extensions),
        skills=[
            AgentSkill(
                id="order_food",
                name="order_food",
                description="Order food to a room",
                examples=["I want to order a burger to my room"],
                tags=["food"],
            )
        ],
    )

    executor_config = A2aAgentExecutorConfig(
        event_converter=lambda e, ic, tid=None, cid=None, pcf=None: convert_event_to_a2a_events(
            e, ic, tid, cid, a2ui_converter.convert
        )
    )
    executor = A2aAgentExecutor(runner=runner, config=executor_config)
    request_handler = DefaultRequestHandler(
        agent_executor=executor,
        task_store=InMemoryTaskStore(),
    )

    server = A2AStarletteApplication(
        agent_card=agent_card, http_handler=request_handler
    )

    app = server.build()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
