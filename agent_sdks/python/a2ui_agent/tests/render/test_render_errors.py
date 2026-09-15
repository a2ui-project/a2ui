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

"""Error handling and resilience tests for the A2UI Headless Rendering Engine."""

import time
import pytest

from a2ui.render.engine import A2uiRenderError, render_payload_to_png


def test_render_nonexistent_file():
    with pytest.raises(A2uiRenderError, match="Failed to read payload file|not found"):
        render_payload_to_png("/nonexistent/path/to/payload.json")


def test_render_malformed_json_string():
    with pytest.raises(A2uiRenderError, match="Malformed payload JSON"):
        render_payload_to_png("{invalid_json: true, missing_quotes}")


def test_render_empty_list():
    with pytest.raises(
        A2uiRenderError, match="Payload cannot be an empty message list"
    ):
        render_payload_to_png([])


def test_render_empty_dict_messages():
    with pytest.raises(A2uiRenderError, match="Payload messages list is empty"):
        render_payload_to_png({"messages": []})


def test_render_unsupported_type():
    with pytest.raises(A2uiRenderError, match="Unsupported payload type"):
        render_payload_to_png(12345)


def test_render_missing_surface():
    payload = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "ghost-surface",
            "components": [{
                "id": "root",
                "component": "Text",
                "text": "Ghost text",
            }],
        },
    }]
    with pytest.raises(A2uiRenderError, match="Surface not found"):
        render_payload_to_png(payload)


def test_render_no_surface_created():
    payload = [{
        "version": "v0.9",
        "deleteSurface": {"surfaceId": "random-surface"},
    }]
    with pytest.raises(A2uiRenderError, match="No surface was created"):
        render_payload_to_png(payload)


def test_render_invalid_component_properties_validation_failure():
    # Button in basic catalog expects object with 'child' or 'action', unrecognized keys fail
    payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "error-surface",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "error-surface",
                "components": [{
                    "id": "root",
                    "component": "Button",
                    "forbiddenUnknownProp": 12345,
                }],
            },
        },
    ]
    with pytest.raises(A2uiRenderError, match="Validation failed for component"):
        render_payload_to_png(payload)


def test_render_bounded_timeout():
    """Verify that timeout bounds execution and does not hang."""
    payload = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "timeout-surface",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "timeout-surface",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": "Timeout Test",
                }],
            },
        },
    ]

    start_time = time.time()
    # Realistic short timeout (50ms) to trigger settling timeout without deadlocking driver
    with pytest.raises(A2uiRenderError, match="timed out"):
        render_payload_to_png(payload, timeout_seconds=0.005)

    elapsed = time.time() - start_time
    assert elapsed < 5.0, f"Execution hung beyond timeout: took {elapsed}s"
