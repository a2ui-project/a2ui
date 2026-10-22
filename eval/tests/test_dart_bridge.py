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

"""Tests for the Dart Agent SDK bridge.

Most tests mock `subprocess.run` and need no Dart toolchain. The tests marked
`requires_dart_toolchain` compile and run the real runner; they are skipped
unless a supported Dart SDK and a resolved root `.dart_tool/package_config.json`
exist. Set `A2UI_EVAL_DART_ROOT` to point them at another directory laid out
like the repository root (with `dart/` and `.dart_tool/package_config.json`).
"""

from __future__ import annotations

import importlib
import json
import os
from pathlib import Path
import stat
import subprocess
from typing import Any

import pytest

from a2ui_eval.bridges import DartSdkBridge
from a2ui_eval.shared.utils import GIT_ROOT

# The bridge module itself, so tests can patch its subprocess and toolchain
# lookups without spelling out its import path.
dart_bridge = importlib.import_module(DartSdkBridge.__module__)

FAKE_DART = "/fake/sdk/bin/dart"
FAKE_DART_VERSION = 'Dart SDK version: 3.12.0 (stable) on "linux_x64"'

V091_CATALOG = str(
    GIT_ROOT / "specification" / "v0_9_1" / "catalogs" / "basic" / "catalog.json"
)
V10_CATALOG = str(GIT_ROOT / "catalogs" / "basic" / "v1" / "catalog.json")
V09_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"


class FakeSubprocess:
    """Records `subprocess.run` calls and emulates dart, flutter and the runner."""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.kwargs: list[dict[str, Any]] = []
        self.compile_returncode = 0
        self.pub_get_returncode = 0
        self.pub_get_creates_config = True
        self.runner_stdout = b'{"result": "PROMPT"}'
        self.runner_stderr = b""
        self.runner_inputs: list[dict[str, Any]] = []

    @property
    def compile_calls(self) -> list[list[str]]:
        return [c for c in self.calls if c[1:3] == ["compile", "exe"]]

    @property
    def runner_calls(self) -> list[list[str]]:
        return [c for c in self.calls if len(c) == 1]

    def __call__(
        self, cmd: list[str], **kwargs: Any
    ) -> subprocess.CompletedProcess[Any]:
        self.calls.append(list(cmd))
        self.kwargs.append(kwargs)
        if cmd[1:3] == ["compile", "exe"]:
            if self.compile_returncode != 0:
                return subprocess.CompletedProcess(
                    cmd, self.compile_returncode, "compile stdout", "compile error"
                )
            out = Path(cmd[cmd.index("-o") + 1])
            out.write_text("#!/bin/sh\n")
            return subprocess.CompletedProcess(cmd, 0, "Generated", "")
        if cmd[1:3] == ["pub", "get"]:
            if self.pub_get_returncode == 0 and self.pub_get_creates_config:
                config = Path(kwargs["cwd"]) / ".dart_tool" / "package_config.json"
                config.parent.mkdir(parents=True, exist_ok=True)
                config.write_text('{"configVersion": 2}')
            return subprocess.CompletedProcess(
                cmd, self.pub_get_returncode, "pub stdout", "pub stderr"
            )
        if len(cmd) == 1:
            self.runner_inputs.append(json.loads(kwargs["input"]))
            return subprocess.CompletedProcess(
                cmd, 0, self.runner_stdout, self.runner_stderr
            )
        raise AssertionError(f"Unexpected command: {cmd}")


@pytest.fixture
def fake_root(tmp_path: Path) -> Path:
    """A minimal checkout: both Dart packages, a runner and a package config."""
    root = tmp_path / "repo"
    for package in ("a2ui_agent", "a2ui_core"):
        lib = root / "dart" / package / "lib"
        lib.mkdir(parents=True)
        (lib / f"{package}.dart").write_text(f"library {package};\n")
    (root / "dart" / "a2ui_agent" / "lib" / "src").mkdir()
    (root / "dart" / "a2ui_agent" / "lib" / "src" / "impl.dart").write_text("// v1\n")
    (root / ".dart_tool").mkdir()
    (root / ".dart_tool" / "package_config.json").write_text('{"configVersion": 2}')
    (root / "runner.dart").write_text("void main() {}\n")
    return root


@pytest.fixture
def fake_subprocess(monkeypatch: pytest.MonkeyPatch) -> FakeSubprocess:
    fake = FakeSubprocess()
    monkeypatch.setattr(dart_bridge.subprocess, "run", fake)
    return fake


@pytest.fixture
def find_dart_calls(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Replaces the toolchain lookup with a fake supported Dart SDK."""
    calls: list[int] = []

    def fake_find_dart() -> tuple[str, str]:
        calls.append(1)
        return FAKE_DART, FAKE_DART_VERSION

    monkeypatch.setattr(dart_bridge, "_find_dart", fake_find_dart)
    return calls


def _bridge(root: Path) -> DartSdkBridge:
    return DartSdkBridge(git_root=root, runner_path=root / "runner.dart")


def _cached_exes(root: Path) -> list[Path]:
    cache_dir = root / ".dart_tool" / "a2ui_eval"
    return sorted(p for p in cache_dir.glob("bridge_*") if not p.name.endswith(".lock"))


# ---------------------------------------------------------------------------
# prepare(): content-hash cache
# ---------------------------------------------------------------------------


def test_prepare_compiles_into_per_checkout_hashed_path(
    fake_root: Path, fake_subprocess: FakeSubprocess, find_dart_calls: list[int]
) -> None:
    bridge = _bridge(fake_root)
    bridge.prepare()

    assert len(fake_subprocess.compile_calls) == 1
    cmd = fake_subprocess.compile_calls[0]
    assert cmd[0] == FAKE_DART
    assert str(fake_root / "runner.dart") in cmd
    assert f"--packages={fake_root / '.dart_tool' / 'package_config.json'}" in cmd

    expected_hash = dart_bridge.compute_bridge_hash(
        fake_root, FAKE_DART_VERSION, fake_root / "runner.dart"
    )
    exe = fake_root / ".dart_tool" / "a2ui_eval" / f"bridge_{expected_hash}"
    assert _cached_exes(fake_root) == [exe]
    assert stat.S_IMODE(exe.stat().st_mode) == 0o700
    # The temporary output was renamed into place, not left behind.
    assert not list(exe.parent.glob("*.tmp"))


def test_prepare_resolves_once_per_instance(
    fake_root: Path, fake_subprocess: FakeSubprocess, find_dart_calls: list[int]
) -> None:
    bridge = _bridge(fake_root)
    bridge.prepare()
    # Edits after the first prepare() are not re-scanned by the same instance.
    (fake_root / "dart" / "a2ui_core" / "lib" / "a2ui_core.dart").write_text("// x\n")
    bridge.prepare()
    bridge.prepare()

    assert len(find_dart_calls) == 1
    assert len(fake_subprocess.compile_calls) == 1


def test_prepare_reuses_binary_across_instances_when_inputs_match(
    fake_root: Path, fake_subprocess: FakeSubprocess, find_dart_calls: list[int]
) -> None:
    _bridge(fake_root).prepare()
    _bridge(fake_root).prepare()

    assert len(fake_subprocess.compile_calls) == 1
    assert len(_cached_exes(fake_root)) == 1


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(
            lambda root: (root / "runner.dart").write_text("void main() {1;}\n"),
            id="runner",
        ),
        pytest.param(
            lambda root: (
                root / "dart" / "a2ui_agent" / "lib" / "src" / "impl.dart"
            ).write_text("// v2\n"),
            id="agent-lib",
        ),
        pytest.param(
            lambda root: (root / "dart" / "a2ui_core" / "lib" / "new.dart").write_text(
                "// new\n"
            ),
            id="core-lib-new-file",
        ),
        pytest.param(
            lambda root: (root / ".dart_tool" / "package_config.json").write_text(
                '{"configVersion": 2, "packages": []}'
            ),
            id="package-config",
        ),
        pytest.param(
            lambda root: (root / "pubspec.lock").write_text("packages: {}\n"),
            id="pubspec-lock",
        ),
    ],
)
def test_prepare_recompiles_when_an_input_changes(
    fake_root: Path,
    fake_subprocess: FakeSubprocess,
    find_dart_calls: list[int],
    mutate: Any,
) -> None:
    _bridge(fake_root).prepare()
    mutate(fake_root)
    _bridge(fake_root).prepare()

    assert len(fake_subprocess.compile_calls) == 2
    assert len(_cached_exes(fake_root)) == 2


def test_bridge_hash_covers_dart_version(fake_root: Path) -> None:
    runner = fake_root / "runner.dart"
    hash_a = dart_bridge.compute_bridge_hash(fake_root, "Dart 3.12.0", runner)
    hash_b = dart_bridge.compute_bridge_hash(fake_root, "Dart 3.12.1", runner)
    assert hash_a != hash_b
    assert hash_a == dart_bridge.compute_bridge_hash(fake_root, "Dart 3.12.0", runner)


def test_bridge_hash_ignores_non_dart_files(fake_root: Path) -> None:
    runner = fake_root / "runner.dart"
    before = dart_bridge.compute_bridge_hash(fake_root, FAKE_DART_VERSION, runner)
    (fake_root / "dart" / "a2ui_core" / "lib" / "README.md").write_text("notes\n")
    after = dart_bridge.compute_bridge_hash(fake_root, FAKE_DART_VERSION, runner)
    assert before == after


def test_prepare_compile_failure_raises_and_leaves_no_binary(
    fake_root: Path, fake_subprocess: FakeSubprocess, find_dart_calls: list[int]
) -> None:
    fake_subprocess.compile_returncode = 254
    bridge = _bridge(fake_root)
    with pytest.raises(RuntimeError, match="Dart compilation failed") as exc_info:
        bridge.prepare()

    assert "compile error" in str(exc_info.value)
    assert _cached_exes(fake_root) == []
    assert not list((fake_root / ".dart_tool" / "a2ui_eval").glob("*.tmp"))
    assert bridge._compiled_exe is None  # pylint: disable=protected-access


def test_prepare_runs_flutter_pub_get_when_package_config_missing(
    fake_root: Path,
    fake_subprocess: FakeSubprocess,
    find_dart_calls: list[int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (fake_root / ".dart_tool" / "package_config.json").unlink()
    monkeypatch.setattr(
        dart_bridge, "find_flutter_binary", lambda dart_bin=None: "/fake/flutter"
    )
    _bridge(fake_root).prepare()

    pub_get = [c for c in fake_subprocess.calls if c[1:3] == ["pub", "get"]]
    assert pub_get == [["/fake/flutter", "pub", "get"]]
    pub_kwargs = fake_subprocess.kwargs[fake_subprocess.calls.index(pub_get[0])]
    assert pub_kwargs["cwd"] == str(fake_root)
    assert pub_kwargs["capture_output"] is True
    assert pub_kwargs["timeout"] > 0
    assert len(fake_subprocess.compile_calls) == 1


def test_prepare_reports_failed_flutter_pub_get(
    fake_root: Path,
    fake_subprocess: FakeSubprocess,
    find_dart_calls: list[int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (fake_root / ".dart_tool" / "package_config.json").unlink()
    fake_subprocess.pub_get_returncode = 1
    monkeypatch.setattr(
        dart_bridge, "find_flutter_binary", lambda dart_bin=None: "/fake/flutter"
    )
    with pytest.raises(RuntimeError, match="flutter pub get` failed") as exc_info:
        _bridge(fake_root).prepare()

    message = str(exc_info.value)
    assert "pub stderr" in message
    assert str(fake_root) in message
    assert fake_subprocess.compile_calls == []


def test_prepare_without_flutter_gives_instruction(
    fake_root: Path,
    fake_subprocess: FakeSubprocess,
    find_dart_calls: list[int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (fake_root / ".dart_tool" / "package_config.json").unlink()
    monkeypatch.setattr(dart_bridge, "find_flutter_binary", lambda dart_bin=None: None)
    with pytest.raises(RuntimeError, match="Run `flutter pub get`"):
        _bridge(fake_root).prepare()
    assert fake_subprocess.calls == []


def test_find_flutter_binary_prefers_sibling_of_dart(tmp_path: Path) -> None:
    (tmp_path / "dart").write_text("")
    (tmp_path / "flutter").write_text("")
    found = dart_bridge.find_flutter_binary(str(tmp_path / "dart"))
    assert found == str(tmp_path / "flutter")


# ---------------------------------------------------------------------------
# find_dart_binary()
# ---------------------------------------------------------------------------


def test_find_dart_binary_raises_when_only_unsupported_versions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dart_bridge, "_dart_candidates", lambda: ["/old/dart"])
    monkeypatch.setattr(
        dart_bridge, "_dart_version_output", lambda _: "Dart SDK version: 3.9.2"
    )
    with pytest.raises(RuntimeError, match="No supported Dart") as exc_info:
        dart_bridge.find_dart_binary()
    assert "/old/dart (3.9)" in str(exc_info.value)


def test_find_dart_binary_raises_when_version_unreadable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dart_bridge, "_dart_candidates", lambda: ["/broken/dart"])
    monkeypatch.setattr(dart_bridge, "_dart_version_output", lambda _: None)
    with pytest.raises(RuntimeError, match="unknown version"):
        dart_bridge.find_dart_binary()


def test_find_dart_binary_raises_when_none_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dart_bridge, "_dart_candidates", lambda: [])
    with pytest.raises(RuntimeError, match="not found"):
        dart_bridge.find_dart_binary()


def test_find_dart_binary_skips_unsupported_candidates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    versions = {"/old/dart": "Dart SDK version: 3.9.0", "/new/dart": FAKE_DART_VERSION}
    monkeypatch.setattr(dart_bridge, "_dart_candidates", lambda: list(versions))
    monkeypatch.setattr(dart_bridge, "_dart_version_output", versions.get)
    assert dart_bridge.find_dart_binary() == "/new/dart"


# ---------------------------------------------------------------------------
# Runner invocation: payload and error mapping
# ---------------------------------------------------------------------------


@pytest.fixture
def ready_bridge(
    fake_root: Path, fake_subprocess: FakeSubprocess, find_dart_calls: list[int]
) -> DartSdkBridge:
    bridge = _bridge(fake_root)
    bridge.prepare()
    return bridge


def test_parse_payload_carries_version_surface_and_flags(
    ready_bridge: DartSdkBridge, fake_subprocess: FakeSubprocess
) -> None:
    fake_subprocess.runner_stdout = json.dumps(
        {"result": {"compiled_jsons": [], "parts": []}}
    ).encode()
    result = ready_bridge.parse_and_validate(
        "express",
        "v0.9.1",
        "/cat.json",
        "my_surface",
        "<a2ui>root = Text('x')</a2ui>",
        require_complete_tags=True,
        validate=False,
    )

    assert result == {"compiled_jsons": [], "parts": []}
    assert fake_subprocess.runner_inputs[-1] == {
        "action": "parse_and_validate",
        "format_name": "express",
        "version": "0.9.1",
        "resolved_catalog_path": "/cat.json",
        "surface_id": "my_surface",
        "completion": "<a2ui>root = Text('x')</a2ui>",
        "require_complete_tags": True,
        "validate": False,
    }


def test_generate_prompt_payload_and_cache(
    ready_bridge: DartSdkBridge, fake_subprocess: FakeSubprocess
) -> None:
    first = ready_bridge.generate_prompt("direct_json", "0.9.1", "/cat.json", "s1")
    second = ready_bridge.generate_prompt("direct_json", "v0.9.1", "/cat.json", "s1")
    assert first == second == "PROMPT"
    assert len(fake_subprocess.runner_calls) == 1
    assert fake_subprocess.runner_inputs[0] == {
        "action": "generate_prompt",
        "format_name": "direct_json",
        "version": "0.9.1",
        "resolved_catalog_path": "/cat.json",
        "surface_id": "s1",
    }

    ready_bridge.generate_prompt("direct_json", "0.9.1", "/cat.json", "s2")
    ready_bridge.generate_prompt("express", "0.9.1", "/cat.json", "s1")
    ready_bridge.generate_prompt("direct_json", "0.9.1", "/other.json", "s1")
    assert len(fake_subprocess.runner_calls) == 4


def test_generate_prompt_does_not_cache_errors(
    ready_bridge: DartSdkBridge, fake_subprocess: FakeSubprocess
) -> None:
    fake_subprocess.runner_stdout = b'{"error": "boom"}'
    for _ in range(2):
        with pytest.raises(ValueError, match="boom"):
            ready_bridge.generate_prompt("direct_json", "0.9.1", "/cat.json")
    assert len(fake_subprocess.runner_calls) == 2


@pytest.mark.parametrize(
    ("stdout", "stderr", "match"),
    [
        (b"not json at all", b"", "Invalid JSON from Dart SDK runner: not json"),
        (b"{broken", b"segfault detail", "segfault detail"),
        (b"", b"runner crashed", r"produced no output \(runner crashed\)"),
        (b"", b"", r"produced no output \(exit code 0\)"),
        (b"[1, 2]", b"", "returned list, expected an object"),
        (b'{"error": "Catalog declares no component"}', b"", "^Catalog declares no"),
        (b'{"unexpected": 1}', b"", "has no 'result'"),
    ],
)
def test_runner_error_mapping(
    ready_bridge: DartSdkBridge,
    fake_subprocess: FakeSubprocess,
    stdout: bytes,
    stderr: bytes,
    match: str,
) -> None:
    fake_subprocess.runner_stdout = stdout
    fake_subprocess.runner_stderr = stderr
    with pytest.raises(ValueError, match=match):
        ready_bridge.parse_and_validate(
            "direct_json", "0.9.1", "/cat.json", "main", "<a2ui-json>[]</a2ui-json>"
        )


def test_runner_timeout_raises_timeout_error(
    ready_bridge: DartSdkBridge, monkeypatch: pytest.MonkeyPatch
) -> None:
    def hang(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[Any]:
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    monkeypatch.setattr(dart_bridge.subprocess, "run", hang)
    with pytest.raises(TimeoutError, match="timed out after 2.5s"):
        ready_bridge.parse_and_validate(
            "express", "0.9.1", "/cat.json", "main", "x", timeout_sec=2.5
        )


def test_runner_long_output_is_truncated(
    ready_bridge: DartSdkBridge, fake_subprocess: FakeSubprocess
) -> None:
    fake_subprocess.runner_stdout = b"x" * 50_000
    with pytest.raises(ValueError) as exc_info:
        ready_bridge.generate_prompt("express", "0.9.1", "/cat.json")
    assert len(str(exc_info.value)) < 10_000
    assert "truncated" in str(exc_info.value)


@pytest.mark.parametrize("version", ["2.0", "0.8"])
def test_unknown_versions_are_rejected_before_running(
    ready_bridge: DartSdkBridge, fake_subprocess: FakeSubprocess, version: str
) -> None:
    with pytest.raises(ValueError, match="not supported"):
        ready_bridge.generate_prompt("direct_json", version, "/cat.json")
    assert fake_subprocess.runner_calls == []


def test_v1_0_is_rejected_before_running(
    ready_bridge: DartSdkBridge, fake_subprocess: FakeSubprocess
) -> None:
    """package:a2ui_agent implements v0.9 and v0.9.1 only."""
    with pytest.raises(ValueError, match="not supported"):
        ready_bridge.parse_and_validate("express", "1.0", "/cat.json", "main", "x")
    assert fake_subprocess.runner_calls == []


def test_unsupported_format_is_rejected(ready_bridge: DartSdkBridge) -> None:
    with pytest.raises(ValueError, match="not supported by SDK 'dart'"):
        ready_bridge.generate_prompt("elemental", "0.9.1", "/cat.json")


# ---------------------------------------------------------------------------
# Real toolchain
# ---------------------------------------------------------------------------

DART_TEST_ROOT = Path(os.environ.get("A2UI_EVAL_DART_ROOT") or GIT_ROOT)


def _real_dart_toolchain_available() -> bool:
    """Whether a supported Dart SDK and a resolved package config exist."""
    if not (DART_TEST_ROOT / ".dart_tool" / "package_config.json").is_file():
        return False
    try:
        dart_bridge.find_dart_binary()
    except RuntimeError:
        return False
    return True


requires_dart_toolchain = pytest.mark.skipif(
    not _real_dart_toolchain_available(),
    reason=(
        "Needs a Dart SDK >= 3.10 and a resolved .dart_tool/package_config.json"
        f" under {DART_TEST_ROOT} (run `flutter pub get` at the repository root)."
    ),
)


@pytest.fixture(scope="module")
def real_bridge() -> DartSdkBridge:
    return DartSdkBridge(git_root=DART_TEST_ROOT)


def _v091_payload(version: str, component: str = "Text") -> str:
    messages = [
        {
            "version": version,
            "createSurface": {"surfaceId": "main", "catalogId": V09_CATALOG_ID},
        },
        {
            "version": version,
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {"id": "root", "component": "Column", "children": ["t"]},
                    {"id": "t", "component": component, "text": "hi"},
                ],
            },
        },
    ]
    return f"<a2ui-json>\n{json.dumps(messages)}\n</a2ui-json>"


@requires_dart_toolchain
def test_real_direct_json_prompt_targets_v0_9_1(real_bridge: DartSdkBridge) -> None:
    prompt = real_bridge.generate_prompt("direct_json", "0.9.1", V091_CATALOG)
    assert '"version":{"enum":["v0.9","v0.9.1"]}' in prompt
    assert V09_CATALOG_ID in prompt


@requires_dart_toolchain
@pytest.mark.parametrize("wire_version", ["v0.9", "v0.9.1"])
def test_real_direct_json_valid_v0_9_1_payload(
    real_bridge: DartSdkBridge, wire_version: str
) -> None:
    result = real_bridge.parse_and_validate(
        "direct_json", "0.9.1", V091_CATALOG, "main", _v091_payload(wire_version)
    )
    assert [m["version"] for m in result["compiled_jsons"]] == [wire_version] * 2
    assert "sendDataModel" not in result["compiled_jsons"][0]["createSurface"]


@requires_dart_toolchain
def test_real_direct_json_keeps_explicit_send_data_model_false(
    real_bridge: DartSdkBridge,
) -> None:
    completion = _v091_payload("v0.9.1").replace(
        f'"catalogId": "{V09_CATALOG_ID}"',
        f'"catalogId": "{V09_CATALOG_ID}", "sendDataModel": false',
    )
    result = real_bridge.parse_and_validate(
        "direct_json", "0.9.1", V091_CATALOG, "main", completion
    )
    assert result["compiled_jsons"][0]["createSurface"]["sendDataModel"] is False


@requires_dart_toolchain
def test_real_direct_json_rejects_unknown_component(
    real_bridge: DartSdkBridge,
) -> None:
    with pytest.raises(ValueError, match="Bogus") as exc_info:
        real_bridge.parse_and_validate(
            "direct_json",
            "0.9.1",
            V091_CATALOG,
            "main",
            _v091_payload("v0.9.1", component="Bogus"),
        )
    message = str(exc_info.value)
    assert "Bad state" not in message
    assert "A2uiValidationError" not in message


@requires_dart_toolchain
def test_real_direct_json_rejects_v1_0_messages_in_v0_9_1_run(
    real_bridge: DartSdkBridge,
) -> None:
    with pytest.raises(ValueError, match="v1.0"):
        real_bridge.parse_and_validate(
            "direct_json", "0.9.1", V091_CATALOG, "main", _v091_payload("v1.0")
        )


@requires_dart_toolchain
@pytest.mark.parametrize(
    ("surface_id", "block", "expected"),
    [
        ("other", 'root = Column([t])\nt = Text("hi")', "other"),
        ("main", 'root = Column([t])\nt = Text("hi")', "main"),
        (
            "other",
            'surface("explicit")\nroot = Column([t])\nt = Text("hi")',
            "explicit",
        ),
    ],
)
def test_real_express_surface_id_and_version(
    real_bridge: DartSdkBridge, surface_id: str, block: str, expected: str
) -> None:
    result = real_bridge.parse_and_validate(
        "express", "0.9.1", V091_CATALOG, surface_id, f"<a2ui>\n{block}\n</a2ui>"
    )
    messages = result["compiled_jsons"]
    assert [next(iter(m.keys() - {"version"})) for m in messages] == [
        "createSurface",
        "updateComponents",
    ]
    for message in messages:
        assert message["version"] == "v0.9.1"
        body = message.get("createSurface") or message["updateComponents"]
        assert body["surfaceId"] == expected


@requires_dart_toolchain
def test_real_runner_rejects_v1_0(real_bridge: DartSdkBridge) -> None:
    """The runner itself refuses v1.0, even if the Python-side check allows it."""
    with pytest.raises(ValueError, match="does not support protocol v1.0"):
        real_bridge._invoke_runner({  # pylint: disable=protected-access
            "action": "generate_prompt",
            "format_name": "direct_json",
            "version": "1.0",
            "resolved_catalog_path": V10_CATALOG,
        })
