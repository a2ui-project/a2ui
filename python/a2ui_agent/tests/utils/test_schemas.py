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

"""Tests for the protocol schema loaders in `a2ui.utils`."""

import copy
import json

import pytest

from a2ui.core import (
    A2uiCatalogError,
    get_agent_to_renderer_schema_json,
    get_common_types_schema_map,
)
from a2ui.core.schema import ProtocolVersion
from a2ui.utils import load_agent_to_renderer_schema, load_common_types_schema


@pytest.mark.parametrize(
    "version, protocol_version",
    [
        ("0.8", ProtocolVersion.V0_8),
        ("0.9", ProtocolVersion.V0_9),
        ("0.9.1", ProtocolVersion.V0_9_1),
        ("1.0", ProtocolVersion.V1_0),
        ("v1_0", ProtocolVersion.V1_0),
    ],
)
def test_agent_to_renderer_schema_matches_core(version, protocol_version):
    assert load_agent_to_renderer_schema(version) == json.loads(
        get_agent_to_renderer_schema_json(protocol_version)
    )


def test_agent_to_renderer_schema_rejects_unknown_version():
    with pytest.raises(A2uiCatalogError):
        load_agent_to_renderer_schema("not-a-version")


def test_agent_to_renderer_schema_returns_independent_copies():
    schema = load_agent_to_renderer_schema("0.9")
    expected = copy.deepcopy(schema)
    for value in schema.values():
        if isinstance(value, dict):
            value.clear()
    schema.clear()

    assert load_agent_to_renderer_schema("0.9") == expected


@pytest.mark.parametrize(
    "version, protocol_version",
    [
        ("0.9", ProtocolVersion.V0_9),
        ("0.9.1", ProtocolVersion.V0_9_1),
        ("1.0", ProtocolVersion.V1_0),
        ("v1_0", ProtocolVersion.V1_0),
    ],
)
def test_common_types_schema_matches_core(version, protocol_version):
    assert load_common_types_schema(version) == get_common_types_schema_map(
        protocol_version
    )


def test_common_types_schema_is_empty_before_v0_9():
    assert load_common_types_schema("0.8") == {}


def test_common_types_schema_rejects_unknown_version():
    with pytest.raises(A2uiCatalogError):
        load_common_types_schema("not-a-version")
