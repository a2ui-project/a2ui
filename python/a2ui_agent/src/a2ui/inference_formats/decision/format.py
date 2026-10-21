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

"""Decision inference format for `A2uiRequestProcessor`.

Plugs local decision-model synthesis into the processor pipeline the same way
`ExpressFormatFactory` and `DirectJsonFormatFactory` do::

    processor = A2uiRequestProcessor(
        catalogs=catalogs, format_factory=DecisionFormatFactory()
    )
"""

from __future__ import annotations

from collections.abc import Sequence

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats._shared import check_mixed_catalogs

from .backends import DecisionBackend
from .catalog_graph import CatalogDecisionGraph
from .models import SynthesisConfig
from .parser import DecisionParser
from .prompt_generator import DecisionPromptGenerator
from .synthesizer import DecisionSynthesizer, FallbackCallback
from .template_registry import TemplateRegistry


class DecisionFormat(InferenceFormat):
    """Inference format in which the model emits intent and data, not UI.

    The prompt generator asks for `<a2ui>` decision blocks and the parser
    renders them through a `DecisionSynthesizer`. The catalog graph and
    synthesizer are built once per format and shared by every parser it
    creates.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        *,
        backend: DecisionBackend | None = None,
        config: SynthesisConfig | None = None,
        registry: TemplateRegistry | None = None,
        surface_id: str = "main",
        fallback_card: bool = True,
        fallback_fn: FallbackCallback | None = None,
    ) -> None:
        """Creates a decision format.

        Args:
            catalogs: The active catalogs.
            examples: Few-shot example turns shown in the prompt.
            backend: Decision backend; defaults to `create_decision_backend()`.
            config: Synthesis thresholds and limits.
            registry: Surface templates offered in the prompt and tried first.
            surface_id: Surface used when a block names none.
            fallback_card: Render a deterministic card when the model abstains
                and the block carries no `fallbackDsl`. Defaults to True here,
                unlike `DecisionSynthesizer`, because inside a parser an
                abstention with no messages is a compilation error.
            fallback_fn: Custom fallback called before the card.
        """
        self._catalogs = list(check_mixed_catalogs(catalogs))
        self._examples = [list(t) for t in examples] if examples is not None else None
        self._registry = registry if registry is not None else TemplateRegistry()
        self.surface_id = surface_id
        self._synthesizer = DecisionSynthesizer(
            CatalogDecisionGraph(self._catalogs),
            backend,
            registry=self._registry,
            config=config,
            fallback_card=fallback_card,
            fallback_fn=fallback_fn,
        )
        self._prompt_generator: DecisionPromptGenerator | None = None

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs, in the order the format received them."""
        return list(self._catalogs)

    @property
    def examples(self) -> list[list[AgentToRendererMessage]] | None:
        """The configured few-shot example turns, if any."""
        return [list(t) for t in self._examples] if self._examples is not None else None

    @property
    def synthesizer(self) -> DecisionSynthesizer:
        """The synthesizer shared by every parser this format creates."""
        return self._synthesizer

    @property
    def prompt_generator(self) -> DecisionPromptGenerator:
        """The prompt generator configured for this format."""
        if self._prompt_generator is None:
            self._prompt_generator = DecisionPromptGenerator(
                self._catalogs, examples=self._examples, registry=self._registry
            )
        return self._prompt_generator

    def create_parser(self) -> DecisionParser:
        """Creates a parser that renders blocks through the shared synthesizer."""
        return DecisionParser(self._synthesizer, surface_id=self.surface_id)

    @property
    def parser(self) -> DecisionParser:
        """A parser configured for this format."""
        return self.create_parser()


class DecisionFormatFactory(InferenceFormatFactory):
    """Factory for `DecisionFormat` instances, for `A2uiRequestProcessor`."""

    def __init__(
        self,
        *,
        backend: DecisionBackend | None = None,
        config: SynthesisConfig | None = None,
        registry: TemplateRegistry | None = None,
        surface_id: str = "main",
        fallback_card: bool = True,
        fallback_fn: FallbackCallback | None = None,
    ) -> None:
        """Stores the settings every created format shares. See `DecisionFormat`."""
        self._backend = backend
        self._config = config
        self._registry = registry
        self._surface_id = surface_id
        self._fallback_card = fallback_card
        self._fallback_fn = fallback_fn

    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> DecisionFormat:
        return DecisionFormat(
            catalogs,
            examples=examples,
            backend=self._backend,
            config=self._config,
            registry=self._registry,
            surface_id=self._surface_id,
            fallback_card=self._fallback_card,
            fallback_fn=self._fallback_fn,
        )


__all__ = ["DecisionFormat", "DecisionFormatFactory"]
