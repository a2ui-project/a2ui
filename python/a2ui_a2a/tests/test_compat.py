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

"""Unit tests for the a2a-sdk 0.3 / 1.x helpers in a2ui.a2a._compat."""

from types import SimpleNamespace

import pytest

from a2ui.a2a import _compat


@pytest.mark.parametrize(
    "helper, empty",
    [
        (_compat.is_data_part, False),
        (_compat.is_text_part, False),
        (_compat.part_text, ""),
        (_compat.part_metadata, {}),
        (_compat.data_part_dict, None),
        (_compat.part_media_type, None),
        (_compat.data_part_view, None),
    ],
)
def test_helpers_accept_none(helper, empty):
    assert helper(None) == empty


def test_part_text_reads_a_text_part():
    assert _compat.part_text(_compat.make_text_part("hello")) == "hello"


def test_part_text_of_a_data_part_is_empty():
    """On 0.3 a data part's ``root`` has no ``text`` attribute at all."""
    assert _compat.part_text(_compat.make_data_part({"a": 1})) == ""


def test_part_metadata_reads_what_make_data_part_wrote():
    part = _compat.make_data_part(
        {"a": 1}, metadata={"mimeType": "application/a2ui+json"}
    )
    assert _compat.part_metadata(part) == {"mimeType": "application/a2ui+json"}


def test_part_metadata_part_without_metadata_is_empty():
    assert _compat.part_metadata(_compat.make_text_part("hi")) == {}


def test_part_metadata_v1_reads_a_plain_map(monkeypatch):
    """A protobuf map field has no DESCRIPTOR, so ``MessageToDict`` cannot read it."""
    monkeypatch.setattr(_compat, "IS_A2A_V1", True)

    class ScalarMapContainer(dict):
        pass

    part = SimpleNamespace(
        metadata=ScalarMapContainer({"mimeType": "application/a2ui+json"})
    )
    assert _compat.part_metadata(part) == {"mimeType": "application/a2ui+json"}


def test_part_metadata_v1_missing_metadata_is_empty(monkeypatch):
    monkeypatch.setattr(_compat, "IS_A2A_V1", True)
    assert _compat.part_metadata(SimpleNamespace(metadata=None)) == {}


def test_add_activated_extension_calls_the_0_3_api():
    activated = []
    context = SimpleNamespace(add_activated_extension=activated.append)
    _compat.add_activated_extension(context, "uri-a")
    assert activated == ["uri-a"]


def test_add_activated_extension_without_the_api_is_a_no_op():
    state = {}
    context = SimpleNamespace(call_context=SimpleNamespace(state=state))
    _compat.add_activated_extension(context, "uri-a")
    assert state == {}


def test_round_trip_keeps_integers_as_ints():
    part = _compat.make_data_part(
        {"count": 3, "items": [1, 2], "ratio": 0.5},
        metadata={"mimeType": "application/a2ui+json", "size": 2},
    )

    data = _compat.data_part_dict(part)
    assert data == {"count": 3, "items": [1, 2], "ratio": 0.5}
    assert type(data["count"]) is int
    assert all(type(item) is int for item in data["items"])
    assert type(data["ratio"]) is float
    assert type(_compat.part_metadata(part)["size"]) is int


@pytest.mark.skipif(not _compat.IS_A2A_V1, reason="a2a-sdk 1.x protobuf Struct")
def test_metadata_dict_v1_keeps_integers_as_ints():
    from google.protobuf import struct_pb2

    metadata = struct_pb2.Struct()
    metadata.update({"caps": {"count": 2}})
    result = _compat.metadata_dict(metadata)
    assert result == {"caps": {"count": 2}}
    assert type(result["caps"]["count"]) is int


@pytest.mark.parametrize("metadata", [None, "not a mapping", ["a"], {"a": 1}])
def test_metadata_dict_passes_other_values_through(metadata):
    assert _compat.metadata_dict(metadata) == metadata


@pytest.mark.skipif(not _compat.IS_A2A_V1, reason="1.x metadata is a Struct")
def test_make_data_part_v1_normalizes_mappings():
    from types import MappingProxyType

    part = _compat.make_data_part(
        {}, metadata={"caps": MappingProxyType({"a": 1}), "ids": ("x", "y")}
    )
    assert _compat.part_metadata(part) == {"caps": {"a": 1}, "ids": ["x", "y"]}


@pytest.mark.skipif(not _compat.IS_A2A_V1, reason="1.x metadata is a Struct")
@pytest.mark.parametrize(
    "value", [float("nan"), float("inf"), object(), {1: "a"}, [object()]]
)
def test_make_data_part_v1_rejects_non_json_metadata(value):
    with pytest.raises(ValueError, match="metadata"):
        _compat.make_data_part({}, metadata={"bad": value})
