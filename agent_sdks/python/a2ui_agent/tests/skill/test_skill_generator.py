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

"""Unit tests for A2UI SkillGenerator and CLI entry points."""

import os
import sys
import unittest
import tempfile
import yaml
from unittest.mock import patch

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.catalog import CatalogConfig
from a2ui.skill.config import SkillConfig
from a2ui.skill.generator import SkillGenerator, generate_skill
from a2ui.skill.__main__ import main as cli_main


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

    def test_unified_skill_generation_express(self):
        """Verifies unified skill generation with Express format."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        generator = SkillGenerator()

        skills = generator.generate_skill(
            catalogs=[self.catalog],
            inference_format=express_fmt,
            modular=False,
        )

        self.assertIn("a2ui/SKILL.md", skills)
        content = skills["a2ui/SKILL.md"]

        self.assertTrue(content.startswith("---"))
        parts = content.split("---", 2)
        self.assertEqual(len(parts), 3)

        frontmatter_data = yaml.safe_load(parts[1])
        self.assertEqual(frontmatter_data["name"], "a2ui")
        self.assertEqual(frontmatter_data["metadata"]["inference_format"], "express")

        # Verify body contains Express rules and positional signatures
        body = parts[2]
        self.assertIn("A2UI Express DSL Output Contract", body)
        self.assertIn("Button(", body)

    def test_modular_skill_generation(self):
        """Verifies modular skill generation (core + catalog skills)."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        generator = SkillGenerator()

        skills = generator.generate_skill(
            catalogs=[self.catalog],
            inference_format=express_fmt,
            modular=True,
        )

        self.assertIn("a2ui-core/SKILL.md", skills)
        cat_id = express_fmt.catalog.catalog_id
        self.assertIn(f"a2ui-{cat_id}/SKILL.md", skills)

        core_content = skills["a2ui-core/SKILL.md"]
        self.assertIn("A2UI Express DSL Output Contract", core_content)

        cat_content = skills[f"a2ui-{cat_id}/SKILL.md"]
        self.assertIn("Positional Component Signatures", cat_content)

    def test_custom_overrides_and_metadata(self):
        """Verifies custom name, description, and metadata overrides."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        skills = generate_skill(
            catalogs=[self.catalog],
            inference_format=express_fmt,
            name="a2ui-finance",
            description="Custom finance UI description.",
            metadata={"custom_key": "custom_val"},
        )

        self.assertIn("a2ui-finance/SKILL.md", skills)
        content = skills["a2ui-finance/SKILL.md"]
        parts = content.split("---", 2)
        fm = yaml.safe_load(parts[1])

        self.assertEqual(fm["name"], "a2ui-finance")
        self.assertEqual(fm["description"], "Custom finance UI description.")
        self.assertEqual(fm["metadata"]["custom_key"], "custom_val")

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

    def test_cli_main_runner(self):
        """Verifies python -m a2ui.skill CLI runner."""
        test_args = [
            CATALOG_PATH,
            "--inference-format",
            "express",
            "--name",
            "a2ui-cli-test",
            "--output-dir",
            self.temp_dir.name,
        ]
        cli_main(test_args)

    def test_generate_domain_objects(self):
        """Verifies generator.generate() and generate_modular() returning Skill and SkillSet."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        generator = SkillGenerator(express_fmt, name="a2ui-domain-test")

        # Test monolithic Skill object
        skill_obj = generator.generate()
        self.assertEqual(skill_obj.name, "a2ui-domain-test")
        self.assertIn("A2UI Express DSL Output Contract", skill_obj.content)
        self.assertTrue(skill_obj.to_markdown().startswith("---"))

        # Mutate Skill fields
        skill_obj.name = "a2ui-custom-mutated"
        skill_obj.metadata["custom_flag"] = True
        self.assertIn("name: a2ui-custom-mutated", skill_obj.to_markdown())
        self.assertIn("custom_flag: true", skill_obj.to_markdown())

        # Test modular SkillSet object
        skill_set = generator.generate_modular(catalogs=[self.catalog])
        self.assertIn("a2ui-core/SKILL.md", skill_set)
        self.assertEqual(len(skill_set), 2)

        core_skill = skill_set.get("a2ui-core")
        self.assertIsNotNone(core_skill)
        self.assertEqual(core_skill.name, "a2ui-core")

        # Export SkillSet to directory
        exported = skill_set.export_to_directory(self.temp_dir.name)
        self.assertIn("a2ui-core/SKILL.md", exported)
        self.assertTrue(os.path.exists(os.path.join(self.temp_dir.name, "a2ui-core", "SKILL.md")))


if __name__ == "__main__":
    unittest.main()
