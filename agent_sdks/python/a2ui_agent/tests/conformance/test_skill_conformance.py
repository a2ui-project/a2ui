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

"""Conformance tests for A2UI Skill and SkillSet APIs driven by conformance/agent/skill.yaml."""

import os
import unittest
import yaml

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill import Skill, SkillSet


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
SPEC_YAML_PATH = os.path.join(REPO_ROOT, "conformance", "agent", "skill.yaml")
GOLDENS_DIR = os.path.join(REPO_ROOT, "conformance", "test_data", "skills")


class TestSkillConformance(unittest.TestCase):
    """Verifies skill generation and decomposed prompt APIs against specification YAML and golden files."""

    def test_prompt_generator_base_rules_conformance(self):
        """Asserts prompt_generator.generate_base_rules() matches golden file exactly."""
        cat_path = os.path.join(REPO_ROOT, "specification", "v1_0", "catalogs", "basic", "catalog.json")
        cat_config = CatalogConfig.from_path("basic", cat_path)
        catalog = A2uiCatalog.from_config(cat_config)
        express_fmt = ExpressFormat(catalog=catalog)
        prompt_gen = express_fmt.prompt_generator

        golden_path = os.path.join(GOLDENS_DIR, "express_base_rules.txt")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        actual = prompt_gen.generate_base_rules()
        self.assertEqual(actual, expected)

    def test_prompt_generator_catalog_instructions_conformance(self):
        """Asserts prompt_generator.generate_catalog_instructions() matches golden file exactly."""
        cat_path = os.path.join(REPO_ROOT, "specification", "v1_0", "catalogs", "basic", "catalog.json")
        cat_config = CatalogConfig.from_path("basic", cat_path)
        catalog = A2uiCatalog.from_config(cat_config)
        express_fmt = ExpressFormat(catalog=catalog)
        prompt_gen = express_fmt.prompt_generator

        golden_path = os.path.join(GOLDENS_DIR, "express_catalog_instructions.txt")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        actual = prompt_gen.generate_catalog_instructions(catalog=catalog)
        self.assertEqual(actual, expected)

    def test_skill_yaml_conformance_cases(self):
        """Parses conformance/agent/skill.yaml and executes declared test cases."""
        self.assertTrue(os.path.exists(SPEC_YAML_PATH), f"Missing conformance spec: {SPEC_YAML_PATH}")

        with open(SPEC_YAML_PATH, "r", encoding="utf-8") as f:
            test_cases = yaml.safe_load(f)

        for case in test_cases:
            name = case["name"]
            action = case["action"]
            args = case.get("args", {})

            with self.subTest(name=name):
                cat_rel_path = args.get("catalog")
                catalog = None
                if cat_rel_path:
                    abs_cat_path = os.path.join(REPO_ROOT, cat_rel_path)
                    cat_config = CatalogConfig.from_path("basic", abs_cat_path)
                    catalog = A2uiCatalog.from_config(cat_config)

                fmt_name = args.get("format", "express")
                fmt = ExpressFormat(catalog=catalog) if catalog else ExpressFormat()

                if action == "from_format":
                    mono_name = args.get("name", "a2ui")
                    skill_obj = Skill.from_format(fmt, name=mono_name)
                    expected_rel = case["expected_file"]
                    expected_abs = os.path.join(REPO_ROOT, expected_rel)
                    with open(expected_abs, "r", encoding="utf-8") as gf:
                        expected_content = gf.read()
                    self.assertEqual(skill_obj.to_markdown(), expected_content)

                elif action == "core_syntax":
                    core_name = args.get("name", "a2ui-core")
                    skill_obj = Skill.core_syntax(fmt, name=core_name)
                    expected_rel = case["expected_file"]
                    expected_abs = os.path.join(REPO_ROOT, expected_rel)
                    with open(expected_abs, "r", encoding="utf-8") as gf:
                        expected_content = gf.read()
                    self.assertEqual(skill_obj.to_markdown(), expected_content)

                elif action == "from_catalog":
                    skill_obj = Skill.from_catalog(catalog, fmt)
                    expected_rel = case["expected_file"]
                    expected_abs = os.path.join(REPO_ROOT, expected_rel)
                    with open(expected_abs, "r", encoding="utf-8") as gf:
                        expected_content = gf.read()
                    self.assertEqual(skill_obj.to_markdown(), expected_content)

                elif action == "skill_set":
                    skill_set = SkillSet.from_format(fmt)
                    expected_keys = case.get("expected_skills", [])
                    for k in expected_keys:
                        self.assertIn(k, skill_set.to_dict())


if __name__ == "__main__":
    unittest.main()
