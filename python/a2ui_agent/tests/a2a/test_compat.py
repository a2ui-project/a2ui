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


def test_part_metadata_reads_what_make_data_part_wrote():
    part = _compat.make_data_part({"a": 1}, metadata={"mimeType": "application/a2ui+json"})
    assert _compat.part_metadata(part) == {"mimeType": "application/a2ui+json"}


def test_part_metadata_part_without_metadata_is_empty():
    assert _compat.part_metadata(_compat.make_text_part("hi")) == {}


def test_part_metadata_v1_reads_a_plain_map(monkeypatch):
    """A protobuf map field has no DESCRIPTOR, so ``MessageToDict`` cannot read it."""
    monkeypatch.setattr(_compat, "IS_A2A_V1", True)

    class ScalarMapContainer(dict):
        pass

    part = SimpleNamespace(metadata=ScalarMapContainer({"mimeType": "application/a2ui+json"}))
    assert _compat.part_metadata(part) == {"mimeType": "application/a2ui+json"}


def test_part_metadata_v1_missing_metadata_is_empty(monkeypatch):
    monkeypatch.setattr(_compat, "IS_A2A_V1", True)
    assert _compat.part_metadata(SimpleNamespace(metadata=None)) == {}


def _context(state):
    return SimpleNamespace(call_context=SimpleNamespace(state=state))


def test_add_activated_extension_creates_a_set():
    state = {}
    _compat.add_activated_extension(_context(state), "uri-a")
    assert state["activated_extensions"] == {"uri-a"}


def test_add_activated_extension_adds_to_an_existing_set():
    state = {"activated_extensions": {"uri-a"}}
    _compat.add_activated_extension(_context(state), "uri-b")
    assert state["activated_extensions"] == {"uri-a", "uri-b"}


def test_add_activated_extension_keeps_an_existing_list():
    """A list the server framework already filled must not be overwritten."""
    state = {"activated_extensions": ["uri-a"]}
    _compat.add_activated_extension(_context(state), "uri-b")
    _compat.add_activated_extension(_context(state), "uri-b")
    assert state["activated_extensions"] == ["uri-a", "uri-b"]
