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
        """Verifies exporting SkillSet to directory, ensuring stale skill files are wiped while sibling skills are preserved."""
        # 1. Pre-populate directory with a stale file inside a matching skill folder, an unrelated sibling skill, and a root note
        stale_core_dir = os.path.join(self.temp_dir.name, "a2ui-core")
        os.makedirs(stale_core_dir, exist_ok=True)
        stale_file = os.path.join(stale_core_dir, "stale_note.txt")
        with open(stale_file, "w", encoding="utf-8") as f:
            f.write("old data")

        unrelated_skill_dir = os.path.join(self.temp_dir.name, "unrelated-custom-skill")
        os.makedirs(unrelated_skill_dir, exist_ok=True)
        unrelated_file = os.path.join(unrelated_skill_dir, "SKILL.md")
        with open(unrelated_file, "w", encoding="utf-8") as f:
            f.write("custom content")

        root_note = os.path.join(self.temp_dir.name, "root_note.txt")
        with open(root_note, "w", encoding="utf-8") as f:
            f.write("keep me")

        # 2. Export skillset
        skill_set = self.generator.generate_skillset()
        exported = skill_set.export_to_directory(self.temp_dir.name)

        # 3. Assert skills were written
        self.assertIn("a2ui-core/SKILL.md", exported)
        self.assertTrue(
            os.path.exists(os.path.join(self.temp_dir.name, "a2ui-core", "SKILL.md"))
        )
        self.assertTrue(
            os.path.exists(os.path.join(self.temp_dir.name, "a2ui-basic", "SKILL.md"))
        )

        # 4. Assert stale file in matching skill folder was wiped
        self.assertFalse(os.path.exists(stale_file))

        # 5. Assert unrelated sibling skill and root note were strictly preserved
        self.assertTrue(os.path.exists(unrelated_file))
        with open(unrelated_file, "r", encoding="utf-8") as f:
            self.assertEqual(f.read(), "custom content")
        self.assertTrue(os.path.exists(root_note))

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

    def test_generate_catalog_skill_default(self):
        """Verifies generate_catalog_skill() defaults to the catalog bound to the format."""
        skill_obj = self.generator.generate_catalog_skill()
        self.assertEqual(skill_obj.name, "a2ui-basic")
        self.assertIn("Positional Component Signatures", skill_obj.content)

    def test_generate_with_explicit_catalogs_override(self):
        """Verifies methods accept explicit catalog arguments overriding format defaults."""
        testing_catalog_path = os.path.join(SPEC_DIR, "test", "testing_catalog.json")
        testing_catalog = A2uiCatalog.from_config(
            CatalogConfig.from_path("testing", testing_catalog_path)
        )

        # 1. generate_catalog_skill with explicit catalog generates for that catalog
        cat_skill = self.generator.generate_catalog_skill(testing_catalog)
        self.assertEqual(cat_skill.name, "a2ui-specification")

        # 2. generate_skillset with explicit catalogs only includes the specified catalog
        skill_set = self.generator.generate_skillset(catalogs=[testing_catalog])
        self.assertEqual(len(skill_set), 2)
        self.assertIn("a2ui-core/SKILL.md", skill_set)
        self.assertIn("a2ui-specification/SKILL.md", skill_set)
        self.assertNotIn("a2ui-basic/SKILL.md", skill_set)

        # 3. generate_skill with explicit catalogs only includes the specified catalog
        mono_skill = self.generator.generate_skill(catalogs=[testing_catalog])
        self.assertIn("TestComponent(value)", mono_skill.content)
        self.assertNotIn("Button(", mono_skill.content)


if __name__ == "__main__":
    unittest.main()
