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

"""Conformance tests for A2UI Skill and SkillSet APIs driven by conformance/agent/skill.yaml."""

import os
import tempfile
import unittest

import yaml

from a2ui.core import A2uiValidationError
from a2ui.inference_formats.experimental.atom import AtomFormat
from a2ui.inference_formats.experimental.elemental import ElementalFormat
from a2ui.inference_formats.express import ExpressFormat
from a2ui.processor import CatalogConfig
from a2ui.skill import Skill, SkillGenerator, SkillSet

from ..repo_paths import find_repo_root

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
SPEC_YAML_PATH = os.path.join(REPO_ROOT, "conformance", "agent", "skill.yaml")
GOLDENS_DIR = os.path.join(REPO_ROOT, "conformance", "test_data", "skills")

_ERROR_CATEGORIES: dict[str, type[Exception]] = {
    "ValidationError": A2uiValidationError,
}


class TestSkillConformance(unittest.TestCase):
    """Verifies skill generation and decomposed prompt APIs against specification YAML and golden files."""

    def test_prompt_generator_base_rules_conformance(self):
        """Asserts prompt_generator.generate_base_rules() matches golden file exactly."""
        cat_path = os.path.join(REPO_ROOT, "catalogs", "basic", "v1", "catalog.json")
        cat_config = CatalogConfig.from_path(cat_path)
        catalog = cat_config.transformed_catalog
        express_fmt = ExpressFormat([catalog])
        prompt_gen = express_fmt.prompt_generator

        golden_path = os.path.join(GOLDENS_DIR, "express_base_rules.txt")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        actual = prompt_gen.generate_base_rules()
        self.assertEqual(actual, expected)

    def test_prompt_generator_catalog_instructions_conformance(self):
        """Asserts prompt_generator.generate_catalog_instructions() matches golden file exactly."""
        cat_path = os.path.join(REPO_ROOT, "catalogs", "basic", "v1", "catalog.json")
        cat_config = CatalogConfig.from_path(cat_path)
        catalog = cat_config.transformed_catalog
        express_fmt = ExpressFormat([catalog])
        prompt_gen = express_fmt.prompt_generator

        golden_path = os.path.join(GOLDENS_DIR, "express_catalog_instructions.txt")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        actual = prompt_gen.generate_catalog_instructions(catalog=catalog)
        self.assertEqual(actual, expected)

    def test_skill_yaml_conformance_cases(self):
        """Parses conformance/agent/skill.yaml and executes declared test cases."""
        self.assertTrue(
            os.path.exists(SPEC_YAML_PATH),
            f"Missing conformance spec: {SPEC_YAML_PATH}",
        )

        with open(SPEC_YAML_PATH, "r", encoding="utf-8") as f:
            test_cases = yaml.safe_load(f)

        for case in test_cases:
            name = case["name"]
            action = case["action"]
            args = case.get("args", {})

            with self.subTest(name=name):
                if action == "export_to_directory":
                    self._run_export_to_directory_case(case, args)
                    continue

                cat_rel_path = args.get("catalog")
                catalog = None
                if cat_rel_path:
                    abs_cat_path = os.path.join(REPO_ROOT, cat_rel_path)
                    cat_config = CatalogConfig.from_path(abs_cat_path)
                    catalog = cat_config.transformed_catalog

                fmt_name = args.get("format", "express")
                if fmt_name == "express":
                    fmt = ExpressFormat([catalog]) if catalog else ExpressFormat()
                elif fmt_name == "atom":
                    fmt = AtomFormat([catalog]) if catalog else AtomFormat()
                elif fmt_name == "elemental":
                    fmt = ElementalFormat([catalog]) if catalog else ElementalFormat()
                else:
                    raise ValueError(f"Unsupported format: {fmt_name}")

                generator = SkillGenerator(fmt)

                if action == "from_format":
                    mono_name = args.get("name", "a2ui")
                    skill_obj = generator.generate_skill(name=mono_name)
                    expected_rel = case["expected_file"]
                    expected_abs = os.path.join(REPO_ROOT, expected_rel)
                    with open(expected_abs, "r", encoding="utf-8") as gf:
                        expected_content = gf.read()
                    self.assertEqual(skill_obj.to_markdown(), expected_content)

                elif action == "core_syntax":
                    core_name = args.get("name", "a2ui-core")
                    skill_obj = generator.generate_core_skill(name=core_name)
                    expected_rel = case["expected_file"]
                    expected_abs = os.path.join(REPO_ROOT, expected_rel)
                    with open(expected_abs, "r", encoding="utf-8") as gf:
                        expected_content = gf.read()
                    self.assertEqual(skill_obj.to_markdown(), expected_content)

                elif action == "from_catalog":
                    skill_obj = generator.generate_catalog_skill(catalog)
                    expected_rel = case["expected_file"]
                    expected_abs = os.path.join(REPO_ROOT, expected_rel)
                    with open(expected_abs, "r", encoding="utf-8") as gf:
                        expected_content = gf.read()
                    self.assertEqual(skill_obj.to_markdown(), expected_content)

                elif action == "skill_set":
                    skill_set = generator.generate_skillset()
                    skills_by_file = skill_set.to_dict()
                    for k in case.get("expected_skills", []):
                        self.assertIn(k, skills_by_file)
                    for k, golden_rel in case.get("expected_skill_files", {}).items():
                        with open(
                            os.path.join(REPO_ROOT, golden_rel), "r", encoding="utf-8"
                        ) as gf:
                            self.assertEqual(skills_by_file[k], gf.read(), k)

                else:
                    self.fail(f"Unhandled conformance action: {action}")

    def _run_export_to_directory_case(self, case: dict, args: dict) -> None:
        """Exports literal skills into a temp dir and checks what survives."""
        with tempfile.TemporaryDirectory(prefix="a2ui-skill-export-") as temp_dir:
            for rel in args.get("pre_existing_files", []):
                abs_path = os.path.join(temp_dir, rel)
                os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                with open(abs_path, "w", encoding="utf-8") as f:
                    f.write("pre-existing")

            def run() -> None:
                skill_set = SkillSet()
                for spec in args.get("skills", []):
                    skill_set.add(
                        Skill(
                            name=spec["name"],
                            description=spec["description"],
                            content=spec["content"],
                            filename=spec.get("filename"),
                        )
                    )
                skill_set.export_to_directory(temp_dir)

            expect_error = case.get("expect_error")
            if expect_error:
                with self.assertRaises(_ERROR_CATEGORIES[expect_error["category"]]):
                    run()
            else:
                run()

            for rel in case.get("expected_files", []):
                self.assertTrue(
                    os.path.exists(os.path.join(temp_dir, rel)),
                    f"expected {rel} to exist",
                )
            for rel in case.get("expected_absent_files", []):
                self.assertFalse(
                    os.path.exists(os.path.join(temp_dir, rel)),
                    f"expected {rel} to be removed",
                )


if __name__ == "__main__":
    unittest.main()
