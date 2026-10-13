# Copyright 2026 Google LLC
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

"""Unit tests for a2ui.a2a.parts helpers (a2a-sdk 0.3 / 1.x)."""

from a2ui.a2a import _compat
from a2ui.a2a.parts import (
    A2UI_MIME_TYPE,
    DEPRECATED_A2UI_MIME_TYPE,
    create_a2ui_part,
    extract_user_action,
    get_a2ui_data,
    get_a2ui_datapart,
    is_a2ui_part,
    part_data_as_dict,
)


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
    assert part_data_as_dict(part) is None


def test_part_data_as_dict_untagged():
    part = _compat.make_data_part({"userAction": {"name": "book_restaurant"}})
    assert get_a2ui_data(part) is None
    data = part_data_as_dict(part)
    assert data is not None
    assert data["userAction"]["name"] == "book_restaurant"


def test_extract_user_action_untagged():
    part = _compat.make_data_part({
        "userAction": {
            "name": "submit_booking",
            "surfaceId": "booking-1",
            "context": {"partySize": "2"},
        }
    })
    action = extract_user_action([_compat.make_text_part("ignore"), part])
    assert action == {
        "name": "submit_booking",
        "surfaceId": "booking-1",
        "context": {"partySize": "2"},
    }


def test_extract_user_action_mime_tagged():
    payload = {"userAction": {"name": "view_metric", "context": {"id": "m1"}}}
    part = create_a2ui_part(payload, version="0.9")
    action = extract_user_action([part])
    assert action == {"name": "view_metric", "context": {"id": "m1"}}


def test_extract_user_action_missing():
    assert extract_user_action([]) is None
    assert extract_user_action([_compat.make_data_part({"useStreaming": True})]) is None
