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

from collections.abc import Sequence

from google.adk.utils.feature_decorator import experimental

from a2ui.core import CatalogApi
from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats._shared import (
    catalogs_protocol_version,
    check_dsl_catalogs,
)
from a2ui.parser import Parser

from .parser import ExpressParser
from .prompt_generator import ExpressPromptGenerator


@experimental
class ExpressFormat(InferenceFormat):
    """Concrete strategy for Express DSL representation."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
        examples_path: str | None = None,
        version: str | None = None,
    ):
        """Initializes the Express DSL inference format.

        Args:
            catalogs: A sequence of catalogs containing valid elements.
            surface_id: The surface identifier for layout targeting.
            examples_path: Optional path to markdown files containing examples.
            version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
                Defaults to the version that the catalogs target.
        """
        self._catalogs = check_dsl_catalogs(catalogs)
        self.surface_id = surface_id
        self.examples_path = examples_path
        self._version = version
        self._prompt_generator: ExpressPromptGenerator | None = None

    @property
    def version(self) -> str:
        """The target protocol version: the override, else the catalogs' version.

        Raises:
            A2uiCatalogError: If no override is set and the catalogs target
                different protocol versions.
        """
        return self._version or catalogs_protocol_version(self._catalogs)

    @version.setter
    def version(self, value: str | None) -> None:
        self._version = value

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs, in the order the format received them."""
        return list(self._catalogs)

    @catalogs.setter
    def catalogs(self, value: Sequence[CatalogApi]) -> None:
        # The prompt generator reads the catalogs from this format each time,
        # so the existing instance stays valid and is kept.
        self._catalogs = check_dsl_catalogs(value)

    @property
    def prompt_generator(self) -> ExpressPromptGenerator:
        """The prompt generator instance configured for this Express format."""
        if self._prompt_generator is None:
            self._prompt_generator = ExpressPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        """The parser instance configured for this Express format."""
        return ExpressParser(self._catalogs, self.surface_id, version=self._version)
