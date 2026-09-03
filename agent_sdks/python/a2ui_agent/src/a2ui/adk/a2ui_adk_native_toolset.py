# Copyright 2026 Google LLC
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

"""Module for the A2uiAdkNativeToolset.

This module provides the `A2uiAdkNativeToolset` which allows ADK agents deployed
on Vertex AI Agent Engine to render A2UI natively by directly writing validated A2UI
JSON payloads into the ADK native event action stream as `UiWidget` instances.
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
    Dict,
    List,
)

from google.adk.agents import readonly_context
from google.adk.models.llm_request import LlmRequest
from google.adk.tools import base_tool
from google.adk.tools import base_toolset
from google.adk.tools import tool_context
from google.adk.utils.feature_decorator import experimental
from google.adk.events.ui_widget import UiWidget
from google.genai import types as genai_types

from a2ui.parser.payload_fixer import parse_and_fix
from a2ui.schema import catalog
from a2ui.core import A2uiValidationError
from a2ui.schema import constants
from a2ui.schema.constants import (
    A2UI_TOOL_ERROR_KEY,
    A2UI_TOOL_NAME,
    A2UI_VALIDATED_JSON_KEY,
)

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
class A2uiAdkNativeToolset(base_toolset.BaseToolset):
    """A native ADK toolset that provides A2UI tools and outputs them directly as ADK UiWidgets."""

    def __init__(
        self,
        a2ui_enabled: Union[bool, A2uiEnabledProvider],
        a2ui_catalog: Union[catalog.A2uiCatalog, A2uiCatalogProvider],
        a2ui_examples: Union[str, A2uiExamplesProvider],
        provider_name: str = "a2ui",
    ):
        super().__init__()
        self._a2ui_enabled = a2ui_enabled
        self._ui_tool = self._SendA2uiJsonToAdkWidgetTool(
            a2ui_catalog, a2ui_examples, provider_name
        )
        self._ui_tools: List[base_tool.BaseTool] = [self._ui_tool]

    async def _resolve_a2ui_enabled(
        self, ctx: readonly_context.ReadonlyContext
    ) -> bool:
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
    ) -> List[base_tool.BaseTool]:
        use_ui = False
        if readonly_context is not None:
            use_ui = await self._resolve_a2ui_enabled(readonly_context)
        if use_ui:
            logger.info("A2UI is ENABLED (ADK Native), adding ui tools")
            return self._ui_tools
        else:
            logger.info("A2UI is DISABLED (ADK Native), not adding ui tools")
            return []

    class _SendA2uiJsonToAdkWidgetTool(base_tool.BaseTool):
        TOOL_NAME = A2UI_TOOL_NAME
        VALIDATED_A2UI_JSON_KEY = A2UI_VALIDATED_JSON_KEY
        A2UI_JSON_ARG_NAME = "a2ui_json"
        TOOL_ERROR_KEY = A2UI_TOOL_ERROR_KEY

        def __init__(
            self,
            a2ui_catalog: Union[catalog.A2uiCatalog, A2uiCatalogProvider],
            a2ui_examples: Union[str, A2uiExamplesProvider],
            provider_name: str,
        ):
            self._a2ui_catalog = a2ui_catalog
            self._a2ui_examples = a2ui_examples
            self._provider_name = provider_name
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

        async def _resolve_a2ui_examples(
            self, ctx: readonly_context.ReadonlyContext
        ) -> str:
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
            logger.info(
                "Added A2UI schema and examples to system instructions (ADK Native)"
            )

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

                a2ui_catalog = await self._resolve_a2ui_catalog(tool_context)
                a2ui_json_payload = parse_and_fix(a2ui_json)
                a2ui_catalog.validator.validate(a2ui_json_payload)

                logger.info(
                    f"Validated call to tool {self.TOOL_NAME} with"
                    f" {self.A2UI_JSON_ARG_NAME} (ADK Native)"
                )

                tool_context.actions.skip_summarization = True

                # Direct writing to ADK native UiWidgets!
                if isinstance(a2ui_json_payload, list):
                    for idx, widget_payload in enumerate(a2ui_json_payload):
                        widget_id = widget_payload.get(
                            "id", f"a2ui-widget-{tool_context.run_id}-{idx}"
                        )
                        ui_widget = UiWidget(
                            id=widget_id,
                            provider=self._provider_name,
                            payload=widget_payload,
                        )
                        tool_context.render_ui_widget(ui_widget)
                else:
                    widget_id = a2ui_json_payload.get(
                        "id", f"a2ui-widget-{tool_context.run_id}"
                    )
                    ui_widget = UiWidget(
                        id=widget_id,
                        provider=self._provider_name,
                        payload=a2ui_json_payload,
                    )
                    tool_context.render_ui_widget(ui_widget)

                # Return the validated JSON for tool response
                return {self.VALIDATED_A2UI_JSON_KEY: a2ui_json_payload}

            except Exception as e:
                err = f"Failed to call A2UI ADK Native tool {self.TOOL_NAME}: {e}"
                logger.error(err)
                return {self.TOOL_ERROR_KEY: err}
