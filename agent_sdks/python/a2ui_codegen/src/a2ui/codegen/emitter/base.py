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

"""Base emitter interface for code generation."""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Union

from a2ui.codegen.analyzer import AnalysedCatalog


class BaseEmitter(ABC):
    """Abstract base class for language-specific code emitters."""

    def __init__(
        self,
        catalog: AnalysedCatalog,
        base_import: str = "a2ui.inference_formats.experimental.macros.builder.base",
    ):
        self.catalog = catalog
        self.base_import = base_import

    @abstractmethod
    def emit(self, output_dir: Union[str, Path]) -> list[Path]:
        """Emits generated files to the target directory and returns list of written paths."""
        pass
