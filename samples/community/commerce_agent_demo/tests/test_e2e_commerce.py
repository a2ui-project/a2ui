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

"""End-to-End test querying Gemini Managed Agent API with generated modular skills."""

import os
import unittest
from google import genai
from google.genai import types

from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.skill import generate_skill


API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPEC_DIR = os.path.abspath(
    os.path.join(BASE_DIR, "..", "..", "..", "specification", "v1_0")
)
BASIC_CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")
COMMERCE_CATALOG_PATH = os.path.join(BASE_DIR, "catalogs", "commerce_catalog.json")


class TestCommerceE2E(unittest.TestCase):
    """End-to-end integration test querying Gemini API with modular commerce skills."""

    def setUp(self):
        basic_cfg = CatalogConfig.from_path("basic", BASIC_CATALOG_PATH)
        self.basic_cat = A2uiCatalog.from_config(basic_cfg)

        commerce_cfg = CatalogConfig.from_path("commerce", COMMERCE_CATALOG_PATH)
        self.commerce_cat = A2uiCatalog.from_config(commerce_cfg)

        self.express_fmt = ExpressFormat(catalog=self.basic_cat)
        self.client = genai.Client(api_key=API_KEY)

    def test_e2e_live_gemini_commerce_skill(self):
        """Generates modular skills, queries Gemini 3.6 Flash live, and validates A2UI payload."""
        if not API_KEY:
            self.skipTest("GEMINI_API_KEY environment variable not set")
        # 1. Generate modular skills
        skills = generate_skill(
            catalogs=[self.basic_cat, self.commerce_cat],
            inference_format=self.express_fmt,
            modular=True,
        )
        self.assertIn("a2ui-core/SKILL.md", skills)
        self.assertIn(f"a2ui-{self.basic_cat.catalog_id}/SKILL.md", skills)
        self.assertIn(f"a2ui-{self.commerce_cat.catalog_id}/SKILL.md", skills)

        combined_skills = "\n\n".join(skills.values())

        # 2. Query Gemini API
        prompt = (
            "Show me Aura noise canceling headphones and ErgoPro mechanical keyboard"
            " with prices and stock status."
        )
        config = types.GenerateContentConfig(
            system_instruction=combined_skills,
            temperature=0.2,
        )

        response = self.client.models.generate_content(
            model="gemini-3.6-flash",
            contents=prompt,
            config=config,
        )

        output_text = response.text or ""
        self.assertIn("<a2ui>", output_text)
        self.assertIn("</a2ui>", output_text)

        # 3. Parse and validate A2UI message envelopes
        parser = self.express_fmt.parser
        a2ui_messages = parser.compile(output_text)

        self.assertIsInstance(a2ui_messages, list)
        self.assertGreaterEqual(len(a2ui_messages), 1)

        first_msg = a2ui_messages[0]
        self.assertIn("createSurface", first_msg)
        surface_data = first_msg["createSurface"]
        self.assertIn("components", surface_data)

        # Verify component presence
        comp_types = [
            c["component"] if "component" in c else c.get("call")
            for c in surface_data["components"]
        ]
        self.assertTrue(
            any(
                t in comp_types
                for t in ["ProductCard", "ProductGrid", "Card", "Column"]
            )
        )


if __name__ == "__main__":
    unittest.main()
