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

"""Unit tests for A2UI version adapters and VersionAdapterFactory."""

import pytest

from a2ui.core.processing.adapters import (
    VersionAdapterFactory,
    VersionAdapterV09,
    VersionAdapterV10,
)
from a2ui.core.schema import A2uiProtocolVersion


def test_factory_get_adapter():
    v08_adapter = VersionAdapterFactory.get_adapter("v0.8")
    assert isinstance(v08_adapter, VersionAdapterV09)
    assert v08_adapter.version == A2uiProtocolVersion.V0_9

    v09_adapter = VersionAdapterFactory.get_adapter("v0.9")
    assert isinstance(v09_adapter, VersionAdapterV09)
    assert v09_adapter.version == A2uiProtocolVersion.V0_9

    v091_adapter = VersionAdapterFactory.get_adapter("v0.9.1")
    assert isinstance(v091_adapter, VersionAdapterV09)

    v10_adapter = VersionAdapterFactory.get_adapter("v1.0")
    assert isinstance(v10_adapter, VersionAdapterV10)
    assert v10_adapter.version == A2uiProtocolVersion.V1_0

    v10_enum_adapter = VersionAdapterFactory.get_adapter(A2uiProtocolVersion.V1_0)
    assert isinstance(v10_enum_adapter, VersionAdapterV10)

    with pytest.raises(ValueError, match="Unsupported protocol version"):
        VersionAdapterFactory.get_adapter("v2.0")


def test_factory_resolve_from_payload():
    adapter_v10 = VersionAdapterFactory.resolve_from_payload({"version": "v1.0"})
    assert isinstance(adapter_v10, VersionAdapterV10)

    adapter_v09 = VersionAdapterFactory.resolve_from_payload({"version": "v0.9"})
    assert isinstance(adapter_v09, VersionAdapterV09)

    adapter_default = VersionAdapterFactory.resolve_from_payload({})
    assert isinstance(adapter_default, VersionAdapterV09)


def test_version_adapter_v09_methods():
    adapter = VersionAdapterV09()
    assert adapter.version == A2uiProtocolVersion.V0_9

    payload_env = {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "s1",
            "theme": {"primaryColor": "#ff0000"},
            "dataModel": {"foo": "bar"},
        },
    }

    assert adapter.extract_surface_properties(payload_env) == {
        "primaryColor": "#ff0000"
    }
    assert adapter.extract_initial_state(payload_env) == {"foo": "bar"}
    assert adapter.extract_message_type(payload_env) == "createSurface"

    normalized = adapter.normalize_message({"createSurface": {"surfaceId": "s1"}})
    assert normalized["version"] == "v0.9"


def test_version_adapter_v10_methods():
    adapter = VersionAdapterV10()
    assert adapter.version == A2uiProtocolVersion.V1_0

    payload_env = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "surfaceProperties": {"layout": "responsive"},
            "dataModel": {"active": True},
        },
    }

    assert adapter.extract_surface_properties(payload_env) == {"layout": "responsive"}
    assert adapter.extract_initial_state(payload_env) == {"active": True}
    assert adapter.extract_message_type(payload_env) == "createSurface"

    normalized = adapter.normalize_message({"createSurface": {"surfaceId": "s1"}})
    assert normalized["version"] == "v1.0"
