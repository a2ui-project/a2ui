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

from .prompt_generator import ExpressPromptGenerator
from .parser import ExpressParser


@experimental
class ExpressFormat(InferenceFormat):
    """Concrete strategy for Express DSL representation."""

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
        examples_path: Optional[str] = None,
    ):
        """Initializes the Express DSL inference format.

        Args:
            catalog: The component catalog containing valid elements.
            surface_id: The surface identifier for layout targeting.
            examples_path: Optional path to markdown files containing examples.
        """
        self.catalog = catalog
        self.surface_id = surface_id
        self.examples_path = examples_path
        self._prompt_generator: Optional[ExpressPromptGenerator] = None

    def _ensure_catalog(self) -> None:
        """Ensures a valid catalog is set, raising ValueError otherwise.

        Raises:
            ValueError: If the catalog has not been initialized.
        """
        if not self.catalog:
            raise ValueError(
                "Catalog is required for parsing and decompiling in express format."
            )

    @property
    def prompt_generator(self) -> ExpressPromptGenerator:
        """The prompt generator instance configured for this Express format."""
        if self._prompt_generator is None:
            self._ensure_catalog()
            self._prompt_generator = ExpressPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        """The parser instance configured for this Express format."""
        self._ensure_catalog()
        return ExpressParser(self.catalog, self.surface_id)
