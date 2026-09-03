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

"""Unit tests for A2UI SkillGenerator."""

import os
import unittest
import tempfile
import yaml

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill.generator import SkillGenerator, generate_skill
from a2ui.skill.skill import Skill, SkillSet


# Locate standard basic catalog in repository
SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "..",
        "..",
        "..",
        "specification",
        "v1_0",
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")


class TestSkillGenerator(unittest.TestCase):
    """Tests SkillGenerator functionality."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.catalog_config = CatalogConfig.from_path("basic", CATALOG_PATH)
        self.catalog = A2uiCatalog.from_config(self.catalog_config)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_unified_skill_generation(self):
        """Verifies unified skill generation with Express format."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        generator = SkillGenerator(express_fmt)

        skill_obj = generator.generate(name="a2ui-test")
        self.assertEqual(skill_obj.name, "a2ui-test")

        content = skill_obj.to_markdown()
        self.assertTrue(content.startswith("---"))
        self.assertIn("A2UI Express DSL Output Contract", content)

    def test_modular_skill_generation(self):
        """Verifies modular skill generation (core + catalog skills)."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        generator = SkillGenerator(express_fmt)

        skill_set = generator.generate_modular(catalogs=[self.catalog])
        self.assertIn("a2ui-core/SKILL.md", skill_set)
        self.assertEqual(len(skill_set), 2)

        core_skill = skill_set.get("a2ui-core")
        self.assertIsNotNone(core_skill)
        self.assertEqual(core_skill.name, "a2ui-core")

    def test_write_to_directory(self):
        """Verifies skill files are written to target directory."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        generate_skill(
            catalogs=[self.catalog],
            inference_format=express_fmt,
            output_dir=self.temp_dir.name,
        )

        expected_file = os.path.join(self.temp_dir.name, "a2ui", "SKILL.md")
        self.assertTrue(os.path.exists(expected_file))
        with open(expected_file, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("name: a2ui", content)


if __name__ == "__main__":
    unittest.main()
