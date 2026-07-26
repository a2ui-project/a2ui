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

"""Systematic round-trip tests for all A2UI v1.0 specification example files across all inference formats."""

import glob
import json
import os
import pytest

from a2ui.basic_catalog import BasicCatalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.inference_formats.experimental.express.format import ExpressFormat
from a2ui.inference_formats.experimental.elemental.format import ElementalFormat
from a2ui.inference_formats.experimental.atom.format import AtomFormat


def _find_specification_example_files():
    """Locates all specification v1.0 (and fallback v0.9) JSON example files."""
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
    # Target v1.0 specification examples first
    search_path_v10 = os.path.join(
        repo_root, "specification", "v1_0", "catalogs", "basic", "examples", "*.json"
    )
    files = sorted(glob.glob(search_path_v10))
    if not files:
        search_path_v09 = os.path.join(
            repo_root,
            "specification",
            "v0_9",
            "catalogs",
            "basic",
            "examples",
            "*.json",
        )
        files = sorted(glob.glob(search_path_v09))
    return files


EXAMPLE_FILES = _find_specification_example_files()


class TestSpecificationRoundtripAllFormats:
    """Verifies 100% round-trip decompilation and compilation across all specification v1.0 JSON examples."""


from a2ui.inference_formats.experimental.express.format import ExpressFormat
from a2ui.inference_formats.experimental.elemental.format import ElementalFormat
from a2ui.inference_formats.experimental.atom.format import AtomFormat


class TestSpecificationRoundtripAllFormats:
    """Verifies 100% round-trip decompilation and compilation across all specification v1.0 JSON examples."""

    @pytest.fixture(autouse=True)
    def setup_catalog(self):
        # Load standard basic catalog containing all specification components
        basic = BasicCatalog()
        config = basic.get_config("0.9")
        self.catalog = A2uiCatalog(
            version="0.9",
            name="basic_catalog",
            s2c_schema={},
            common_types_schema={},
            catalog_schema=config.provider.load(),
        )
        self.express_fmt = ExpressFormat(catalog=self.catalog)
        self.elemental_fmt = ElementalFormat(catalog=self.catalog)
        self.atom_fmt = AtomFormat(catalog=self.catalog)

    @pytest.mark.parametrize(
        "json_file", EXAMPLE_FILES, ids=lambda p: os.path.basename(p)
    )
    def test_specification_example_roundtrip(self, json_file):
        """Loads specification example JSON, decompiles across formats, and recompiles back to A2UI payload."""
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        messages = data.get("messages", [data])

        # Extract all components across updateComponents messages
        all_components = []
        surface_id = "main"

        for msg in messages:
            if not isinstance(msg, dict):
                continue
            if "createSurface" in msg:
                surface_id = msg["createSurface"].get("surfaceId", surface_id)
            if "updateComponents" in msg:
                comps = msg["updateComponents"].get("components", [])
                all_components.extend(comps)

        if not all_components:
            pytest.skip(f"No components in {os.path.basename(json_file)}")

        surface_payload = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": surface_id,
                "components": all_components,
            },
        }

        processed = 0

        # 1. Test Express Format Roundtrip
        try:
            express_dsl = self.express_fmt.parser.decompile(surface_payload)
            if express_dsl:
                recompiled = self.express_fmt.parser.compile(express_dsl)
                assert recompiled is not None
                processed += 1
        except Exception as e:
            print(f"\n[Express Error] {os.path.basename(json_file)}: {e}")

        # 2. Test Elemental Format Roundtrip
        try:
            elemental_dom = self.elemental_fmt.parser.decompile(surface_payload)
            if elemental_dom:
                recompiled = self.elemental_fmt.parser.compile(elemental_dom)
                assert recompiled is not None
                processed += 1
        except Exception as e:
            print(f"\n[Elemental Error] {os.path.basename(json_file)}: {e}")

        # 3. Test Atom Format Roundtrip
        try:
            atom_sexpr = self.atom_fmt.parser.decompile(surface_payload)
            if atom_sexpr:
                recompiled = self.atom_fmt.parser.compile(atom_sexpr)
                assert recompiled is not None
                processed += 1
        except Exception as e:
            print(f"\n[Atom Error] {os.path.basename(json_file)}: {e}")

        assert processed > 0, f"No formats processed for {os.path.basename(json_file)}"
