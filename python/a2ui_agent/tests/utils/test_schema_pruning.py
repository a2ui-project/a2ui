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

"""Unit tests for the protocol schema pruning in `a2ui.utils`."""

import copy

import pytest

from a2ui.schema.utils import load_agent_to_renderer_schema
from a2ui.utils import prune_common_types_schema, prune_messages_schema

V09_A2R = {
    "oneOf": [
        {"$ref": "#/$defs/CreateSurfaceMessage"},
        {"$ref": "#/$defs/UpdateComponentsMessage"},
    ],
    "$defs": {
        "CreateSurfaceMessage": {"properties": {"theme": {"$ref": "#/$defs/Theme"}}},
        "UpdateComponentsMessage": {
            "properties": {"components": {"$ref": "#/$defs/ComponentList"}}
        },
        "Theme": {"type": "object"},
        "ComponentList": {"type": "array"},
    },
}


def test_prune_messages_v09_keeps_allowlisted_messages_and_their_defs():
    pruned = prune_messages_schema(V09_A2R, "0.9", ["CreateSurfaceMessage"])

    assert pruned["oneOf"] == [{"$ref": "#/$defs/CreateSurfaceMessage"}]
    assert set(pruned["$defs"]) == {"CreateSurfaceMessage", "Theme"}


def test_prune_messages_empty_allowlist_keeps_no_message():
    pruned = prune_messages_schema(V09_A2R, "v1.0", [])

    assert pruned["oneOf"] == []
    assert pruned["$defs"] == {}


def test_prune_messages_ignores_unknown_names():
    pruned = prune_messages_schema(
        V09_A2R, "0.9.1", ["UpdateComponentsMessage", "Unknown"]
    )

    assert pruned["oneOf"] == [{"$ref": "#/$defs/UpdateComponentsMessage"}]
    assert set(pruned["$defs"]) == {"UpdateComponentsMessage", "ComponentList"}


def test_prune_messages_leaves_the_input_unchanged():
    original = copy.deepcopy(V09_A2R)

    prune_messages_schema(V09_A2R, "0.9", ["CreateSurfaceMessage"])

    assert V09_A2R == original


def test_prune_messages_v08_prunes_properties():
    a2r = load_agent_to_renderer_schema("0.8")

    pruned = prune_messages_schema(a2r, "0.8", ["beginRendering", "surfaceUpdate"])

    assert set(pruned["properties"]) == {"beginRendering", "surfaceUpdate"}


def test_prune_messages_published_v10_schema():
    a2r = load_agent_to_renderer_schema("1.0")

    pruned = prune_messages_schema(a2r, "1.0", ["UpdateComponentsMessage"])

    assert pruned["oneOf"] == [{"$ref": "#/$defs/UpdateComponentsMessage"}]
    assert "UpdateComponentsMessage" in pruned["$defs"]
    assert "CreateSurfaceMessage" not in pruned["$defs"]


def test_prune_messages_rejects_a_single_string():
    with pytest.raises(TypeError, match="not a string"):
        prune_messages_schema(V09_A2R, "0.9", "CreateSurfaceMessage")


COMMON_TYPES = {
    "$defs": {
        "DynamicString": {"oneOf": [{"type": "string"}, {"$ref": "#/$defs/Binding"}]},
        "Binding": {"type": "object"},
        "DynamicNumber": {"type": "number"},
        "Unused": {"type": "boolean"},
    }
}


def test_prune_common_types_keeps_defs_any_schema_refers_to():
    catalog_schema = {
        "components": {
            "Text": {
                "properties": {
                    "text": {"$ref": "common_types.json#/$defs/DynamicString"}
                }
            }
        }
    }
    other_catalog_schema = {
        "components": {
            "Slider": {"properties": {"value": {"$ref": "#/$defs/DynamicNumber"}}}
        }
    }

    pruned = prune_common_types_schema(
        COMMON_TYPES, catalog_schema, other_catalog_schema
    )

    assert set(pruned["$defs"]) == {"DynamicString", "Binding", "DynamicNumber"}


def test_prune_common_types_without_referencing_schemas_keeps_nothing():
    assert prune_common_types_schema(COMMON_TYPES) == {"$defs": {}}


def test_prune_common_types_empty_schema():
    assert prune_common_types_schema({}, {"$ref": "#/$defs/DynamicString"}) == {}
