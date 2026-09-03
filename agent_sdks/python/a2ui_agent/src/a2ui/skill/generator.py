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
        fmt = self.inference_format
        resolved_catalogs = self._resolve_catalogs(catalogs, fmt)

        cat_ids = [c.catalog_id for c in resolved_catalogs if getattr(c, "catalog_id", None)]
        fmt_name = fmt.__class__.__name__.replace("Format", "").lower()

        meta = {
            "protocol_version": "0.9.1",
            "inference_format": fmt_name,
            "catalogs": cat_ids,
        }
        frontmatter = self._build_frontmatter(name, "Generates interactive user interface components for user requests.", meta)

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

        content = frontmatter + "\n\n" + "\n\n".join(body_parts) + "\n"
        return self._parse_skill_markdown(content, filename=f"{name}/SKILL.md")

    def generate_modular(
        self,
        catalogs: Optional[list[Union[str, A2uiCatalog]]] = None,
    ) -> SkillSet:
        """Generates a SkillSet containing modular Skill objects (a2ui-core, a2ui-basic, etc.)."""
        fmt = self.inference_format
        cat_list = self._resolve_catalogs(catalogs, fmt)
        fmt_name = fmt.__class__.__name__.replace("Format", "").lower()
        prompt_gen = fmt.prompt_generator

        skill_set = SkillSet()

        # 1. Core Syntax Skill
        core_fm = self._build_frontmatter(
            "a2ui-core",
            "Core A2UI protocol instructions and syntax rules for UI generation.",
            {"protocol_version": "0.9.1", "inference_format": fmt_name},
        )
        base_rules = prompt_gen.generate_base_rules()
        core_content = core_fm + "\n\n" + base_rules + "\n"
        skill_set.add(self._parse_skill_markdown(core_content, filename="a2ui-core/SKILL.md"))

        # 2. Catalog Skills
        for c in cat_list:
            cat_id = getattr(c, "catalog_id", "catalog")
            cat_skill_name = f"a2ui-{cat_id}"
            cat_fm = self._build_frontmatter(
                cat_skill_name,
                getattr(c, "description", None) or f"UI component catalog signatures for {cat_id}.",
                {"protocol_version": "0.9.1", "inference_format": fmt_name, "catalog": cat_id},
            )
            cat_body = prompt_gen.generate_catalog_instructions(catalog=c)
            ex = prompt_gen.generate_examples(catalog=c)
            if ex:
                cat_body += f"\n\n### Examples:\n\n{ex}"

            cat_content = cat_fm + "\n\n" + cat_body + "\n"
            skill_set.add(self._parse_skill_markdown(cat_content, filename=f"{cat_skill_name}/SKILL.md"))

        return skill_set

    def _resolve_catalogs(
        self,
        catalogs: Optional[list[Union[str, Any]]],
        fmt: InferenceFormat,
    ) -> list[A2uiCatalog]:
        resolved = []
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

    def _build_frontmatter(self, name: str, description: str, metadata: dict[str, Any]) -> str:
        fm_dict = {"name": name, "description": description, "metadata": metadata}
        return f"---\n{yaml.dump(fm_dict, sort_keys=False).strip()}\n---"

    def _parse_skill_markdown(self, markdown_text: str, filename: str = "SKILL.md") -> Skill:
        if markdown_text.startswith("---"):
            parts = markdown_text.split("---", 2)
            if len(parts) >= 3:
                try:
                    fm_data = yaml.safe_load(parts[1].strip()) or {}
                    return Skill(
                        name=fm_data.get("name", "a2ui"),
                        description=fm_data.get("description", ""),
                        content=parts[2].strip(),
                        metadata=fm_data.get("metadata", {}),
                        filename=filename,
                    )
                except Exception:
                    pass
        return Skill(name="a2ui", description="", content=markdown_text, filename=filename)


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
