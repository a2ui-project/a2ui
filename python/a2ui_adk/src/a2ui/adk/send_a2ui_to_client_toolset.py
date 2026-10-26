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
messages to a client through a tool call. It includes the `SendA2uiToClientToolset` for managing A2UI
tools, and a specific tool for the LLM to send A2UI.

This is just one approach for capturing A2UI payloads from an LLM.

Key Components:
  * `SendA2uiToClientToolset`: The main entry point. It accepts providers for determining
    if A2UI is enabled and for fetching the active A2UI catalogs. It manages the lifecycle of the
    `_SendA2uiJsonToClientTool`.
  * `_SendA2uiJsonToClientTool`: A tool exposed to the LLM. It takes one `A2uiRequestProcessor`
    (or a provider of one per context), which the toolset binds the catalogs, the examples and the
    inference format (Express by default) to. The LLM writes the A2UI block in the tool's argument,
    in the processor's format. The tool compiles the block into A2UI messages, validates them
    against the catalogs (and the renderer state, when one is given), and returns the A2UI JSON
    messages for the part converter to send.

Usage Examples:

  1. Defining Providers:
    You can use simple values or callables (sync or async) for enablement, catalogs, and examples.

    ```python
    # Simple boolean and catalogs
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True,
        a2ui_catalogs=[MY_CATALOG, MY_OTHER_CATALOG],
        a2ui_examples=MY_EXAMPLE_TURNS,
    )

    # Async providers
    async def check_enabled(ctx: ReadonlyContext) -> bool:
      return await some_condition(ctx)

    async def get_catalogs(ctx: ReadonlyContext) -> Sequence[CatalogApi]:
      return await fetch_catalogs(ctx)

    toolset = SendA2uiToClientToolset(
        a2ui_enabled=check_enabled,
        a2ui_catalogs=get_catalogs,
    )
    ```

  2. Choosing an Inference Format:
    The tool's argument uses Express by default. Pass another factory to change it.

    ```python
    from a2ui.inference_formats.direct_json import DirectJsonFormatFactory

    toolset = SendA2uiToClientToolset(
        a2ui_enabled=True,
        a2ui_catalogs=[MY_CATALOG],
        inference_format_factory=DirectJsonFormatFactory(),
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
            ),
        ],
    )
    ```
"""

from collections.abc import Iterable, Mapping, Sequence
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
from a2ui.core import (
    A2uiCatalogError,
    A2uiParseError,
    A2uiValidationError,
    Catalog,
    CatalogApi,
)
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.parser import A2uiPart, Parser, RawA2uiPart
from a2ui.processor import A2uiRequestProcessor
from a2ui.prompt import PromptGenerator
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
_A2uiProcessorProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext],
    A2uiRequestProcessor | Awaitable[A2uiRequestProcessor],
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
        inference_format_factory: InferenceFormatFactory | None = None,
        a2ui_state: RendererState | A2uiStateProvider | None = None,
    ):
        """Initializes the toolset.

        Args:
            a2ui_enabled: Whether A2UI is enabled, or a provider that decides it
              per context.
            a2ui_catalogs: The active A2UI catalogs, or a provider that returns
              them per context. The catalogs must share a protocol version. The
              prompt describes every catalog, and a payload is validated
              against the catalog each surface names.
            a2ui_examples: The A2UI examples, or a provider that returns them
              per context. A sequence of example turns, such as
              `processor.examples`, is given to the inference format, whose
              prompt generator writes them in the format's syntax. A string is
              added to the prompt as it is. `None` adds no examples.
            inference_format_factory: The factory for the inference format the
              LLM writes the tool's argument in. Defaults to
              `ExpressFormatFactory()`.
            a2ui_state: Optional `RendererState`, or a provider that returns one
              per context, for Canvas agents whose tool calls update surfaces
              across turns. Each payload is checked against the state and, if
              it passes, applied to it.
        """
        super().__init__()
        self._a2ui_enabled = a2ui_enabled
        self._ui_tool = self._SendA2uiJsonToClientTool(
            _processor_source(
                a2ui_catalogs,
                a2ui_examples,
                (
                    inference_format_factory
                    if inference_format_factory is not None
                    else ExpressFormatFactory()
                ),
            ),
            a2ui_state=a2ui_state,
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

        The converter reads text-based A2UI with the parser of the toolset's
        inference format, so text and tool calls use the same format.

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

        processor = await self._ui_tool._resolve_processor(ctx)
        state = await self._ui_tool._resolve_a2ui_state(ctx)
        return A2uiPartConverter(processor=processor, state=state)

    class _SendA2uiJsonToClientTool(base_tool.BaseTool):
        TOOL_NAME = A2UI_TOOL_NAME
        VALIDATED_A2UI_JSON_KEY = A2UI_VALIDATED_JSON_KEY
        A2UI_PAYLOAD_ARG_NAME = "a2ui_payload"
        TOOL_ERROR_KEY = A2UI_TOOL_ERROR_KEY

        def __init__(
            self,
            processor: A2uiRequestProcessor | _A2uiProcessorProvider,
            *,
            a2ui_state: RendererState | A2uiStateProvider | None = None,
        ):
            """Initializes the tool.

            Args:
                processor: The request processor that writes the prompt and
                  reads the tool's argument, or a provider that returns one per
                  context. It holds the catalogs, the examples and the
                  inference format.
                a2ui_state: Optional `RendererState`, or a provider that returns
                  one per context, that payloads are checked against and
                  applied to.
            """
            self._processor = processor
            self._a2ui_state = a2ui_state
            super().__init__(
                name=self.TOOL_NAME,
                description=(
                    "Sends A2UI to the client to render rich UI for the user. This"
                    " tool can be called multiple times in the same turn to render"
                    " multiple UI surfaces. Args: "
                    f"{self.A2UI_PAYLOAD_ARG_NAME}: The A2UI block to send, written"
                    " in the A2UI format and with the components that the system"
                    " instructions describe."
                ),
            )

        def _get_declaration(self) -> genai_types.FunctionDeclaration | None:
            return genai_types.FunctionDeclaration(
                name=self.name,
                description=self.description,
                parameters=genai_types.Schema(
                    type=genai_types.Type.OBJECT,
                    properties={
                        self.A2UI_PAYLOAD_ARG_NAME: genai_types.Schema(
                            type=genai_types.Type.STRING,
                            description=(
                                "The A2UI block to send to the client, in the A2UI"
                                " format that the system instructions describe."
                            ),
                        ),
                    },
                    required=[self.A2UI_PAYLOAD_ARG_NAME],
                ),
            )

        async def _resolve_processor(
            self, ctx: readonly_context.ReadonlyContext
        ) -> A2uiRequestProcessor:
            """Returns the request processor, calling the provider if one was given.

            Raises:
                TypeError: If the provider returns something else than an
                  `A2uiRequestProcessor`.
            """
            if isinstance(self._processor, A2uiRequestProcessor):
                return self._processor
            processor = self._processor(ctx)
            if inspect.isawaitable(processor):
                processor = await processor
            if not isinstance(processor, A2uiRequestProcessor):
                raise TypeError(
                    f"Tool {self.TOOL_NAME} expects an A2uiRequestProcessor,"
                    f" got {type(processor).__name__}."
                )
            return processor

        async def _resolve_a2ui_state(
            self, ctx: readonly_context.ReadonlyContext
        ) -> RendererState | None:
            """Resolves the optional RendererState for Canvas validation."""
            if self._a2ui_state is None or isinstance(self._a2ui_state, RendererState):
                return self._a2ui_state
            state = self._a2ui_state(ctx)
            if inspect.isawaitable(state):
                state = await state
            if state is not None and not isinstance(state, RendererState):
                raise TypeError(
                    f"Tool {self.TOOL_NAME} expects a RendererState or None,"
                    f" got {type(state).__name__}."
                )
            return state

        def _tool_instruction(self) -> str:
            return (
                f"To show A2UI to the user, call the `{self.TOOL_NAME}` tool and"
                f" pass the A2UI block in its `{self.A2UI_PAYLOAD_ARG_NAME}`"
                " argument instead of writing the block in your reply."
            )

        async def process_llm_request(
            self,
            *,
            tool_context: tool_context.ToolContext,
            llm_request: LlmRequest,
        ) -> None:
            """Adds the A2UI prompt to the system instructions.

            The prompt comes from the inference format's prompt generator: its
            rules, its catalog instructions and its examples. A section that the
            system instructions already hold, as when the agent's instruction
            includes `processor.prompt_snippet`, is not added again.
            """
            await super().process_llm_request(
                tool_context=tool_context, llm_request=llm_request
            )

            processor = await self._resolve_processor(tool_context)
            generator = processor.format.prompt_generator

            rules = generator.generate_base_rules()
            sections: list[tuple[str, str]] = []
            if rules:
                sections.append((rules, f"## Workflow Description:\n{rules}"))
            catalog_instructions = generator.generate_catalog_instructions(
                include_schema=True
            )
            if catalog_instructions:
                sections.append((catalog_instructions, catalog_instructions))
            examples = generator.generate_examples()
            if examples:
                sections.append((examples, f"### Examples:\n{examples}"))
            tool_instruction = self._tool_instruction()
            sections.append((tool_instruction, tool_instruction))

            existing = _instruction_text(llm_request)
            to_append = [text for key, text in sections if key not in existing]
            if to_append:
                llm_request.append_instructions(to_append)
                logger.info(
                    "Added %d A2UI prompt sections to system instructions",
                    len(to_append),
                )

        def _parse_payload(
            self,
            processor: A2uiRequestProcessor,
            payload: str,
            state: RendererState | None,
        ) -> list[dict[str, Any]]:
            """Compiles and validates the tool's argument into A2UI JSON messages.

            The argument is one block in the processor's inference format. It
            may still be wrapped in the format's tags, which are then removed.

            With a state, the messages are checked against it and applied to it,
            all or nothing. Without one, the payload is checked on its own, as
            `validate_payload` does: a surface that the payload only updates
            may have been created by an earlier call.

            Raises:
                A2uiError: If the block cannot be read or the messages are
                  invalid.
            """
            parser = processor.parser
            wrapped = parser.has_format_content(payload, complete=True)
            if state is not None:
                parts = processor.parse_response(payload, wrapped, state=state)
                messages = [
                    message
                    for part in parts
                    if isinstance(part, A2uiPart)
                    for message in part.a2ui
                ]
                if not messages:
                    raise A2uiParseError("The payload holds no A2UI messages.")
                return to_message_dicts(messages)

            blocks = (
                [
                    raw.part.a2ui_raw
                    for raw in parser.unwrap(payload)
                    if isinstance(raw.part, RawA2uiPart)
                ]
                if wrapped
                else [payload]
            )
            compiled: list[Any] = []
            for block in blocks:
                compiled.extend(parser.compile(block))
            message_dicts = to_message_dicts(compiled)
            if not message_dicts:
                raise A2uiParseError("The payload holds no A2UI messages.")
            validate_payload(processor.active_catalogs, message_dicts)
            return message_dicts

        async def run_async(
            self, *, args: dict[str, Any], tool_context: tool_context.ToolContext
        ) -> Any:
            try:
                payload = args.get(self.A2UI_PAYLOAD_ARG_NAME)
                if not payload or not isinstance(payload, str):
                    raise A2uiValidationError(
                        f"Failed to call tool {self.TOOL_NAME} because missing required"
                        f" arg {self.A2UI_PAYLOAD_ARG_NAME}"
                    )

                processor = await self._resolve_processor(tool_context)
                state = await self._resolve_a2ui_state(tool_context)
                messages = self._parse_payload(processor, payload, state)

                logger.info(
                    f"Validated call to tool {self.TOOL_NAME} with"
                    f" {self.A2UI_PAYLOAD_ARG_NAME}"
                )

                # Don't do a second LLM inference call for the JSON response
                tool_context.actions.skip_summarization = True

                # Return the validated A2UI JSON messages so the converter can
                # send them.
                return {self.VALIDATED_A2UI_JSON_KEY: messages}

            except Exception as e:
                err = f"Failed to call A2UI tool {self.TOOL_NAME}: {e}"
                logger.error(err)

                return {self.TOOL_ERROR_KEY: err}


def _instruction_text(llm_request: LlmRequest) -> str:
    """Returns the text of the request's system instructions."""
    config = getattr(llm_request, "config", None)
    instruction = getattr(config, "system_instruction", None)
    if instruction is None:
        return ""
    if isinstance(instruction, str):
        return instruction
    parts = getattr(instruction, "parts", None)
    if parts is None and isinstance(instruction, list):
        parts = instruction
    texts: list[str] = []
    for part in parts or []:
        if isinstance(part, str):
            texts.append(part)
        elif text := getattr(part, "text", None):
            texts.append(text)
    return "\n\n".join(texts)


def _processor_source(
    catalogs: Sequence[CatalogApi] | A2uiCatalogsProvider,
    examples: A2uiExamplesValue | A2uiExamplesProvider,
    format_factory: InferenceFormatFactory,
) -> A2uiRequestProcessor | _A2uiProcessorProvider:
    """Binds the catalogs and examples to the inference format.

    With fixed catalogs and examples, the processor is built once, here, so a
    bad catalog or example fails when the toolset is created. With a provider
    for either, a provider is returned that builds a processor per context.

    Raises:
        A2uiCatalogError: If fixed catalogs are empty or the format rejects them.
        A2uiValidationError: If a fixed example turn fails validation.
        TypeError: If the catalogs or examples are of the wrong type.
    """
    fixed_catalogs = None if callable(catalogs) else _to_catalog_list(catalogs)
    # A collection is read once here, so a generator or a set given directly
    # is not exhausted by the first request.
    fixed_examples = None if callable(examples) else _to_examples(examples)
    if fixed_catalogs is not None and not callable(examples):
        return _build_processor(fixed_catalogs, fixed_examples, format_factory)

    async def provide(ctx: readonly_context.ReadonlyContext) -> A2uiRequestProcessor:
        if fixed_catalogs is not None:
            resolved_catalogs = fixed_catalogs
        else:
            assert callable(catalogs)
            resolved_catalogs = _to_catalog_list(await _call(catalogs, ctx))
        resolved_examples = (
            _to_examples(await _call(examples, ctx))
            if callable(examples)
            else fixed_examples
        )
        return _build_processor(resolved_catalogs, resolved_examples, format_factory)

    return provide


async def _call(provider: Callable[[Any], Any], ctx: Any) -> Any:
    """Calls a sync or async provider."""
    value = provider(ctx)
    if inspect.isawaitable(value):
        value = await value
    return value


def _build_processor(
    catalogs: list[CatalogApi],
    examples: A2uiExamplesValue,
    format_factory: InferenceFormatFactory,
) -> A2uiRequestProcessor:
    """Builds the processor; a markdown string of examples goes to its prompt."""
    if isinstance(examples, str):
        return A2uiRequestProcessor(
            catalogs,
            format_factory=_MarkdownExamplesFormatFactory(format_factory, examples),
        )
    return A2uiRequestProcessor(
        catalogs, examples=examples, format_factory=format_factory
    )


def _to_catalog_list(catalogs: Iterable[CatalogApi]) -> list[CatalogApi]:
    """Checks catalogs and returns them as a list, in their original order.

    Raises:
        A2uiCatalogError: If there are no catalogs.
        TypeError: If a single catalog, a string or bytes is given in place of
          an iterable of catalogs.
    """
    if isinstance(catalogs, (Catalog, str, bytes)):
        raise TypeError(
            f"Tool {A2UI_TOOL_NAME} expects a sequence of A2UI catalogs,"
            f" got {type(catalogs).__name__}."
        )
    catalogs_list = list(catalogs)
    if not catalogs_list:
        raise A2uiCatalogError(
            f"Tool {A2UI_TOOL_NAME} requires at least one A2UI catalog."
        )
    return catalogs_list


def _to_examples(examples: Any) -> A2uiExamplesValue:
    """Checks examples and returns them as a string, turns, or None.

    Returns:
        The string as it is, the example turns as a list of lists in their
        original order, or None when there are no examples.

    Raises:
        TypeError: If the examples are bytes, a single message or turn in place
          of a sequence of turns, or of another type.
    """
    if examples is None or isinstance(examples, str):
        return examples or None
    if _is_iterable_collection(examples):
        turns: list[list[AgentToRendererMessage]] = []
        for turn in examples:
            if not _is_iterable_collection(turn):
                raise TypeError(
                    f"Tool {A2UI_TOOL_NAME} expects each example turn to be a"
                    f" sequence of messages, got {type(turn).__name__}."
                )
            turns.append(list(turn))
        return turns or None
    raise TypeError(
        f"Tool {A2UI_TOOL_NAME} expects examples as a string, a sequence of"
        f" example turns, or None, got {type(examples).__name__}."
    )


def _is_iterable_collection(value: Any) -> bool:
    """Whether a value is a collection of items, not a single item."""
    # A message model iterates over its fields, so it is checked first.
    return isinstance(value, Iterable) and not isinstance(
        value, (str, bytes, Mapping, AgentToRendererMessage)
    )


class _MarkdownExamplesPromptGenerator(PromptGenerator):
    """A format's prompt generator whose examples are a markdown string."""

    def __init__(self, inner: PromptGenerator, examples: str):
        self._inner = inner
        self._examples = examples

    def generate_base_rules(self) -> str:
        return self._inner.generate_base_rules()

    def generate_catalog_instructions(
        self, include_schema: bool = True, catalog: Any | None = None
    ) -> str:
        return self._inner.generate_catalog_instructions(
            include_schema=include_schema, catalog=catalog
        )

    def generate_examples(
        self, catalog: Any | None = None, validate: bool = False
    ) -> str:
        return self._examples

    def generate(self) -> str:
        return super().generate()


class _MarkdownExamplesFormat(InferenceFormat):
    """An inference format whose prompt shows markdown examples.

    Agents written before example turns existed pass their examples as text.
    """

    def __init__(self, inner: InferenceFormat, examples: str):
        self._inner = inner
        self._prompt_generator = _MarkdownExamplesPromptGenerator(
            inner.prompt_generator, examples
        )

    @property
    def prompt_generator(self) -> PromptGenerator:
        return self._prompt_generator

    def create_parser(self) -> Parser:
        return self._inner.create_parser()

    @property
    def supports_streaming(self) -> bool:
        return self._inner.supports_streaming


class _MarkdownExamplesFormatFactory(InferenceFormatFactory):
    """Creates a format whose prompt shows markdown examples."""

    def __init__(self, inner: InferenceFormatFactory, examples: str):
        self._inner = inner
        self._examples = examples

    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> InferenceFormat:
        return _MarkdownExamplesFormat(
            self._inner.create_format(catalogs, examples), self._examples
        )
