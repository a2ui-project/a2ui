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

"""Unit tests for the A2UI Headless Rendering Engine."""

import json
import os
from pathlib import Path
import struct
import pytest

from a2ui.render.engine import (
    A2uiRenderError,
    HeadlessRenderEngine,
    get_harness_path,
    render_payload_to_png,
    resolve_chromium_binary,
)

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _read_png_dimensions(png_bytes: bytes) -> tuple[int, int]:
    """Extracts width and height from PNG IHDR chunk."""
    assert png_bytes.startswith(PNG_MAGIC), "Not a valid PNG file"
    # IHDR chunk starts at byte 12 (length 4, type 4 'IHDR', width 4, height 4)
    width, height = struct.unpack(">II", png_bytes[16:24])
    return width, height


@pytest.fixture
def simple_payload():
    return [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "unit-test-surface",
                "catalogId": (
                    "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
                ),
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "unit-test-surface",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": "Unit Test Text",
                    "variant": "h2",
                }],
            },
        },
    ]


@pytest.fixture
def composite_payload_file():
    path = Path(
        "agent_sdks/python/a2ui_agent/tests/fixtures/render/payloads/canvas_side_panel.json"
    )
    assert path.is_file(), f"Fixture file not found: {path}"
    return path


def test_resolve_chromium_binary():
    bin_path = resolve_chromium_binary()
    assert bin_path is not None, "Chromium executable was not resolved"
    assert os.path.isfile(bin_path), f"Binary does not exist: {bin_path}"
    assert os.access(bin_path, os.X_OK), f"Binary is not executable: {bin_path}"


def test_get_harness_path():
    harness_path = get_harness_path()
    assert harness_path.is_file(), f"Harness HTML file not found: {harness_path}"
    content = harness_path.read_text(encoding="utf-8")
    assert "<!doctype html>" in content.lower()
    assert "bundle.js" in content


def test_render_payload_to_png_in_memory_list(simple_payload, tmp_path):
    out_file = tmp_path / "simple_test.png"
    png_bytes = render_payload_to_png(
        simple_payload, out_path=out_file, width=800, height=600
    )

    assert isinstance(png_bytes, bytes)
    assert png_bytes.startswith(PNG_MAGIC)
    assert out_file.is_file()
    assert out_file.read_bytes() == png_bytes

    w, h = _read_png_dimensions(png_bytes)
    assert w == 800
    assert h == 600


def test_render_payload_to_png_in_memory_dict(simple_payload):
    dict_payload = {"messages": simple_payload}
    png_bytes = render_payload_to_png(dict_payload)

    assert isinstance(png_bytes, bytes)
    assert png_bytes.startswith(PNG_MAGIC)
    w, h = _read_png_dimensions(png_bytes)
    assert w == 800
    assert h == 600


def test_render_payload_to_png_json_string(simple_payload):
    json_str = json.dumps(simple_payload)
    png_bytes = render_payload_to_png(json_str)

    assert isinstance(png_bytes, bytes)
    assert png_bytes.startswith(PNG_MAGIC)


def test_render_payload_to_png_file_path(composite_payload_file, tmp_path):
    out_file = tmp_path / "canvas_out.png"
    png_bytes = render_payload_to_png(composite_payload_file, out_path=out_file)

    assert isinstance(png_bytes, bytes)
    assert png_bytes.startswith(PNG_MAGIC)
    assert len(png_bytes) > 5000
    assert out_file.is_file()


def test_render_dimensions_option(simple_payload):
    png_bytes = render_payload_to_png(simple_payload, width=1024, height=768)
    w, h = _read_png_dimensions(png_bytes)
    assert w == 1024
    assert h == 768

    png_bytes_small = render_payload_to_png(simple_payload, width=400, height=300)
    w_small, h_small = _read_png_dimensions(png_bytes_small)
    assert w_small == 400
    assert h_small == 300


def test_render_catalog_override(simple_payload):
    png_bytes = render_payload_to_png(
        simple_payload,
        catalog_id="https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    )
    assert png_bytes.startswith(PNG_MAGIC)


def test_headless_render_engine_context_manager(simple_payload):
    with HeadlessRenderEngine(default_width=800, default_height=600) as engine:
        png1 = engine.render(simple_payload)
        assert png1.startswith(PNG_MAGIC)

        png2 = engine.render(simple_payload, width=500, height=400)
        assert png2.startswith(PNG_MAGIC)
        w, h = _read_png_dimensions(png2)
        assert w == 500
        assert h == 400
