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

import json
import re
from typing import Any, Optional, List
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.inference_format import InferenceFormat
from a2ui.parser.parser import Parser
from google.adk.utils.feature_decorator import experimental

from .prompt_generator import ElementalPromptGenerator
from .compiler import TAG_PREFIX

from .parser import ElementalParser


@experimental
class ElementalFormat(InferenceFormat):
    """Elemental HTML5-like markup format strategy."""

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
        examples_path: Optional[str] = None,
    ):
        self.catalog = catalog
        self.surface_id = surface_id
        self.examples_path = examples_path
        self._prompt_generator: Optional[ElementalPromptGenerator] = None

    def _ensure_catalog(self) -> None:
        if not self.catalog:
            raise ValueError(
                "Catalog is required for parsing and decompiling in elemental format."
            )

    @property
    def prompt_generator(self) -> ElementalPromptGenerator:
        """Returns the PromptGenerator instance for this format."""
        if self._prompt_generator is None:
            self._ensure_catalog()
            self._prompt_generator = ElementalPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        self._ensure_catalog()
        return ElementalParser(self.catalog, self.surface_id)
