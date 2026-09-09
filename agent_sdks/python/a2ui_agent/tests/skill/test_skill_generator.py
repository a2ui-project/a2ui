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

"""Unit tests for A2UI SkillGenerator API."""

import os
import tempfile
import unittest

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill import SkillGenerator


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
    """Tests SkillGenerator compilation methods."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.catalog_config = CatalogConfig.from_path("basic", CATALOG_PATH)
        self.catalog = A2uiCatalog.from_config(self.catalog_config)
        self.express_fmt = ExpressFormat(catalog=self.catalog)
        self.generator = SkillGenerator(self.express_fmt)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_generate_skill_monolithic(self):
        """Verifies SkillGenerator.generate_skill() creating a monolithic Skill object."""
        skill_obj = self.generator.generate_skill(name="a2ui-custom-monolithic")

        self.assertEqual(skill_obj.name, "a2ui-custom-monolithic")
        self.assertIn("a2ui-custom-monolithic", skill_obj.filename)
        content = skill_obj.to_markdown()
        self.assertTrue(content.startswith("---"))
        self.assertIn("A2UI Express DSL Output Contract", content)

    def test_generate_catalog_skill(self):
        """Verifies SkillGenerator.generate_catalog_skill() creating a catalog skill with clean LLM name."""
        skill_obj = self.generator.generate_catalog_skill(self.catalog)

        self.assertEqual(skill_obj.name, "a2ui-basic")
        self.assertIn("a2ui-basic/SKILL.md", skill_obj.filename)
        content = skill_obj.to_markdown()
        self.assertIn("Positional Component Signatures", content)

    def test_generate_core_skill(self):
        """Verifies SkillGenerator.generate_core_skill() creating base grammar skill."""
        core_skill = self.generator.generate_core_skill(name="a2ui-base-core")

        self.assertEqual(core_skill.name, "a2ui-base-core")
        self.assertIn("A2UI Express DSL Output Contract", core_skill.content)

    def test_generate_skillset_modular(self):
        """Verifies SkillGenerator.generate_skillset() generating modular skill package."""
        skill_set = self.generator.generate_skillset()

        self.assertIn("a2ui-core/SKILL.md", skill_set)
        self.assertIn("a2ui-basic/SKILL.md", skill_set)
        self.assertEqual(len(skill_set), 2)

        core_sk = skill_set["a2ui-core"]
        self.assertEqual(core_sk.name, "a2ui-core")

        basic_sk = skill_set["a2ui-basic"]
        self.assertEqual(basic_sk.name, "a2ui-basic")

    def test_export_to_directory(self):
        """Verifies exporting SkillSet to directory."""
        skill_set = self.generator.generate_skillset()
        exported = skill_set.export_to_directory(self.temp_dir.name)

        self.assertIn("a2ui-core/SKILL.md", exported)
        self.assertTrue(
            os.path.exists(os.path.join(self.temp_dir.name, "a2ui-core", "SKILL.md"))
        )
        self.assertTrue(
            os.path.exists(os.path.join(self.temp_dir.name, "a2ui-basic", "SKILL.md"))
        )

    def test_skill_set_get_matching_rules(self):
        """Verifies SkillSet.get matching rules (exact key, exact name, min-3-char substring)."""
        skill_set = self.generator.generate_skillset()

        # 1. Exact key match
        self.assertIsNotNone(skill_set.get("a2ui-core/SKILL.md"))
        self.assertEqual(skill_set.get("a2ui-core/SKILL.md").name, "a2ui-core")

        # 2. Exact name match
        self.assertIsNotNone(skill_set.get("a2ui-core"))
        self.assertEqual(skill_set.get("a2ui-core").name, "a2ui-core")

        # 3. Substring match with >= 3 characters
        self.assertIsNotNone(skill_set.get("basic"))
        self.assertEqual(skill_set.get("basic").name, "a2ui-basic")

        # 4. Substring match with < 3 characters must NOT match
        self.assertIsNone(skill_set.get("ba"))
        self.assertIsNone(skill_set.get("c"))

        # 5. Non-matching string returns None
        self.assertIsNone(skill_set.get("nonexistent"))

    def test_direct_json_prompt_generator_none_format(self):
        """Verifies DirectJsonPromptGenerator.generate_examples returns empty string when format is None."""
        from a2ui.inference_formats.direct_json.prompt_generator import (
            DirectJsonPromptGenerator,
        )

        gen = DirectJsonPromptGenerator(None)
        self.assertEqual(gen.generate_examples(), "")

    def test_atom_prompt_generator_none_format(self):
        """Verifies AtomPromptGenerator.generate_examples returns empty string when format is None."""
        from a2ui.inference_formats.experimental.atom.prompt_generator import (
            AtomPromptGenerator,
        )

        gen = AtomPromptGenerator(None)
        self.assertEqual(gen.generate_examples(), "")


if __name__ == "__main__":
    unittest.main()
