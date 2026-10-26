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

"""Unit tests for Python Agent SDK prompt generation and validation runner."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import textwrap
import time
from typing import Any

import pytest

from a2ui_eval.runner import (
    SUPPORTED_FORMATS,
    SUPPORTED_STRATEGIES,
    _WorkerPool,
    generate_prompt,
    parse_and_validate,
    validate_format,
    validate_strategy,
)
from a2ui_eval.shared.utils import GIT_ROOT

V091_CATALOG = str(
    GIT_ROOT / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
)
V10_CATALOG = str(GIT_ROOT / "catalogs" / "basic" / "v1" / "catalog.json")
V09_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
V10_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"


def test_validate_strategy_and_format() -> None:
    for strategy in SUPPORTED_STRATEGIES:
        validate_strategy(strategy)
    for format_name in SUPPORTED_FORMATS:
        validate_format(format_name)

    with pytest.raises(ValueError, match="not supported"):
        validate_strategy("unknown")
    with pytest.raises(ValueError, match="not supported"):
        validate_format("unknown")


def test_generate_prompt_direct_json_v091() -> None:
    prompt = generate_prompt("direct_json", "0.9.1", V091_CATALOG)
    assert "<a2ui-json>" in prompt
    assert V09_CATALOG_ID in prompt


def test_generate_prompt_express_v091() -> None:
    prompt = generate_prompt("express", "0.9.1", V091_CATALOG)
    assert "<a2ui>" in prompt
    assert "Text" in prompt


def test_generate_prompt_v10() -> None:
    direct_prompt = generate_prompt("direct_json", "1.0", V10_CATALOG)
    assert V10_CATALOG_ID in direct_prompt
    express_prompt = generate_prompt("express", "1.0", V10_CATALOG)
    assert "<a2ui>" in express_prompt


def test_generate_prompt_normalizes_and_validates_version() -> None:
    prompt = generate_prompt("direct_json", " v0.9.1 ", V091_CATALOG)
    assert V09_CATALOG_ID in prompt
    with pytest.raises(ValueError, match="not supported"):
        generate_prompt("direct_json", "0.8", V091_CATALOG)


def test_parse_and_validate_rejects_unsupported_version() -> None:
    with pytest.raises(ValueError, match="not supported"):
        parse_and_validate(
            format_name="direct_json",
            version="0.8",
            resolved_catalog_path=V091_CATALOG,
            surface_id="main",
            completion="<a2ui-json>[]</a2ui-json>",
        )


def test_parse_and_validate_direct_json_v091() -> None:
    valid_completion = """
    Here is your requested UI:
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": "main",
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        }
      },
      {
        "version": "v0.9",
        "updateComponents": {
          "surfaceId": "main",
          "components": [
            {
              "id": "root",
              "component": "Text",
              "text": "Hello from runner"
            }
          ]
        }
      }
    ]
    </a2ui-json>
    Let me know if you need changes.
    """
    res = parse_and_validate(
        format_name="direct_json",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion=valid_completion,
        require_complete_tags=True,
    )
    assert len(res["compiled_jsons"]) == 2
    assert len(res["parts"]) == 3
    assert "Here is your requested UI:" in res["parts"][0]["text"]


def test_parse_and_validate_express_v091() -> None:
    express_completion = (
        'Intro text\n<a2ui>\nroot = Text("Hello Express")\n</a2ui>\nOutro text'
    )
    res = parse_and_validate(
        format_name="express",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion=express_completion,
    )
    assert len(res["compiled_jsons"]) >= 2
    assert len(res["parts"]) == 3
    assert res["parts"][0]["text"] == "Intro text"
    assert res["parts"][2]["text"] == "Outro text"


def test_parse_and_validate_rejects_missing_root() -> None:
    invalid_completion = """
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": "main",
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        }
      },
      {
        "version": "v0.9",
        "updateComponents": {
          "surfaceId": "main",
          "components": [
            {
              "id": "not-root",
              "component": "Text",
              "text": "Missing root component"
            }
          ]
        }
      }
    ]
    </a2ui-json>
    """
    with pytest.raises(ValueError):
        parse_and_validate(
            format_name="direct_json",
            version="0.9.1",
            resolved_catalog_path=V091_CATALOG,
            surface_id="main",
            completion=invalid_completion,
            require_complete_tags=True,
        )


def test_runner_rejects_version_that_conflicts_with_catalog() -> None:
    with pytest.raises(ValueError, match="(?i)version"):
        generate_prompt("express", "0.9.1", V10_CATALOG)


def test_parse_and_validate_direct_json_v10() -> None:
    messages = [
        {
            "version": "v1.0",
            "createSurface": {"surfaceId": "main", "catalogId": V10_CATALOG_ID},
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {"id": "root", "component": "Text", "text": "Hello v1.0"}
                ],
            },
        },
    ]
    res = parse_and_validate(
        format_name="direct_json",
        version="1.0",
        resolved_catalog_path=V10_CATALOG,
        surface_id="main",
        completion=f"<a2ui-json>{json.dumps(messages)}</a2ui-json>",
        require_complete_tags=True,
    )
    assert [m["version"] for m in res["compiled_jsons"]] == ["v1.0", "v1.0"]


def test_parse_and_validate_express_v10() -> None:
    res = parse_and_validate(
        format_name="express",
        version="1.0",
        resolved_catalog_path=V10_CATALOG,
        surface_id="main",
        completion='<a2ui>\nroot = Text("Hello v1.0")\n</a2ui>',
        require_complete_tags=True,
    )
    assert res["compiled_jsons"]
    assert {m["version"] for m in res["compiled_jsons"]} == {"v1.0"}


def test_require_complete_tags_express() -> None:
    with pytest.raises(ValueError, match="A2UI tags '<a2ui>' and '</a2ui>'"):
        parse_and_validate(
            format_name="express",
            version="0.9.1",
            resolved_catalog_path=V091_CATALOG,
            surface_id="main",
            completion='<a2ui>\nroot = Text("Unterminated")\n',
            require_complete_tags=True,
        )


def test_validate_false_parses_valid_payload() -> None:
    res = parse_and_validate(
        format_name="express",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion='<a2ui>\nroot = Text("Parse only")\n</a2ui>',
        validate=False,
    )
    assert res["compiled_jsons"]


def test_runner_large_payload() -> None:
    """Results above the 64 KB pipe buffer must not deadlock the worker."""
    count = 800
    components: list[dict[str, Any]] = [{
        "id": "root",
        "component": "Column",
        "children": [f"t{i}" for i in range(count)],
    }]
    components.extend(
        {"id": f"t{i}", "component": "Text", "text": f"Item {i} " + "x" * 64}
        for i in range(count)
    )
    messages = [
        {
            "version": "v0.9",
            "createSurface": {"surfaceId": "main", "catalogId": V09_CATALOG_ID},
        },
        {
            "version": "v0.9",
            "updateComponents": {"surfaceId": "main", "components": components},
        },
    ]
    completion = f"<a2ui-json>{json.dumps(messages)}</a2ui-json>"
    assert len(completion) > 64 * 1024

    res = parse_and_validate(
        format_name="direct_json",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion=completion,
    )
    update = res["compiled_jsons"][1]["updateComponents"]
    assert len(update["components"]) == count + 1


def _fake_worker(body: str) -> list[str]:
    """Returns a worker command that greets, then runs `body` per request."""
    script = textwrap.dedent("""
        import json, os, sys, time
        print(json.dumps({"ready": True}), flush=True)
        for line in sys.stdin:
        """) + textwrap.indent(textwrap.dedent(body), "    ")
    return [sys.executable, "-c", script]


def _parse_with(pool: _WorkerPool, timeout_sec: float = 15.0) -> dict[str, Any]:
    return parse_and_validate(
        format_name="express",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="main",
        completion='<a2ui>\nroot = Text("hi")\n</a2ui>',
        timeout_sec=timeout_sec,
        pool=pool,
    )


def test_runner_worker_exit_raises_value_error() -> None:
    pool = _WorkerPool(_fake_worker("sys.exit(3)"))
    with pytest.raises(ValueError, match="exit code 3"):
        _parse_with(pool)


def test_runner_worker_invalid_json_raises_value_error() -> None:
    pool = _WorkerPool(_fake_worker('print("not json", flush=True)'))
    with pytest.raises(ValueError, match="Invalid JSON from Python SDK worker"):
        _parse_with(pool)


def test_runner_timeout_kills_and_replaces_worker(tmp_path: Path) -> None:
    pid_file = tmp_path / "hung_worker.pid"
    body = f"""
        if not os.path.exists({str(pid_file)!r}):
            with open({str(pid_file)!r}, "w") as f:
                f.write(str(os.getpid()))
            time.sleep(60)
        print(json.dumps({{"result": {{"compiled_jsons": [], "parts": []}}}}), flush=True)
    """
    pool = _WorkerPool(_fake_worker(body))

    start = time.monotonic()
    with pytest.raises(TimeoutError, match="process was killed"):
        _parse_with(pool, timeout_sec=0.5)
    assert time.monotonic() - start < 10

    if sys.platform == "linux":
        hung_pid = int(pid_file.read_text())
        assert not Path(f"/proc/{hung_pid}").exists()

    # The next call gets a fresh worker instead of the killed one.
    assert _parse_with(pool) == {"compiled_jsons": [], "parts": []}


def test_runner_sends_request_fields_to_worker() -> None:
    body = """
        print(json.dumps({"result": {"compiled_jsons": [], "parts": [json.loads(line)]}}), flush=True)
    """
    pool = _WorkerPool(_fake_worker(body))
    request = parse_and_validate(
        format_name="express",
        version="0.9.1",
        resolved_catalog_path=V091_CATALOG,
        surface_id="side",
        completion="text",
        require_complete_tags=True,
        validate=False,
        pool=pool,
    )["parts"][0]
    assert request == {
        "format_name": "express",
        "version": "0.9.1",
        "resolved_catalog_path": V091_CATALOG,
        "surface_id": "side",
        "completion": "text",
        "require_complete_tags": True,
        "validate": False,
    }


def test_runner_reuses_worker() -> None:
    body = """
        print(json.dumps({"result": {"compiled_jsons": [], "parts": [os.getpid()]}}), flush=True)
    """
    pool = _WorkerPool(_fake_worker(body))
    first = _parse_with(pool)["parts"]
    second = _parse_with(pool)["parts"]
    assert first == second


def test_runner_module_does_not_import_inspect_ai() -> None:
    """Python runner workers import this module, so it must stay lightweight."""
    code = "import sys, a2ui_eval.runner; print('inspect_ai' in sys.modules)"
    out = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        check=True,
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    assert out.stdout.strip() == "False"
