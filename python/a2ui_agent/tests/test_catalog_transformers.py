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

"""Unit tests for the catalog transformers and their use in `CatalogConfig`.

The shared `conformance/agent/catalog_transformer.yaml` suite covers which
names an allowlist keeps. These tests cover what the suite can't state: the
generated schema, the untouched input, and the order that `CatalogConfig`
applies transformers in.
"""

from typing import Any

import pytest

from a2ui.catalog_transformers import (
    CatalogTransformer,
    ComponentPruningTransformer,
    FunctionPruningTransformer,
)
from a2ui.core import Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import ComponentApi, FunctionApi
from a2ui.schema import CatalogConfig, InMemoryCatalogProvider


def _refs(any_schema: dict[str, Any]) -> set[str]:
    return {item["$ref"] for item in any_schema["oneOf"]}


def test_component_pruning_regenerates_any_component():
    pruned = ComponentPruningTransformer(["Text", "Column"]).transform(
        BasicCatalog("0.9")
    )

    schema = pruned.catalog_schema
    assert set(schema["components"]) == {"Text", "Column"}
    assert _refs(schema["$defs"]["anyComponent"]) == {
        "#/components/Text",
        "#/components/Column",
    }


def test_function_pruning_regenerates_any_function():
    pruned = FunctionPruningTransformer(["email"]).transform(BasicCatalog("0.9"))

    schema = pruned.catalog_schema
    assert set(schema["functions"]) == {"email"}
    assert _refs(schema["$defs"]["anyFunction"]) == {"#/functions/email"}


def test_pruning_removes_unreferenced_helper_defs():
    catalog = Catalog(
        catalog_id="custom",
        protocol_version="0.9",
        components=[
            ComponentApi(
                "Card",
                {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Card"},
                        "style": {"$ref": "#/$defs/CardStyle"},
                    },
                },
            ),
            ComponentApi(
                "Badge",
                {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Badge"},
                        "variant": {"$ref": "#/$defs/BadgeVariant"},
                    },
                },
            ),
        ],
        functions=[
            FunctionApi(
                name="formatBadge",
                return_type="string",
                schema={
                    "type": "object",
                    "properties": {
                        "args": {
                            "type": "object",
                            "properties": {
                                "variant": {"$ref": "#/$defs/FnArgDef"},
                            },
                        }
                    },
                },
            )
        ],
        defs={
            "CardStyle": {
                "type": "object",
                "properties": {"border": {"$ref": "#/$defs/BorderStyle"}},
            },
            "BorderStyle": {"type": "string"},
            "BadgeVariant": {"type": "string", "enum": ["primary", "secondary"]},
            "FnArgDef": {"type": "string"},
        },
    )

    pruned_comps = ComponentPruningTransformer(["Card"]).transform(catalog)
    comp_defs = pruned_comps.catalog_schema["$defs"]
    assert "CardStyle" in comp_defs
    assert "BorderStyle" in comp_defs
    assert "FnArgDef" in comp_defs
    assert "BadgeVariant" not in comp_defs

    pruned_fns = FunctionPruningTransformer([]).transform(pruned_comps)
    fn_defs = pruned_fns.catalog_schema["$defs"]
    assert "CardStyle" in fn_defs
    assert "BorderStyle" in fn_defs
    assert "FnArgDef" not in fn_defs
    assert "BadgeVariant" not in fn_defs


def test_pruning_keeps_the_rest_of_the_catalog():
    catalog = BasicCatalog("0.9")

    pruned = ComponentPruningTransformer(["Text"]).transform(catalog)

    assert pruned.catalog_id == catalog.catalog_id
    assert pruned.protocol_version == catalog.protocol_version
    assert pruned.instructions == catalog.instructions
    assert pruned.theme_schema == catalog.theme_schema
    assert set(pruned.functions) == set(catalog.functions)


def test_pruning_leaves_the_input_catalog_unchanged():
    catalog = BasicCatalog("0.9")
    components = set(catalog.components)
    functions = set(catalog.functions)

    ComponentPruningTransformer(["Text"]).transform(catalog)
    FunctionPruningTransformer([]).transform(catalog)

    assert set(catalog.components) == components
    assert set(catalog.functions) == functions


@pytest.mark.parametrize(
    "transformer_class", [ComponentPruningTransformer, FunctionPruningTransformer]
)
def test_pruning_rejects_a_single_string(transformer_class):
    with pytest.raises(TypeError, match="not a string"):
        transformer_class("Text")


def test_pruning_v08_catalog():
    pruned = ComponentPruningTransformer(["Text", "Column"]).transform(
        BasicCatalog("0.8")
    )

    assert set(pruned.components) == {"Text", "Column"}
    assert set(pruned.catalog_schema["components"]) == {"Text", "Column"}


class _RecordingTransformer(CatalogTransformer):
    """Records the components of each catalog it sees."""

    def __init__(self, log: list[set[str]]):
        self._log = log

    def transform(self, catalog: CatalogApi) -> CatalogApi:
        self._log.append(set(catalog.components))
        return catalog


def test_to_catalog_applies_transformers_in_order():
    log: list[set[str]] = []
    config = CatalogConfig.from_catalog(
        "basic",
        BasicCatalog("0.9"),
        transformers=[
            ComponentPruningTransformer(["Text", "Column", "Row"]),
            _RecordingTransformer(log),
            ComponentPruningTransformer(["Text", "Button"]),
        ],
    )

    catalog = config.to_catalog()

    assert log == [{"Text", "Column", "Row"}]
    assert set(catalog.components) == {"Text"}


def test_to_catalog_applies_transformers_after_schema_modifiers():
    def add_marquee(schema: dict[str, Any]) -> dict[str, Any]:
        schema["components"]["Marquee"] = {
            "type": "object",
            "properties": {"component": {"const": "Marquee"}},
        }
        return schema

    config = CatalogConfig(
        name="custom",
        provider=InMemoryCatalogProvider({
            "catalogId": "custom",
            "components": {
                "Text": {
                    "type": "object",
                    "properties": {"component": {"const": "Text"}},
                },
            },
        }),
        transformers=[ComponentPruningTransformer(["Marquee"])],
    )

    catalog = config.to_catalog(protocol_version="0.9", schema_modifiers=[add_marquee])

    assert set(catalog.components) == {"Marquee"}


def test_from_path_accepts_transformers(tmp_path):
    path = tmp_path / "catalog.json"
    path.write_text(
        '{"catalogId": "custom", "components": {"Text": {}, "Image": {}}}',
        encoding="utf-8",
    )
    config = CatalogConfig.from_path(
        "custom", str(path), transformers=[ComponentPruningTransformer(["Image"])]
    )

    assert set(config.to_catalog(protocol_version="0.9").components) == {"Image"}


def test_catalog_config_without_transformers_returns_the_catalog():
    catalog = BasicCatalog("0.9")

    assert CatalogConfig.from_catalog("basic", catalog).to_catalog() is catalog
