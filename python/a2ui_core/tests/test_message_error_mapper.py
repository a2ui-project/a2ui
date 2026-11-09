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

"""Unit tests for message_error_mapper version and context extraction."""

from a2ui.core.exceptions import A2uiValidationError
from a2ui.core.processing import (
    extract_envelope_error_context,
    map_error_to_renderer_message,
)


def test_extract_envelope_error_context_preserves_v0_9_1_and_canonicalizes():
    """Preserves v0.9.1 and normalizes unprefixed version strings."""
    ctx_v091 = extract_envelope_error_context({
        "version": "v0.9.1",
        "createSurface": {"surfaceId": "s1", "catalogId": "basic"},
    })
    assert ctx_v091.version == "v0.9.1"
    assert ctx_v091.action == "createSurface"
    assert ctx_v091.surface_id == "s1"

    ctx_unprefixed = extract_envelope_error_context({
        "version": "0.9.1",
        "updateComponents": {"surfaceId": "s2", "components": []},
    })
    assert ctx_unprefixed.version == "v0.9.1"
    assert ctx_unprefixed.action == "updateComponents"
    assert ctx_unprefixed.surface_id == "s2"


def test_extract_envelope_error_context_falls_back_to_v0_8_for_legacy_actions():
    """Falls back to v0.8 when a v0.8 action key is present without version."""
    for action_key in ("beginRendering", "surfaceUpdate", "dataModelUpdate"):
        msg = {action_key: {"surfaceId": "legacy_s"}}
        ctx = extract_envelope_error_context(msg)
        assert ctx.version == "v0.8"
        assert ctx.action == action_key
        assert ctx.surface_id == "legacy_s"

        err_msg = map_error_to_renderer_message(
            A2uiValidationError("Invalid legacy payload"), msg
        )
        assert err_msg["version"] == "v0.8"
        assert err_msg["error"]["surfaceId"] == "legacy_s"


def test_extract_envelope_error_context_normalizes_v1_0_to_bare_1_0():
    """Extracts 1.0 wire version as bare '1.0' without 'v' prefix."""
    ctx_10 = extract_envelope_error_context({
        "version": "1.0",
        "createSurface": {"surfaceId": "s1", "catalogId": "basic"},
    })
    assert ctx_10.version == "1.0"
    assert ctx_10.action == "createSurface"
    assert ctx_10.surface_id == "s1"

    ctx_v10 = extract_envelope_error_context({
        "version": "v1.0",
        "createSurface": {"surfaceId": "s1", "catalogId": "basic"},
    })
    assert ctx_v10.version == "1.0"

    err_msg = map_error_to_renderer_message(
        A2uiValidationError("Invalid v1.0 payload"),
        {"version": "1.0", "createSurface": {"surfaceId": "s1"}},
    )
    assert err_msg["version"] == "1.0"
    assert err_msg["error"]["surfaceId"] == "s1"
