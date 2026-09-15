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

"""CLI integration tests for `a2ui render` and `render_cli`."""

from pathlib import Path
import struct
import pytest

from a2ui.render.engine import render_cli

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
SAMPLE_PAYLOAD = (
    "agent_sdks/python/a2ui_agent/tests/fixtures/render/payloads/simple_text.json"
)
COMPOSITE_PAYLOAD = (
    "agent_sdks/python/a2ui_agent/tests/fixtures/render/payloads/canvas_side_panel.json"
)


def test_render_cli_success(tmp_path):
    out_png = tmp_path / "cli_out.png"
    ret = render_cli(
        [SAMPLE_PAYLOAD, "--png", str(out_png), "--width", "800", "--height", "600"]
    )

    assert ret == 0
    assert out_png.is_file()
    data = out_png.read_bytes()
    assert data.startswith(PNG_MAGIC)
    w, h = struct.unpack(">II", data[16:24])
    assert w == 800
    assert h == 600


def test_render_cli_composite_payload(tmp_path):
    out_png = tmp_path / "composite_out.png"
    ret = render_cli(
        [COMPOSITE_PAYLOAD, "--png", str(out_png), "--width", "1024", "--height", "768"]
    )

    assert ret == 0
    assert out_png.is_file()
    data = out_png.read_bytes()
    assert data.startswith(PNG_MAGIC)
    w, h = struct.unpack(">II", data[16:24])
    assert w == 1024
    assert h == 768


def test_render_cli_missing_png_flag(capsys):
    with pytest.raises(SystemExit) as excinfo:
        render_cli([SAMPLE_PAYLOAD])
    assert excinfo.value.code != 0


def test_render_cli_nonexistent_file(tmp_path, capsys):
    out_png = tmp_path / "never_created.png"
    ret = render_cli(["/nonexistent/path/payload.json", "--png", str(out_png)])

    assert ret == 1
    assert not out_png.exists()


def test_render_cli_malformed_json(tmp_path, capsys):
    bad_file = tmp_path / "bad.json"
    bad_file.write_text("{not: json}", encoding="utf-8")
    out_png = tmp_path / "bad.png"

    ret = render_cli([str(bad_file), "--png", str(out_png)])
    assert ret == 1
    assert not out_png.exists()


def test_main_cli_dispatch_render(tmp_path):
    """Verify end-to-end dispatch through `a2ui.cli.main:main`."""
    from a2ui.cli.main import main

    out_png = tmp_path / "main_dispatch.png"
    ret = main([
        "render",
        SAMPLE_PAYLOAD,
        "--png",
        str(out_png),
        "--width",
        "800",
        "--height",
        "600",
    ])

    assert ret == 0
    assert out_png.is_file()
    assert out_png.read_bytes().startswith(PNG_MAGIC)
