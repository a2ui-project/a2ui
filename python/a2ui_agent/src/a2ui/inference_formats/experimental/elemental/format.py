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
from a2ui.inference_formats._shared import check_mixed_catalogs
from a2ui.parser import Parser

from .parser import ElementalParser
from .prompt_generator import ElementalPromptGenerator


@experimental
class ElementalFormat(InferenceFormat):
    """Elemental HTML5-like markup format strategy."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_id: str = "main",
        examples_path: str | None = None,
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self.surface_id = surface_id
        self.examples_path = examples_path
        self._prompt_generator: ElementalPromptGenerator | None = None

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs, in the order the format received them."""
        return list(self._catalogs)

    @property
    def prompt_generator(self) -> ElementalPromptGenerator:
        """Returns the PromptGenerator instance for this format."""
        if self._prompt_generator is None:
            self._prompt_generator = ElementalPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        return ElementalParser(self._catalogs, self.surface_id)
