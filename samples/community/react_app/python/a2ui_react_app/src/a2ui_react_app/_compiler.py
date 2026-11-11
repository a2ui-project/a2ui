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

"""Client of the ReactApp compile worker (`@a2ui-labs/react-app-compiler`)."""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
import itertools
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from types import TracebackType
from typing import Any, Literal

__all__ = [
    "CompileDiagnostic",
    "CompileResult",
    "ReactAppCompiler",
    "default_worker_path",
]

logger = logging.getLogger(__name__)

WORKER_ENV = "A2UI_REACT_APP_COMPILER"
"""Environment variable that overrides the path of the compile worker script."""


def default_worker_path() -> Path:
    """The compile worker: `$A2UI_REACT_APP_COMPILER`, else the monorepo build if present."""
    configured = os.environ.get(WORKER_ENV)
    if configured:
        return Path(configured)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "typescript" / "react_app_compiler" / "dist" / "worker.js"
        if candidate.is_file():
            return candidate
    if len(here.parents) > 4:
        return (
            here.parents[4] / "typescript" / "react_app_compiler" / "dist" / "worker.js"
        )
    return here.parent / "worker.js"


@dataclass(frozen=True)
class CompileDiagnostic:
    """One problem the compiler found; positions are 1-based lines and columns of `source`."""

    phase: Literal["transpile", "type"]
    message: str
    line: int
    column: int
    code: int | None = None

    def describe(self) -> str:
        """`line:column message`, the way the repair prompt lists diagnostics."""
        prefix = f"TS{self.code} " if self.code else ""
        return f"{self.line}:{self.column} {prefix}{self.message}"


@dataclass(frozen=True)
class CompileResult:
    """The result of compiling one source.

    Attributes:
        ok: Whether it transpiled and type-checked without errors.
        compiled: The transpiled ES module, when the transpile succeeded.
        diagnostics: Every problem, transpile or type.
        transpile_ms: Worker time spent in Sucrase.
        typecheck_ms: Worker time spent in the type check.
        round_trip_ms: Time from sending the request to reading the answer.
    """

    ok: bool
    compiled: str | None
    diagnostics: tuple[CompileDiagnostic, ...] = field(default_factory=tuple)
    transpile_ms: int = 0
    typecheck_ms: int = 0
    round_trip_ms: int = 0

    @staticmethod
    def from_json(data: dict[str, Any], round_trip_ms: int) -> CompileResult:
        timings = data.get("timings") or {}
        return CompileResult(
            ok=bool(data.get("ok")),
            compiled=data.get("compiled"),
            diagnostics=tuple(
                CompileDiagnostic(
                    phase="transpile" if d.get("phase") == "transpile" else "type",
                    message=str(d.get("message", "")),
                    line=int(d.get("line", 1)),
                    column=int(d.get("column", 1)),
                    code=d.get("code"),
                )
                for d in data.get("diagnostics") or []
            ),
            transpile_ms=int(timings.get("transpileMs") or 0),
            typecheck_ms=int(timings.get("typecheckMs") or 0),
            round_trip_ms=round_trip_ms,
        )


class ReactAppCompiler:
    """A long-running Node compile worker, started on first use or with `start()`.

    The worker transpiles with Sucrase, as the frame runtime does, and
    type-checks with a warm TypeScript language service against the `a2ui`
    module, `@types/react` and the bindings declarations of the call. Calls are
    serialized with a lock, so one instance can be shared across threads; call
    `start()` at server startup and run `compile` or `transform_to_transport`
    in `asyncio.to_thread` from async code so the event loop never blocks. Use
    it as a context manager, or call `close`, to stop the worker.
    """

    def __init__(
        self,
        worker_path: str | Path | None = None,
        *,
        node: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        """Initializes the client; the worker starts on `start()` or the first call.

        Args:
            worker_path: The worker script (`dist/worker.js` of
                `@a2ui-labs/react-app-compiler`). Defaults to `default_worker_path()`.
            node: The Node executable. Defaults to `node` on the `PATH`.
            timeout: Seconds to wait for one answer before the worker is
                restarted and the call fails.
        """
        self._worker_path = Path(worker_path) if worker_path else default_worker_path()
        self._node = node or shutil.which("node") or "node"
        self._timeout = timeout
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()
        self._ids = itertools.count(1)
        self.startup_ms: int | None = None
        """Milliseconds the last worker took to start and warm up, once started."""

    def __enter__(self) -> ReactAppCompiler:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    def start(self) -> None:
        """Starts and warms the worker now, instead of on the first compile."""
        with self._lock:
            self._ensure_process()

    def compile(
        self,
        source: str,
        *,
        bindings: str | None = None,
        skip_type_check: bool = False,
    ) -> CompileResult:
        """Transpiles and type-checks one ReactApp source.

        Args:
            source: The TSX source.
            bindings: Declarations of the `a2ui:bindings` module
                (`ReactAppBindings.declarations`), when the app may import it.
            skip_type_check: Transpile only.

        Raises:
            RuntimeError: If the worker can't start, exits, returns invalid
                JSON, or doesn't answer in time.
        """
        request: dict[str, Any] = {"op": "compile", "source": source}
        if bindings:
            request["bindings"] = bindings
        if skip_type_check:
            request["skipTypeCheck"] = True
        with self._lock:
            process = self._ensure_process()
            request_id = next(self._ids)
            started = time.perf_counter()
            data = self._exchange(process, {"id": request_id, **request}, request_id)
            round_trip_ms = round((time.perf_counter() - started) * 1000)
        if "error" in data:
            raise RuntimeError(f"The ReactApp compiler failed: {data['error']}")
        return CompileResult.from_json(data, round_trip_ms)

    def close(self) -> None:
        """Stops the worker and closes its pipes. A later call starts a new one."""
        with self._lock:
            process = self._process
            if process is not None:
                self._kill(process)

    def _ensure_process(self) -> subprocess.Popen[str]:
        if self._process is not None and self._process.poll() is None:
            return self._process
        if self._process is not None:
            self._kill(self._process)
        if not self._worker_path.exists():
            raise RuntimeError(
                f"The ReactApp compile worker {self._worker_path} doesn't exist. Build"
                " @a2ui-labs/react-app-compiler, or set"
                f" {WORKER_ENV} to its dist/worker.js."
            )
        started = time.perf_counter()
        process = subprocess.Popen(
            [self._node, str(self._worker_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        try:
            ready = self._read_line(process)
        except BaseException:
            self._kill(process)
            raise
        if not ready.get("ready"):
            self._kill(process)
            raise RuntimeError(f"The ReactApp compiler didn't start: {ready}")
        self._process = process
        self.startup_ms = round((time.perf_counter() - started) * 1000)
        logger.info("Started the ReactApp compiler in %d ms", self.startup_ms)
        return process

    def _exchange(
        self, process: subprocess.Popen[str], request: dict[str, Any], request_id: int
    ) -> dict[str, Any]:
        assert process.stdin is not None
        try:
            process.stdin.write(json.dumps(request) + "\n")
            process.stdin.flush()
            while True:
                data = self._read_line(process)
                if data.get("id") == request_id:
                    return data
        except (OSError, RuntimeError):
            self._kill(process)
            raise

    def _read_line(self, process: subprocess.Popen[str]) -> dict[str, Any]:
        assert process.stdout is not None
        result: list[str] = []
        reader = threading.Thread(
            target=lambda: result.append(process.stdout.readline()),  # type: ignore[union-attr]
            daemon=True,
        )
        reader.start()
        reader.join(self._timeout)
        if reader.is_alive() or not result or not result[0]:
            self._kill(process)
            raise RuntimeError("The ReactApp compiler exited or timed out.")
        try:
            parsed = json.loads(result[0])
        except ValueError as exc:
            self._kill(process)
            raise RuntimeError(
                f"The ReactApp compiler returned invalid JSON: {result[0]!r}"
            ) from exc
        if not isinstance(parsed, dict):
            self._kill(process)
            raise RuntimeError(
                f"The ReactApp compiler returned a non-object JSON response: {parsed!r}"
            )
        return parsed

    def _kill(self, process: subprocess.Popen[str]) -> None:
        if self._process is process:
            self._process = None
        if process.poll() is None:
            with contextlib.suppress(OSError):
                process.kill()
        for stream in (process.stdin, process.stdout):
            if stream is not None:
                with contextlib.suppress(OSError):
                    stream.close()
        with contextlib.suppress(subprocess.TimeoutExpired, OSError):
            process.wait(timeout=5.0)
