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
        catalogs=catalogs,
        format_factory=DecisionFormatFactory(backend=create_decision_backend()),
    )
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Sequence
import threading
from typing import TYPE_CHECKING, Any
import warnings

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats._shared import check_mixed_catalogs

from .archetypes import ArchetypeGrammar
from .backends import DecisionBackend
from .catalog_graph import CatalogDecisionGraph
from .decision_block import DecisionBlock
from .models import SynthesisConfig
from .parser import DecisionParser
from .patterns import MergedPatternLibrary, PatternLibrary
from .prompt_generator import DecisionPromptGenerator
from .synthesizer import DecisionSynthesizer, FallbackCallback
from .template_registry import TemplateRegistry

if TYPE_CHECKING:
    from a2ui.utils import RendererState


def _warn_message_examples(
    examples: Sequence[Sequence[AgentToRendererMessage]] | None,
) -> None:
    """Warns that A2UI message examples are ignored by the decision format."""
    if examples:
        warnings.warn(
            "DecisionFormat ignores A2UI message examples; pass block_examples"
            " (DecisionBlock instances) instead.",
            UserWarning,
            stacklevel=3,
        )


class DecisionFormat(InferenceFormat):
    """Inference format in which the model emits intent and data, not UI.

    The prompt generator asks for `<a2ui>` decision blocks and the parser
    renders them through a `DecisionSynthesizer`. The catalog graph and
    synthesizer are built once per format and shared by every parser it
    creates.

    Renderer state: a caller that binds a `RendererState` passes it on each
    call as usual. Without one, `create_parser(conversation_id=...)` gives a
    parser backed by one `RendererState` per conversation id, kept by this
    format, so a block can update a surface an earlier turn created.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        *,
        backend: DecisionBackend,
        config: SynthesisConfig | None = None,
        registry: TemplateRegistry | None = None,
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
        surface_id: str = "main",
        fallback_fn: FallbackCallback | None = None,
        block_examples: Sequence[DecisionBlock] = (),
        max_conversations: int = 256,
    ) -> None:
        """Creates a decision format.

        Args:
            catalogs: The active catalogs; every one must target A2UI v1.0.
            examples: A2UI message examples. Ignored with a `UserWarning`:
                decompiled messages lose the intent and actions a decision
                block carries. Use `block_examples`.
            backend: Decision backend. Required; build one with
                `create_decision_backend()` to read the environment.
            config: Synthesis thresholds and limits.
            registry: Surface templates the model may choose for matching
                payloads.
            archetypes: Layout archetype grammar; defaults to
                `ArchetypeGrammar.default()`.
            patterns: Catalog pattern library; defaults to
                `MergedPatternLibrary.for_catalogs(catalogs)`.
            surface_id: Surface used when a block names none. A block's own
                `surfaceId` wins; `SynthesisConfig.default_surface_id` is not
                consulted on this path.
            fallback_fn: Custom fallback called when the model abstains and
                the block carries no `fallbackDsl`.
            block_examples: Few-shot decision blocks for the prompt.
            max_conversations: Maximum number of conversation `RendererState`
                entries retained in the LRU cache. Defaults to 256.

        Raises:
            TypeError: If `backend` is None.
            ValueError: If any catalog's protocol version is not v1.0, or if
                `max_conversations` is less than 1.
        """
        if max_conversations < 1:
            raise ValueError(
                f"max_conversations must be >= 1, got {max_conversations}."
            )
        _warn_message_examples(examples)
        self._catalogs = list(check_mixed_catalogs(catalogs))
        self._block_examples = tuple(block_examples)
        self._registry = registry if registry is not None else TemplateRegistry()
        self.surface_id = surface_id
        self._max_conversations = int(max_conversations)
        self._synthesizer = DecisionSynthesizer(
            CatalogDecisionGraph(self._catalogs),
            backend,
            registry=self._registry,
            config=config,
            archetypes=archetypes,
            patterns=patterns,
            fallback_fn=fallback_fn,
        )
        self._prompt_generator: DecisionPromptGenerator | None = None
        self._conversation_states: OrderedDict[str, RendererState] = OrderedDict()
        self._states_lock = threading.Lock()

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs, in the order the format received them."""
        return list(self._catalogs)

    @property
    def block_examples(self) -> tuple[DecisionBlock, ...]:
        """The few-shot decision blocks configured for the prompt."""
        return self._block_examples

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
                block_examples=self._block_examples,
                archetypes=self._synthesizer.archetypes,
            )
        return self._prompt_generator

    def state_for(self, conversation_id: str) -> RendererState:
        """Returns the `RendererState` this format keeps for `conversation_id`.

        Created empty on first use and retained in a bounded LRU cache capped
        at `max_conversations` entries.

        Args:
            conversation_id: Identifier of the conversation to look up.

        Returns:
            The `RendererState` associated with `conversation_id`.
        """
        from a2ui.utils import RendererState

        with self._states_lock:
            state = self._conversation_states.get(conversation_id)
            if state is None:
                state = RendererState(self._catalogs)
                self._conversation_states[conversation_id] = state
            else:
                self._conversation_states.move_to_end(conversation_id)
            while len(self._conversation_states) > self._max_conversations:
                self._conversation_states.popitem(last=False)
            return state

    def clear_conversation(self, conversation_id: str) -> None:
        """Removes the stored `RendererState` for `conversation_id`, if present.

        Args:
            conversation_id: Identifier of the conversation to evict.
        """
        with self._states_lock:
            self._conversation_states.pop(conversation_id, None)

    def create_parser(self, *, conversation_id: str | None = None) -> DecisionParser:
        """Creates a parser that renders blocks through the shared synthesizer.

        Args:
            conversation_id: When given, calls that pass no state use the
                state this format keeps for the conversation (`state_for`).
        """
        return DecisionParser(
            self._synthesizer,
            surface_id=self.surface_id,
            conversation_state=(
                self.state_for(conversation_id) if conversation_id is not None else None
            ),
        )

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
        backend: DecisionBackend,
        config: SynthesisConfig | None = None,
        registry: TemplateRegistry | None = None,
        archetypes: ArchetypeGrammar | None = None,
        patterns: PatternLibrary | MergedPatternLibrary | None = None,
        surface_id: str = "main",
        fallback_fn: FallbackCallback | None = None,
        block_examples: Sequence[DecisionBlock] = (),
    ) -> None:
        """Stores the settings every created format shares. See `DecisionFormat`.

        Args:
            backend: The shared decision backend. Required; build one with
                `create_decision_backend()` to read the environment.
            config: See `DecisionFormat`.
            registry: See `DecisionFormat`.
            archetypes: See `DecisionFormat`.
            patterns: See `DecisionFormat`. When None, built once per catalog
                set via `MergedPatternLibrary.for_catalogs`.
            surface_id: See `DecisionFormat`.
            fallback_fn: See `DecisionFormat`.
            block_examples: See `DecisionFormat`.

        Raises:
            TypeError: If `backend` is None.
        """
        if backend is None:
            raise TypeError(
                "DecisionFormatFactory requires a decision backend; pass"
                " backend=create_decision_backend() to read the environment."
            )
        self._backend: DecisionBackend = backend
        self._config = config
        self._registry = registry
        self._archetypes = archetypes
        self._patterns = patterns
        self._pattern_cache: dict[
            tuple[str, ...], PatternLibrary | MergedPatternLibrary
        ] = {}
        self._surface_id = surface_id
        self._fallback_fn = fallback_fn
        self._block_examples = tuple(block_examples)

    @property
    def backend(self) -> DecisionBackend:
        """The backend every created format shares."""
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
        """Creates a format for `catalogs`; message `examples` are ignored with a warning."""
        _warn_message_examples(examples)
        return DecisionFormat(
            catalogs,
            backend=self._backend,
            config=self._config,
            registry=self._registry,
            archetypes=self._archetypes,
            patterns=self._patterns_for_catalogs(catalogs),
            surface_id=self._surface_id,
            fallback_fn=self._fallback_fn,
            block_examples=self._block_examples,
        )

    async def aclose(self) -> None:
        """Closes the shared decision backend."""
        await self._backend.aclose()

    async def __aenter__(self) -> DecisionFormatFactory:
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.aclose()


__all__ = ["DecisionFormat", "DecisionFormatFactory"]
