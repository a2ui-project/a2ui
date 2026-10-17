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

"""Module for the SendA2uiToClientToolset.

This module provides the necessary components to enable an agent to send A2UI (Agent-to-User Interface)
JSON payloads to a client. It includes the `SendA2uiToClientToolset` for managing A2UI tools, and a specific tool for the LLM
to send JSON.

This is just one approach for capturing A2UI JSON payloads from an LLM.

Key Components:
  * `SendA2uiToClientToolset`: The main entry point. It accepts providers for determining
    if A2UI is enabled and for fetching the active A2UI catalogs. It manages the lifecycle of the
    `_SendA2uiJsonToClientTool`.
  * `_SendA2uiJsonToClientTool`: A tool exposed to the LLM. It allows the LLM to "call" a function
    that effectively sends a JSON payload to the client. This tool validates the JSON against
    the provided catalogs. It automatically wraps the provided schema in an array structure,
    instructing the LLM that it can send a list of UI items.

Usage Examples:

  1. Defining Providers:
    You can use simple values or callables (sync or async) for enablement, catalogs, and examples.

    ```python
    # Simple boolean and catalogs
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True,
        a2ui_catalogs=[MY_CATALOG, MY_OTHER_CATALOG],
        a2ui_examples=MY_EXAMPLES,
    )

    # Async providers
    async def check_enabled(ctx: ReadonlyContext) -> bool:
      return await some_condition(ctx)

    async def get_catalogs(ctx: ReadonlyContext) -> Sequence[CatalogApi]:
      return await fetch_catalogs(ctx)

    async def get_examples(ctx: ReadonlyContext) -> str:
      return await fetch_examples(ctx)

    toolset = SendA2uiToClientToolset(
        a2ui_enabled=check_enabled,
        a2ui_catalogs=get_catalogs,
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
                a2ui_catalogs=get_catalogs,
                a2ui_examples=get_examples,
            ),
        ],
    )
    ```
"""

from collections.abc import Iterable, Sequence
import inspect
import logging
from typing import (
    TYPE_CHECKING,
    Any,
    Awaitable,
    Callable,
    TypeAlias,
)

from google.adk.agents import readonly_context
from google.adk.models.llm_request import LlmRequest
from google.adk.tools import base_tool
from google.adk.tools import base_toolset
from google.adk.tools import tool_context
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

from a2ui import constants
from a2ui.constants import A2UI_TOOL_ERROR_KEY, A2UI_TOOL_NAME, A2UI_VALIDATED_JSON_KEY
from a2ui.core import A2uiCatalogError, A2uiValidationError, Catalog, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats.direct_json import DirectJsonDecompiler, schema_to_prompt
from a2ui.parser import parse_and_fix
from a2ui.utils import RendererState, validate_payload

if TYPE_CHECKING:
    from a2ui.adk.a2a import A2uiPartConverter

logger = logging.getLogger(__name__)

A2uiExamplesValue: TypeAlias = str | Sequence[Sequence[AgentToRendererMessage]] | None
A2uiEnabledProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext], bool | Awaitable[bool]
]
A2uiCatalogsProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext],
    Sequence[CatalogApi] | Awaitable[Sequence[CatalogApi]],
]
A2uiExamplesProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext],
    A2uiExamplesValue | Awaitable[A2uiExamplesValue],
]
A2uiStateProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext],
    RendererState | None | Awaitable[RendererState | None],
]


@experimental
class SendA2uiToClientToolset(base_toolset.BaseToolset):
    """A toolset that provides A2UI Tools and can be enabled/disabled."""

    def __init__(
        self,
        a2ui_enabled: bool | A2uiEnabledProvider,
        a2ui_catalogs: Sequence[CatalogApi] | A2uiCatalogsProvider,
        a2ui_examples: A2uiExamplesValue | A2uiExamplesProvider = None,
        *,
        a2ui_state: RendererState | A2uiStateProvider | None = None,
    ):
        """Initializes the toolset.

        Args:
            a2ui_enabled: Whether A2UI is enabled, or a provider that decides it
              per context.
            a2ui_catalogs: The active A2UI catalogs, or a provider that returns
              them per context. The catalogs must share a protocol version. The
              schema prompt describes every catalog, and a payload is validated
              against the catalog each surface names.
            a2ui_examples: The A2UI examples (a markdown string, a sequence of
              example turns such as `processor.examples`, or `None`), or a
              provider that returns them per context.
            a2ui_state: Optional `RendererState`, or a provider that returns one
              per context, for Canvas agents whose tool calls update surfaces
              across turns.
        """
        super().__init__()
        self._a2ui_enabled = a2ui_enabled
        self._ui_tool = self._SendA2uiJsonToClientTool(
            a2ui_catalogs, a2ui_examples, a2ui_state=a2ui_state
        )
        self._ui_tools: list[base_tool.BaseTool] = [self._ui_tool]

    async def _resolve_a2ui_enabled(
        self, ctx: readonly_context.ReadonlyContext
    ) -> bool:
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
        readonly_context: readonly_context.ReadonlyContext | None = None,
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
            ctx: The readonly_context.ReadonlyContext to resolve the catalogs with.

        Returns:
            A configured A2uiPartConverter.

        Raises:
            ImportError: If the `a2a` extra (`pip install "a2ui-adk[a2a]"`) is
              not installed.
        """
        # Through the package facade, so a missing extra raises the ImportError
        # that names the install command.
        from a2ui.adk import A2uiPartConverter

        catalogs = await self._ui_tool._resolve_a2ui_catalogs(ctx)
        state = await self._ui_tool._resolve_a2ui_state(ctx)
        if state is not None:
            return A2uiPartConverter(catalogs, state=state)
        return A2uiPartConverter(catalogs)

    class _SendA2uiJsonToClientTool(base_tool.BaseTool):
        TOOL_NAME = A2UI_TOOL_NAME
        VALIDATED_A2UI_JSON_KEY = A2UI_VALIDATED_JSON_KEY
        A2UI_JSON_ARG_NAME = "a2ui_json"
        TOOL_ERROR_KEY = A2UI_TOOL_ERROR_KEY

        def __init__(
            self,
            a2ui_catalogs: Sequence[CatalogApi] | A2uiCatalogsProvider,
            a2ui_examples: A2uiExamplesValue | A2uiExamplesProvider = None,
            *,
            a2ui_state: RendererState | A2uiStateProvider | None = None,
        ):
            self._a2ui_catalogs: list[CatalogApi] | A2uiCatalogsProvider = (
                a2ui_catalogs
                if callable(a2ui_catalogs)
                else self._to_catalog_list(a2ui_catalogs)
            )
            self._a2ui_examples = a2ui_examples
            self._a2ui_state = a2ui_state
            super().__init__(
                name=self.TOOL_NAME,
                description=(
                    "Sends A2UI JSON to the client to render rich UI for the user."
                    " This tool can be called multiple times in the same call to"
                    f" render multiple UI surfaces.Args:    {self.A2UI_JSON_ARG_NAME}:"
                    " Valid A2UI JSON Schema to send to the client. The A2UI JSON"
                    f" Schema definition is between {constants.A2UI_SCHEMA_BLOCK_START}"
                    f" and {constants.A2UI_SCHEMA_BLOCK_END} in the system"
                    " instructions."
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

        def _format_examples(self, examples: A2uiExamplesValue) -> str:
            """Formats examples as a string for the LLM prompt."""
            if examples is None:
                return ""
            if isinstance(examples, str):
                return examples
            if isinstance(examples, Sequence) and not isinstance(
                examples, (str, bytes)
            ):
                if not examples:
                    return ""
                decompiler = DirectJsonDecompiler()
                blocks = [
                    f"<a2ui-json>\n{decompiler.decompile(turn)}\n</a2ui-json>"
                    for turn in examples
                ]
                return "### Examples:\n" + "\n\n".join(blocks)
            raise TypeError(
                f"Tool {self.TOOL_NAME} expects examples as a string, a sequence"
                f" of example turns, or None, got {type(examples).__name__}."
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
            if callable(self._a2ui_examples):
                a2ui_examples = self._a2ui_examples(ctx)
                if inspect.isawaitable(a2ui_examples):
                    a2ui_examples = await a2ui_examples
                return self._format_examples(a2ui_examples)
            return self._format_examples(self._a2ui_examples)

        async def _resolve_a2ui_state(
            self, ctx: readonly_context.ReadonlyContext
        ) -> RendererState | None:
            """Resolves the optional RendererState for Canvas validation."""
            if self._a2ui_state is None or isinstance(self._a2ui_state, RendererState):
                return self._a2ui_state
            if callable(self._a2ui_state):
                state = self._a2ui_state(ctx)
                if inspect.isawaitable(state):
                    state = await state
                if state is not None and not isinstance(state, RendererState):
                    raise TypeError(
                        f"Tool {self.TOOL_NAME} expects a RendererState or None,"
                        f" got {type(state).__name__}."
                    )
                return state
            raise TypeError(
                f"Tool {self.TOOL_NAME} expects a RendererState or provider,"
                f" got {type(self._a2ui_state).__name__}."
            )

        @staticmethod
        def _check_state_catalogs(
            state: RendererState, catalogs: Sequence[CatalogApi]
        ) -> None:
            held = [
                (c.catalog_id, to_protocol_version(c.protocol_version).value)
                for c in state.catalogs
            ]
            active = [
                (c.catalog_id, to_protocol_version(c.protocol_version).value)
                for c in catalogs
            ]
            if held != active:
                raise A2uiCatalogError(
                    f"The renderer state holds catalogs {held}, but the tool's"
                    f" active catalogs are {active}."
                )

        def _to_catalog_list(self, catalogs: Iterable[CatalogApi]) -> list[CatalogApi]:
            """Checks catalogs and returns them as a list.

            Args:
                catalogs: The catalogs given to the tool or returned by its
                  provider.

            Returns:
                The catalogs as a list, in their original order.

            Raises:
                A2uiCatalogError: If there are no catalogs.
                TypeError: If a single catalog, a string or bytes is given in
                  place of an iterable of catalogs.
            """
            if isinstance(catalogs, (Catalog, str, bytes)):
                raise TypeError(
                    f"Tool {self.TOOL_NAME} expects a sequence of A2UI catalogs,"
                    f" got {type(catalogs).__name__}."
                )
            catalogs_list = list(catalogs)
            if not catalogs_list:
                raise A2uiCatalogError(
                    f"Tool {self.TOOL_NAME} requires at least one A2UI catalog."
                )
            return catalogs_list

        async def _resolve_a2ui_catalogs(
            self, ctx: readonly_context.ReadonlyContext
        ) -> list[CatalogApi]:
            """The resolved self.a2ui_catalogs field to construct instruction for this agent.

            Args:
                ctx: The readonly_context.ReadonlyContext to resolve the provider with.

            Returns:
                The A2UI catalogs.

            Raises:
                A2uiCatalogError: If the provider returns no catalogs.
                TypeError: If the provider returns a single catalog, a string or
                  bytes in place of a sequence of catalogs.
            """
            if not callable(self._a2ui_catalogs):
                return self._a2ui_catalogs
            resolved = self._a2ui_catalogs(ctx)
            if inspect.isawaitable(resolved):
                resolved = await resolved
            return self._to_catalog_list(resolved)

        async def process_llm_request(
            self,
            *,
            tool_context: tool_context.ToolContext,
            llm_request: LlmRequest,
        ) -> None:
            await super().process_llm_request(
                tool_context=tool_context, llm_request=llm_request
            )

            a2ui_catalogs = await self._resolve_a2ui_catalogs(tool_context)

            instruction = schema_to_prompt(a2ui_catalogs)
            examples = await self._resolve_a2ui_examples(tool_context)

            existing_instruction = getattr(
                getattr(llm_request, "config", None), "system_instruction", None
            )
            existing_text = (
                existing_instruction if isinstance(existing_instruction, str) else ""
            )
            instructions_to_append = [
                part
                for part in (instruction, examples)
                if part and part not in existing_text
            ]
            if instructions_to_append:
                llm_request.append_instructions(instructions_to_append)

            logger.info("Added A2UI schema and examples to system instructions")

        async def run_async(
            self, *, args: dict[str, Any], tool_context: tool_context.ToolContext
        ) -> Any:
            try:
                a2ui_json = args.get(self.A2UI_JSON_ARG_NAME)
                if not a2ui_json:
                    raise A2uiValidationError(
                        f"Failed to call tool {self.TOOL_NAME} because missing required"
                        f" arg {self.A2UI_JSON_ARG_NAME} "
                    )

                a2ui_catalogs = await self._resolve_a2ui_catalogs(tool_context)
                state = await self._resolve_a2ui_state(tool_context)
                a2ui_json_payload = parse_and_fix(a2ui_json)
                if state is not None:
                    self._check_state_catalogs(state, a2ui_catalogs)
                    with state.transaction():
                        touched = state.apply(a2ui_json_payload)
                        state.check_topology(touched)
                else:
                    validate_payload(a2ui_catalogs, a2ui_json_payload)

                logger.info(
                    f"Validated call to tool {self.TOOL_NAME} with"
                    f" {self.A2UI_JSON_ARG_NAME}"
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
