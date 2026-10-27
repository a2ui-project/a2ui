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
  * `SendA2uiToClientToolset`: The main entry point. It takes whether A2UI is enabled and the
    `A2uiRequestProcessor` for the request, or providers that return them per context. It manages
    the lifecycle of the `_SendA2uiJsonToClientTool`.
  * `_SendA2uiJsonToClientTool`: A tool exposed to the LLM. The processor holds everything the tool
    needs: the catalogs, the example turns, the inference format, and the renderer state bound to
    it, if any. The tool adds the processor's prompt to the system instructions. The LLM writes the
    A2UI block in the tool's argument, in the processor's format. The tool compiles the block into
    A2UI messages, validates them against the catalogs (and the bound renderer state), and returns
    the A2UI JSON messages for the part converter to send.

Usage Examples:

  1. A processor per request, which the agent's executor puts in an
     `A2uiProcessorStore`:

    ```python
    processors = A2uiProcessorStore()
    toolset = SendA2uiToClientToolset(
        a2ui_enabled=processors.is_enabled,
        a2ui_processor=processors.get,
    )
    ```

  2. One processor for every request, such as for fixed catalogs. It must not
     have a renderer state bound to it, since every conversation would share it:

    ```python
    processor = A2uiRequestProcessor([MY_CATALOG], examples=MY_EXAMPLE_TURNS)
    toolset = SendA2uiToClientToolset(a2ui_enabled=True, a2ui_processor=processor)
    ```
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
import inspect
import logging
from typing import (
    TYPE_CHECKING,
    Any,
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
from a2ui.core import A2uiParseError, A2uiValidationError
from a2ui.inference_formats import to_message_dicts
from a2ui.parser import A2uiPart, RawA2uiPart, RawResponsePart
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import validate_payload

if TYPE_CHECKING:
    from a2ui.adk.a2a import A2uiPartConverter

logger = logging.getLogger(__name__)

A2uiEnabledProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext], bool | Awaitable[bool]
]
A2uiProcessorProvider: TypeAlias = Callable[
    [readonly_context.ReadonlyContext],
    A2uiRequestProcessor | None | Awaitable[A2uiRequestProcessor | None],
]


@experimental
class SendA2uiToClientToolset(base_toolset.BaseToolset):
    """A toolset that provides A2UI Tools and can be enabled/disabled."""

    def __init__(
        self,
        a2ui_enabled: bool | A2uiEnabledProvider,
        a2ui_processor: A2uiRequestProcessor | A2uiProcessorProvider,
    ):
        """Initializes the toolset.

        Args:
            a2ui_enabled: Whether A2UI is enabled, or a provider that decides it
              per context.
            a2ui_processor: The request processor for the client's catalogs, or
              a provider that returns it per context, such as
              `A2uiProcessorStore.get`. The processor's inference format,
              catalogs and example turns make the prompt, and the tool's
              argument is read in its format. A canvas agent binds the
              conversation's `RendererState` to the processor, so each payload
              is checked against the state and, if it passes, applied to it.
              Don't keep the processor in session state: ADK's session services
              save state as JSON, which a processor can't be written as, and
              copy it each time they load a session, so a bound state would not
              keep one turn's changes for the next. A processor given for every
              request must not have a state bound to it, since every
              conversation would share that state.
        """
        super().__init__()
        if (
            isinstance(a2ui_processor, A2uiRequestProcessor)
            and a2ui_processor.state is not None
        ):
            logger.warning(
                "SendA2uiToClientToolset got one processor for every request,"
                " with a RendererState bound to it: every conversation shares"
                " that state. Pass a provider that returns each conversation's"
                " processor instead."
            )
        self._a2ui_enabled = a2ui_enabled
        self._ui_tool = self._SendA2uiJsonToClientTool(a2ui_processor)
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
    ) -> A2uiPartConverter:
        """Returns an A2uiPartConverter for the context's processor.

        The converter reads text-based A2UI with the processor's inference
        format, so text and tool calls use the same format.

        Args:
            ctx: The readonly_context.ReadonlyContext to resolve the processor with.

        Returns:
            A configured A2uiPartConverter.

        Raises:
            ImportError: If the `a2a` extra (`pip install "a2ui-adk[a2a]"`) is
              not installed.
        """
        # Through the package facade, so a missing extra raises the ImportError
        # that names the install command.
        from a2ui.adk import A2uiPartConverter

        return A2uiPartConverter(await self._ui_tool._resolve_processor(ctx))

    class _SendA2uiJsonToClientTool(base_tool.BaseTool):
        TOOL_NAME = A2UI_TOOL_NAME
        VALIDATED_A2UI_JSON_KEY = A2UI_VALIDATED_JSON_KEY
        A2UI_PAYLOAD_ARG_NAME = "a2ui_payload"
        TOOL_ERROR_KEY = A2UI_TOOL_ERROR_KEY

        def __init__(self, processor: A2uiRequestProcessor | A2uiProcessorProvider):
            """Initializes the tool.

            Args:
                processor: The request processor that writes the prompt and
                  reads the tool's argument, or a provider that returns one per
                  context.
            """
            self._processor = processor
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
                  `A2uiRequestProcessor`, such as None when the context has no
                  processor.
            """
            if isinstance(self._processor, A2uiRequestProcessor):
                return self._processor
            processor = self._processor(ctx)
            if inspect.isawaitable(processor):
                processor = await processor
            if not isinstance(processor, A2uiRequestProcessor):
                hint = (
                    " A2UI is enabled for a context that has no processor."
                    if processor is None
                    else ""
                )
                raise TypeError(
                    f"Tool {self.TOOL_NAME} expects an A2uiRequestProcessor,"
                    f" got {type(processor).__name__}.{hint}"
                )
            return processor

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
            self, processor: A2uiRequestProcessor, payload: str
        ) -> list[dict[str, Any]]:
            """Compiles and validates the tool's argument into A2UI JSON messages.

            The argument is one block in the processor's inference format. It
            may still be in the format's tags, which are then removed, even if
            the closing tag is missing: the argument is complete either way.

            With a renderer state bound to the processor, the messages are
            checked against it and applied to it, all or nothing. Without one,
            the payload is checked on its own, as `validate_payload` does: a
            surface that the payload only updates may have been created by an
            earlier call.

            Raises:
                A2uiError: If the block cannot be read or the messages are
                  invalid.
            """
            parser = processor.parser
            blocks = (
                [
                    raw.part.a2ui_raw
                    for raw in parser.unwrap(payload)
                    if isinstance(raw.part, RawA2uiPart)
                ]
                if parser.has_format_content(payload)
                else [payload]
            )
            if processor.state is not None:
                # Rewrap the blocks with closing tags, so each one is read as
                # complete and the surfaces they touch are checked.
                closed = parser.wrap([
                    RawResponsePart(part=RawA2uiPart(a2ui_raw=block), is_final=True)
                    for block in blocks
                ])
                parts = processor.parse_response(closed)
                messages = [
                    message
                    for part in parts
                    if isinstance(part, A2uiPart)
                    for message in part.a2ui
                ]
                if not messages:
                    raise A2uiParseError("The payload holds no A2UI messages.")
                return to_message_dicts(messages)

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
                messages = self._parse_payload(processor, payload)

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
                # The error may quote the payload, so its text goes back to the
                # LLM but is only logged at debug level.
                logger.error(
                    "Failed to call A2UI tool %s: %s", self.TOOL_NAME, type(e).__name__
                )
                logger.debug(err)

                return {self.TOOL_ERROR_KEY: err}


def _instruction_text(llm_request: LlmRequest) -> str:
    """Returns the text of the request's system instructions.

    ADK keeps the instruction as a string, but `GenerateContentConfig` also
    allows a `Content`, a part or a list of them. Only text is read; anything
    else is skipped.
    """
    config = getattr(llm_request, "config", None)
    instruction = getattr(config, "system_instruction", None)
    if isinstance(instruction, str):
        return instruction
    parts = instruction if isinstance(instruction, list) else None
    if parts is None:
        content_parts = getattr(instruction, "parts", None)
        parts = content_parts if isinstance(content_parts, list) else [instruction]
    texts = [
        part if isinstance(part, str) else getattr(part, "text", None) for part in parts
    ]
    return "\n\n".join(text for text in texts if isinstance(text, str) and text)
