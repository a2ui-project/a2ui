# Copyright 2026 Google LLC
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

"""Configuration data class for A2UI Skill generation."""

from dataclasses import dataclass, field
from typing import Any, Optional, Union
from a2ui.inference_format import InferenceFormat
from a2ui.schema.catalog import A2uiCatalog


@dataclass
class SkillConfig:
    """Configures skill generation for managed agent platforms.

    Attributes:
        inference_format: Target InferenceFormat instance.
        catalogs: List of catalog instances or catalog JSON paths.
        name: Custom skill name override.
        description: Custom skill description override.
        modular: Whether to generate modular skills.
        include_examples: Whether to include few-shot examples.
        validate_examples: Whether to validate few-shot examples.
        tags: List of metadata tags.
        metadata: Dictionary of additional metadata tags.
        output_dir: Output directory path to save SKILL.md files.
    """

    inference_format: Optional[InferenceFormat] = None
    catalogs: list[Union[str, A2uiCatalog]] = field(default_factory=list)
    name: Optional[str] = None
    description: Optional[str] = None
    modular: bool = False
    include_examples: bool = True
    validate_examples: bool = False
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    output_dir: Optional[str] = None
