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

"""Agent-level generator negotiating A2uiRequestProcessor instances per renderer capabilities."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from a2ui.core import A2uiCatalogError
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import A2uiRendererCapabilities, AgentToRendererMessage
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.utils import RendererState, resolve_catalogs, validate_payload

from .catalog_config import CatalogConfig
from .processor import A2uiRequestProcessor, _ProcessorCacheEntry

__all__ = [
    "A2uiGenerator",
]


class A2uiGenerator:
    """Agent-level generator holding agent-supported catalogs and returning A2uiRequestProcessor instances per request renderer capabilities.

    Attributes:
        catalogs: Master list of CatalogConfig objects supported by the agent.
        examples: Optional list of few-shot example turns shared across sessions.
        factory: Default InferenceFormatFactory used when instantiating processors.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogConfig],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        inference_format_factory: InferenceFormatFactory | None = None,
        *,
        accepts_inline_catalogs: bool = False,
    ):
        """Initializes A2uiGenerator with supported catalog configurations and format factory.

        Args:
            catalogs: List of supported CatalogConfig configurations.
            examples: Optional list of prompt example turns.
            inference_format_factory: Optional default InferenceFormatFactory (defaults to ExpressFormatFactory).
            accepts_inline_catalogs: Whether inline catalogs sent in renderer capabilities become active.
        """
        self.catalogs = list(catalogs)
        self.examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        self.factory: InferenceFormatFactory = (
            inference_format_factory
            if inference_format_factory is not None
            else ExpressFormatFactory()
        )
        self.accepts_inline_catalogs = accepts_inline_catalogs
        self._processor_cache: dict[tuple[Any, ...], _ProcessorCacheEntry] = {}

    def _examples_cache_key(self) -> tuple[tuple[int, ...], ...] | None:
        if self.examples is None:
            return None
        return tuple(tuple(id(m) for m in turn) for turn in self.examples)

    @staticmethod
    def _has_inline_catalogs(
        renderer_capabilities: A2uiRendererCapabilities,
    ) -> bool:
        caps: Any = (
            renderer_capabilities.model_dump(by_alias=True, exclude_none=True)
            if hasattr(renderer_capabilities, "model_dump")
            else renderer_capabilities
        )
        if not isinstance(caps, Mapping):
            return False
        if caps.get("inlineCatalogs"):
            return True
        return any(
            isinstance(v, Mapping) and bool(v.get("inlineCatalogs"))
            for v in caps.values()
        )

    def create_processor(
        self,
        renderer_capabilities: A2uiRendererCapabilities,
        inference_format_factory: InferenceFormatFactory | None = None,
        *,
        state: RendererState | None = None,
    ) -> A2uiRequestProcessor:
        """Creates an A2uiRequestProcessor bound to the specified renderer capabilities.

        Args:
            renderer_capabilities: Capabilities sent by the client renderer. Must not be None:
                a processor is negotiated for one renderer, so a request without capabilities
                is a catalog error here, although resolve_catalogs accepts one.
            inference_format_factory: Optional override format factory for this processor.
            state: The renderer state a canvas agent keeps for the
                conversation, bound to the processor so that its
                `parse_response` and `open_stream` use it.

        Returns:
            Pre-negotiated client-bound A2uiRequestProcessor instance.

        Raises:
            A2uiCatalogError: If renderer_capabilities is None, no catalog can be
                resolved, or `state` holds other catalogs than the resolved ones.
            A2uiValidationError: If renderer_capabilities or prompt examples are invalid.
        """
        if renderer_capabilities is None:
            raise A2uiCatalogError(
                "Renderer capabilities are required to create a request processor."
            )
        active_catalogs = resolve_catalogs(
            self.catalogs,
            renderer_capabilities,
            accepts_inline_catalogs=self.accepts_inline_catalogs,
        )
        factory = (
            inference_format_factory
            if inference_format_factory is not None
            else self.factory
        )
        cache_entry: _ProcessorCacheEntry | None = None
        if not (
            self.accepts_inline_catalogs
            and self._has_inline_catalogs(renderer_capabilities)
        ):
            cache_key = (
                tuple(
                    (
                        c.catalog_id,
                        to_protocol_version(c.protocol_version).value,
                    )
                    for c in active_catalogs
                ),
                tuple(id(cfg.transformed_catalog) for cfg in self.catalogs),
                id(factory),
                self._examples_cache_key(),
            )
            cache_entry = self._processor_cache.get(cache_key)
            if cache_entry is None:
                if self.examples:
                    for turn in self.examples:
                        validate_payload(active_catalogs, turn)
                fmt = factory.create_format(
                    catalogs=active_catalogs,
                    examples=self.examples,
                )
                cache_entry = _ProcessorCacheEntry(fmt, factory)
                self._processor_cache[cache_key] = cache_entry
        return A2uiRequestProcessor(
            catalogs=active_catalogs,
            examples=self.examples,
            format_factory=factory,
            state=state,
            _cache_entry=cache_entry,
        )
