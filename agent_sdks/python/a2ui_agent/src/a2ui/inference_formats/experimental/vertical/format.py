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

"""Vertical inference format implementation for A2UI."""

from typing import Optional
from a2ui.schema.catalog import A2uiCatalog
from a2ui.inference_format import InferenceFormat
from a2ui.parser.parser import Parser

try:
    from google.adk.utils.feature_decorator import experimental
except ImportError:

    def experimental(cls):
        return cls


from .prompt_generator import VerticalPromptGenerator
from .parser import VerticalParser


@experimental
class VerticalFormat(InferenceFormat):
    """Concrete strategy for Vertical inference format representation.

    The Vertical format targets simple, direct UI generation where an agent
    emits a single component or a non-nested vertical list of components.
    Components requiring children are excluded from the prompt catalog rules,
    and multiple root components are automatically nested into a vertical container
    (e.g., Column or List) by the compiler.
    """

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
        examples_path: Optional[str] = None,
        version: str = "v0.9.1",
    ):
        """Initializes the Vertical inference format.

        Args:
            catalog: The component catalog containing valid elements.
            surface_id: The surface identifier for layout targeting (default: "main").
            examples_path: Optional path to markdown files containing examples.
            version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
        """
        self.catalog = catalog
        self.surface_id = surface_id
        self.examples_path = examples_path
        self.version = version
        self._prompt_generator: Optional[VerticalPromptGenerator] = None

    def _ensure_catalog(self) -> None:
        """Ensures a valid catalog is set, raising ValueError otherwise."""
        if not self.catalog:
            raise ValueError(
                "Catalog is required for parsing and decompiling in vertical format."
            )

    @property
    def prompt_generator(self) -> VerticalPromptGenerator:
        """The prompt generator instance configured for this Vertical format."""
        if self._prompt_generator is None:
            self._ensure_catalog()
            self._prompt_generator = VerticalPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        """The parser instance configured for this Vertical format."""
        self._ensure_catalog()
        return VerticalParser(self.catalog, self.surface_id, version=self.version)

    def generate_system_prompt(self, *args, **kwargs) -> str:
        """Convenience method delegating to prompt_generator.generate."""
        return self.prompt_generator.generate(*args, **kwargs)
