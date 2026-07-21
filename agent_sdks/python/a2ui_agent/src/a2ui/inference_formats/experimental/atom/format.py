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

"""Format definition for A2UI Atom (S-Expression AST inference format)."""

from typing import Optional
from a2ui.schema.catalog import A2uiCatalog
from a2ui.inference_format import InferenceFormat
from a2ui.parser.parser import Parser

try:
    from google.adk.utils.feature_decorator import experimental
except ImportError:

    def experimental(cls):
        return cls


from .prompt_generator import AtomPromptGenerator
from .parser import AtomParser


@experimental
class AtomFormat(InferenceFormat):
    """Configures and provides components for the Atom S-expression inference format strategy.

    Atom is a compact, token-efficient S-expression representation for generating
    and parsing A2UI user interfaces.

    Attributes:
        catalog: The catalog containing component and function schemas.
        surface_id: The target surface identifier.
        examples_path: The filesystem path to prompt example definitions.
    """

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
        examples_path: Optional[str] = None,
    ):
        """Initializes an AtomFormat strategy instance.

        Args:
            catalog: The catalog containing component and function schemas.
            surface_id: The target surface identifier. Defaults to "main".
            examples_path: The filesystem path to prompt example definitions.
        """
        self.catalog = catalog
        self.surface_id = surface_id
        self.examples_path = examples_path
        self._prompt_generator: Optional[AtomPromptGenerator] = None
        self._parser: Optional[AtomParser] = None

    def _ensure_catalog(self) -> None:
        """Ensures a valid catalog is set."""
        if not self.catalog:
            raise ValueError(
                "Catalog is required for parsing and decompiling in atom format."
            )

    @property
    def prompt_generator(self) -> AtomPromptGenerator:
        """The prompt generator instance configured for Atom format."""
        if self._prompt_generator is None:
            self._ensure_catalog()
            self._prompt_generator = AtomPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        """The parser instance configured for Atom format."""
        if self._parser is None:
            self._ensure_catalog()
            self._parser = AtomParser(self.catalog, self.surface_id)
        return self._parser
