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

"""Checks the common_types schema generated from the Pydantic models.

Byte-for-byte equality with the published `common_types.json` is covered by
the `common_types` conformance suite. These tests cover what equality cannot:
that the generated schema is a valid Draft 2020-12 document, that data dumped
from the models validates against it, and that the dynamic-value index derived
from it matches the one derived from the specification.
"""

import glob
import importlib
import json
import os
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from pydantic import TypeAdapter
from referencing import Registry, Resource

from a2ui.core.catalog import get_common_types_schema_map
from a2ui.core.schema._dynamic_types import (
    build_dynamic_type_index,
    clean_schema_node,
)
from a2ui.core.schema.common_types_schema import (
    get_common_types_catalog_defs,
    get_dynamic_type_index,
)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SPEC_ROOT = os.path.join(REPO_ROOT, "specification")

# Schema packages keyed by specification directory. `schema.v0_9` serves both
# v0.9 and v0.9.1.
_SCHEMA_PACKAGES = {"v0_9": "v0_9", "v0_9_1": "v0_9", "v1_0": "v1_0"}

_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"


def _spec_versions() -> list[str]:
    """Specification directories that publish a common_types.json."""
    paths = glob.glob(os.path.join(SPEC_ROOT, "v*", "json", "common_types.json"))
    return sorted(os.path.basename(os.path.dirname(os.path.dirname(p))) for p in paths)


def _protocol_version(version: str) -> str:
    """Turns a directory name into a protocol version: 'v0_9_1' -> '0.9.1'."""
    return version[1:].replace("_", ".")


def _load_spec_defs(version: str) -> dict[str, Any]:
    path = os.path.join(SPEC_ROOT, version, "json", "common_types.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)["$defs"]


def test_every_published_version_has_a_schema_package() -> None:
    """A new specification version cannot silently skip these checks."""
    versions = _spec_versions()
    assert versions, f"No common_types.json found under {SPEC_ROOT}."
    assert set(versions) <= set(_SCHEMA_PACKAGES), versions


@pytest.mark.parametrize("version", _spec_versions())
def test_models_round_trip_through_generated_schema(version: str) -> None:
    """Data dumped from the models validates against the generated schema."""
    schema_map = get_common_types_schema_map(_protocol_version(version))
    # Formats are not checked: the `Extensions` key pattern uses Unicode
    # property classes (`\p{...}`), which Python's `re` cannot compile.
    Draft202012Validator(Draft202012Validator.META_SCHEMA).validate(schema_map)

    defs = importlib.import_module(
        f"a2ui.core.schema.{_SCHEMA_PACKAGES[version]}"
    ).COMMON_TYPES_DEFS

    # FunctionCall references `catalog.json#/$defs/anyFunction`, so resolve it
    # against a stub catalog with one function that takes object args.
    stub_catalog_uri = schema_map["$id"].rsplit("/", 1)[0] + "/catalog.json"
    registry: Registry[Any] = Registry().with_resource(
        stub_catalog_uri,
        Resource.from_contents({
            "$schema": _DRAFT_2020_12,
            "$defs": {
                "anyFunction": {
                    "type": "object",
                    "properties": {
                        "call": {"const": "fetchData"},
                        "args": {"type": "object"},
                    },
                    "required": ["call"],
                }
            },
        }),
    )

    cases: list[tuple[str, Any]] = [
        ("DataBinding", {"path": "/user/profile/name"}),
        ("ComponentCommon", {"id": "comp_header"}),
        ("FunctionCall", {"call": "fetchData", "args": {"query": "test"}}),
        (
            "CheckRule",
            {"condition": {"path": "/form/valid"}, "message": "Required field"},
        ),
        ("ChildList", ["header", "body"]),
        ("ChildList", {"componentId": "row_template", "path": "/items"}),
        ("Action", {"event": {"name": "submit"}}),
    ]
    for def_name, instance in cases:
        adapter = TypeAdapter(defs[def_name])
        dumped = adapter.dump_python(
            adapter.validate_python(instance),
            mode="json",
            by_alias=True,
            exclude_unset=True,
        )
        assert dumped == instance, def_name
        Draft202012Validator(
            {
                "$schema": schema_map.get("$schema", _DRAFT_2020_12),
                "$id": schema_map["$id"],
                "$defs": schema_map["$defs"],
                "$ref": f"#/$defs/{def_name}",
            },
            registry=registry,
        ).validate(dumped)


@pytest.mark.parametrize("version", _spec_versions())
def test_dynamic_type_index_matches_specification(version: str) -> None:
    """Dynamic value defs are identified identically in the spec and generated schema."""
    spec_index = build_dynamic_type_index(_load_spec_defs(version))
    index = get_dynamic_type_index(_protocol_version(version))

    assert index.names
    assert index.names == spec_index.names
    assert index.by_scalar_kind == spec_index.by_scalar_kind
    assert index.catch_all == spec_index.catch_all
    assert index.catch_all in index.names
    assert set(index.by_scalar_kind) == {"string", "number", "boolean"}

    # Inline Pydantic unions collapse into the def selected by their literal kinds.
    db_ref = {"$ref": "#/$defs/DataBinding"}
    fc_ref = {"$ref": "#/$defs/FunctionCall"}
    for literal, expected in (
        ({"type": "string"}, index.by_scalar_kind["string"]),
        ({"type": "integer"}, index.by_scalar_kind["number"]),
        ({"type": "boolean"}, index.by_scalar_kind["boolean"]),
        ({"type": "array", "items": {"type": "string"}}, index.catch_all),
    ):
        cleaned = clean_schema_node(
            {"anyOf": [literal, db_ref, fc_ref]}, dynamic_index=index
        )
        assert cleaned == {"$ref": f"#/$defs/{expected}"}

    # Unions without both a binding and a function call are left alone.
    plain = clean_schema_node(
        {"anyOf": [{"type": "string"}, db_ref]}, dynamic_index=index
    )
    assert plain == {"oneOf": [{"type": "string"}, db_ref]}


def _inline_refs(node: Any, defs: dict[str, Any]) -> Any:
    """Replaces local refs to `defs` with their content; siblings take precedence."""
    if isinstance(node, list):
        return [_inline_refs(item, defs) for item in node]
    if not isinstance(node, dict):
        return node
    ref = node.get("$ref")
    if isinstance(ref, str) and ref.removeprefix("#/$defs/") in defs:
        siblings = {k: v for k, v in node.items() if k != "$ref"}
        return _inline_refs({**defs[ref.removeprefix("#/$defs/")], **siblings}, defs)
    return {k: _inline_refs(v, defs) for k, v in node.items()}


@pytest.mark.parametrize("version", _spec_versions())
def test_catalog_defs_match_specification(version: str) -> None:
    """The defs that catalogs embed and validate with are the specification's.

    Catalogs keep helper models (e.g. `TemplateChildList`) as separate defs,
    so their refs are inlined before comparing. The one difference is
    `FunctionCall`: the specification composes it with the catalog's function
    union, which catalogs check separately, so catalogs embed the flat model
    schema; it must still reject unknown keys.
    """
    spec_defs = _load_spec_defs(version)
    catalog_defs = get_common_types_catalog_defs(_protocol_version(version))
    helpers = {
        name: schema for name, schema in catalog_defs.items() if name not in spec_defs
    }

    assert set(catalog_defs) >= set(spec_defs)
    for name, spec_def in spec_defs.items():
        catalog_def = _inline_refs(catalog_defs[name], helpers)
        if name == "FunctionCall":
            assert catalog_def["additionalProperties"] is False
            assert catalog_def["required"] == ["call"]
        else:
            assert catalog_def == spec_def, name
