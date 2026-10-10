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

"""Tests for `Catalog.from_json`, `Catalog.to_json` and `validation_schema`."""

import json
import os
from typing import Any

import jsonschema
import pytest

from a2ui.core.basic_catalog import v0_9, v1_0
from a2ui.core.catalog import Catalog, ComponentApi, FunctionApi
from a2ui.core.processing import CapabilitiesOptions, MessageProcessor

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))

PUBLISHED_CATALOGS = [
    "catalogs/basic/v1/catalog.json",
    "catalogs/mcp/catalog.json",
    "specification/v0_9/catalogs/basic/catalog.json",
    "specification/v0_9/catalogs/minimal/catalog.json",
    "specification/v0_9_1/catalogs/basic/catalog.json",
]


def _load(path: str) -> dict[str, Any]:
    with open(os.path.join(REPO_ROOT, path), "r", encoding="utf-8") as f:
        return json.load(f)


def _refs(node: Any) -> list[str]:
    if isinstance(node, dict):
        found = [node["$ref"]] if isinstance(node.get("$ref"), str) else []
        for value in node.values():
            found.extend(_refs(value))
        return found
    if isinstance(node, list):
        return [ref for item in node for ref in _refs(item)]
    return []


def _catalog_definition_validator() -> jsonschema.Draft202012Validator:
    return jsonschema.Draft202012Validator(
        _load("specification/v1_0/json/catalog_definition.json")
    )


def _label_catalog(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://example.com/catalogs/labels.json",
        "title": "Labels",
        "description": "A catalog of labels.",
        "protocolVersion": "1.0",
        "catalogId": "https://example.com/catalogs/labels",
        "instructions": "Use Label for text.",
        "components": {
            "Label": {
                "type": "object",
                "allOf": [
                    {"$ref": "#/$defs/Weighted"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "Label"},
                            "text": {"$ref": "common_types.json#/$defs/DynamicString"},
                        },
                        "required": ["component", "text"],
                    },
                ],
            },
            "Spacer": {
                "type": "object",
                "properties": {"component": {"const": "Spacer"}},
                "required": ["component"],
            },
        },
        "functions": {
            "shout": {
                "type": "object",
                "returnType": "string",
                "properties": {
                    "@call": {"const": "shout"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "value": {"$ref": "common_types.json#/$defs/DynamicString"}
                        },
                        "required": ["value"],
                    },
                },
                "required": ["@call", "args"],
            }
        },
        "$defs": {
            "Weighted": {
                "type": "object",
                "properties": {"weight": {"type": "number"}},
            },
            "Unused": {"type": "string"},
            "anyComponent": {
                "oneOf": [
                    {"$ref": "#/components/Label"},
                    {"$ref": "#/components/Spacer"},
                ],
                "discriminator": {"propertyName": "component"},
            },
            "anyFunction": {"oneOf": [{"$ref": "#/functions/shout"}]},
        },
    }
    document.update(overrides)
    return document


# ==============================================================================
# 1. from_json keeps the authored document
# ==============================================================================


@pytest.mark.parametrize("path", PUBLISHED_CATALOGS)
def test_published_catalogs_round_trip(path: str) -> None:
    document = _load(path)
    out = Catalog.from_json(document).to_json()
    assert out == document
    assert Catalog.from_json(out).to_json() == out


def test_from_json_keeps_metadata_and_entry_sources() -> None:
    document = _label_catalog()
    catalog = Catalog.from_json(document)

    assert catalog.schema_dialect == document["$schema"]
    assert catalog.schema_id == document["$id"]
    assert catalog.title == "Labels"
    assert catalog.description == "A catalog of labels."
    assert catalog.components["Label"].source_json == document["components"]["Label"]
    assert catalog.functions["shout"].source_json == document["functions"]["shout"]


def test_from_json_validates_with_resolved_refs() -> None:
    # The validation schema localizes references and bundles common types,
    # while the authored JSON keeps them external.
    catalog = Catalog.from_json(_label_catalog())
    schema = catalog.validation_schema

    assert "DynamicString" in schema["$defs"]
    assert all(ref.startswith("#") for ref in _refs(schema))
    assert "Unused" not in catalog.to_json()["components"]["Label"]


def test_v10_loaded_catalog_validation_schema_bundles_common_types() -> None:
    catalog = Catalog.from_json({
        "protocolVersion": "1.0",
        "catalogId": "https://a2ui.org/catalogs/v10/bundled",
        "components": {
            "Label": {
                "type": "object",
                "properties": {
                    "component": {"const": "Label"},
                    "text": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "text"],
            }
        },
    })
    schema = catalog.validation_schema

    assert schema["catalogId"] == "https://a2ui.org/catalogs/v10/bundled"
    assert "DynamicString" in schema["$defs"]
    assert schema["components"]["Label"]["properties"]["text"] == {
        "$ref": "#/$defs/DynamicString"
    }


def test_to_json_returns_independent_copies() -> None:
    catalog = Catalog.from_json(_label_catalog())
    out = catalog.to_json()
    out["components"]["Label"]["mutated"] = True
    out["$defs"]["Weighted"]["mutated"] = True

    again = catalog.to_json()
    assert "mutated" not in again["components"]["Label"]
    assert "mutated" not in again["$defs"]["Weighted"]
    assert catalog.components["Label"].source_json is not None
    assert "mutated" not in catalog.components["Label"].source_json


def test_to_json_keeps_function_list_form() -> None:
    document = {
        "catalogId": "https://example.com/catalogs/list",
        "components": {},
        "functions": [{
            "name": "shout",
            "description": "Upper-cases a string.",
            "returnType": "string",
            "parameters": {
                "type": "object",
                "properties": {"value": {"type": "string"}},
            },
        }],
    }
    assert Catalog.from_json(document, protocol_version="v0.9").to_json() == document


def test_to_json_keeps_unknown_top_level_keys() -> None:
    document = _label_catalog(**{"x-owner": "team"})
    assert Catalog.from_json(document).to_json() == document


# ==============================================================================
# 2. Derived catalogs
# ==============================================================================


def test_copy_with_rebuilds_unions_and_drops_orphaned_defs() -> None:
    catalog = Catalog.from_json(_label_catalog())
    derived = catalog.copy_with(components=[catalog.components["Spacer"]], functions=[])
    out = derived.to_json()

    assert out["title"] == "Labels"
    assert out["protocolVersion"] == "1.0"
    assert out["components"] == {"Spacer": _label_catalog()["components"]["Spacer"]}
    assert out["functions"] == {}
    # `Weighted` was referenced only by the dropped Label; `Unused` never was.
    assert set(out["$defs"]) == {"Unused", "anyComponent", "anyFunction"}
    assert out["$defs"]["anyComponent"]["oneOf"] == [{"$ref": "#/components/Spacer"}]
    assert out["$defs"]["anyFunction"] == {"not": {}}


def test_copy_with_serializes_entries_without_source() -> None:
    catalog = Catalog.from_json(_label_catalog())
    changed = ComponentApi(
        "Spacer",
        {
            "type": "object",
            "properties": {
                "component": {"const": "Spacer"},
                "size": {"$ref": "#/$defs/DynamicNumber"},
            },
            "required": ["component"],
        },
        allowed_parents=["Label"],
    )
    derived = catalog.copy_with(components=[catalog.components["Label"], changed])
    spacer = derived.to_json()["components"]["Spacer"]

    assert spacer["properties"]["size"] == {
        "$ref": "common_types.json#/$defs/DynamicNumber"
    }
    assert spacer["allowedParents"] == ["Label"]
    # The union names the same components, so it is emitted as written.
    assert (
        derived.to_json()["$defs"]["anyComponent"]
        == _label_catalog()["$defs"]["anyComponent"]
    )


def test_source_without_unions_does_not_gain_them() -> None:
    document = {
        "catalogId": "https://example.com/catalogs/plain",
        "components": {
            "Spacer": {
                "type": "object",
                "properties": {"component": {"const": "Spacer"}},
            }
        },
    }
    catalog = Catalog.from_json(document, protocol_version="v1.0")
    added = FunctionApi(name="noop", return_type="void", schema={"type": "object"})
    out = catalog.copy_with(functions=[added]).to_json()

    assert "$defs" not in out
    assert out["functions"]["noop"]["properties"]["@call"] == {"const": "noop"}
    assert out["functions"]["noop"]["returnType"] == "void"


# ==============================================================================
# 3. Catalogs defined in code
# ==============================================================================


def test_v10_basic_catalog_to_json_is_a_valid_unbundled_document() -> None:
    catalog = v1_0.BasicCatalog()
    out = catalog.to_json()

    _catalog_definition_validator().validate(out)
    assert out["protocolVersion"] == "1.0"
    assert out["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert set(out["$defs"]) == {"anyComponent", "anyFunction"}
    assert not [ref for ref in _refs(out) if ref.startswith("#/$defs/")]
    assert "@index" not in out["functions"]
    for name, component in out["components"].items():
        assert "id" not in component.get("properties", {}), name
    published = _load("catalogs/basic/v1/catalog.json")
    assert set(out["components"]) == set(published["components"])
    assert set(out["functions"]) == set(published["functions"])
    assert out["functions"]["openUrl"]["requiresUserActivation"] is True


def test_v10_basic_catalog_to_json_round_trips() -> None:
    out = v1_0.BasicCatalog().to_json()
    assert Catalog.from_json(out).to_json() == out


def test_v09_basic_catalog_to_json_keeps_catalog_mixin_local() -> None:
    out = v0_9.BasicCatalog().to_json()
    local = {ref for ref in _refs(out) if ref.startswith("#/$defs/")}

    assert local == {"#/$defs/CatalogComponentCommon"}
    assert "CatalogComponentCommon" in out["$defs"]
    assert "theme" in out["$defs"]
    assert out["protocolVersion"] == "0.9"


def test_code_defined_v10_catalog_always_emits_both_unions() -> None:
    catalog = Catalog(catalog_id="https://example.com/empty", protocol_version="v1.0")
    out = catalog.to_json()

    _catalog_definition_validator().validate(out)
    assert out["$defs"] == {
        "anyComponent": {"not": {}},
        "anyFunction": {"not": {}},
    }


def test_code_defined_catalog_emits_metadata_it_was_given() -> None:
    catalog = Catalog(
        catalog_id="https://example.com/meta",
        protocol_version="v0.9.1",
        schema_id="https://example.com/meta.json",
        title="Meta",
        description="Has metadata.",
    )
    out = catalog.to_json()

    assert out["$id"] == "https://example.com/meta.json"
    assert out["title"] == "Meta"
    assert out["description"] == "Has metadata."
    assert out["protocolVersion"] == "0.9.1"


def test_code_defined_function_uses_version_call_shape() -> None:
    fn = FunctionApi(
        name="ping",
        return_type="boolean",
        schema={"type": "object", "properties": {"host": {"type": "string"}}},
        allowed_callers="agentOnly",
        description="Pings a host.",
    )
    v1 = Catalog(catalog_id="c", protocol_version="v1.0", functions=[fn]).to_json()
    v09 = Catalog(catalog_id="c", protocol_version="v0.9", functions=[fn]).to_json()

    assert v1["functions"]["ping"]["properties"]["@call"] == {"const": "ping"}
    assert v1["functions"]["ping"]["allowedCallers"] == "agentOnly"
    assert v1["functions"]["ping"]["description"] == "Pings a host."
    assert v09["functions"]["ping"]["properties"]["call"] == {"const": "ping"}
    assert v09["functions"]["ping"]["properties"]["returnType"] == {"const": "boolean"}


# ==============================================================================
# 4. validation_schema and its deprecated alias
# ==============================================================================


def test_catalog_schema_is_a_deprecated_alias() -> None:
    catalog = v1_0.BasicCatalog()
    with pytest.warns(DeprecationWarning, match="validation_schema"):
        legacy = catalog.catalog_schema
    assert legacy == catalog.validation_schema


def test_v10_renderer_capabilities_inline_catalogs_use_to_json() -> None:
    catalog = v1_0.BasicCatalog()
    processor = MessageProcessor([catalog])
    caps = processor.get_renderer_capabilities(
        CapabilitiesOptions(versions=["v1.0"], include_inline_catalogs=True)
    )
    inline = caps["v1.0"]["inlineCatalogs"]

    assert inline == [catalog.to_json()]
    _catalog_definition_validator().validate(inline[0])


def test_validation_schema_emits_a_declared_protocol_version_bare() -> None:
    catalog = Catalog.from_json(
        {"catalogId": "c", "protocolVersion": "v0.9.1", "components": {}},
        protocol_version="v0.9",
    )

    # `catalog_definition.json` requires the bare semantic version form;
    # `to_json` keeps the document as written.
    assert catalog.validation_schema["protocolVersion"] == "0.9.1"
    assert catalog.to_json()["protocolVersion"] == "v0.9.1"
    assert (
        "protocolVersion"
        not in Catalog(catalog_id="c", protocol_version="v0.9").validation_schema
    )


def test_v09_validation_schema_closes_authored_function_calls() -> None:
    catalog = Catalog.from_json(
        {
            "catalogId": "c",
            "functions": {
                "format": {
                    "type": "object",
                    "properties": {
                        "call": {"const": "format"},
                        "args": {
                            "type": "object",
                            "properties": {"amount": {"type": "number"}},
                            "required": ["amount"],
                        },
                        "returnType": {"const": "string"},
                    },
                    "required": ["call"],
                }
            },
        },
        protocol_version="v0.9",
    )

    assert catalog.functions["format"].return_type == "string"
    assert catalog.validation_schema["functions"]["format"] == {
        "type": "object",
        "properties": {
            "call": {"const": "format"},
            "args": {
                "type": "object",
                "properties": {"amount": {"type": "number"}},
                "required": ["amount"],
                "unevaluatedProperties": False,
            },
            "returnType": {"const": "string"},
        },
        "required": ["call", "args"],
        "unevaluatedProperties": False,
    }


def test_v10_validation_schema_leaves_function_entries_open() -> None:
    # `FunctionCall` composes each entry with `FunctionCommon`, whose
    # `catalogId` a closed entry would reject.
    entry = v1_0.BasicCatalog().validation_schema["functions"]["openUrl"]

    assert "unevaluatedProperties" not in entry
    assert "returnType" not in entry["properties"]


def _text_catalog(version: str, **document: Any) -> Catalog:
    return Catalog.from_json(
        {
            "catalogId": "app",
            "components": {
                "Text": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Text"},
                        "text": {"$ref": "common_types.json#/$defs/DynamicString"},
                    },
                    "required": ["component", "text"],
                }
            },
            **document,
        },
        protocol_version=version,
    )


def _local_refs(node: Any) -> list[str]:
    if isinstance(node, dict):
        refs = [node["$ref"]] if isinstance(node.get("$ref"), str) else []
        return refs + [r for v in node.values() for r in _local_refs(v)]
    if isinstance(node, list):
        return [r for v in node for r in _local_refs(v)]
    return []


@pytest.mark.parametrize(("version", "call_key"), [("v0.9", "call"), ("v1.0", "@call")])
def test_validation_schema_bundles_published_common_types(
    version: str, call_key: str
) -> None:
    catalog = _text_catalog(
        version,
        functions={
            "now": {
                "type": "object",
                "returnType": "string",
                "properties": {call_key: {"const": "now"}},
                "required": [call_key],
            }
        },
    )
    schema = catalog.validation_schema
    defs = schema["$defs"]

    # The published `FunctionCall` admits the catalog's functions through
    # `anyFunction`, and its cross-document references become local.
    assert "anyFunction" in json.dumps(defs["FunctionCall"])
    assert "common_types.json" not in json.dumps(schema)
    for ref in _local_refs(schema):
        section, name = ref.removeprefix("#/").split("/")
        assert name in schema[section], ref


@pytest.mark.parametrize(
    ("version", "expected"),
    [("v0.8", None), ("v0.9", True), ("v1.0", True)],
)
def test_validation_schema_states_an_open_theme(
    version: str, expected: bool | None
) -> None:
    theme = {"type": "object", "properties": {"primaryColor": {"type": "string"}}}
    catalog = _text_catalog(version, theme=theme)

    assert (
        catalog.validation_schema["$defs"]["theme"].get("additionalProperties")
        == expected
    )
    assert "additionalProperties" not in catalog.theme_schema


def test_validation_schema_keeps_a_closed_theme_closed() -> None:
    theme = {"type": "object", "properties": {}, "additionalProperties": False}
    catalog = _text_catalog("v0.9", theme=theme)

    assert catalog.validation_schema["$defs"]["theme"]["additionalProperties"] is False


def test_validation_schema_keeps_authored_titles() -> None:
    catalog = Catalog.from_json(
        {
            "catalogId": "app",
            "components": {
                "Card": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Card"},
                        "title": {"type": "string", "title": "Heading"},
                        "email": {
                            "type": "string",
                            "title": "Email address",
                            "format": "email",
                        },
                    },
                    "required": ["component"],
                }
            },
        },
        protocol_version="v1.0",
    )
    props = catalog.validation_schema["components"]["Card"]["properties"]

    # A property named `title` stays a property; `title` keywords stay too.
    assert props["title"] == {"type": "string", "title": "Heading"}
    assert props["email"] == {
        "type": "string",
        "title": "Email address",
        "format": "email",
    }
