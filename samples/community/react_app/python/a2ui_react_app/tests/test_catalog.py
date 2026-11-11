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

"""Tests for the ReactApp catalog and examples."""

from __future__ import annotations

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts
from a2ui.utils import validate_payload
from a2ui_react_app import REACT_APP_CATALOG_ID, react_app_catalog, react_app_examples


def test_catalog_defines_react_app_for_v1_0() -> None:
    catalog = react_app_catalog()

    assert catalog.catalog_id == REACT_APP_CATALOG_ID
    assert catalog.protocol_version == "1.0"
    component = catalog.to_json()["components"]["ReactApp"]
    assert component["required"] == ["component", "source"]
    assert set(component["properties"]) == {
        "component",
        "source",
        "title",
        "height",
        "dataPaths",
        "functions",
        "actions",
        "compiled",
    }


def test_examples_are_turns_that_validate_against_the_catalogs() -> None:
    catalogs = [BasicCatalog("1.0"), react_app_catalog()]
    examples = react_app_examples()

    assert len(examples) >= 2
    for turn in examples:
        validate_payload(catalogs, to_message_dicts(turn))
        components = [
            component
            for message in to_message_dicts(turn)
            for component in message.get("updateComponents", {}).get("components", [])
        ]
        assert any(c["component"] == "ReactApp" for c in components)
