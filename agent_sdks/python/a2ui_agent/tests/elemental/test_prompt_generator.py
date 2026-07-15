# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import unittest
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9
from a2ui.inference_formats.experimental.elemental.format import ElementalFormat


class TestElementalPromptGenerator(unittest.TestCase):

    def setUp(self):
        self.catalog = A2uiCatalog(
            version=VERSION_0_9,
            name="test_catalog",
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/test_catalog",
                "components": {
                    "Text": {
                        "properties": {"text": {"type": "string", "positionalIndex": 0}}
                    }
                },
                "functions": {
                    "openUrl": {
                        "properties": {"url": {"type": "string", "positionalIndex": 0}}
                    }
                },
            },
        )

    def test_elemental_prompt_generator_property(self):
        elemental_format = ElementalFormat(catalog=self.catalog)
        generator = elemental_format.prompt_generator

        prompt = generator.generate(
            role_description="You are an HTML generator.",
            workflow_description="Please output Elemental HTML.",
            include_schema=True,
        )
        assert "You are an HTML generator." in prompt
        assert "Please output Elemental HTML." in prompt
        assert "# A2UI Elemental Output Contract" in prompt
        assert "interface Text {" in prompt
