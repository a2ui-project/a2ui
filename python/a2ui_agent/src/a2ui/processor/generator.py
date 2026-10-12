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

from collections.abc import Sequence

from a2ui.core import A2uiCatalogError
from a2ui.core.schema import A2uiRendererCapabilities, AgentToRendererMessage
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.utils import resolve_catalogs

from .catalog_config import CatalogConfig
from .processor import A2uiRequestProcessor

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
            inference_format_factory: Optional default InferenceFormatFactory (defaults to DirectJsonFormatFactory).
            accepts_inline_catalogs: Whether inline catalogs sent in renderer capabilities become active.
        """
        self.catalogs = list(catalogs)
        self.examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        self.factory: InferenceFormatFactory = (
            inference_format_factory
            if inference_format_factory is not None
            else DirectJsonFormatFactory()
        )
        self.accepts_inline_catalogs = accepts_inline_catalogs

    def create_processor(
        self,
        renderer_capabilities: A2uiRendererCapabilities,
        inference_format_factory: InferenceFormatFactory | None = None,
    ) -> A2uiRequestProcessor:
        """Creates an A2uiRequestProcessor bound to the specified renderer capabilities.

        Args:
            renderer_capabilities: Capabilities sent by the client renderer. Must not be None:
                a processor is negotiated for one renderer, so a request without capabilities
                is a catalog error here, although resolve_catalogs accepts one.
            inference_format_factory: Optional override format factory for this processor.

        Returns:
            Pre-negotiated client-bound A2uiRequestProcessor instance.

        Raises:
            A2uiCatalogError: If renderer_capabilities is None or no catalog can be resolved.
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
        return A2uiRequestProcessor(
            catalogs=active_catalogs,
            examples=self.examples,
            format_factory=factory,
        )
