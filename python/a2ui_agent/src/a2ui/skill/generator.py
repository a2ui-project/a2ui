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

"""SkillGenerator for compiling InferenceFormat and Catalog into Skill and SkillSet packages."""

from typing import Optional, Union

from a2ui.core import CatalogApi
from a2ui.inference_format import InferenceFormat
from a2ui.schema import CatalogConfig
from a2ui.skill.skill import Skill, SkillSet, _clean_catalog_name, _resolve_catalogs_list


class SkillGenerator:
    """Compiles InferenceFormat rules and Catalog instances into Skill and SkillSet packages."""

    def __init__(self, fmt: InferenceFormat):
        self.fmt = fmt

    def generate_skill(
        self,
        name: str = "a2ui",
        description: Optional[str] = None,
        catalogs: Optional[list[Union[str, CatalogApi, CatalogConfig]]] = None,
    ) -> Skill:
        """Compiles an InferenceFormat into a single unified (monolithic) Skill.

        If catalogs is not specified, defaults to the catalogs configured on the inference format.
        """
        resolved_catalogs = _resolve_catalogs_list(catalogs, self.fmt)
        prompt_gen = self.fmt.prompt_generator

        base_rules = prompt_gen.generate_base_rules()

        cat_blocks = []
        ex_blocks = []
        for c in resolved_catalogs:
            inst = prompt_gen.generate_catalog_instructions(catalog=c)
            if inst:
                cat_blocks.append(inst)
            ex = prompt_gen.generate_examples(catalog=c)
            # A format whose examples aren't kept per catalog returns the same
            # examples for each catalog, so they're added once.
            if ex and ex not in ex_blocks:
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

        return Skill(
            name=name,
            description=desc,
            content=content_str,
            filename=f"{name}/SKILL.md",
        )

    def generate_catalog_skill(
        self,
        catalog: Optional[Union[str, CatalogApi, CatalogConfig]] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        include_examples: bool = True,
    ) -> Skill:
        """Compiles a single catalog into a dedicated catalog Skill.

        If catalog is not specified, defaults to the catalog configured on the inference format.
        """
        if catalog is not None:
            target_catalog = _resolve_catalogs_list([catalog], self.fmt)[0]
        else:
            format_catalogs = _resolve_catalogs_list(None, self.fmt)
            if format_catalogs:
                target_catalog = format_catalogs[0]
            else:
                raise ValueError(
                    "No catalog provided or configured on the inference format to"
                    " compile catalog skill."
                )
        clean_name = _clean_catalog_name(target_catalog)
        skill_name = name or f"a2ui-{clean_name}"
        prompt_gen = self.fmt.prompt_generator

        cat_body = (
            prompt_gen.generate_catalog_instructions(catalog=target_catalog) or ""
        )
        if include_examples:
            ex = prompt_gen.generate_examples(catalog=target_catalog)
            if ex:
                cat_body += f"\n\n### Examples:\n\n{ex}"

        desc = (
            description
            or getattr(target_catalog, "description", None)
            or f"UI component catalog signatures for {clean_name}. Use when building {clean_name} user interface components."
        )

        return Skill(
            name=skill_name,
            description=desc,
            content=cat_body.strip() + "\n",
            filename=f"{skill_name}/SKILL.md",
        )

    def generate_core_skill(
        self,
        name: str = "a2ui-core",
        description: Optional[str] = None,
    ) -> Skill:
        """Compiles core syntax rules for an inference format into a base core skill."""
        prompt_gen = self.fmt.prompt_generator
        base_rules = prompt_gen.generate_base_rules() or ""
        desc = (
            description
            or "Core A2UI protocol instructions and syntax rules for UI generation."
        )

        return Skill(
            name=name,
            description=desc,
            content=base_rules.strip() + "\n",
            filename=f"{name}/SKILL.md",
        )

    def generate_skillset(
        self,
        catalogs: Optional[list[Union[str, CatalogApi, CatalogConfig]]] = None,
        core_name: str = "a2ui-core",
    ) -> SkillSet:
        """Generates standard modular skills (a2ui-core + 1 skill per catalog) for an inference format.

        If catalogs is not specified, defaults to the catalogs configured on the inference format.
        """
        skill_set = SkillSet()

        # 1. Core Syntax Skill
        skill_set.add(self.generate_core_skill(name=core_name))

        # 2. Per-Catalog Skills
        # A format whose examples aren't kept per catalog returns the same
        # examples for each catalog, so only the first catalog skill gets them.
        resolved_catalogs = _resolve_catalogs_list(catalogs, self.fmt)
        prompt_gen = self.fmt.prompt_generator
        seen_examples: set[str] = set()
        for cat in resolved_catalogs:
            examples = prompt_gen.generate_examples(catalog=cat)
            skill_set.add(
                self.generate_catalog_skill(
                    cat, include_examples=examples not in seen_examples
                )
            )
            seen_examples.add(examples)

        return skill_set
