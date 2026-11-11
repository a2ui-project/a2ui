# Copyright 2026 Google LLC
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

"""Client of the Node worker that transpiles and type-checks ReactApp sources."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import itertools
import json
from pathlib import Path
import shutil
from typing import Any

__all__ = ["CheckResult", "ReactAppChecker", "TypeError_", "default_checker"]

_WORKER = Path(__file__).resolve().parent.parent / "node" / "check_react_app.mjs"


@dataclass(frozen=True)
class TypeError_:
    """One TypeScript error, 1-based position in the source."""

    line: int
    column: int
    message: str


@dataclass(frozen=True)
class CheckResult:
    """Outcome of checking one source.

    Attributes:
        transpiled: Whether Sucrase compiled the source, as the frame runtime does.
        transpile_error: Sucrase's message when it failed.
        type_errors: TypeScript errors against `a2ui.d.ts` and `@types/react`.
        ms: Time the worker spent on the source.
    """

    transpiled: bool
    transpile_error: str | None = None
    type_errors: tuple[TypeError_, ...] = field(default_factory=tuple)
    ms: int = 0

    @property
    def type_checks(self) -> bool:
        return self.transpiled and not self.type_errors

    @staticmethod
    def from_json(data: dict[str, Any]) -> CheckResult:
        return CheckResult(
            transpiled=bool(data.get("transpiled")),
            transpile_error=data.get("transpileError"),
            type_errors=tuple(
                TypeError_(
                    line=int(e.get("line", -1)),
                    column=int(e.get("column", -1)),
                    message=str(e.get("message", "")),
                )
                for e in data.get("typeErrors") or []
            ),
            ms=int(data.get("ms") or 0),
        )


class ReactAppChecker:
    """A long-running `node check_react_app.mjs` process, started on first use.

    Requests are serialized: the worker answers in order, and one warm worker
    is fast enough for an eval run.
    """

    def __init__(self, worker: Path = _WORKER, node: str | None = None) -> None:
        self._worker = worker
        self._node = node or shutil.which("node") or "node"
        self._process: asyncio.subprocess.Process | None = None
        self._lock: asyncio.Lock | None = None
        self._ids = itertools.count(1)

    async def check(self, source: str, timeout: float = 60.0) -> CheckResult:
        """Transpiles and type-checks `source`."""
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            process = await self._ensure_process()
            assert process.stdin is not None and process.stdout is not None
            request_id = next(self._ids)
            line = json.dumps({"id": request_id, "source": source}) + "\n"
            process.stdin.write(line.encode())
            await process.stdin.drain()
            while True:
                raw = await asyncio.wait_for(process.stdout.readline(), timeout)
                if not raw:
                    self._process = None
                    raise RuntimeError("The ReactApp checker exited.")
                data = json.loads(raw)
                if data.get("id") == request_id:
                    return CheckResult.from_json(data)

    async def close(self) -> None:
        process, self._process = self._process, None
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()

    async def _ensure_process(self) -> asyncio.subprocess.Process:
        if self._process is None or self._process.returncode is not None:
            self._process = await asyncio.create_subprocess_exec(
                self._node,
                str(self._worker),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                limit=16 * 1024 * 1024,
            )
        return self._process


_default: tuple[asyncio.AbstractEventLoop, ReactAppChecker] | None = None


def default_checker() -> ReactAppChecker:
    """The checker shared by the scorers running on the current event loop.

    A new loop (a new `inspect_ai.eval` call) gets a new worker, since the old
    one's pipes belong to the previous loop.
    """
    global _default
    loop = asyncio.get_running_loop()
    if _default is None or _default[0] is not loop:
        _default = (loop, ReactAppChecker())
    return _default[1]
