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

from a2ui.core import A2uiCatalogError
from a2ui.core.basic_catalog import v0_9, v1_0
from a2ui.core.catalog import Catalog, ComponentApi, FunctionApi
from a2ui.core.processing import CapabilitiesOptions, MessageProcessor

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))

PUBLISHED_CATALOGS = [
    "catalogs/basic/v1/catalog.json",
    "catalogs/mcp/catalog.json",
    "catalogs/vegachart/v0_9/catalog.json",
    "catalogs/vegachart/v1/catalog.json",
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


def test_from_json_keeps_metadata_and_authored_schemas() -> None:
    document = _label_catalog()
    catalog = Catalog.from_json(document)

    assert catalog.schema_dialect == document["$schema"]
    assert catalog.schema_id == document["$id"]
    assert catalog.title == "Labels"
    assert catalog.description == "A catalog of labels."
    assert catalog.declared_protocol_version == "1.0"
    assert catalog.instructions == "Use Label for text."
    # Each entry's schema is its definition as written, with its `allOf`
    # mixin, local `$defs` reference and `common_types.json` reference.
    assert catalog.components["Label"].schema == document["components"]["Label"]
    assert catalog.functions["shout"].schema == document["functions"]["shout"]
    assert catalog.functions["shout"].return_type == "string"
    # The shared named `$defs` are kept; the unions are derived from the
    # entries, since they list them.
    assert catalog.defs == {
        "Weighted": document["$defs"]["Weighted"],
        "Unused": document["$defs"]["Unused"],
    }
    assert catalog.union_defs == {"anyComponent": None, "anyFunction": None}


def test_resolved_schemas_inline_local_defs_for_validation() -> None:
    catalog = Catalog.from_json(_label_catalog())
    resolved = catalog.resolved_component_schema("Label")

    assert resolved["allOf"][0] == _label_catalog()["$defs"]["Weighted"]
    assert resolved["allOf"][1]["properties"]["text"] == {
        "$ref": "#/$defs/DynamicString"
    }
    # The authored schema is unchanged.
    assert catalog.components["Label"].schema == _label_catalog()["components"]["Label"]


def test_to_json_writes_the_model_fields() -> None:
    # `to_json` assembles the document from the catalog's fields, so a
    # changed field is written, before the document is first computed.
    catalog = Catalog.from_json(_label_catalog())
    catalog.title = "Renamed"
    catalog.functions["shout"].description = "Upper-cases a string."
    catalog.components["Spacer"].allowed_parents = ["Label"]

    out = catalog.to_json()
    assert out["title"] == "Renamed"
    assert out["functions"]["shout"]["description"] == "Upper-cases a string."
    assert out["components"]["Spacer"]["allowedParents"] == ["Label"]


def test_to_json_and_validation_schema_are_computed_once() -> None:
    catalog = Catalog.from_json(_label_catalog())
    first = catalog.to_json()
    catalog.title = "Changed after the first call"

    assert catalog.to_json() == first
    assert catalog.to_json() is not catalog.to_json()
    assert catalog.validation_schema == catalog.validation_schema
    assert catalog.validation_schema is not catalog.validation_schema


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
        "$ref": "#/$defs/DynamicString",
        "description": "Represents a string",
    }


def test_to_json_returns_independent_copies() -> None:
    catalog = Catalog.from_json(_label_catalog())
    out = catalog.to_json()
    out["components"]["Label"]["mutated"] = True
    out["$defs"]["Weighted"]["mutated"] = True

    again = catalog.to_json()
    assert "mutated" not in again["components"]["Label"]
    assert "mutated" not in again["$defs"]["Weighted"]
    assert "mutated" not in catalog.components["Label"].schema
    assert "mutated" not in catalog.defs["Weighted"]


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


@pytest.mark.parametrize("version", ["v0.9", "1.0"])
@pytest.mark.parametrize(
    "functions",
    [
        # An entry that only describes its arguments.
        {"f": {"type": "object", "properties": {"a": {}}}},
        # An empty entry.
        {"f": {}},
        # A list entry without `parameters` or `returnType`.
        [{"name": "f", "description": "d"}],
        # Entries named like system functions.
        {"required": {"type": "object"}, "formatString": {}},
    ],
    ids=["args-only", "empty", "list-without-parameters", "system-names"],
)
def test_loaded_function_entries_round_trip(version: str, functions: Any) -> None:
    document = {
        "catalogId": "https://example.com/catalogs/f",
        "functions": functions,
    }
    catalog = Catalog.from_json(document, protocol_version=version)
    assert catalog.to_json() == document
    # A copy keeps its entries as they were loaded.
    assert catalog.copy_with().to_json() == document


@pytest.mark.parametrize("version", ["v0.9", "1.0"])
@pytest.mark.parametrize(
    "document",
    [
        # Function metadata that the model defaults, in the map form.
        {
            "functions": {
                "f": {
                    "returnType": None,
                    "allowedCallers": None,
                    "requiresUserActivation": None,
                }
            }
        },
        # The same in the v0.9 list form.
        {
            "functions": [{
                "name": "f",
                "returnType": None,
                "allowedCallers": None,
                "requiresUserActivation": None,
            }]
        },
        # A call schema whose `returnType` const is not a string.
        {
            "functions": {
                "f": {
                    "type": "object",
                    "properties": {"returnType": {"const": 5}},
                }
            }
        },
        # Function metadata written as the default.
        {
            "functions": {
                "f": {
                    "returnType": "any",
                    "allowedCallers": "rendererOnly",
                    "requiresUserActivation": False,
                }
            }
        },
        # Null component metadata.
        {
            "components": {
                "A": {
                    "type": "object",
                    "allowedParents": None,
                    "allowedChildren": None,
                }
            }
        },
        # Top-level instructions that are not a string.
        {"instructions": None},
        {"instructions": 3},
    ],
    ids=[
        "null-function-metadata",
        "null-function-metadata-list",
        "non-string-return-const",
        "default-function-metadata",
        "null-component-metadata",
        "null-instructions",
        "non-string-instructions",
    ],
)
def test_entry_metadata_the_model_defaults_round_trips(
    version: str, document: dict[str, Any]
) -> None:
    document = {"catalogId": "https://example.com/catalogs/m", **document}
    catalog = Catalog.from_json(document, protocol_version=version)
    assert catalog.to_json() == document
    assert catalog.copy_with().to_json() == document


def test_changed_function_metadata_is_written_over_the_entry() -> None:
    document = {
        "catalogId": "https://example.com/catalogs/m",
        "functions": {
            "f": {
                "type": "object",
                "properties": {"returnType": {"const": "string"}},
            },
            "g": {"returnType": None, "allowedCallers": None},
        },
    }
    catalog = Catalog.from_json(document, protocol_version="v0.9")
    f, g = catalog.functions["f"], catalog.functions["g"]
    f.return_type = "number"
    g.return_type = "boolean"
    g.allowed_callers = "rendererOrAgent"
    g.requires_user_activation = True

    out = catalog.copy_with(functions=[f, g]).to_json()["functions"]
    assert out["f"]["properties"]["returnType"] == {"const": "number"}
    assert out["g"] == {
        "returnType": "boolean",
        "allowedCallers": "rendererOrAgent",
        "requiresUserActivation": True,
    }


def test_function_is_definition_overrides_the_schema_shape() -> None:
    args = {"type": "object", "properties": {"a": {}}}
    entry = FunctionApi(name="f", schema=args, is_definition=True)
    wrapped = FunctionApi(name="g", schema={"returnType": "any"}, is_definition=False)
    out = Catalog(
        catalog_id="c", protocol_version="1.0", functions=[entry, wrapped]
    ).to_json()

    assert out["functions"]["f"] == args
    assert out["functions"]["g"]["properties"]["@call"] == {"const": "g"}


@pytest.mark.parametrize("version", ["v0.9", "1.0"])
def test_to_json_keeps_an_empty_theme_in_defs(version: str) -> None:
    document = {
        "catalogId": "https://example.com/catalogs/t",
        "$defs": {"theme": {}},
    }
    catalog = Catalog.from_json(document, protocol_version=version)
    assert catalog.theme_location == "$defs"
    assert catalog.to_json() == document


_DANGLING_REF: dict[str, Any] = {"$ref": "#/$defs/DynamicString"}


@pytest.mark.parametrize("version", ["0.9", "1.0"])
@pytest.mark.parametrize(
    "fields",
    [
        {"components": {"A": {"properties": {"t": _DANGLING_REF}}}},
        {
            "functions": {
                "f": {"properties": {"args": {"properties": {"t": _DANGLING_REF}}}}
            }
        },
        {"functions": [{"name": "f", "parameters": {"t": _DANGLING_REF}}]},
        {"theme": {"properties": {"t": _DANGLING_REF}}},
        {"$defs": {"theme": {"properties": {"t": _DANGLING_REF}}}},
        {"$defs": {"Own": {"properties": {"t": _DANGLING_REF}}}},
    ],
    ids=[
        "component",
        "map_function",
        "list_function",
        "theme",
        "defs_theme",
        "def",
    ],
)
def test_loaded_refs_to_undefined_common_types_round_trip(
    fields: dict[str, Any], version: str
) -> None:
    document = {"catalogId": "x", "protocolVersion": version, **fields}
    catalog = Catalog.from_json(document)

    assert catalog.to_json() == document
    assert catalog.copy_with().to_json() == document


def test_duplicate_list_function_names_are_rejected() -> None:
    document = {
        "catalogId": "x",
        "functions": [{"name": "f"}, {"name": "f", "returnType": "string"}],
    }
    with pytest.raises(A2uiCatalogError, match="definition 1 duplicates the name 'f'"):
        Catalog.from_json(document)


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
    catalog = Catalog.from_json(document, protocol_version="1.0")
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
    assert set(out["$defs"]) == {"Weight", "anyComponent", "anyFunction"}
    assert {ref for ref in _refs(out) if ref.startswith("#/$defs/")} == {
        "#/$defs/Weight"
    }
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
    # The published v0.9 basic catalog declares no `protocolVersion`.
    assert "protocolVersion" not in out


def test_code_defined_v10_catalog_always_emits_both_unions() -> None:
    catalog = Catalog(catalog_id="https://example.com/empty", protocol_version="1.0")
    out = catalog.to_json()

    _catalog_definition_validator().validate(out)
    assert out["$defs"] == {
        "anyComponent": {"not": {}},
        "anyFunction": {"not": {}},
    }


@pytest.mark.parametrize(
    "union_defs",
    [
        {"anyComponent": True},
        {"anyFunction": False},
        {"anyComponent": None},
        {"anyFunction": None},
    ],
    ids=[
        "anyComponent_true",
        "anyFunction_false",
        "anyComponent_null",
        "anyFunction_null",
    ],
)
def test_boolean_union_round_trips(union_defs: dict[str, bool | None]) -> None:
    doc = {"catalogId": "x", "$defs": union_defs}

    catalog = Catalog.from_json(doc)

    assert catalog.to_json() == doc
    assert catalog.copy_with().to_json() == doc


def test_null_union_is_listed_from_entries_when_copy_changes_them() -> None:
    doc = {
        "catalogId": "x",
        "components": {"A": {"type": "object"}, "B": {"type": "object"}},
        "$defs": {"anyComponent": None},
    }
    catalog = Catalog.from_json(doc)

    copy = catalog.copy_with(components=[catalog.components["A"]])

    assert copy._layout.null_unions == frozenset()
    assert copy.to_json()["$defs"]["anyComponent"] == {
        "oneOf": [{"$ref": "#/components/A"}],
        "discriminator": {"propertyName": "component"},
    }


def test_catalog_is_immutable_after_first_serialization() -> None:
    # `to_json` and `validation_schema` are cached on first use, so a catalog
    # must not be changed afterwards; `copy_with` derives a changed one.
    doc = {"catalogId": "x", "$defs": {"A": {"type": "string"}}}
    catalog = Catalog.from_json(doc)
    assert catalog.to_json() == doc

    catalog.defs["A"] = {"type": "number"}
    catalog.instructions = "hi"

    assert catalog.to_json() == doc
    changed = catalog.copy_with(defs={"A": {"type": "number"}})
    assert changed.to_json()["$defs"] == {"A": {"type": "number"}}


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
    v1 = Catalog(catalog_id="c", protocol_version="1.0", functions=[fn]).to_json()
    v09 = Catalog(catalog_id="c", protocol_version="v0.9", functions=[fn]).to_json()

    assert v1["functions"]["ping"]["properties"]["@call"] == {"const": "ping"}
    assert v1["functions"]["ping"]["allowedCallers"] == "agentOnly"
    assert v1["functions"]["ping"]["description"] == "Pings a host."
    assert v09["functions"]["ping"]["properties"]["call"] == {"const": "ping"}
    assert v09["functions"]["ping"]["properties"]["returnType"] == {"const": "boolean"}


@pytest.mark.parametrize("version", ["v0.9", "1.0"])
def test_function_without_a_schema_takes_any_args(version: str) -> None:
    def catalog(**schema: Any) -> Catalog:
        fn = FunctionApi(name="ping", allowed_callers="agentOnly", **schema)
        return Catalog(catalog_id="c", protocol_version=version, functions=[fn])

    without = catalog()
    empty = catalog(schema={})

    assert without.validation_schema == empty.validation_schema
    assert without.to_json() == empty.to_json()
    assert without.resolved_function_schema("ping") == {}
    assert without.to_json()["functions"]["ping"]["properties"]["args"] == {
        "type": "object",
        "additionalProperties": True,
    }
    read_back = Catalog.from_json(without.to_json())
    assert read_back.validation_schema["functions"]["ping"]["properties"]["args"] == {
        "type": "object",
        "unevaluatedProperties": True,
    }


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
        CapabilitiesOptions(versions=["1.0"], include_inline_catalogs=True)
    )
    inline = caps["1.0"]["inlineCatalogs"]

    assert inline == [catalog.to_json()]
    _catalog_definition_validator().validate(inline[0])


def test_v10_renderer_capabilities_inline_a_function_without_a_schema() -> None:
    catalog = Catalog(
        catalog_id="c",
        protocol_version="1.0",
        functions=[FunctionApi(name="ping")],
    )
    caps = MessageProcessor([catalog]).get_renderer_capabilities(
        CapabilitiesOptions(versions=["1.0"], include_inline_catalogs=True)
    )
    inline = caps["1.0"]["inlineCatalogs"]

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
    undeclared = Catalog.from_json({"catalogId": "c"}, protocol_version="v0.9")
    assert "protocolVersion" not in undeclared.validation_schema
    assert "protocolVersion" not in undeclared.to_json()
    # A catalog defined in code declares its canonical protocol version.
    assert (
        Catalog(catalog_id="c", protocol_version="v0.9").validation_schema[
            "protocolVersion"
        ]
        == "0.9"
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


@pytest.mark.parametrize(("version", "call_key"), [("v0.9", "call"), ("1.0", "@call")])
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
    [("v0.8", None), ("v0.9", True), ("1.0", True)],
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
        protocol_version="1.0",
    )
    props = catalog.validation_schema["components"]["Card"]["properties"]

    # A property named `title` stays a property; `title` keywords stay too.
    assert props["title"] == {"type": "string", "title": "Heading"}
    assert props["email"] == {
        "type": "string",
        "title": "Email address",
        "format": "email",
    }


def test_to_json_emits_catalog_id_only_when_the_document_declares_it() -> None:
    document = {"components": {"Text": {"type": "object", "properties": {}}}}
    loaded = Catalog.from_json(document, catalog_id="app", protocol_version="v0.8")

    assert loaded.catalog_id == "app"
    assert "catalogId" not in loaded.to_json()
    declared = Catalog.from_json(
        {**document, "catalogId": "app"}, protocol_version="v0.8"
    )
    assert declared.to_json()["catalogId"] == "app"
    assert (
        Catalog(catalog_id="app", protocol_version="1.0").to_json()["catalogId"]
        == "app"
    )


def test_from_json_reads_v08_styles_as_the_theme() -> None:
    styles = {"font": {"type": "string"}}
    catalog = Catalog.from_json(
        {"components": {}, "styles": styles},
        catalog_id="app",
        protocol_version="v0.8",
    )

    assert catalog.theme_schema == {"type": "object", "properties": styles}
    assert catalog.to_json() == {"components": {}, "styles": styles}


def test_validation_schema_flattens_mixins_and_preserves_extra_keywords() -> None:
    document = {
        "catalogId": "https://example.com/catalogs/extra",
        "protocolVersion": "1.0",
        "$defs": {
            "Weighted": {
                "type": "object",
                "properties": {
                    "weight": {"type": "number"},
                    "label": {"type": "number"},
                },
            }
        },
        "components": {
            "Box": {
                "type": "object",
                "anyOf": [{"required": ["a"]}, {"required": ["b"]}],
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/Weighted"},
                    {"oneOf": [{"required": ["a"]}, {"required": ["b"]}]},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "Box"},
                            "label": {"type": "string"},
                            "a": {"type": "string"},
                            "b": {"type": "string"},
                        },
                        "required": ["component", "label"],
                    },
                ],
            }
        },
    }
    catalog = Catalog.from_json(document)
    box = catalog.validation_schema["components"]["Box"]

    assert box["properties"]["label"] == {"type": "string"}
    assert "weight" in box["properties"]
    assert "accessibility" in box["properties"]
    assert box["required"] == ["id", "label", "component"]
    assert box["anyOf"] == [{"required": ["a"]}, {"required": ["b"]}]
    assert box["allOf"] == [{"oneOf": [{"required": ["a"]}, {"required": ["b"]}]}]
    assert "Weighted" not in catalog.validation_schema["$defs"]
    assert catalog.to_json() == document


def test_catalog_def_inlined_in_memory_and_restored_in_json() -> None:
    catalog = v1_0.BasicCatalog()
    text_raw = catalog.components["Text"].schema
    raw_weight_branch = text_raw["properties"]["weight"]["anyOf"][0]
    assert raw_weight_branch["type"] == "number"
    assert "$ref" not in raw_weight_branch
    assert raw_weight_branch["x-a2ui-catalog-def"] == "Weight"

    text_in_memory = catalog.resolved_component_schema("Text")
    weight_branch = text_in_memory["properties"]["weight"]["anyOf"][0]
    assert weight_branch["type"] == "number"
    assert "$ref" not in weight_branch
    assert "x-a2ui-catalog-def" not in weight_branch

    to_json_doc = catalog.to_json()
    assert to_json_doc["components"]["Text"]["properties"]["weight"] == {
        "$ref": "#/$defs/Weight"
    }
    assert to_json_doc["$defs"]["Weight"]["type"] == "number"

    val_schema = catalog.validation_schema
    assert val_schema["components"]["Text"]["properties"]["weight"] == {
        "$ref": "#/$defs/Weight"
    }
    assert val_schema["$defs"]["Weight"]["type"] == "number"

    parsed = Catalog.from_json(to_json_doc)
    parsed_raw_weight = parsed.components["Text"].schema["properties"]["weight"]
    assert parsed_raw_weight["type"] == "number"
    assert "$ref" not in parsed_raw_weight
    assert parsed_raw_weight["x-a2ui-catalog-def"] == "Weight"

    parsed_text = parsed.resolved_component_schema("Text")
    assert parsed_text["properties"]["weight"]["type"] == "number"
    assert "$ref" not in parsed_text["properties"]["weight"]
    assert "x-a2ui-catalog-def" not in parsed_text["properties"]["weight"]
    assert parsed.to_json() == to_json_doc
    assert parsed.validation_schema == val_schema


def test_catalog_def_preserves_field_level_description_and_default_overrides() -> None:
    from typing import Literal
    from pydantic import Field
    from a2ui.core.catalog.components import ModelComponentApi
    from a2ui.core.schema.v1_0.common_types import ComponentCommon

    class CustomWeightedComponent(ComponentCommon):
        component: Literal["CustomWeighted"] = "CustomWeighted"
        weight: v1_0.Weight = Field(
            ...,
            description="Custom weight override",
            json_schema_extra={"default": 2},
        )

    catalog = Catalog(
        catalog_id="https://example.com/catalogs/custom-weight",
        protocol_version="1.0",
        components=[ModelComponentApi(CustomWeightedComponent)],
    )
    doc = catalog.to_json()
    assert doc["$defs"]["Weight"] == {
        "type": "number",
        "description": (
            "The relative weight of this component within a Row or Column. This"
            " is similar to the CSS 'flex-grow' property. Note: this may ONLY be"
            " set when the component is a direct descendant of a Row or Column."
        ),
    }
    assert doc["components"]["CustomWeighted"]["properties"]["weight"] == {
        "$ref": "#/$defs/Weight",
        "description": "Custom weight override",
        "default": 2,
    }
    assert Catalog.from_json(doc).to_json() == doc


def test_catalog_definition_validates_catalog_schema_relaxation_cases() -> None:
    from pathlib import Path
    from pydantic import ValidationError
    from a2ui.core.schema.v1_0.catalog_definition import CatalogDefinition

    suite_path = (
        Path(REPO_ROOT)
        / "specification"
        / "v1_0"
        / "test"
        / "cases"
        / "catalog_schema_relaxation.json"
    )
    suite = json.loads(suite_path.read_text(encoding="utf-8"))
    for case in suite["tests"]:
        if case["valid"]:
            CatalogDefinition.model_validate(case["data"])
        else:
            with pytest.raises(ValidationError):
                CatalogDefinition.model_validate(case["data"])


def _catalog_with_ref(ref: str, version: str = "1.0") -> dict[str, Any]:
    return {
        "catalogId": "https://example.com/catalogs/refs",
        "protocolVersion": version,
        "components": {
            "Label": {
                "type": "object",
                "properties": {
                    "component": {"const": "Label"},
                    "text": {"$ref": ref},
                },
                "required": ["component", "text"],
            }
        },
    }


@pytest.mark.parametrize(
    "ref",
    [
        "basic_catalog.json#/components/Text",
        "other_catalog.json#/$defs/Shared",
        "foo/catalog.json#/components/Text",
        "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json#/components/Text",
        "common_types.json.bak#/$defs/DynamicString",
        "my_common_types.json#/$defs/DynamicString",
    ],
)
def test_v10_from_json_rejects_external_refs(ref: str) -> None:
    with pytest.raises(A2uiCatalogError) as excinfo:
        Catalog.from_json(_catalog_with_ref(ref))

    assert str(excinfo.value) == (
        f"Unsupported external $ref '{ref}' at"
        " /components/Label/properties/text/$ref: a v1.0 catalog may only"
        " reference its own components and functions (#/...) or"
        " common_types.json."
    )


def test_v10_from_json_rejects_external_ref_in_function_args() -> None:
    ref = "other_catalog.json#/functions/formatString/properties/args"
    document = {
        "catalogId": "https://example.com/catalogs/function_refs",
        "protocolVersion": "1.0",
        "functions": {
            "formatBadge": {
                "type": "object",
                "returnType": "string",
                "properties": {
                    "@call": {"const": "formatBadge"},
                    "args": {
                        "type": "object",
                        "properties": {"value": {"$ref": ref}},
                        "required": ["value"],
                    },
                },
                "required": ["@call", "args"],
            }
        },
    }

    with pytest.raises(A2uiCatalogError, match="Unsupported external") as excinfo:
        Catalog.from_json(document)

    assert (
        f"'{ref}' at /functions/formatBadge/properties/args/properties/value/$ref:"
        in str(excinfo.value)
    )


def test_v10_from_json_rejects_external_ref_in_defs_and_escapes_pointer() -> None:
    document = _catalog_with_ref("#/$defs/a~b/c")
    document["$defs"] = {
        "a~b/c": {"anyOf": [{"type": "string"}, {"$ref": "peer.json#/$defs/X"}]}
    }

    with pytest.raises(A2uiCatalogError) as excinfo:
        Catalog.from_json(document)

    assert "'peer.json#/$defs/X' at /$defs/a~0b~1c/anyOf/1/$ref:" in str(excinfo.value)


def test_v10_from_json_reports_the_first_external_ref_in_document_order() -> None:
    document = _catalog_with_ref("first.json#/$defs/A")
    document["$defs"] = {"Later": {"$ref": "second.json#/$defs/B"}}

    with pytest.raises(A2uiCatalogError, match="'first.json#/\\$defs/A'"):
        Catalog.from_json(document)


def test_v10_from_json_rejects_external_ref_when_version_is_passed() -> None:
    document = _catalog_with_ref("peer.json#/$defs/X")
    del document["protocolVersion"]

    with pytest.raises(A2uiCatalogError, match="Unsupported external \\$ref"):
        Catalog.from_json(document, protocol_version="1.0")


@pytest.mark.parametrize(
    "ref",
    [
        "#/$defs/Local",
        "#/components/Label",
        "common_types.json#/$defs/DynamicString",
        "./common_types.json#/$defs/DynamicString",
        "../v1_0/common_types.json#/$defs/DynamicString",
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString",
        "catalog.json#/components/Label",
    ],
)
def test_v10_from_json_accepts_local_and_common_types_refs(ref: str) -> None:
    document = _catalog_with_ref(ref)
    document["$defs"] = {"Local": {"type": "string"}}

    catalog = Catalog.from_json(document)

    assert set(catalog.components) == {"Label"}


@pytest.mark.parametrize("version", ["0.9", "0.9.1"])
def test_v09_from_json_keeps_external_refs(version: str) -> None:
    ref = "basic_catalog.json#/components/Text"

    catalog = Catalog.from_json(_catalog_with_ref(ref, version))

    assert catalog.components["Label"].schema["properties"]["text"] == {"$ref": ref}
