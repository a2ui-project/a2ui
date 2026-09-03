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

"""Conformance tests for A2UI SkillGenerator and decomposed PromptGenerator APIs."""

import os
import unittest

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill import generate_skill


# Locate paths
REPO_ROOT = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "..",
        "..",
    )
)
GOLDENS_DIR = os.path.join(REPO_ROOT, "conformance", "test_data", "skills")
CATALOG_PATH = os.path.join(
    REPO_ROOT, "specification", "v1_0", "catalogs", "basic", "catalog.json"
)


class TestSkillConformance(unittest.TestCase):
    """Verifies skill generation and decomposed prompt APIs against golden files."""

    def setUp(self):
        self.catalog_config = CatalogConfig.from_path("basic", CATALOG_PATH)
        self.catalog = A2uiCatalog.from_config(self.catalog_config)
        self.express_fmt = ExpressFormat(catalog=self.catalog)
        self.prompt_gen = self.express_fmt.prompt_generator

    def test_prompt_generator_base_rules_conformance(self):
        """Asserts prompt_generator.generate_base_rules() matches golden file exactly."""
        golden_path = os.path.join(GOLDENS_DIR, "express_base_rules.txt")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        actual = self.prompt_gen.generate_base_rules()
        self.assertEqual(actual, expected)

    def test_prompt_generator_catalog_instructions_conformance(self):
        """Asserts prompt_generator.generate_catalog_instructions() matches golden file exactly."""
        golden_path = os.path.join(GOLDENS_DIR, "express_catalog_instructions.txt")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        actual = self.prompt_gen.generate_catalog_instructions(catalog=self.catalog)
        self.assertEqual(actual, expected)

    def test_monolithic_skill_conformance(self):
        """Asserts monolithic generate_skill() matches golden file exactly."""
        golden_path = os.path.join(GOLDENS_DIR, "express_basic_monolithic.skill.md")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        skills = generate_skill(
            catalogs=[self.catalog],
            inference_format=self.express_fmt,
            modular=False,
        )
        actual = skills["a2ui/SKILL.md"]
        self.assertEqual(actual, expected)

    def test_modular_skill_conformance(self):
        """Asserts modular generate_skill() (core + catalog) matches golden files exactly."""
        core_golden_path = os.path.join(GOLDENS_DIR, "express_core.skill.md")
        cat_golden_path = os.path.join(GOLDENS_DIR, "express_basic_catalog.skill.md")

        with open(core_golden_path, "r", encoding="utf-8") as f:
            expected_core = f.read()
        with open(cat_golden_path, "r", encoding="utf-8") as f:
            expected_cat = f.read()

        skills = generate_skill(
            catalogs=[self.catalog],
            inference_format=self.express_fmt,
            modular=True,
        )

        actual_core = skills["a2ui-core/SKILL.md"]
        self.assertEqual(actual_core, expected_core)

        cat_id = self.catalog.catalog_id
        actual_cat = skills[f"a2ui-{cat_id}/SKILL.md"]
        self.assertEqual(actual_cat, expected_cat)

    def test_skill_generator_with_fake_prompt_generator(self):
        """Asserts generate_skill() with a FakePromptGenerator matches golden file exactly."""
        from typing import Any, Optional
        from a2ui.inference_format import InferenceFormat
        from a2ui.prompt.generator import PromptGenerator

        class FakePromptGen(PromptGenerator):
            def generate_base_rules(self) -> str:
                return "FAKE_BASE_RULES"

            def generate_catalog_instructions(
                self, include_schema: bool = True, catalog: Optional[Any] = None
            ) -> str:
                cat_id = catalog.catalog_id if catalog else "unknown"
                return f"FAKE_CATALOG_INSTRUCTIONS FOR {cat_id}"

            def generate_examples(
                self, catalog: Optional[Any] = None, validate: bool = False
            ) -> str:
                return "FAKE_EXAMPLES"

        class FakeFormat(InferenceFormat):
            @property
            def format_name(self) -> str:
                return "fake"

            @property
            def prompt_generator(self) -> PromptGenerator:
                return FakePromptGen()

            @property
            def parser(self) -> Any:
                return None

        fake_fmt = FakeFormat()
        skills = generate_skill(
            catalogs=[self.catalog],
            inference_format=fake_fmt,
            include_examples=True,
            modular=False,
        )

        golden_path = os.path.join(GOLDENS_DIR, "fake_monolithic.skill.md")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        actual = skills["a2ui/SKILL.md"]
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
