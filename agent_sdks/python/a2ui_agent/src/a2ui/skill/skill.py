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

"""Skill and SkillSet domain objects for A2UI skill packages."""

import os
from typing import Any, Iterator, Optional, Union
import yaml

from a2ui.inference_format import InferenceFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig


def _clean_catalog_name(catalog: Any) -> str:
    """Derives a clean, LLM-friendly catalog name from a catalog ID or URL."""
    raw_id = getattr(catalog, "catalog_id", "basic")
    if not raw_id:
        return "basic"
    if "/" in raw_id or "\\" in raw_id:
        raw_id = raw_id.replace("\\", "/")
        parts = [p for p in raw_id.split("/") if p and not p.endswith(".json")]
        if parts:
            cand = parts[-1]
            if cand.startswith("v") and len(parts) > 1:
                cand = parts[-2]
            raw_id = cand
    return raw_id.lower()


def _resolve_catalogs_list(
    catalogs: Optional[list[Union[str, Any]]],
    fmt: InferenceFormat,
) -> list[A2uiCatalog]:
    """Resolves catalog instances from list of strings, configs, or format defaults."""
    resolved: list[A2uiCatalog] = []
    if catalogs:
        for c in catalogs:
            if isinstance(c, str):
                resolved.append(A2uiCatalog.from_json_file(c))
            elif isinstance(c, CatalogConfig):
                resolved.append(A2uiCatalog.from_config(c))
            elif isinstance(c, A2uiCatalog):
                resolved.append(c)

    if not resolved and hasattr(fmt, "_supported_catalogs") and fmt._supported_catalogs:
        resolved.extend(fmt._supported_catalogs)
    if hasattr(fmt, "catalog") and fmt.catalog:
        if fmt.catalog not in resolved:
            resolved.append(fmt.catalog)

    return resolved


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
        filename: Optional[str] = None,
    ):
        self.name = name
        self.description = description
        self.content = content
        self.metadata = metadata or {}
        self.filename = filename or f"{name}/SKILL.md"

    # --- Factory Constructors ---

    @classmethod
    def from_format(
        cls,
        fmt: InferenceFormat,
        name: str = "a2ui",
        description: Optional[str] = None,
        catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
    ) -> "Skill":
        """Compiles ANY InferenceFormat into a single unified (monolithic) Skill."""
        resolved_catalogs = _resolve_catalogs_list(catalogs, fmt)
        prompt_gen = fmt.prompt_generator

        base_rules = prompt_gen.generate_base_rules()

        cat_blocks = []
        ex_blocks = []
        for c in resolved_catalogs:
            inst = prompt_gen.generate_catalog_instructions(catalog=c)
            if inst:
                cat_blocks.append(inst)
            ex = prompt_gen.generate_examples(catalog=c)
            if ex:
                ex_blocks.append(ex)

        body_parts = []
        if base_rules:
            body_parts.append(base_rules)
        if cat_blocks:
            body_parts.extend(cat_blocks)
        if ex_blocks:
            body_parts.append("### Examples:\n\n" + "\n\n".join(ex_blocks))

        content_str = "\n\n".join(body_parts) + "\n"
        desc = (
            description
            or "Generates interactive user interface components for user requests."
        )

        return cls(
            name=name,
            description=desc,
            content=content_str,
            filename=f"{name}/SKILL.md",
        )

    @classmethod
    def from_catalog(
        cls,
        catalog: A2uiCatalog,
        fmt: InferenceFormat,
        name: Optional[str] = None,
        description: Optional[str] = None,
        include_examples: bool = True,
    ) -> "Skill":
        """Compiles a single catalog into a dedicated catalog Skill."""
        clean_name = _clean_catalog_name(catalog)
        skill_name = name or f"a2ui-{clean_name}"
        prompt_gen = fmt.prompt_generator

        cat_body = prompt_gen.generate_catalog_instructions(catalog=catalog)
        if include_examples:
            ex = prompt_gen.generate_examples(catalog=catalog)
            if ex:
                cat_body += f"\n\n### Examples:\n\n{ex}"

        desc = (
            description
            or getattr(catalog, "description", None)
            or f"UI component catalog signatures for {clean_name}. Use when building {clean_name} user interface components."
        )

        return cls(
            name=skill_name,
            description=desc,
            content=cat_body.strip() + "\n",
            filename=f"{skill_name}/SKILL.md",
        )

    @classmethod
    def core_syntax(
        cls,
        fmt: InferenceFormat,
        name: str = "a2ui-core",
        description: Optional[str] = None,
    ) -> "Skill":
        """Compiles core syntax rules for any format into a base core skill."""
        prompt_gen = fmt.prompt_generator
        base_rules = prompt_gen.generate_base_rules()
        desc = (
            description
            or "Core A2UI protocol instructions and syntax rules for UI generation."
        )

        return cls(
            name=name,
            description=desc,
            content=base_rules.strip() + "\n",
            filename=f"{name}/SKILL.md",
        )

    # --- Serialization ---

    def to_markdown(self) -> str:
        """Serializes skill object back to complete markdown string with YAML frontmatter."""
        fm: dict[str, Any] = {
            "name": self.name,
            "description": self.description,
        }
        if self.metadata:
            fm["metadata"] = self.metadata

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

    @classmethod
    def from_format(
        cls,
        fmt: InferenceFormat,
        catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
        core_name: str = "a2ui-core",
    ) -> "SkillSet":
        """Generates standard modular skills (a2ui-core + 1 skill per catalog) for ANY format."""
        skill_set = cls()

        # 1. Core Syntax Skill
        skill_set.add(Skill.core_syntax(fmt, name=core_name))

        # 2. Per-Catalog Skills
        resolved_catalogs = _resolve_catalogs_list(catalogs, fmt)
        for cat in resolved_catalogs:
            skill_set.add(Skill.from_catalog(cat, fmt))

        return skill_set

    def add(self, skill: Skill) -> None:
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
        return {
            filename: skill.to_markdown() for filename, skill in self._skills.items()
        }

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

    def keys(self) -> Any:
        return self._skills.keys()

    def values(self) -> Any:
        return self._skills.values()

    def items(self) -> Any:
        return self._skills.items()

    def __len__(self) -> int:
        return len(self._skills)

    def __repr__(self) -> str:
        return f"SkillSet({list(self._skills.keys())!r})"
