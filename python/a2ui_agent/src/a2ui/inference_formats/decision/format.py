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
from typing import Any

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats._shared import check_mixed_catalogs

from .archetypes import ArchetypeGrammar
from .backends import DecisionBackend, create_decision_backend
from .batching import BatchingDecisionBackend
from .catalog_graph import CatalogDecisionGraph
from .models import SynthesisConfig
from .parser import DecisionParser
from .patterns import MergedPatternLibrary, PatternLibrary
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
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
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
            archetypes: Layout archetype grammar; defaults to
                `ArchetypeGrammar.default()`.
            patterns: Catalog pattern library; defaults to
                `MergedPatternLibrary.for_catalogs(catalogs)`.
            surface_id: Surface used when a block names none. A block's own
                `surfaceId` wins; `SynthesisConfig.default_surface_id` is not
                consulted on this path.
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
            archetypes=archetypes,
            patterns=patterns,
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
                self._catalogs,
                examples=self._examples,
                registry=self._registry,
                archetypes=self._synthesizer.archetypes,
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
    """Factory for `DecisionFormat` instances, for `A2uiRequestProcessor`.

    One backend is shared by every format the factory creates, because a
    backend may hold a loaded model or an HTTP connection pool and
    `A2uiGenerator` creates a format per renderer request. The catalog graph
    is still built per format, since catalogs are negotiated per renderer.
    """

    def __init__(
        self,
        *,
        backend: DecisionBackend | None = None,
        config: SynthesisConfig | None = None,
        registry: TemplateRegistry | None = None,
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
        batch_backend: bool = True,
        surface_id: str = "main",
        fallback_card: bool = True,
        fallback_fn: FallbackCallback | None = None,
    ) -> None:
        """Stores the settings every created format shares. See `DecisionFormat`.

        Args:
            backend: The shared decision backend. When None, it is created
                with `create_decision_backend()` on the first `create_format`
                call and reused afterwards.
            config: See `DecisionFormat`.
            registry: See `DecisionFormat`.
            archetypes: See `DecisionFormat`.
            patterns: See `DecisionFormat`. When None, built once per catalog
                set via `MergedPatternLibrary.for_catalogs`.
            batch_backend: When True (default), wraps the shared backend in
                `BatchingDecisionBackend` with `config.max_pairs` as its
                per-call budget.
            surface_id: See `DecisionFormat`.
            fallback_card: See `DecisionFormat`.
            fallback_fn: See `DecisionFormat`.
        """
        self._raw_backend = backend
        self._backend: DecisionBackend | None = None
        self._config = config
        self._batch_backend = batch_backend
        if backend is not None:
            self._backend = self._wrap_backend(backend)
        self._registry = registry
        self._archetypes = archetypes
        self._patterns = patterns
        self._pattern_cache: dict[
            tuple[str, ...], PatternLibrary | MergedPatternLibrary
        ] = {}
        self._surface_id = surface_id
        self._fallback_card = fallback_card
        self._fallback_fn = fallback_fn

    @property
    def backend(self) -> DecisionBackend | None:
        """The shared backend, or None until the first format is created."""
        return self._backend

    def _wrap_backend(self, raw: DecisionBackend) -> DecisionBackend:
        """Wraps `raw` in `BatchingDecisionBackend` when `batch_backend` is on."""
        if not self._batch_backend or isinstance(raw, BatchingDecisionBackend):
            return raw
        budget = (self._config or SynthesisConfig()).max_pairs
        return BatchingDecisionBackend(raw, max_pairs=budget)

    def _shared_backend(self) -> DecisionBackend:
        """Returns the backend every created format shares, building it on first use."""
        if self._backend is None:
            raw = (
                self._raw_backend
                if self._raw_backend is not None
                else create_decision_backend()
            )
            self._backend = self._wrap_backend(raw)
        return self._backend

    def _patterns_for_catalogs(
        self, catalogs: Sequence[CatalogApi]
    ) -> PatternLibrary | MergedPatternLibrary:
        """Returns the cached `PatternLibrary` for `catalogs`."""
        if self._patterns is not None:
            return self._patterns
        key = tuple(c.catalog_id for c in catalogs)
        if key not in self._pattern_cache:
            self._pattern_cache[key] = MergedPatternLibrary.for_catalogs(catalogs)
        return self._pattern_cache[key]

    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> DecisionFormat:
        return DecisionFormat(
            catalogs,
            examples=examples,
            backend=self._shared_backend(),
            config=self._config,
            registry=self._registry,
            archetypes=self._archetypes,
            patterns=self._patterns_for_catalogs(catalogs),
            surface_id=self._surface_id,
            fallback_card=self._fallback_card,
            fallback_fn=self._fallback_fn,
        )

    async def aclose(self) -> None:
        """Closes the shared decision backend if one has been initialized."""
        if self._backend is not None:
            await self._backend.aclose()

    async def __aenter__(self) -> DecisionFormatFactory:
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.aclose()


__all__ = ["DecisionFormat", "DecisionFormatFactory"]
