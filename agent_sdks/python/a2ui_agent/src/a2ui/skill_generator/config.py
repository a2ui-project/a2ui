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

"""Configuration for the A2UI Skill Generator."""

from dataclasses import dataclass, field
from typing import Any, List, Optional, Union


@dataclass
class SkillConfig:
    """Configuration options for creating an A2UI Agent Skill package.

    Attributes:
        skill_name: Unique identifier for the skill (e.g. 'render-ui' or 'render-travel-ui').
        description: Description of what the skill does, used in SKILL.md YAML frontmatter.
        output_dir: Target directory path where the skill folder will be created.
        target_language: Programming language for reference scripts and lib helpers (default: 'python').
        catalogs: Optional list of CatalogConfig instances or catalog file paths.
        examples_path: Optional path to directory containing example A2UI JSON payloads.
        examples: Optional list of A2UI JSON messages (dicts, JSON strings, or file paths).
        include_builder_lib: Whether to generate the fluent component builder helper in lib/ (default: True).
        include_runtime_bridge: Whether to generate runtime webview bridge adapter (default: True).
        include_validation_script: Whether to generate validation CLI tool (default: True).
    """

    skill_name: str = "render-ui"
    description: str = (
        "Skill for rendering dynamic A2UI user interfaces in webview using component catalogs "
        "and function bindings."
    )
    output_dir: str = ".agents/skills/render-ui"
    target_language: str = "python"
    catalogs: List[Any] = field(default_factory=list)
    examples_path: Optional[str] = None
    examples: Optional[List[Any]] = None
    include_builder_lib: bool = True
    include_runtime_bridge: bool = True
    include_validation_script: bool = True
