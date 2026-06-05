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

"""Module for the SendA2uiToClientToolset.

This module provides the necessary components to enable an agent to send A2UI (Agent-to-User Interface)
JSON payloads to a client. It includes the `SendA2uiToClientToolset` for managing A2UI tools, and a specific tool for the LLM
to send JSON.

This is just one approach for capturing A2UI JSON payloads from an LLM.

Key Components:
  * `SendA2uiToClientToolset`: The main entry point. It accepts providers for determining
    if A2UI is enabled and for fetching the A2UI schema. It manages the lifecycle of the
    `_SendA2uiJsonToClientTool`.
  * `_SendA2uiJsonToClientTool`: A tool exposed to the LLM. It allows the LLM to "call" a function
    that effectively sends a JSON payload to the client. This tool validates the JSON against
    the provided schema. It automatically wraps the provided schema in an array structure,
    instructing the LLM that it can send a list of UI items.

Usage Examples:

  1. Defining Providers:
    You can use simple values or callables (sync or async) for enablement, catalog schema, and examples.

    ```python
    # Simple boolean and dict
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True,
        a2ui_catalog=MY_CATALOG,
        a2ui_examples=MY_EXAMPLES,
    )

    # Async providers
    async def check_enabled(ctx: ReadonlyContext) -> bool:
      return await some_condition(ctx)

    async def get_catalog(ctx: ReadonlyContext) -> catalog.A2uiCatalog:
      return await fetch_catalog(ctx)

    async def get_examples(ctx: ReadonlyContext) -> str:
      return await fetch_examples(ctx)

    toolset = SendA2uiToClientToolset(
        a2ui_enabled=check_enabled,
        a2ui_catalog=get_catalog,
        a2ui_examples=get_examples,
    )
    ```

  2. Integration with Agent:
    Typically used when initializing an agent's toolset.

    ```python
    # In your agent initialization
    LlmAgent(
        tools=[
            SendA2uiToClientToolset(
                a2ui_enabled=check_enabled,
                a2ui_catalog=get_catalog,
                a2ui_examples=get_examples,
            ),
        ],
    )
    ```
"""

import inspect
import logging
from typing import (
    Any,
    Awaitable,
    Callable,
    Optional,
    TYPE_CHECKING,
    TypeAlias,
    Union,
)

from google.adk.agents import readonly_context
from google.adk.models.llm_request import LlmRequest
from google.adk.tools import base_tool
from google.adk.tools import base_toolset
from google.adk.tools import tool_context
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

from a2ui.adk.a2a.event_converter import A2uiEventConverter
from a2ui.adk.a2a.part_converter import A2uiPartConverter
from a2ui.parser.payload_fixer import parse_and_fix
from a2ui.schema import catalog
from a2ui.schema import constants
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import (
    A2UI_SCHEMA_BLOCK_END,
    A2UI_SCHEMA_BLOCK_START,
    A2UI_TOOL_ERROR_KEY,
    A2UI_TOOL_NAME,
    A2UI_VALIDATED_JSON_KEY,
)

if TYPE_CHECKING:
  from google.adk.agents.invocation_context import InvocationContext
  from google.adk.events.event import Event

logger = logging.getLogger(__name__)

A2uiEnabledProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext], Union[bool, Awaitable[bool]]
]
A2uiCatalogProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext],
    Union[catalog.A2uiCatalog, Awaitable[catalog.A2uiCatalog]],
]
A2uiExamplesProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext], Union[str, Awaitable[str]]
]


@experimental
class SendA2uiToClientToolset(base_toolset.BaseToolset):
  """A toolset that provides A2UI Tools and can be enabled/disabled."""

  def __init__(
      self,
      a2ui_enabled: Union[bool, A2uiEnabledProvider],
      a2ui_catalog: Union[catalog.A2uiCatalog, A2uiCatalogProvider],
      a2ui_examples: Union[str, A2uiExamplesProvider],
  ):
    super().__init__()
    self._a2ui_enabled = a2ui_enabled
    self._ui_tools = [self._SendA2uiJsonToClientTool(a2ui_catalog, a2ui_examples)]

  async def _resolve_a2ui_enabled(self, ctx: readonly_context.ReadonlyContext) -> bool:
    """The resolved self.a2ui_enabled field to construct instruction for this agent.

    Args:
        ctx: The ReadonlyContext to resolve the provider with.

    Returns:
        If A2UI is enabled, return True. Otherwise, return False.
    """
    if isinstance(self._a2ui_enabled, bool):
      return self._a2ui_enabled
    else:
      a2ui_enabled = self._a2ui_enabled(ctx)
      if inspect.isawaitable(a2ui_enabled):
        a2ui_enabled = await a2ui_enabled
    return a2ui_enabled

  async def get_tools(
      self,
      readonly_context: Optional[readonly_context.ReadonlyContext] = None,
  ) -> list[base_tool.BaseTool]:
    """Returns the list of tools provided by this toolset.

    Args:
        readonly_context: The ReadonlyContext for resolving tool enablement.

    Returns:
        A list of tools.
    """
    use_ui = False
    if readonly_context is not None:
      use_ui = await self._resolve_a2ui_enabled(readonly_context)
    if use_ui:
      logger.info("A2UI is ENABLED, adding ui tools")
      return self._ui_tools
    else:
      logger.info("A2UI is DISABLED, not adding ui tools")
      return []

  async def get_part_converter(
      self, ctx: readonly_context.ReadonlyContext
  ) -> "A2uiPartConverter":
    """Returns a configured A2uiPartConverter for the given context.

    Args:
        ctx: The readonly_context.ReadonlyContext to resolve the catalog with.

    Returns:
        A configured A2uiPartConverter.
    """
    catalog = await self._ui_tools[0]._resolve_a2ui_catalog(ctx)
    return A2uiPartConverter(catalog)

  class _SendA2uiJsonToClientTool(base_tool.BaseTool):
    TOOL_NAME = A2UI_TOOL_NAME
    VALIDATED_A2UI_JSON_KEY = A2UI_VALIDATED_JSON_KEY
    A2UI_JSON_ARG_NAME = "a2ui_json"
    TOOL_ERROR_KEY = A2UI_TOOL_ERROR_KEY

    def __init__(
        self,
        a2ui_catalog: Union[catalog.A2uiCatalog, A2uiCatalogProvider],
        a2ui_examples: Union[str, A2uiExamplesProvider],
    ):
      self._a2ui_catalog = a2ui_catalog
      self._a2ui_examples = a2ui_examples
      super().__init__(
          name=self.TOOL_NAME,
          description=(
              "Sends A2UI JSON to the client to render rich UI for the user. This tool"
              " can be called multiple times in the same call to render multiple UI"
              f" surfaces.Args:    {self.A2UI_JSON_ARG_NAME}: Valid A2UI JSON Schema to"
              " send to the client. The A2UI JSON Schema definition is between"
              f" {constants.A2UI_SCHEMA_BLOCK_START} and"
              f" {constants.A2UI_SCHEMA_BLOCK_END} in the system instructions."
          ),
      )

    def _get_declaration(self) -> genai_types.FunctionDeclaration | None:
      return genai_types.FunctionDeclaration(
          name=self.name,
          description=self.description,
          parameters=genai_types.Schema(
              type=genai_types.Type.OBJECT,
              properties={
                  self.A2UI_JSON_ARG_NAME: genai_types.Schema(
                      type=genai_types.Type.STRING,
                      description="valid A2UI JSON Schema to send to the client.",
                  ),
              },
              required=[self.A2UI_JSON_ARG_NAME],
          ),
      )

    async def _resolve_a2ui_examples(
        self, ctx: readonly_context.ReadonlyContext
    ) -> str:
      """The resolved self.a2ui_examples field to construct instruction for this agent.

      Args:
          ctx: The readonly_context.ReadonlyContext to resolve the provider with.

      Returns:
          The A2UI examples string.
      """
      if isinstance(self._a2ui_examples, str):
        return self._a2ui_examples
      else:
        a2ui_examples = self._a2ui_examples(ctx)
        if inspect.isawaitable(a2ui_examples):
          a2ui_examples = await a2ui_examples
        return a2ui_examples

    async def _resolve_a2ui_catalog(
        self, ctx: readonly_context.ReadonlyContext
    ) -> catalog.A2uiCatalog:
      """The resolved self.a2ui_catalog field to construct instruction for this agent.

      Args:
          ctx: The readonly_context.ReadonlyContext to resolve the provider with.

      Returns:
          The A2UI catalog object.
      """
      if isinstance(self._a2ui_catalog, catalog.A2uiCatalog):
        return self._a2ui_catalog
      else:
        a2ui_catalog = self._a2ui_catalog(ctx)
        if inspect.isawaitable(a2ui_catalog):
          a2ui_catalog = await a2ui_catalog
        return a2ui_catalog

    async def process_llm_request(
        self,
        *,
        tool_context: tool_context.ToolContext,
        llm_request: LlmRequest,
    ) -> None:
      await super().process_llm_request(
          tool_context=tool_context, llm_request=llm_request
      )

      a2ui_catalog = await self._resolve_a2ui_catalog(tool_context)

      instruction = a2ui_catalog.render_as_llm_instructions()
      examples = await self._resolve_a2ui_examples(tool_context)

      llm_request.append_instructions([instruction, examples])

      logger.info("Added A2UI schema and examples to system instructions")

    async def run_async(
        self, *, args: dict[str, Any], tool_context: tool_context.ToolContext
    ) -> Any:
      try:
        a2ui_json = args.get(self.A2UI_JSON_ARG_NAME)
        if not a2ui_json:
          raise ValueError(
              f"Failed to call tool {self.TOOL_NAME} because missing required"
              f" arg {self.A2UI_JSON_ARG_NAME} "
          )

        a2ui_catalog = await self._resolve_a2ui_catalog(tool_context)
        a2ui_json_payload = parse_and_fix(a2ui_json)
        a2ui_catalog.validator.validate(a2ui_json_payload)

        logger.info(
            f"Validated call to tool {self.TOOL_NAME} with {self.A2UI_JSON_ARG_NAME}"
        )

        # Don't do a second LLM inference call for the JSON response
        tool_context.actions.skip_summarization = True

        # Return the validated JSON so the converter can use it.
        # We return it in a dict under "result" key for consistent JSON structure.
        return {self.VALIDATED_A2UI_JSON_KEY: a2ui_json_payload}

      except Exception as e:
        err = f"Failed to call A2UI tool {self.TOOL_NAME}: {e}"
        logger.error(err)

        return {self.TOOL_ERROR_KEY: err}
