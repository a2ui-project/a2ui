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

"""Unit tests for A2UI Skill and SkillSet composition API."""

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


class TestSkillCompositionAPI(unittest.TestCase):
    """Tests Skill and SkillSet domain composition factory methods."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.catalog_config = CatalogConfig.from_path("basic", CATALOG_PATH)
        self.catalog = A2uiCatalog.from_config(self.catalog_config)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_skill_from_format_monolithic(self):
        """Verifies Skill.from_format() creating a monolithic Skill object."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        skill_obj = Skill.from_format(express_fmt, name="a2ui-custom-monolithic")

        self.assertEqual(skill_obj.name, "a2ui-custom-monolithic")
        self.assertIn("a2ui-custom-monolithic", skill_obj.filename)
        content = skill_obj.to_markdown()
        self.assertTrue(content.startswith("---"))
        self.assertIn("A2UI Express DSL Output Contract", content)

    def test_skill_from_catalog(self):
        """Verifies Skill.from_catalog() creating a catalog skill with clean LLM name."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        skill_obj = Skill.from_catalog(self.catalog, express_fmt)

        self.assertEqual(skill_obj.name, "a2ui-basic")
        self.assertIn("a2ui-basic/SKILL.md", skill_obj.filename)
        content = skill_obj.to_markdown()
        self.assertIn("Positional Component Signatures", content)

    def test_skill_core_syntax(self):
        """Verifies Skill.core_syntax() creating base grammar skill."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        core_skill = Skill.core_syntax(express_fmt, name="a2ui-base-core")

        self.assertEqual(core_skill.name, "a2ui-base-core")
        self.assertIn("A2UI Express DSL Output Contract", core_skill.content)

    def test_skillset_from_format_modular(self):
        """Verifies SkillSet.from_format() generating modular skill package."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        skill_set = SkillSet.from_format(express_fmt)

        self.assertIn("a2ui-core/SKILL.md", skill_set)
        self.assertIn("a2ui-basic/SKILL.md", skill_set)
        self.assertEqual(len(skill_set), 2)

        core_sk = skill_set["a2ui-core"]
        self.assertEqual(core_sk.name, "a2ui-core")

        basic_sk = skill_set["a2ui-basic"]
        self.assertEqual(basic_sk.name, "a2ui-basic")

    def test_export_to_directory(self):
        """Verifies exporting SkillSet to directory."""
        express_fmt = ExpressFormat(catalog=self.catalog)
        skill_set = SkillSet.from_format(express_fmt)
        exported = skill_set.export_to_directory(self.temp_dir.name)

        self.assertIn("a2ui-core/SKILL.md", exported)
        self.assertTrue(os.path.exists(os.path.join(self.temp_dir.name, "a2ui-core", "SKILL.md")))
        self.assertTrue(os.path.exists(os.path.join(self.temp_dir.name, "a2ui-basic", "SKILL.md")))


if __name__ == "__main__":
    unittest.main()
