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

from collections.abc import AsyncIterable
import json
import logging
import os
from typing import Any, Dict, Optional

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    Part,
    TextPart,
)
from a2ui.a2a import (
    get_a2ui_agent_extension,
    parse_response_to_parts,
)
from a2ui.basic_catalog.provider import BasicCatalog
from a2ui.core.parser.parser import parse_response
from a2ui.core.schema.common_modifiers import remove_strict_validation
from a2ui.core.schema.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG, VERSION_0_8
from a2ui.core.schema.manager import A2uiSchemaManager
import dotenv
from google.adk.agents import run_config
from google.adk.agents.llm_agent import LlmAgent
from google.adk.artifacts import InMemoryArtifactService
from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from google.genai.errors import ServerError
import jsonschema
from prompt_builder import ROLE_DESCRIPTION, UI_DESCRIPTION, WORKFLOW_DESCRIPTION, get_text_prompt
from tools import get_contact_info

logger = logging.getLogger(__name__)

SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]

dotenv.load_dotenv()


class ContactAgent:
  """An agent that finds contact info for colleagues."""

  def __init__(self, base_url: str):
    self.base_url = base_url
    self._agent_name = "contact_agent"
    self._user_id = "remote_agent"
    self._text_runner: Optional[Runner] = self._build_runner(self._build_llm_agent())

    self._schema_managers: Dict[str, A2uiSchemaManager] = {}
    self._ui_runners: Dict[str, Runner] = {}

    # Gemini Enerprise only supports VERSION_0_8 for now.
    for version in [VERSION_0_8]:
      schema_manager = self._build_schema_manager(version)
      self._schema_managers[version] = schema_manager
      agent = self._build_llm_agent(schema_manager)
      self._ui_runners[version] = self._build_runner(agent)

    self._agent_card = self._build_agent_card()

  @property
  def agent_card(self) -> AgentCard:
    return self._agent_card

  def _build_schema_manager(self, version: str) -> A2uiSchemaManager:
    # Gemini Enerprise only supports VERSION_0_8 for now.
    return A2uiSchemaManager(
        version=version,
        catalogs=[
            BasicCatalog.get_config(
                version=version,
                examples_path=os.path.join(
                    os.path.dirname(__file__), f"examples/{version}"
                ),
            )
        ],
        schema_modifiers=[remove_strict_validation],
    )

  def _build_agent_card(self) -> AgentCard:
    """Builds the AgentCard for this agent, describing its capabilities and skills."""
    extensions = []
    if self._schema_managers:
      for version, sm in self._schema_managers.items():
        ext = get_a2ui_agent_extension(
            version,
            sm.accepts_inline_catalogs,
            sm.supported_catalog_ids,
        )
        extensions.append(ext)

    capabilities = AgentCapabilities(
        streaming=True,
        extensions=extensions,
    )
    skill = AgentSkill(
        id="find_contact",
        name="Find Contact Tool",
        description=(
            "Helps find contact information for colleagues (e.g., email,"
            " location, team)."
        ),
        tags=["contact", "directory", "people", "finder"],
        examples=[
            "Who is David Chen in marketing?",
            "Find Sarah Lee from engineering",
        ],
    )

    return AgentCard(
        name="Contact Lookup Agent",
        description=(
            "This agent helps find contact info for people in your organization."
        ),
        url=self.base_url,
        version="1.0.0",
        default_input_modes=SUPPORTED_CONTENT_TYPES,
        default_output_modes=SUPPORTED_CONTENT_TYPES,
        capabilities=capabilities,
        preferred_transport="JSONRPC",
        skills=[skill],
    )

  def _build_runner(self, agent: LlmAgent) -> Runner:
    return Runner(
        app_name=self._agent_name,
        agent=agent,
        artifact_service=InMemoryArtifactService(),
        session_service=InMemorySessionService(),
        memory_service=InMemoryMemoryService(),
    )

  def get_processing_message(self) -> str:
    return "Looking up contact information..."

  def _build_llm_agent(
      self, schema_manager: Optional[A2uiSchemaManager] = None
  ) -> LlmAgent:
    """Builds the LLM agent for the contact agent."""

    instruction = (
        schema_manager.generate_system_prompt(
            role_description=ROLE_DESCRIPTION,
            workflow_description=WORKFLOW_DESCRIPTION,
            ui_description=UI_DESCRIPTION,
            include_schema=True,
            include_examples=True,
            validate_examples=True,
        )
        if schema_manager
        else get_text_prompt()
    )

    return LlmAgent(
        model=os.getenv("MODEL", "gemini-2.5-flash"),
        name=self._agent_name,
        description="An agent that finds colleague contact info.",
        instruction=instruction,
        tools=[get_contact_info],
    )

  async def fetch_response(
      self, query, session_id, ui_version: Optional[str] = None
  ) -> list[Part]:
    """Fetches the response from the agent."""

    session_state = {"base_url": self.base_url}

    # Determine which runner to use based on whether the a2ui extension is active.
    if ui_version:
      runner = self._ui_runners[ui_version]
      schema_manager = self._schema_managers[ui_version]
      selected_catalog = (
          schema_manager.get_selected_catalog() if schema_manager else None
      )
    else:
      runner = self._text_runner
      selected_catalog = None

    session = await runner.session_service.get_session(
        app_name=self._agent_name,
        user_id=self._user_id,
        session_id=session_id,
    )
    if session is None:
      session = await runner.session_service.create_session(
          app_name=self._agent_name,
          user_id=self._user_id,
          state=session_state,
          session_id=session_id,
      )
    elif "base_url" not in session.state:
      session.state["base_url"] = self.base_url

    # --- Begin: UI Validation and Retry Logic ---
    max_retries = 1  # Total 2 attempts
    attempt = 0
    current_query_text = query

    # Ensure catalog schema was loaded
    if ui_version and (not selected_catalog or not selected_catalog.catalog_schema):
      logger.error(
          "--- ContactAgent.fetch_response: A2UI_SCHEMA is not loaded. "
          "Cannot perform UI validation. ---"
      )
      return [
          Part(
              root=TextPart(
                  text=(
                      "I'm sorry, I'm facing an internal configuration"
                      " error with my UI components. Please contact"
                      " support."
                  )
              )
          )
      ]

    while attempt <= max_retries:
      attempt += 1
      logger.info(
          "--- ContactAgent.fetch_response: Attempt"
          f" {attempt}/{max_retries + 1} for session {session_id} ---"
      )

      current_message = types.Content(
          role="user", parts=[types.Part.from_text(text=current_query_text)]
      )

      full_content_list = []

      try:
        async for event in runner.run_async(
            user_id=self._user_id,
            session_id=session.id,
            new_message=current_message,
        ):
          if event.is_final_response():
            if event.content and event.content.parts and event.content.parts[0].text:
              full_content_list.extend([p.text for p in event.content.parts if p.text])
      except ServerError as e:
        logger.error(f"GenAI ServerError: {e}")
        return [Part(root=TextPart(text=f"GenAI Error: {e}"))]

      final_response_content = "".join(full_content_list)

      if final_response_content is None:
        logger.warning(
            "--- ContactAgent.fetch_response: Received no final response"
            f" content from runner (Attempt {attempt}). ---"
        )
        if attempt <= max_retries:
          current_query_text = (
              "I received no response. Please try again."
              f"Please retry the original request: '{query}'"
          )
          logger.info(f"Retrying with query: {current_query_text}")
          continue  # Go to next retry
        else:
          logger.info("Retries exhausted on no-response")
          # Retries exhausted on no-response
          final_response_content = (
              "I'm sorry, I encountered an error and couldn't process your request."
          )
          # Fall through to send this as a text-only error

      is_valid = False
      error_message = ""

      if ui_version:
        logger.info(
            "--- ContactAgent.fetch_response: Validating UI response (Attempt"
            f" {attempt})... ---"
        )
        try:
          logger.info(
              "--- ContactAgent.fetch_response: trying to parse response:"
              f" {final_response_content})... ---"
          )
          response_parts = parse_response(final_response_content)

          for part in response_parts:
            if not part.a2ui_json:
              continue

            parsed_json_data = part.a2ui_json

            # Handle the "no results found" or empty JSON case
            if parsed_json_data == []:
              logger.info(
                  "--- ContactAgent.fetch_response: Empty JSON list found. "
                  "Assuming valid (e.g., 'no results'). ---"
              )
              is_valid = True
            else:
              # --- Validation Steps ---
              # Check if it validates against the A2UI_SCHEMA
              # This will raise jsonschema.exceptions.ValidationError if it fails
              logger.info(
                  "--- ContactAgent.fetch_response: Validating against"
                  " A2UI_SCHEMA... ---"
              )
              selected_catalog.validator.validate(parsed_json_data)
              # --- End Validation Steps ---

              logger.info(
                  "--- ContactAgent.fetch_response: UI JSON successfully"
                  " parsed AND validated against schema. Validation OK"
                  f" (Attempt {attempt}). ---"
              )
              is_valid = True
        except (
            ValueError,
            json.JSONDecodeError,
            jsonschema.exceptions.ValidationError,
        ) as e:
          logger.warning(
              f"--- ContactAgent.fetch_response: A2UI validation failed: {e}"
              f" (Attempt {attempt}) ---"
          )
          logger.warning(
              f"--- Failed response content: {final_response_content[:500]}... ---"
          )
          error_message = f"Validation failed: {e}."

      else:  # Not using UI, so text is always "valid"
        is_valid = True

      if is_valid:
        logger.info(
            "--- ContactAgent.fetch_response: Response is valid. Task complete"
            f" (Attempt {attempt}). ---"
        )

        # Already validated, so we can return the parts.
        if ui_version:
          return parse_response_to_parts(final_response_content)
        else:
          return [Part(root=TextPart(text=final_response_content))]

      # --- If we're here, it means validation failed ---
      if attempt <= max_retries:
        logger.warning(
            "--- ContactAgent.fetch_response: Retrying..."
            f" ({attempt}/{max_retries + 1}) ---"
        )
        # Prepare the query for the retry
        current_query_text = (
            f"Your previous response was invalid. {error_message} You MUST"
            " generate a valid response that strictly follows the A2UI JSON"
            " SCHEMA. The response MUST be a JSON list of A2UI messages."
            f" Ensure each JSON part is wrapped in '{A2UI_OPEN_TAG}' and"
            f" '{A2UI_CLOSE_TAG}' tags. Please retry the original request:"
            f" '{query}'"
        )
        # Loop continues...

    # --- If we're here, it means we've exhausted retries ---
    logger.error(
        "--- ContactAgent.fetch_response: Max retries exhausted. Sending"
        " text-only error. ---"
    )
    return [
        Part(
            root=TextPart(
                text=(
                    "I'm sorry, I'm having trouble generating the interface"
                    " for that request right now. Please try again in a"
                    " moment."
                )
            )
        )
    ]
    # --- End: UI Validation and Retry Logic ---
