# Copyright 2024 Google LLC
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

"""Tests that the basic catalogs rebuild their published documents from models."""

import json
import os
from typing import Any

import pytest

from a2ui.core.basic_catalog import v0_8, v0_9, v1_0
from a2ui.core.catalog import Catalog

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
PACKAGE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../src/a2ui/core/basic_catalog")
)

# Each basic catalog module and its published file.
CASES = [
    (v0_8, "specification/v0_8/json/standard_catalog_definition.json"),
    (v0_9, "specification/v0_9/catalogs/basic/catalog.json"),
    (v1_0, "catalogs/basic/v1/catalog.json"),
]


def _load(path: str) -> dict[str, Any]:
    with open(os.path.join(REPO_ROOT, path), "r", encoding="utf-8") as f:
        return json.load(f)


def _normalized(node: Any) -> Any:
    """Sorts `enum` values and `required` names, whose order has no meaning."""
    if isinstance(node, list):
        return [_normalized(item) for item in node]
    if not isinstance(node, dict):
        return node
    result = {key: _normalized(value) for key, value in node.items()}
    for keyword in ("enum", "required"):
        if isinstance(result.get(keyword), list):
            result[keyword] = sorted(result[keyword], key=json.dumps)
    return result


@pytest.mark.parametrize(("module", "published"), CASES)
def test_to_json_rebuilds_the_published_document(module: Any, published: str) -> None:
    catalog = module.BasicCatalog()

    assert _normalized(catalog.to_json()) == _normalized(_load(published))


@pytest.mark.parametrize(("module", "published"), CASES)
def test_rebuilt_document_round_trips(module: Any, published: str) -> None:
    del published  # Unused.
    catalog = module.BasicCatalog()
    out = catalog.to_json()

    again = Catalog.from_json(
        out,
        catalog_id=catalog.catalog_id,
        protocol_version=catalog.protocol_version,
    ).to_json()
    assert again == out


@pytest.mark.parametrize(("module", "published"), CASES)
def test_basic_catalog_entries_are_defined_by_models(
    module: Any, published: str
) -> None:
    del published  # Unused.
    catalog = module.BasicCatalog()

    for name, component in catalog.components.items():
        assert component.model_class is not None, name
    for name, function in catalog.functions.items():
        assert not isinstance(function.schema, dict), name


def test_no_published_document_ships_in_the_package() -> None:
    shipped = [
        os.path.relpath(os.path.join(root, file), PACKAGE_DIR)
        for root, _, files in os.walk(PACKAGE_DIR)
        for file in files
        if file.endswith(".json")
    ]
    assert not shipped


def test_v08_nested_objects_of_different_shapes_keep_their_properties() -> None:
    # Each `value` object of the v0.8 document has its own literal type.
    v0_8.CheckBoxComponent.model_validate({
        "id": "c",
        "label": {"literalString": "Agree"},
        "value": {"literalBoolean": True},
    })
    v0_8.SliderComponent.model_validate({"id": "s", "value": {"literalNumber": 3}})
    v0_8.ButtonComponent.model_validate({
        "id": "b",
        "child": "t",
        "action": {
            "name": "go",
            "context": [{"key": "k", "value": {"literalString": "v"}}],
        },
    })
