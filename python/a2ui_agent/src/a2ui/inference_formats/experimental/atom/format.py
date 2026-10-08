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

"""Format definition for A2UI Atom (S-Expression AST inference format)."""

from collections.abc import Sequence

from google.adk.utils.feature_decorator import experimental

from a2ui.core import CatalogApi
from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats._shared import check_dsl_catalogs
from a2ui.parser import Parser

from .parser import AtomParser
from .prompt_generator import AtomPromptGenerator


@experimental
class AtomFormat(InferenceFormat):
    """Configures and provides components for the Atom S-expression inference format strategy.

    Atom is a compact, token-efficient S-expression representation for generating
    and parsing A2UI user interfaces.

    Attributes:
        catalogs: The sequence of active catalogs.
        surface_id: The target surface identifier.
        examples_path: The filesystem path to prompt example definitions.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
        examples_path: str | None = None,
    ):
        """Initializes an AtomFormat strategy instance.

        Args:
            catalogs: A sequence of catalogs containing component and function schemas.
            surface_id: The target surface identifier. Defaults to "main".
            examples_path: The filesystem path to prompt example definitions.

        Raises:
            A2uiCatalogError: If no catalog is given, two catalogs share an
                ID, the catalogs target different protocol versions, or there
                are several catalogs and they target a version before v1.0.
        """
        self._catalogs = check_dsl_catalogs(catalogs)
        self.surface_id = surface_id
        self.examples_path = examples_path
        self._prompt_generator: AtomPromptGenerator | None = None

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs, in the order the format received them."""
        return list(self._catalogs)

    @catalogs.setter
    def catalogs(self, value: Sequence[CatalogApi]) -> None:
        self._catalogs = check_dsl_catalogs(value)
        if self._prompt_generator is not None:
            self._prompt_generator.refresh_catalogs()

    @property
    def prompt_generator(self) -> AtomPromptGenerator:
        """The prompt generator instance configured for Atom format."""
        if self._prompt_generator is None:
            self._prompt_generator = AtomPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        """The parser instance configured for Atom format."""
        return AtomParser(self._catalogs, self.surface_id)
