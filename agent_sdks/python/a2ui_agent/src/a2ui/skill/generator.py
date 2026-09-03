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

"""SkillGenerator convenience wrapper for generating A2UI skill packages."""

import os
from typing import Any, Optional, Union

from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats.experimental.express.format import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog
from a2ui.skill.skill import Skill, SkillSet


class SkillGenerator:
    """Utility that generates monolithic or modular A2UI skill packages from an InferenceFormat."""

    def __init__(self, inference_format: Optional[InferenceFormat] = None):
        """Initializes SkillGenerator with an InferenceFormat instance."""
        self.inference_format = inference_format or ExpressFormat()

    def generate(
        self,
        name: str = "a2ui",
        catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
    ) -> Skill:
        """Generates a single unified (monolithic) Skill domain object."""
        return Skill.from_format(self.inference_format, name=name, catalogs=catalogs)

    def generate_modular(
        self,
        catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
    ) -> SkillSet:
        """Generates a SkillSet containing modular Skill objects (a2ui-core, a2ui-basic, etc.)."""
        return SkillSet.from_format(self.inference_format, catalogs=catalogs)


def generate_skill(
    inference_format: Optional[InferenceFormat] = None,
    catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
    name: str = "a2ui",
    output_dir: Optional[str] = None,
    modular: bool = False,
    include_examples: bool = True,
    **kwargs: Any,
) -> dict[str, str]:
    """Simple helper function to generate skills directly."""
    generator = SkillGenerator(inference_format)
    if modular:
        skill_set = generator.generate_modular(catalogs=catalogs)
        if output_dir:
            return skill_set.export_to_directory(output_dir)
        return skill_set.to_dict()
    else:
        skill = generator.generate(name=name, catalogs=catalogs)
        res = {skill.filename: skill.to_markdown()}
        if output_dir:
            file_path = os.path.join(output_dir, skill.filename)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(skill.to_markdown())
        return res
