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

"""SkillGenerator implementation for generating A2UI skill packages."""

import os
from typing import Any, Optional, Union
import yaml

from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats.experimental.express.format import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill.config import SkillConfig


class SkillGenerator:
    """Utility that generates monolithic or modular A2UI skill packages from an InferenceFormat."""

    def __init__(
        self,
        inference_format: Optional[Union[InferenceFormat, SkillConfig]] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        config: Optional[SkillConfig] = None,
    ):
        """Initializes SkillGenerator with an InferenceFormat or SkillConfig.

        Args:
            inference_format: Target InferenceFormat instance or SkillConfig instance.
            name: Default skill name override.
            description: Default skill description override.
            metadata: Additional metadata dictionary.
            config: Optional SkillConfig instance for backward compatibility.
        """
        if isinstance(inference_format, SkillConfig):
            self.config = inference_format
        elif config:
            self.config = config
        else:
            fmt = inference_format or ExpressFormat()
            self.config = SkillConfig(
                inference_format=fmt,
                name=name,
                description=description,
                metadata=metadata or {},
            )

    def generate(
        self,
        include_examples: bool = True,
        validate_examples: bool = False,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> "Skill":
        """Generates a single unified (monolithic) Skill domain object.

        Returns:
            Skill instance representing the compiled monolithic skill.
        """
        fmt = self.config.inference_format or ExpressFormat()
        cat_list = self._resolve_catalogs(self.config.catalogs, fmt)
        raw_dict = self._generate_unified_skill(
            fmt=fmt,
            catalogs=cat_list,
            name=name or self.config.name,
            description=description or self.config.description,
            include_examples=include_examples,
            validate_examples=validate_examples,
            extra_metadata=self.config.metadata,
        )
        fname, content_str = list(raw_dict.items())[0]
        return self._parse_skill_markdown(content_str, filename=fname)

    def generate_modular(
        self,
        catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
        include_examples: bool = True,
        validate_examples: bool = False,
    ) -> "SkillSet":
        """Generates a SkillSet containing modular Skill domain objects (a2ui-core, a2ui-basic, etc.).

        Returns:
            SkillSet collection containing the compiled modular Skill objects.
        """
        fmt = self.config.inference_format or ExpressFormat()
        cat_list = self._resolve_catalogs(catalogs or self.config.catalogs, fmt)
        raw_dict = self._generate_modular_skills(
            fmt=fmt,
            catalogs=cat_list,
            name=None,
            description=self.config.description,
            include_examples=include_examples,
            validate_examples=validate_examples,
            extra_metadata=self.config.metadata,
        )
        from a2ui.skill.skill import SkillSet
        skill_set = SkillSet()
        for fname, content_str in raw_dict.items():
            sk = self._parse_skill_markdown(content_str, filename=fname)
            skill_set.add(sk)
        return skill_set

    def generate_skill(
        self,
        catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
        inference_format: Optional[InferenceFormat] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        modular: Optional[bool] = None,
        output_dir: Optional[str] = None,
        include_examples: Optional[bool] = None,
        validate_examples: Optional[bool] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, str]:
        """Generates unified or modular SKILL.md file content and optionally writes to disk.

        Args:
            catalogs: List of catalog instances or catalog JSON paths.
            inference_format: Target InferenceFormat instance.
            name: Skill name override.
            description: Skill description override.
            modular: Whether to generate modular skills.
            output_dir: Output directory to write files.
            include_examples: Whether to include examples.
            validate_examples: Whether to validate examples.
            metadata: Additional metadata dictionary.

        Returns:
            Dictionary mapping skill filenames (e.g. 'a2ui/SKILL.md') to content strings.
        """
        fmt = inference_format or self.config.inference_format
        if not fmt:
            fmt = ExpressFormat()

        is_modular = modular if modular is not None else self.config.modular
        out_dir = output_dir or self.config.output_dir
        inc_examples = (
            include_examples
            if include_examples is not None
            else self.config.include_examples
        )
        val_examples = (
            validate_examples
            if validate_examples is not None
            else self.config.validate_examples
        )

        cat_list = self._resolve_catalogs(catalogs or self.config.catalogs, fmt)

        if is_modular:
            skills = self._generate_modular_skills(
                fmt=fmt,
                catalogs=cat_list,
                name=name or self.config.name,
                description=description or self.config.description,
                include_examples=inc_examples,
                validate_examples=val_examples,
                extra_metadata=metadata or self.config.metadata,
            )
        else:
            skills = self._generate_unified_skill(
                fmt=fmt,
                catalogs=cat_list,
                name=name or self.config.name,
                description=description or self.config.description,
                include_examples=inc_examples,
                validate_examples=val_examples,
                extra_metadata=metadata or self.config.metadata,
            )

        if out_dir:
            self._write_skills_to_dir(skills, out_dir)

        return skills

    def _parse_skill_markdown(self, markdown_text: str, filename: str = "SKILL.md") -> "Skill":
        """Parses markdown text with frontmatter into a Skill domain object."""
        from a2ui.skill.skill import Skill
        if markdown_text.startswith("---"):
            parts = markdown_text.split("---", 2)
            if len(parts) >= 3:
                yaml_part = parts[1].strip()
                body_part = parts[2].strip()
                try:
                    fm_data = yaml.safe_load(yaml_part) or {}
                    return Skill(
                        name=fm_data.get("name", "a2ui"),
                        description=fm_data.get("description", ""),
                        content=body_part,
                        metadata=fm_data.get("metadata", {}),
                        filename=filename,
                    )
                except Exception:
                    pass
        return Skill(
            name="a2ui",
            description="",
            content=markdown_text,
            filename=filename,
        )

    def _resolve_catalogs(
        self,
        raw_catalogs: list[Union[str, Any]],
        fmt: InferenceFormat,
    ) -> list[A2uiCatalog]:
        resolved = []
        for c in raw_catalogs:
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

        if resolved and hasattr(fmt, "catalog") and not fmt.catalog:
            fmt.catalog = resolved[0]

        return resolved

    def _generate_unified_skill(
        self,
        fmt: InferenceFormat,
        catalogs: list[A2uiCatalog],
        name: Optional[str],
        description: Optional[str],
        include_examples: bool,
        validate_examples: bool,
        extra_metadata: dict[str, Any],
    ) -> dict[str, str]:
        skill_name = name or "a2ui"
        desc = (
            description
            or "Generates interactive user interface components for user requests."
        )

        cat_ids = [
            c.catalog_id for c in catalogs if hasattr(c, "catalog_id") and c.catalog_id
        ]
        fmt_name = fmt.__class__.__name__.replace("Format", "").lower()

        meta = {
            "protocol_version": "0.9.1",
            "inference_format": fmt_name,
            "catalogs": cat_ids,
        }
        meta.update(extra_metadata)

        frontmatter = self._build_frontmatter(skill_name, desc, meta)

        prompt_gen = fmt.prompt_generator
        base_rules = prompt_gen.generate_base_rules()

        cat_instructions_blocks = []
        examples_blocks = []

        for c in catalogs:
            instructions = prompt_gen.generate_catalog_instructions(catalog=c)
            if instructions:
                cat_instructions_blocks.append(instructions)
            if include_examples:
                ex = prompt_gen.generate_examples(catalog=c, validate=validate_examples)
                if ex:
                    examples_blocks.append(ex)

        body_parts = []
        if base_rules:
            body_parts.append(base_rules)
        if cat_instructions_blocks:
            body_parts.extend(cat_instructions_blocks)
        if examples_blocks:
            body_parts.append("### Examples:\n\n" + "\n\n".join(examples_blocks))

        content = frontmatter + "\n\n" + "\n\n".join(body_parts) + "\n"
        filename = f"{skill_name}/SKILL.md"
        return {filename: content}

    def _generate_modular_skills(
        self,
        fmt: InferenceFormat,
        catalogs: list[A2uiCatalog],
        name: Optional[str],
        description: Optional[str],
        include_examples: bool,
        validate_examples: bool,
        extra_metadata: dict[str, Any],
    ) -> dict[str, str]:
        skills = {}
        fmt_name = fmt.__class__.__name__.replace("Format", "").lower()
        prompt_gen = fmt.prompt_generator

        # 1. Base Core Skill
        core_name = name or 'a2ui-core'
        core_desc = (
            description
            or "Core A2UI protocol instructions and syntax rules for UI generation."
        )
        core_meta = {
            "protocol_version": "0.9.1",
            "inference_format": fmt_name,
        }
        core_meta.update(extra_metadata)

        core_fm = self._build_frontmatter(core_name, core_desc, core_meta)
        base_rules = prompt_gen.generate_base_rules()
        core_content = core_fm + "\n\n" + base_rules + "\n"
        skills[f"{core_name}/SKILL.md"] = core_content

        # 2. Catalog Skills
        for c in catalogs:
            cat_id = getattr(c, "catalog_id", "catalog")
            cat_skill_name = f"a2ui-{cat_id}"
            cat_desc = (
                getattr(c, "description", None)
                or f"UI component catalog signatures for {cat_id}."
            )
            cat_meta = {
                "protocol_version": "0.9.1",
                "inference_format": fmt_name,
                "catalog": cat_id,
            }
            cat_fm = self._build_frontmatter(cat_skill_name, cat_desc, cat_meta)
            cat_body = prompt_gen.generate_catalog_instructions(catalog=c)
            if include_examples:
                ex = prompt_gen.generate_examples(catalog=c, validate=validate_examples)
                if ex:
                    cat_body += f"\n\n### Examples:\n\n{ex}"

            cat_content = cat_fm + "\n\n" + cat_body + "\n"
            skills[f"{cat_skill_name}/SKILL.md"] = cat_content

        return skills

    def _build_frontmatter(
        self, name: str, description: str, metadata: dict[str, Any]
    ) -> str:
        fm_dict = {
            "name": name,
            "description": description,
            "metadata": metadata,
        }
        yaml_str = yaml.dump(fm_dict, sort_keys=False).strip()
        return f"---\n{yaml_str}\n---"

    def _write_skills_to_dir(self, skills: dict[str, str], output_dir: str) -> None:
        for rel_path, content in skills.items():
            full_path = os.path.join(output_dir, rel_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)


def generate_skill(
    catalog_path: Optional[Union[str, list[Union[str, A2uiCatalog]]]] = None,
    catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
    inference_format: Optional[InferenceFormat] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    modular: bool = False,
    output_dir: Optional[str] = None,
    include_examples: bool = True,
    validate_examples: bool = False,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, str]:
    """Helper function to generate skill files directly.

    Args:
        catalog_path: Path or list of paths/catalogs.
        catalogs: Optional list of catalogs.
        inference_format: Target InferenceFormat instance.
        name: Skill name override.
        description: Skill description override.
        modular: Whether to generate modular skills.
        output_dir: Output directory path.
        include_examples: Whether to include examples.
        validate_examples: Whether to validate examples.
        metadata: Metadata dictionary.

    Returns:
        Dictionary mapping skill file relative paths to content strings.
    """
    cat_list = []
    if catalog_path:
        if isinstance(catalog_path, list):
            cat_list.extend(catalog_path)
        else:
            cat_list.append(catalog_path)
    if catalogs:
        cat_list.extend(catalogs)

    config = SkillConfig(
        inference_format=inference_format,
        catalogs=cat_list,
        name=name,
        description=description,
        modular=modular,
        include_examples=include_examples,
        validate_examples=validate_examples,
        metadata=metadata or {},
        output_dir=output_dir,
    )
    generator = SkillGenerator(config)
    return generator.generate_skill()
