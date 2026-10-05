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
import unittest
import yaml

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill import Skill, SkillGenerator, SkillSet

from a2ui.schema.utils import find_repo_root

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
SPEC_YAML_PATH = os.path.join(REPO_ROOT, "conformance", "agent", "skill.yaml")
GOLDENS_DIR = os.path.join(REPO_ROOT, "conformance", "test_data", "skills")

# Skill cases this SDK is known to fail, with the reason. Each one must still fail:
# once it passes, remove it here.
_RESERVED_KEYS_GAP = (
    "The v1.0 basic catalog's examples write @path and @call, which the Express"
    " decompiler doesn't read yet"
    " (https://github.com/a2ui-project/a2ui/issues/3006)."
)
KNOWN_GAPS = {
    "test_express_monolithic_skill": _RESERVED_KEYS_GAP,
    "test_express_catalog_skill": _RESERVED_KEYS_GAP,
}


class TestSkillConformance(unittest.TestCase):
    """Verifies skill generation and decomposed prompt APIs against specification YAML and golden files."""

    def _assert_matches_golden(self, name: str, actual: str, expected: str) -> None:
        """Asserts a skill matches its golden file, or still differs for a known gap."""
        if name in KNOWN_GAPS:
            self.assertNotEqual(
                actual,
                expected,
                f"{name} now passes; remove it from KNOWN_GAPS.",
            )
        else:
            self.assertEqual(actual, expected)

    def test_prompt_generator_base_rules_conformance(self):
        """Asserts prompt_generator.generate_base_rules() matches golden file exactly."""
        cat_path = os.path.join(REPO_ROOT, "catalogs", "basic", "v1", "catalog.json")
        cat_config = CatalogConfig.from_path("basic", cat_path)
        catalog = A2uiCatalog.from_config(cat_config)
        express_fmt = ExpressFormat(catalog=catalog)
        prompt_gen = express_fmt.prompt_generator

        golden_path = os.path.join(GOLDENS_DIR, "express_base_rules.txt")
        with open(golden_path, "r", encoding="utf-8") as f:
            expected = f.read()

        actual = prompt_gen.generate_base_rules()
        self.assertEqual(actual, expected)

    # The v1.0 basic catalog's examples write @path and @call, which the Express
    # decompiler doesn't read yet (https://github.com/a2ui-project/a2ui/issues/3006).
    @unittest.expectedFailure
    def test_prompt_generator_catalog_instructions_conformance(self):
        """Asserts prompt_generator.generate_catalog_instructions() matches golden file exactly."""
        cat_path = os.path.join(REPO_ROOT, "catalogs", "basic", "v1", "catalog.json")
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
                cat_rel_path = args.get("catalog")
                catalog = None
                if cat_rel_path:
                    abs_cat_path = os.path.join(REPO_ROOT, cat_rel_path)
                    cat_config = CatalogConfig.from_path("basic", abs_cat_path)
                    catalog = A2uiCatalog.from_config(cat_config)

                fmt_name = args.get("format", "express")
                if fmt_name == "express":
                    fmt = ExpressFormat(catalog=catalog) if catalog else ExpressFormat()
                elif fmt_name == "atom":
                    from a2ui.inference_formats.experimental.atom import AtomFormat

                    fmt = AtomFormat(catalog=catalog) if catalog else AtomFormat()
                elif fmt_name == "elemental":
                    from a2ui.inference_formats.experimental.elemental import (
                        ElementalFormat,
                    )

                    fmt = (
                        ElementalFormat(catalog=catalog)
                        if catalog
                        else ElementalFormat()
                    )
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
                    self._assert_matches_golden(
                        name, skill_obj.to_markdown(), expected_content
                    )

                elif action == "core_syntax":
                    core_name = args.get("name", "a2ui-core")
                    skill_obj = generator.generate_core_skill(name=core_name)
                    expected_rel = case["expected_file"]
                    expected_abs = os.path.join(REPO_ROOT, expected_rel)
                    with open(expected_abs, "r", encoding="utf-8") as gf:
                        expected_content = gf.read()
                    self._assert_matches_golden(
                        name, skill_obj.to_markdown(), expected_content
                    )

                elif action == "from_catalog":
                    skill_obj = generator.generate_catalog_skill(catalog)
                    expected_rel = case["expected_file"]
                    expected_abs = os.path.join(REPO_ROOT, expected_rel)
                    with open(expected_abs, "r", encoding="utf-8") as gf:
                        expected_content = gf.read()
                    self._assert_matches_golden(
                        name, skill_obj.to_markdown(), expected_content
                    )

                elif action == "skill_set":
                    skill_set = generator.generate_skillset()
                    expected_keys = case.get("expected_skills", [])
                    for k in expected_keys:
                        self.assertIn(k, skill_set.to_dict())


if __name__ == "__main__":
    unittest.main()
