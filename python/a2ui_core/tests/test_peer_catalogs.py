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

"""Tests for cross-catalog `$ref` resolution against peer catalogs."""

from __future__ import annotations

import json
import os
from typing import Any

import pytest

from a2ui.core import (
    A2uiValidationError,
    Catalog,
    CatalogApi,
    MessageProcessor,
    PayloadValidator,
    link_catalogs,
)
from a2ui.core.basic_catalog import BasicCatalog

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_CATALOGS = os.path.join(_REPO_ROOT, "conformance", "test_data", "catalogs")


def _load(rel_path: str) -> CatalogApi:
    with open(os.path.join(_CATALOGS, rel_path), encoding="utf-8") as f:
        return Catalog.from_json(json.load(f), protocol_version="v1.0")


def _catalog(
    catalog_id: str,
    components: dict[str, Any],
    *,
    schema_id: str | None = None,
    defs: dict[str, Any] | None = None,
) -> CatalogApi:
    document: dict[str, Any] = {
        "catalogId": catalog_id,
        "protocolVersion": "1.0",
        "components": components,
    }
    if schema_id is not None:
        document["$id"] = schema_id
    if defs is not None:
        document["$defs"] = defs
    return Catalog.from_json(document, protocol_version="v1.0")


def _component(name: str, ref: str, **extra: Any) -> dict[str, Any]:
    return {
        "type": "object",
        "allOf": [{"$ref": ref}],
        "properties": {"component": {"const": name}, **extra},
        "required": ["component"],
    }


def _badge(prop: str, schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"component": {"const": "Badge"}, prop: schema},
        "required": ["component", prop],
    }


def _props(catalog: CatalogApi, name: str) -> dict[str, Any]:
    return catalog.validation_schema["components"][name]["properties"]


def test_with_peer_catalogs_returns_a_copy_and_leaves_the_receiver_unchanged() -> None:
    cross_ref = _load("cross_ref_catalog_v1_0.json")
    simplified = _load("simplified_catalog_v1_0.json")
    schema_before = cross_ref.validation_schema
    resolved_before = cross_ref._resolved

    linked = cross_ref.with_peer_catalogs([simplified])

    assert linked is not cross_ref
    assert linked.peer_catalogs == (simplified,)
    assert cross_ref.peer_catalogs == ()
    assert cross_ref._resolved is resolved_before
    assert cross_ref.validation_schema == schema_before
    assert "text" in _props(linked, "CustomText")
    assert "text" not in _props(cross_ref, "CustomText")


def test_with_peer_catalogs_returns_the_receiver_when_nothing_changes() -> None:
    cross_ref = _load("cross_ref_catalog_v1_0.json")
    simplified = _load("simplified_catalog_v1_0.json")
    linked = cross_ref.with_peer_catalogs([simplified])

    assert linked.with_peer_catalogs([simplified]) is linked
    assert linked.with_peer_catalogs([cross_ref]) is linked


def test_link_catalogs_returns_catalogs_without_peer_refs_unchanged() -> None:
    basic = BasicCatalog("v1.0")
    cross_ref = _load("cross_ref_catalog_v1_0.json")
    simplified = _load("simplified_catalog_v1_0.json")

    linked = link_catalogs([basic, cross_ref, simplified])

    assert linked[0] is basic
    assert linked[2] is simplified
    assert linked[1] is not cross_ref
    assert basic.peer_catalogs == ()
    assert cross_ref.peer_catalogs == ()
    assert simplified.peer_catalogs == ()
    assert "text" in _props(linked[1], "CustomText")


def test_message_processor_does_not_mutate_shared_catalogs() -> None:
    basic = BasicCatalog("v1.0")
    simplified = _load("simplified_catalog_v1_0.json")
    cross_ref = _load("cross_ref_catalog_v1_0.json")
    basic_schema = basic.validation_schema
    cross_ref_schema = cross_ref.validation_schema

    first = MessageProcessor([basic, simplified, cross_ref])
    MessageProcessor([basic, _load("cross_ref_catalog_v1_0.json"), simplified])

    assert basic.peer_catalogs == ()
    assert cross_ref.peer_catalogs == ()
    assert basic.validation_schema == basic_schema
    assert cross_ref.validation_schema == cross_ref_schema
    linked_cross_ref = first.catalogs[2]
    assert linked_cross_ref is not cross_ref
    assert "text" in _props(linked_cross_ref, "CustomText")


def test_peer_matching_prefers_exact_id_over_catalog_json_file_name() -> None:
    base = "https://example.com/catalogs"
    alpha = _catalog(
        "alpha",
        {"Badge": _badge("label", {"type": "string"})},
        schema_id=f"{base}/alpha/catalog.json",
    )
    beta = _catalog(
        "beta",
        {"Badge": _badge("count", {"type": "integer"})},
        schema_id=f"{base}/beta/catalog.json",
    )
    referencing = _catalog(
        "referencing",
        {
            "Exact": _component("Exact", f"{base}/beta/catalog.json#/components/Badge"),
            "Suffix": _component("Suffix", "beta/catalog.json#/components/Badge"),
        },
    ).with_peer_catalogs([alpha, beta])

    assert "count" in _props(referencing, "Exact")
    assert "count" in _props(referencing, "Suffix")
    assert "label" not in _props(referencing, "Exact")


def test_peer_matching_resolves_mcp_catalog_json_by_file_name() -> None:
    mcp = _catalog(
        "mcp",
        {"Badge": _badge("icon", {"type": "string"})},
        schema_id="https://example.com/catalogs/mcp_catalog.json",
    )
    referencing = _catalog(
        "referencing",
        {"Icon": _component("Icon", "mcp_catalog.json#/components/Badge")},
    ).with_peer_catalogs([mcp])

    assert "icon" in _props(referencing, "Icon")
    validator = PayloadValidator(referencing)
    with pytest.raises(A2uiValidationError):
        validator.validate_component({"id": "i1", "component": "Icon"})
    validator.validate_component({"id": "i1", "component": "Icon", "icon": "star"})


def test_bare_catalog_json_refers_to_the_referencing_catalog() -> None:
    peer = _catalog(
        "peer",
        {"Badge": _badge("count", {"type": "integer"})},
        schema_id="https://example.com/catalogs/catalog.json",
    )
    referencing = _catalog(
        "referencing",
        {
            "Badge": _badge("label", {"type": "string"}),
            "Local": _component("Local", "catalog.json#/components/Badge"),
        },
    ).with_peer_catalogs([peer])

    assert "label" in _props(referencing, "Local")
    assert "count" not in _props(referencing, "Local")


def test_transitive_peer_refs_resolve_against_the_referencing_peers() -> None:
    c = _catalog("c", {"Badge": _badge("count", {"type": "integer"})})
    b = _catalog("b", {"Middle": _component("Middle", "c#/components/Badge")})
    a = _catalog("a", {"Top": _component("Top", "b#/components/Middle")})

    linked = link_catalogs([a, b, c])

    assert "count" in _props(linked[0], "Top")
    assert "count" in _props(linked[1], "Middle")


def test_pruned_peer_resolves_through_its_source_catalog() -> None:
    simplified = _load("simplified_catalog_v1_0.json")
    pruned = simplified.copy_with(
        components=[simplified.components["Card"], simplified.components["Button"]]
    )
    cross_ref = _load("cross_ref_catalog_v1_0.json")

    linked = cross_ref.with_peer_catalogs([pruned])

    assert simplified in linked.peer_catalogs
    assert "text" in _props(linked, "CustomText")


def test_peer_local_defs_with_the_referencing_catalogs_names_resolve_in_the_peer() -> (
    None
):
    mixin = {"type": "object", "properties": {"weight": {"type": "number"}}}
    peer = _catalog(
        "peer",
        {
            "Badge": {
                "type": "object",
                "allOf": [{"$ref": "#/$defs/Common"}],
                "properties": {
                    "component": {"const": "Badge"},
                    "tone": {"$ref": "#/$defs/Tone"},
                },
                "required": ["component"],
            }
        },
        defs={
            "Common": {
                "type": "object",
                "properties": {"peerOnly": {"type": "string"}},
            },
            "Tone": {"type": "string", "enum": ["loud", "quiet"]},
        },
    )
    referencing = _catalog(
        "referencing",
        {
            "Mine": {
                "type": "object",
                "allOf": [
                    {"$ref": "#/$defs/Common"},
                    {"$ref": "peer#/components/Badge"},
                ],
                "properties": {"component": {"const": "Mine"}},
                "required": ["component"],
            }
        },
        defs={"Common": mixin, "Tone": {"type": "integer"}},
    ).with_peer_catalogs([peer])

    props = _props(referencing, "Mine")
    assert "weight" in props
    assert "peerOnly" in props
    assert props["tone"]["enum"] == ["loud", "quiet"]
