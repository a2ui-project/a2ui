# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""A framework-agnostic tool that renders A2UI from an intent and a payload.

Agent frameworks (MCP servers, ADK, OpenAI and Gemini function calling) all
describe tools with a JSON Schema and call them with a dict of arguments.
`DecisionRenderTool` supplies both halves so an integration does not have to
write the schema, decode stringified payloads, or bridge sync and async
itself::

    tool = DecisionRenderTool.from_env(catalogs)
    declaration = {"name": tool.name, "description": tool.description,
                   "parameters": tool.parameters_json_schema()}
    output = await tool.run_async(call_arguments)
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from a2ui.core import CatalogApi

from .backends import DecisionBackend
from .catalog_graph import CatalogDecisionGraph
from .decision_block import DecisionBlock
from .models import SynthesisConfig, SynthesisOutput
from .synthesizer import DecisionSynthesizer, FallbackCallback
from .template_registry import TemplateRegistry

_DEFAULT_TOOL_NAME = "render_a2ui_decision"
_DEFAULT_DESCRIPTION = (
    "Renders a user interface from a short description of what to show"
    " (intent) and the data to show (payload). A local decision model picks"
    " the components; do not describe components yourself."
)


class DecisionRenderTool:
    """Tool declaration plus runner for decision-model UI synthesis.

    Attributes:
        name: Tool name advertised to the model.
        description: Tool description advertised to the model.
        synthesizer: The synthesizer that renders each call.
    """

    def __init__(
        self,
        synthesizer: DecisionSynthesizer,
        *,
        name: str = _DEFAULT_TOOL_NAME,
        description: str = _DEFAULT_DESCRIPTION,
        surface_id: str | None = None,
    ) -> None:
        """Wraps a synthesizer as a tool.

        Args:
            synthesizer: Renders each tool call.
            name: Tool name advertised to the model.
            description: Tool description advertised to the model.
            surface_id: Surface used when a call names none; None defers to
                the synthesizer's `config.default_surface_id`.
        """
        self.name = name
        self.description = description
        self.synthesizer = synthesizer
        self._surface_id = surface_id

    @classmethod
    def from_env(
        cls,
        catalogs: Sequence[CatalogApi] | CatalogDecisionGraph,
        *,
        backend: DecisionBackend | None = None,
        config: SynthesisConfig | None = None,
        registry: TemplateRegistry | None = None,
        fallback_card: bool = True,
        fallback_fn: FallbackCallback | None = None,
        name: str = _DEFAULT_TOOL_NAME,
        description: str = _DEFAULT_DESCRIPTION,
        surface_id: str | None = None,
    ) -> DecisionRenderTool:
        """Builds a tool and its synthesizer in one call.

        `fallback_card` defaults to True: a tool call that renders nothing is
        an error from the model's point of view, so an abstention renders a
        deterministic card unless the call supplied `fallbackDsl`.
        """
        synthesizer = DecisionSynthesizer(
            catalogs,
            backend,
            registry=registry,
            config=config,
            fallback_card=fallback_card,
            fallback_fn=fallback_fn,
        )
        return cls(
            synthesizer, name=name, description=description, surface_id=surface_id
        )

    def parameters_json_schema(self) -> dict[str, Any]:
        """Returns the JSON Schema for the tool's arguments.

        `payload` accepts an object, an array, or a JSON-encoded string of
        either, since models often stringify nested arguments.
        """
        template_ids = [
            t.template_id for t in self.synthesizer.registry.list_templates()
        ]
        template_schema: dict[str, Any] = {
            "type": "string",
            "description": "Id of a registered surface template to render directly.",
        }
        if template_ids:
            template_schema["enum"] = template_ids
        return {
            "type": "object",
            "properties": {
                "intent": {
                    "type": "string",
                    "description": (
                        "Short natural-language description of the interface to"
                        " render and how the user should interact with it."
                    ),
                },
                "payload": {
                    "description": (
                        "The data to display: a JSON object (preferred) or array,"
                        " or a JSON-encoded string of either. Use descriptive"
                        " camelCase keys."
                    ),
                    "anyOf": [
                        {"type": "object"},
                        {"type": "array"},
                        {"type": "string"},
                    ],
                },
                "surfaceId": {
                    "type": "string",
                    "description": "Surface to create or update.",
                },
                "template": template_schema,
                "fallbackDsl": {
                    "type": "string",
                    "description": (
                        "A2UI Express rendered if the decision model is not"
                        " confident enough to choose components."
                    ),
                },
            },
            "required": ["intent", "payload"],
            "additionalProperties": False,
        }

    def _synthesis_kwargs(
        self, args: Mapping[str, Any]
    ) -> tuple[DecisionBlock, dict[str, Any]]:
        block = DecisionBlock.from_mapping(args)
        kwargs: dict[str, Any] = {
            "template_id": block.template_id,
            "fallback_dsl": block.fallback_dsl,
        }
        surface_id = block.surface_id or self._surface_id
        if surface_id is not None:
            kwargs["surface_id"] = surface_id
        return block, kwargs

    async def run_async(self, args: Mapping[str, Any]) -> SynthesisOutput:
        """Renders one tool call.

        Args:
            args: The tool-call arguments, with the field names from
                `parameters_json_schema` (snake_case spellings are accepted).

        Raises:
            ValueError: If `intent` is missing, `payload` is an invalid JSON
                string, or `template` is unknown.
            TypeError: If `payload` is neither an object nor an array.
        """
        block, kwargs = self._synthesis_kwargs(args)
        return await self.synthesizer.synthesize(block.intent, block.payload, **kwargs)

    def run_sync(self, args: Mapping[str, Any]) -> SynthesisOutput:
        """Renders one tool call from synchronous code. See `run_async`."""
        block, kwargs = self._synthesis_kwargs(args)
        return self.synthesizer.synthesize_sync(block.intent, block.payload, **kwargs)


__all__ = ["DecisionRenderTool"]
