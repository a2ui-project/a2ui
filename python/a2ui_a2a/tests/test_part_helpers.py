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

"""Unit tests for a2ui.a2a part helpers (a2a-sdk 0.3 / 1.x)."""

import dataclasses

import pytest

from a2ui.a2a import (
    A2UI_MIME_TYPE,
    DEPRECATED_A2UI_MIME_TYPE,
    create_a2ui_part,
    get_a2ui_data,
    get_a2ui_datapart,
    get_a2ui_messages,
    is_a2ui_part,
)
from a2ui.a2a import _compat


def test_create_a2ui_part_default_uses_legacy_mime():
    part = create_a2ui_part({"beginRendering": {"surfaceId": "s1"}})
    assert is_a2ui_part(part)
    view = get_a2ui_datapart(part)
    assert view is not None
    assert view.metadata.get("mimeType") == DEPRECATED_A2UI_MIME_TYPE
    assert get_a2ui_data(part)["beginRendering"]["surfaceId"] == "s1"


def test_create_a2ui_part_v09_1_uses_primary_mime():
    part = create_a2ui_part({"createSurface": {"surfaceId": "s1"}}, version="0.9.1")
    assert is_a2ui_part(part)
    view = get_a2ui_datapart(part)
    assert view.metadata.get("mimeType") == A2UI_MIME_TYPE


def test_text_part_is_not_a2ui():
    part = _compat.make_text_part("hello")
    assert not is_a2ui_part(part)
    assert get_a2ui_data(part) is None
    assert get_a2ui_datapart(part) is None


def test_untagged_data_part_is_not_a2ui():
    part = _compat.make_data_part({"action": {"name": "book_restaurant"}})
    assert get_a2ui_data(part) is None
    assert get_a2ui_datapart(part) is None
    assert get_a2ui_messages([part]) == []


@pytest.mark.skipif(not _compat.IS_A2A_V1, reason="a2a-sdk 1.x protobuf Part")
def test_v1_non_object_payload_is_skipped():
    from a2a.types import Part
    from google.protobuf import struct_pb2

    value = struct_pb2.Value()
    value.list_value.values.add().string_value = "x"
    part = Part(data=value, media_type=A2UI_MIME_TYPE)

    assert is_a2ui_part(part)
    assert get_a2ui_data(part) is None
    assert get_a2ui_datapart(part) is None
    assert get_a2ui_messages([part]) == []


@pytest.mark.skipif(not _compat.IS_A2A_V1, reason="a2a-sdk 1.x protobuf Part")
def test_v1_view_takes_mime_type_from_media_type():
    from a2a.types import Part
    from google.protobuf import json_format, struct_pb2

    value = struct_pb2.Value()
    json_format.ParseDict({"deleteSurface": {"surfaceId": "s1"}}, value)
    part = Part(data=value, media_type=A2UI_MIME_TYPE)

    view = get_a2ui_datapart(part)
    assert view is not None
    assert view.metadata == {"mimeType": A2UI_MIME_TYPE}
    assert view.data == {"deleteSurface": {"surfaceId": "s1"}}
    with pytest.raises(dataclasses.FrozenInstanceError):
        view.data = {}  # type: ignore[misc]
