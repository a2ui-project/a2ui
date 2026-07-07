import logging
import os
import click
import uvicorn
from dotenv import load_dotenv

from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
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
        instruction="You are the hotel room service agent. You handle ordering food to rooms.",
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
            AgentSkill(id="order_food", name="order_food", description="Order food to a room", examples=["I want to order a burger to my room"], tags=["food"])
        ]
    )

    executor = A2aAgentExecutor(runner=runner)
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
