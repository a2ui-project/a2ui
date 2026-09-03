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

"""Skill and SkillSet domain objects for A2UI skill packages."""

import os
from typing import Any, Iterator, Optional
import yaml


class Skill:
    """Represents a single A2UI Skill package with YAML frontmatter metadata and markdown content.

    Allows developers to inspect and mutate fields (name, description, metadata, content)
    before serializing back to markdown format.
    """

    def __init__(
        self,
        name: str,
        description: str,
        content: str,
        metadata: Optional[dict[str, Any]] = None,
        filename: str = "SKILL.md",
    ):
        self.name = name
        self.description = description
        self.content = content
        self.metadata = metadata or {}
        self.filename = filename

    def to_markdown(self) -> str:
        """Serializes skill object back to complete markdown string with YAML frontmatter."""
        fm = {
            "name": self.name,
            "description": self.description,
            "metadata": self.metadata,
        }
        yaml_str = yaml.dump(fm, sort_keys=False).strip()
        return f"---\n{yaml_str}\n---\n\n{self.content.strip()}\n"

    def __str__(self) -> str:
        return self.to_markdown()

    def __repr__(self) -> str:
        return f"Skill(name={self.name!r}, filename={self.filename!r})"


class SkillSet:
    """Collection of Skill objects representing a modular or multi-skill package."""

    def __init__(self, skills: Optional[dict[str, Skill]] = None):
        self._skills: dict[str, Skill] = skills or {}

    def add(self, skill: Skill):
        """Adds a Skill to the collection."""
        self._skills[skill.filename] = skill

    def get(self, filename: str) -> Optional[Skill]:
        """Retrieves a Skill by filename or key."""
        if filename in self._skills:
            return self._skills[filename]
        # Search by skill name
        for sk in self._skills.values():
            if sk.name == filename or filename in sk.filename:
                return sk
        return None

    def to_dict(self) -> dict[str, str]:
        """Serializes all skills to a dictionary mapping filename to markdown text."""
        return {filename: skill.to_markdown() for filename, skill in self._skills.items()}

    def export_to_directory(self, output_dir: str) -> dict[str, str]:
        """Exports all skills in the set to the specified output directory on disk."""
        os.makedirs(output_dir, exist_ok=True)
        results = {}
        for filename, skill in self._skills.items():
            file_path = os.path.join(output_dir, filename)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            markdown_text = skill.to_markdown()
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(markdown_text)
            results[filename] = markdown_text
        return results

    def __getitem__(self, key: str) -> Skill:
        item = self.get(key)
        if item is None:
            raise KeyError(key)
        return item

    def __iter__(self) -> Iterator[str]:
        return iter(self._skills)

    def keys(self):
        return self._skills.keys()

    def values(self):
        return self._skills.values()

    def items(self):
        return self._skills.items()

    def __len__(self) -> int:
        return len(self._skills)

    def __repr__(self) -> str:
        return f"SkillSet({list(self._skills.keys())!r})"
