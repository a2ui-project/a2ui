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

"""Tests for main CLI entrypoint and formatting utilities."""

import json
from unittest.mock import patch
import pytest

from a2ui.cli.main import main
import a2ui.cli.formatters as fmt


def test_main_no_args_returns_code_1(capsys):
    code = main([])
    captured = capsys.readouterr()

    assert code == 1
    assert "usage: a2ui" in captured.out or "usage: a2ui" in captured.err


def test_main_catalog_no_subcommand_returns_code_1():
    code = main(["catalog"])
    assert code == 1


def test_main_catalog_describe_dispatch(capsys):
    code = main(["catalog", "describe", "basic", "--json"])
    captured = capsys.readouterr()

    assert code == 0
    data = json.loads(captured.out)
    assert data["name"] == "basic"
    assert data["component_count"] == 18


def test_main_catalog_diff_dispatch(capsys):
    code = main(["catalog", "diff", "basic", "gemini_enterprise_composite", "--json"])
    captured = capsys.readouterr()

    assert code == 0
    data = json.loads(captured.out)
    assert data["summary"]["added_count"] == 34


def test_main_check_dispatch(tmp_path, capsys):
    valid_payload = [{
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": (
                "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
            ),
        },
    }]
    f = tmp_path / "valid.json"
    f.write_text(json.dumps(valid_payload))

    code = main(["check", str(f), "--json"])
    captured = capsys.readouterr()

    assert code == 0
    data = json.loads(captured.out)
    assert data["valid"] is True


def test_main_render_dispatch_missing_engine(tmp_path, capsys):
    f = tmp_path / "payload.json"
    f.write_text("{}")

    out_png = tmp_path / "out.png"
    code = main(["render", str(f), "--png", str(out_png)])
    captured = capsys.readouterr()

    assert code in (0, 1)


def test_formatters_plain_text_fallback(capsys):
    original_has_rich = fmt.HAS_RICH
    original_console = fmt.console
    try:
        fmt.HAS_RICH = False
        fmt.console = None

        fmt.print_header("Test Header", "Subtitle")
        fmt.print_success("Success msg")
        fmt.print_error("Error msg")
        fmt.print_warning("Warning msg")
        fmt.print_info("Info msg")
        fmt.print_table("Test Table", ["Col1", "Col2"], [["Val1", "Val2"]])
        fmt.print_json({"key": "val"})

        captured = capsys.readouterr()
        assert "=== Test Header ===" in captured.out
        assert "✓ Success msg" in captured.out
        assert "✗ Error: Error msg" in captured.out
        assert "! Warning msg" in captured.out
        assert "• Info msg" in captured.out
        assert "--- Test Table ---" in captured.out
        assert "Col1" in captured.out
        assert '"key": "val"' in captured.out
    finally:
        fmt.HAS_RICH = original_has_rich
        fmt.console = original_console
