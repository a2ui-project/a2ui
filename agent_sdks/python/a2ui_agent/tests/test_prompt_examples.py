# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests to ensure all prompt rules syntax examples parse cleanly through format compilers."""

import re
import pytest

from a2ui.core.catalog import Catalog
from a2ui.inference_formats.experimental.atom.compiler import AtomCompiler
from a2ui.inference_formats.experimental.atom.format import AtomFormat
from a2ui.inference_formats.experimental.atom.prompt_generator import ATOM_RULES
from a2ui.inference_formats.experimental.express.compiler import ExpressCompiler
from a2ui.inference_formats.experimental.express.format import ExpressFormat
from a2ui.inference_formats.experimental.express.prompt_generator import EXPRESS_RULES


def _extract_a2ui_examples(rules_text: str) -> list[str]:
    """Extracts multiline code blocks surrounded by <a2ui> and </a2ui> tags."""
    raw_matches = re.findall(r"<a2ui>\s*(.*?)\s*</a2ui>", rules_text, re.DOTALL)
    cleaned = []
    for m in raw_matches:
        s = m.strip("` \n")
        if len(s) > 15 and not s.startswith("and"):
            cleaned.append(s)
    return cleaned


from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9


class TestPromptExamplesValidity:
    """Verifies that all prompt generator example blocks compile with zero syntax/parser errors."""

    @pytest.fixture(autouse=True)
    def setup_catalog(self):
        self.catalog = A2uiCatalog(
            version=VERSION_0_9,
            name="test_catalog",
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "test_catalog",
                "components": {
                    "Card": {
                        "properties": {
                            "title": {"type": "string"},
                            "children": {"type": "array"},
                        }
                    },
                    "Column": {"properties": {"children": {"type": "array"}}},
                    "Row": {"properties": {"children": {"type": "array"}}},
                    "Text": {
                        "properties": {
                            "text": {"type": "string"},
                            "variant": {"type": "string"},
                        }
                    },
                    "TextField": {
                        "properties": {
                            "label": {"type": "string"},
                            "value": {"type": "string"},
                        }
                    },
                    "Button": {
                        "properties": {
                            "text": {"type": "string"},
                            "onPress": {"type": "object"},
                        }
                    },
                    "Tabs": {
                        "properties": {
                            "items": {"type": "array"},
                            "content": {"type": "array"},
                        }
                    },
                    "List": {
                        "properties": {
                            "items": {"type": "array"},
                            "template": {"type": "object"},
                        }
                    },
                    "ContainerComponent": {
                        "properties": {"children": {"type": "array"}}
                    },
                    "ChildComponent": {"properties": {"title": {"type": "string"}}},
                    "InputComponent": {
                        "properties": {
                            "label": {"type": "string"},
                            "value": {"type": "string"},
                        }
                    },
                    "ActionComponent": {
                        "properties": {
                            "label": {"type": "string"},
                            "onPress": {"type": "object"},
                        }
                    },
                    "ListComponent": {
                        "properties": {
                            "items": {"type": "array"},
                            "template": {"type": "object"},
                        }
                    },
                },
            },
        )

    def test_atom_prompt_generator_examples(self):
        """Verifies Atom format examples parse cleanly."""
        examples = _extract_a2ui_examples(ATOM_RULES)
        assert len(examples) > 0, "No <a2ui> examples found in ATOM_RULES"

        compiler = AtomCompiler(catalog=self.catalog)
        for i, example in enumerate(examples):
            try:
                clean_ex = example.strip()
                if clean_ex.startswith("```"):
                    clean_ex = re.sub(r"^```[a-z]*\n?", "", clean_ex)
                    clean_ex = re.sub(r"\n?```$", "", clean_ex)
                parsed = compiler.compile(clean_ex)
                assert parsed is not None, f"Atom Example {i+1} returned None payload"
            except Exception as e:
                pytest.fail(
                    f"Atom Prompt Example {i+1} failed to parse:\n{example}\nError: {e}"
                )

    def test_express_prompt_generator_examples(self):
        """Verifies Express format examples parse cleanly."""
        examples = _extract_a2ui_examples(EXPRESS_RULES)
        compiler = ExpressCompiler(catalog=self.catalog)
        for i, example in enumerate(examples):
            try:
                clean_ex = example.strip()
                if clean_ex.startswith("```"):
                    clean_ex = re.sub(r"^```[a-z]*\n?", "", clean_ex)
                    clean_ex = re.sub(r"\n?```$", "", clean_ex)
                parsed = compiler.compile(clean_ex)
                assert (
                    parsed is not None
                ), f"Express Example {i+1} returned None payload"
            except Exception as e:
                pytest.fail(
                    f"Express Prompt Example {i+1} failed to"
                    f" parse:\n{example}\nError: {e}"
                )
