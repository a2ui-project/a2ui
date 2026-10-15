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
payloads to a client. It includes the `SendA2uiToClientToolset` for managing A2UI tools, and a specific tool for the LLM
to send A2UI.

This is just one approach for capturing A2UI payloads from an LLM.

Key Components:
  * `SendA2uiToClientToolset`: The main entry point. It accepts providers for determining
    if A2UI is enabled and for fetching the active A2UI catalogs and examples, and an
    optional `InferenceFormatFactory` that picks the inference format the model writes
    A2UI in (Direct JSON by default, or another format such as Express). It manages the
    lifecycle of the `_SendA2uiJsonToClientTool`.
  * `_SendA2uiJsonToClientTool`: A tool exposed to the LLM. It allows the LLM to "call" a function
    that effectively sends an A2UI payload to the client. The tool adds the inference format's
    prompt to the system instructions, compiles the tool argument with the format's parser,
    which validates it against the provided catalogs, and returns the A2UI messages as JSON.

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

  2. Choosing an Inference Format:
    Pass an `InferenceFormatFactory` to have the model write A2UI in another format.
    Examples given as A2UI message turns are rendered in that format.

    ```python
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True,
        a2ui_catalogs=[MY_CATALOG],
        a2ui_examples=MY_EXAMPLE_TURNS,  # list[list[AgentToRendererMessage]]
        inference_format_factory=ExpressFormatFactory(),
    )
    ```

  3. Integration with Agent:
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

from a2ui.constants import A2UI_TOOL_ERROR_KEY, A2UI_TOOL_NAME, A2UI_VALIDATED_JSON_KEY
from a2ui.core import A2uiCatalogError, A2uiValidationError, Catalog, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats import DirectJsonFormatFactory
from a2ui.parser import A2uiPart, Parser, to_message_dicts

if TYPE_CHECKING:
    from a2ui.adk.a2a import A2uiPartConverter

logger = logging.getLogger(__name__)

A2uiEnabledProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext], bool | Awaitable[bool]
]
A2uiCatalogsProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext],
    Sequence[CatalogApi] | Awaitable[Sequence[CatalogApi]],
]
A2uiExampleTurns: TypeAlias = Sequence[Sequence[AgentToRendererMessage]]
A2uiExamples: TypeAlias = str | A2uiExampleTurns
A2uiExamplesProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext], A2uiExamples | Awaitable[A2uiExamples]
]


@experimental
class SendA2uiToClientToolset(base_toolset.BaseToolset):
    """A toolset that provides A2UI Tools and can be enabled/disabled."""

    def __init__(
        self,
        a2ui_enabled: bool | A2uiEnabledProvider,
        a2ui_catalogs: Sequence[CatalogApi] | A2uiCatalogsProvider,
        a2ui_examples: A2uiExamples | A2uiExamplesProvider,
        inference_format_factory: InferenceFormatFactory | None = None,
    ):
        """Initializes the toolset.

        Args:
            a2ui_enabled: Whether A2UI is enabled, or a provider that decides it
              per context.
            a2ui_catalogs: The active A2UI catalogs, or a provider that returns
              them per context. The catalogs must share a protocol version. The
              prompt describes every catalog, and a payload is validated
              against the catalog each surface names.
            a2ui_examples: The few-shot examples, or a provider that returns
              them per context. A string is added to the prompt as written, so
              it must already be in the inference format's syntax. A sequence
              of turns, each a sequence of A2UI messages, is rendered by the
              inference format.
            inference_format_factory: Creates the inference format that the
              model writes A2UI in. Defaults to `DirectJsonFormatFactory()`.
        """
        super().__init__()
        self._a2ui_enabled = a2ui_enabled
        self._ui_tool = self._SendA2uiJsonToClientTool(
            a2ui_catalogs, a2ui_examples, inference_format_factory
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
            A configured A2uiPartConverter that parses text-based A2UI with the
            inference format's parser.

        Raises:
            ImportError: If the `a2a` extra (`pip install "a2ui-adk[a2a]"`) is
              not installed.
        """
        # Through the package facade, so a missing extra raises the ImportError
        # that names the install command.
        from a2ui.adk import A2uiPartConverter

        catalogs = await self._ui_tool._resolve_a2ui_catalogs(ctx)
        inference_format = self._ui_tool._create_inference_format(catalogs)
        return A2uiPartConverter(catalogs, parser=inference_format.create_parser())

    class _SendA2uiJsonToClientTool(base_tool.BaseTool):
        TOOL_NAME = A2UI_TOOL_NAME
        VALIDATED_A2UI_JSON_KEY = A2UI_VALIDATED_JSON_KEY
        A2UI_JSON_ARG_NAME = "a2ui_json"
        TOOL_ERROR_KEY = A2UI_TOOL_ERROR_KEY
        TOOL_USAGE_INSTRUCTION = (
            f"To show UI to the user, call the `{A2UI_TOOL_NAME}` tool and pass"
            f" the A2UI block as its `{A2UI_JSON_ARG_NAME}` argument, instead of"
            " writing A2UI in your text response. Call the tool once per block."
        )

        def __init__(
            self,
            a2ui_catalogs: Sequence[CatalogApi] | A2uiCatalogsProvider,
            a2ui_examples: A2uiExamples | A2uiExamplesProvider,
            inference_format_factory: InferenceFormatFactory | None = None,
        ):
            self._a2ui_catalogs: list[CatalogApi] | A2uiCatalogsProvider = (
                a2ui_catalogs
                if callable(a2ui_catalogs)
                else self._to_catalog_list(a2ui_catalogs)
            )
            self._a2ui_examples = a2ui_examples
            self._inference_format_factory = (
                inference_format_factory
                if inference_format_factory is not None
                else DirectJsonFormatFactory()
            )
            super().__init__(
                name=self.TOOL_NAME,
                description=(
                    "Sends A2UI to the client to render rich UI for the user."
                    " This tool can be called multiple times in the same turn to"
                    " render multiple UI surfaces. Args:"
                    f" {self.A2UI_JSON_ARG_NAME}: The A2UI to send to the client,"
                    " written in the A2UI format that the system instructions"
                    " describe."
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
                            description=(
                                "The A2UI to send to the client, in the format"
                                " the system instructions describe."
                            ),
                        ),
                    },
                    required=[self.A2UI_JSON_ARG_NAME],
                ),
            )

        async def _resolve_a2ui_examples(
            self, ctx: readonly_context.ReadonlyContext
        ) -> str | list[list[AgentToRendererMessage]]:
            """The resolved self.a2ui_examples field to construct instruction for this agent.

            Args:
                ctx: The readonly_context.ReadonlyContext to resolve the provider with.

            Returns:
                The A2UI examples, either as a string or as a list of turns, each
                a list of A2UI messages.

            Raises:
                TypeError: If the examples are neither a string nor a sequence of
                  turns.
            """
            examples: A2uiExamples
            if callable(self._a2ui_examples):
                resolved = self._a2ui_examples(ctx)
                if inspect.isawaitable(resolved):
                    resolved = await resolved
                examples = resolved
            else:
                examples = self._a2ui_examples
            if isinstance(examples, str):
                return examples
            turns: list[list[AgentToRendererMessage]] = []
            for turn in examples:
                if not isinstance(turn, Sequence) or isinstance(turn, (str, bytes)):
                    raise TypeError(
                        f"Tool {self.TOOL_NAME} expects A2UI examples as a string or"
                        " a sequence of turns, each a sequence of A2UI messages,"
                        f" got a turn of type {type(turn).__name__}."
                    )
                turns.append(list(turn))
            return turns

        def _create_inference_format(
            self,
            catalogs: Sequence[CatalogApi],
            examples: A2uiExampleTurns | None = None,
        ) -> InferenceFormat:
            """Creates the inference format for the given catalogs and examples."""
            return self._inference_format_factory.create_format(
                catalogs, examples=examples
            )

        def _compile(self, parser: Parser, content: str) -> list[dict[str, Any]]:
            """Compiles the tool argument into validated A2UI message dicts.

            The argument may be a bare block in the inference format, or one or
            more blocks wrapped in the format's tags, with any text around them
            ignored.

            Args:
                parser: The inference format's parser.
                content: The tool argument.

            Returns:
                The A2UI messages as wire-format dicts.
            """
            if parser.has_format_content(content, complete=True):
                messages = [
                    message
                    for part in parser.parse_response(content)
                    if isinstance(part, A2uiPart)
                    for message in part.a2ui
                ]
            else:
                messages = parser.compile(content)
            return to_message_dicts(messages)

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
            examples = await self._resolve_a2ui_examples(tool_context)
            if isinstance(examples, str):
                inference_format = self._create_inference_format(a2ui_catalogs)
            else:
                inference_format = self._create_inference_format(
                    a2ui_catalogs, examples
                )

            instructions = [
                inference_format.prompt_generator.generate(),
                self.TOOL_USAGE_INSTRUCTION,
            ]
            if isinstance(examples, str) and examples:
                instructions.append(examples)
            llm_request.append_instructions(instructions)

            logger.info("Added A2UI prompt and examples to system instructions")

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
                parser = self._create_inference_format(a2ui_catalogs).create_parser()
                a2ui_json_payload = self._compile(parser, a2ui_json)

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
