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

"""Unit and conformance tests for CatalogTransformer and pruning transformers."""

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

from a2ui.catalog_transformers import (
    CatalogTransformer,
    ComponentPruningTransformer,
    FunctionPruningTransformer,
)
from a2ui.core import Catalog, CatalogApi
from a2ui.core.catalog import ComponentApi, FunctionApi

from a2ui.core.schema import ProtocolVersion


_REPO_ROOT = Path(__file__).resolve().parents[3]
_CONFORMANCE_DIR = _REPO_ROOT / "conformance"
_TRANSFORMER_CONFORMANCE_YAML = _CONFORMANCE_DIR / "agent" / "catalog_transformer.yaml"


def _load_conformance_cases() -> list[dict[str, Any]]:
    with open(_TRANSFORMER_CONFORMANCE_YAML, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data if isinstance(data, list) else []


def _make_sample_catalog() -> CatalogApi:

    components = [
        ComponentApi(
            "Text",
            {
                "type": "object",
                "properties": {
                    "component": {"const": "Text"},
                    "text": {"$ref": "#/$defs/CustomDef"},
                },
                "required": ["component", "text"],
            },
        ),
        ComponentApi(
            "Button",
            {
                "type": "object",
                "properties": {
                    "component": {"const": "Button"},
                    "label": {"type": "string"},
                },
                "required": ["component", "label"],
            },
        ),
        ComponentApi(
            "Card",
            {
                "type": "object",
                "properties": {
                    "component": {"const": "Card"},
                    "child": {"type": "string"},
                },
                "required": ["component", "child"],
            },
        ),
    ]
    functions = [
        FunctionApi(
            "required",
            {
                "type": "object",
                "properties": {
                    "call": {"const": "required"},
                    "returnType": {"const": "boolean"},
                },
                "required": ["call", "returnType"],
            },
        ),
        FunctionApi(
            "formatString",
            {
                "type": "object",
                "properties": {
                    "call": {"const": "formatString"},
                    "returnType": {"$ref": "#/$defs/CustomDef"},
                },
                "required": ["call", "returnType"],
            },
        ),
    ]
    return Catalog(
        catalog_id="test/catalog",
        protocol_version=ProtocolVersion.V1_0,
        components=components,
        functions=functions,
        theme_schema={"primaryColor": {"type": "string"}},
        instructions="Custom catalog instructions.",
        defs={"CustomDef": {"type": "string"}},
        common_types_defs={"CheckRule": {"type": "object"}},
    )


def test_catalog_transformer_is_abstract() -> None:
    """Verifies CatalogTransformer cannot be instantiated without transform()."""
    with pytest.raises(TypeError):
        CatalogTransformer()  # type: ignore[abstract]


def test_component_pruning_preserves_immutability_and_metadata() -> None:
    """Verifies ComponentPruningTransformer returns a new Catalog without mutating input."""
    original = _make_sample_catalog()
    transformer = ComponentPruningTransformer(["Text", "Card"])

    transformed = transformer.transform(original)

    assert transformed is not original
    assert list(original.components.keys()) == ["Text", "Button", "Card"]
    assert list(transformed.components.keys()) == ["Text", "Card"]
    assert list(transformed.functions.keys()) == ["required", "formatString"]
    assert transformed.catalog_id == original.catalog_id
    assert transformed.protocol_version == original.protocol_version
    assert transformed.theme_schema == original.theme_schema
    assert transformed.instructions == original.instructions
    assert transformed.defs == original.defs
    assert transformed.common_types_defs == original.common_types_defs

    schema = transformed.catalog_schema
    assert set(schema["components"].keys()) == {"Text", "Card"}
    assert schema["$defs"]["anyComponent"]["oneOf"] == [
        {"$ref": "#/components/Text"},
        {"$ref": "#/components/Card"},
    ]


def test_function_pruning_preserves_immutability_and_metadata() -> None:
    """Verifies FunctionPruningTransformer returns a new Catalog without mutating input."""
    original = _make_sample_catalog()
    transformer = FunctionPruningTransformer(["formatString"])

    transformed = transformer.transform(original)

    assert transformed is not original
    assert list(original.functions.keys()) == ["required", "formatString"]
    assert list(transformed.functions.keys()) == ["formatString"]
    assert list(transformed.components.keys()) == ["Text", "Button", "Card"]
    assert transformed.catalog_id == original.catalog_id
    assert transformed.protocol_version == original.protocol_version
    assert transformed.theme_schema == original.theme_schema
    assert transformed.instructions == original.instructions
    assert transformed.defs == original.defs
    assert transformed.common_types_defs == original.common_types_defs

    schema = transformed.catalog_schema
    assert set(schema["functions"].keys()) == {"formatString"}
    assert schema["$defs"]["anyFunction"]["oneOf"] == [
        {"$ref": "#/functions/formatString"},
    ]


def test_pruning_transformers_none_vs_empty_allowlist() -> None:
    """Verifies None and empty allowlists both keep no items."""
    original = _make_sample_catalog()

    comp_none = ComponentPruningTransformer(None).transform(original)
    assert list(comp_none.components.keys()) == []
    assert list(comp_none.functions.keys()) == ["required", "formatString"]

    comp_empty = ComponentPruningTransformer([]).transform(original)
    assert list(comp_empty.components.keys()) == []
    assert list(comp_empty.functions.keys()) == ["required", "formatString"]

    func_none = FunctionPruningTransformer(None).transform(original)
    assert list(func_none.components.keys()) == ["Text", "Button", "Card"]
    assert list(func_none.functions.keys()) == []

    func_empty = FunctionPruningTransformer([]).transform(original)
    assert list(func_empty.components.keys()) == ["Text", "Button", "Card"]
    assert list(func_empty.functions.keys()) == []


@pytest.mark.parametrize(
    "case",
    _load_conformance_cases(),
    ids=lambda c: c.get("name", "unnamed"),
)
def test_catalog_transformer_conformance(case: dict[str, Any]) -> None:
    """Runs the language-agnostic conformance suite for catalog transformers."""
    args = case["args"]
    catalog_rel_path = args["catalog"]
    catalog_path = _CONFORMANCE_DIR / catalog_rel_path
    with open(catalog_path, encoding="utf-8") as f:
        raw_catalog = json.load(f)

    catalog: CatalogApi = Catalog.from_json(
        raw_catalog,
        protocol_version=raw_catalog.get("protocolVersion", "v1.0"),
        catalog_id=raw_catalog.get("catalogId", "conformance/fallback"),
    )

    for spec in args.get("transformers", []):
        if "component_pruning" in spec:
            transformer: CatalogTransformer = ComponentPruningTransformer(
                spec["component_pruning"]
            )
            catalog = transformer.transform(catalog)
        elif "function_pruning" in spec:
            transformer = FunctionPruningTransformer(spec["function_pruning"])
            catalog = transformer.transform(catalog)
        else:
            pytest.fail(f"Unknown transformer spec: {spec}")

    expect = case["expect"]
    if "components" in expect:
        assert list(catalog.components.keys()) == expect["components"]
    if "functions" in expect:
        assert list(catalog.functions.keys()) == expect["functions"]
    if "catalog_id" in expect:
        assert catalog.catalog_id == expect["catalog_id"]
    if "protocol_version" in expect:
        actual_ver = str(catalog.protocol_version)
        if not actual_ver.startswith("v"):
            actual_ver = f"v{actual_ver}"
        assert actual_ver == expect["protocol_version"]
