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

"""Python Agent SDK bridge implementation.

Parsing and validation run in long-lived worker processes so that a runaway
parse can be killed without taking down the evaluation. A worker is a plain
`python -c` interpreter that imports only this module and the A2UI SDK. It does
not re-import the evaluation's `__main__` module, so it starts in well under a
second, and it is reused across calls until it times out or dies.

This module must not import `inspect_ai` or the TypeScript/Dart bridges: the
worker imports it, and anything it pulls in adds to worker start-up time.
"""

from __future__ import annotations

import collections
from collections.abc import Mapping, Sequence
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import traceback
from typing import Any, IO

from a2ui.catalog_transformers import (
    CatalogTransformer,
    ComponentPruningTransformer,
    FunctionPruningTransformer,
)
from a2ui.core import (
    CatalogApi,
    MessageProcessor,
    MessageProcessorOptions,
    STRICT_VALIDATION,
)
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat
from a2ui.inference_formats import (
    AtomFormat,
    DirectJsonFormat,
    ElementalFormat,
    ExpressFormat,
    to_message_dicts,
)
from a2ui.parser import A2uiPart, Parser, TextPart, normalize_prompt_example_messages
from a2ui.processor import CatalogConfig

from .base import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    AgentSdkBridge,
    BridgeOptions,
    validate_sdk_format,
    validate_sdk_version,
)

_WORKER_STARTUP_TIMEOUT_SEC = 120.0
_STDERR_TAIL_CHARS = 8192
_EVAL_ROOT = str(Path(__file__).resolve().parents[2])
_WORKER_SOURCE = (
    "from a2ui_eval.bridges.python_bridge import _worker_main; _worker_main()"
)

# The dictionary form of `BridgeOptions`, as it crosses the worker's JSON pipe.
OptionsDict = dict[str, Any]
Examples = list[list[AgentToRendererMessage]]


def _catalog_transformers(spec: Mapping[str, Any]) -> list[CatalogTransformer]:
    """Builds the pruning transformers a catalog spec asks for."""
    transformers: list[CatalogTransformer] = []
    allowed_components = spec.get("allowed_components")
    if allowed_components is not None:
        transformers.append(ComponentPruningTransformer(list(allowed_components)))
    allowed_functions = spec.get("allowed_functions")
    if allowed_functions is not None:
        transformers.append(FunctionPruningTransformer(list(allowed_functions)))
    return transformers


def _load_catalog(spec: Mapping[str, Any], version: str) -> CatalogApi:
    """Loads one catalog spec from disk and applies its pruning."""
    return CatalogConfig.from_path(
        str(spec["path"]),
        transformers=_catalog_transformers(spec),
        protocol_version=version,
        catalog_id=spec.get("catalog_id"),
    ).transformed_catalog


def _read_example_file(path: str) -> list[dict[str, Any]]:
    """Reads one example file: a JSON list of messages, or `{"messages": [...]}`."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = data.get("messages")
    if not isinstance(data, list):
        raise ValueError(
            f"Example file {path} must hold a JSON list of A2UI messages or an"
            ' object with a "messages" list.'
        )
    return [dict(m) for m in data]


def _prefixed_version(version: str) -> str:
    """Returns the protocol version in its `v`-prefixed wire form (`v1.0`)."""
    return version if version.startswith("v") else f"v{version}"


def _load_examples(paths: Sequence[str], catalog: CatalogApi, version: str) -> Examples:
    """Loads few-shot example turns, defaulting their catalog to `catalog`."""
    return [
        normalize_prompt_example_messages(
            _read_example_file(path),
            version=_prefixed_version(version),
            default_catalog_id=catalog.id,
        )
        for path in paths
    ]


def build_catalogs_and_examples(
    resolved_catalog_path: str,
    version: str,
    options: OptionsDict | None,
) -> tuple[list[CatalogApi], Examples | None]:
    """Loads the catalogs and few-shot examples that `options` describes.

    Args:
        resolved_catalog_path: The catalog used when `options` names none.
        version: The protocol version the catalogs must target.
        options: The `to_dict` form of a `BridgeOptions`, or None.

    Returns:
        The pruned catalogs in order, and the example turns (one list of
        messages per example file) or None when no spec lists any.
    """
    specs: Sequence[Mapping[str, Any]] = (options or {}).get("catalogs") or [
        {"path": resolved_catalog_path}
    ]
    catalogs: list[CatalogApi] = []
    examples: Examples = []
    for spec in specs:
        catalog = _load_catalog(spec, version)
        catalogs.append(catalog)
        examples.extend(_load_examples(spec.get("examples") or (), catalog, version))
    return catalogs, examples or None


def get_python_strategy(
    format_name: str,
    version: str,
    catalog_config: CatalogConfig | Sequence[CatalogApi],
    surface_id: str = "main",
    *,
    examples: Examples | None = None,
    allowed_messages: Sequence[str] | None = None,
) -> InferenceFormat:
    """Resolves and instantiates the Python InferenceFormat strategy.

    Args:
        format_name: One of `direct_json`, `express`, `elemental` or `atom`.
        version: The protocol version, with or without a `v` prefix.
        catalog_config: A single `CatalogConfig` (its transformed catalog is
            used) or the already-loaded catalogs, in order.
        surface_id: The default surface for formats that need one.
        examples: Few-shot example turns to show in the prompt.
        allowed_messages: Message types the model may write, or None for all.

    Returns:
        The instantiated `InferenceFormat` strategy.

    Raises:
        ValueError: If `format_name` is unknown.
    """
    catalogs = (
        [catalog_config.transformed_catalog]
        if isinstance(catalog_config, CatalogConfig)
        else list(catalog_config)
    )
    if format_name == "direct_json":
        return DirectJsonFormat(
            catalogs, examples=examples, allowed_messages=allowed_messages
        )

    formatted_version = _prefixed_version(version)
    if format_name == "express":
        return ExpressFormat(
            catalogs,
            examples=examples,
            allowed_messages=allowed_messages,
            surface_id=surface_id,
            version=formatted_version,
        )
    if format_name == "elemental":
        return ElementalFormat(
            catalogs,
            examples=examples,
            allowed_messages=allowed_messages,
            surface_id=surface_id,
        )
    if format_name == "atom":
        return AtomFormat(
            catalogs,
            examples=examples,
            allowed_messages=allowed_messages,
            surface_id=surface_id,
        )

    raise ValueError(f"Unknown format strategy: {format_name}")


def _check_complete_tags(parser: Parser, format_name: str, completion: str) -> None:
    if parser.has_format_content(completion, complete=True):
        return
    if format_name == "direct_json":
        raise ValueError(
            "A2UI tags '<a2ui-json>' and '</a2ui-json>' not found in response."
        )
    raise ValueError("A2UI tags '<a2ui>' and '</a2ui>' not found in response.")


def _serialize_parts(
    parts: Sequence[TextPart | A2uiPart],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Splits parsed parts into the compiled messages and their JSON form."""
    compiled_jsons: list[dict[str, Any]] = []
    serialized_parts: list[dict[str, Any]] = []
    for p in parts:
        if isinstance(p, TextPart):
            serialized_parts.append({"text": p.text, "a2ui_json": None})
        elif isinstance(p, A2uiPart):
            msgs = to_message_dicts(p.a2ui)
            serialized_parts.append({"text": "", "a2ui_json": msgs})
            compiled_jsons.extend(msgs)
    return compiled_jsons, serialized_parts


def _check_streamed_parse(
    strategy: InferenceFormat, completion: str, chunk_size: int
) -> None:
    """Feeds `completion` through a fresh streaming parser in fixed slices.

    Raises:
        ValueError: If the streamed parse raises, or yields no A2UI part.
    """
    if chunk_size < 1:
        raise ValueError(f"stream_chunk_size must be >= 1, got {chunk_size}")
    parser = strategy.create_parser()
    if not parser.supports_streaming:
        return
    streamed: list[Any] = []
    try:
        for start in range(0, len(completion), chunk_size):
            streamed.extend(parser.parse_chunk(completion[start : start + chunk_size]))
    except Exception as e:
        raise ValueError(
            f"Streaming parse failed with chunks of {chunk_size} characters: {e}"
        ) from e
    if not any(isinstance(p, A2uiPart) for p in streamed):
        raise ValueError(
            f"Streaming parse with chunks of {chunk_size} characters yielded no"
            " A2UI part, but the whole-response parse did."
        )


def _validate_messages(
    catalogs: Sequence[CatalogApi],
    compiled_jsons: list[dict[str, Any]],
    initial_renderer_state: Sequence[dict[str, Any]] | None,
) -> None:
    """Strictly validates the model's turn, after any pre-seeded state."""
    processor = MessageProcessor(
        list(catalogs),
        options=MessageProcessorOptions(validation_config=STRICT_VALIDATION),
    )
    if initial_renderer_state:
        processor.process_messages(list(initial_renderer_state))
    processor.process_messages(compiled_jsons)


def parse_and_validate_in_process(
    format_name: str,
    version: str,
    resolved_catalog_path: str,
    surface_id: str,
    completion: str,
    require_complete_tags: bool = False,
    *,
    validate: bool = True,
    options: OptionsDict | None = None,
) -> dict[str, Any]:
    """Parses an LLM response in the current Python process.

    When `validate` is True, the compiled messages are also run through a strict
    `MessageProcessor`, seeded with `options["initial_renderer_state"]` when
    given. When `options["stream_chunk_size"]` is set and the format's parser
    streams, the completion is also parsed in slices of that many characters.
    """
    opts = options or {}
    catalogs, examples = build_catalogs_and_examples(
        resolved_catalog_path, version, opts
    )
    strategy = get_python_strategy(
        format_name,
        version,
        catalogs,
        surface_id=surface_id,
        examples=examples,
        allowed_messages=opts.get("allowed_messages"),
    )
    parser = strategy.create_parser()
    if require_complete_tags:
        _check_complete_tags(parser, format_name, completion)

    compiled_jsons, serialized_parts = _serialize_parts(
        parser.parse_response(completion)
    )
    if not compiled_jsons:
        if format_name == "direct_json":
            raise ValueError("No A2UI JSON found in response (tags missing or empty)")
        raise ValueError(
            f"No compiled A2UI {format_name} user interface found in parsed parts."
        )

    chunk_size = opts.get("stream_chunk_size")
    if chunk_size is not None:
        _check_streamed_parse(strategy, completion, int(chunk_size))
    if validate:
        _validate_messages(catalogs, compiled_jsons, opts.get("initial_renderer_state"))
    return {"compiled_jsons": compiled_jsons, "parts": serialized_parts}


def _worker_main() -> None:
    """Entry point of a worker process: serves one JSON request per stdin line.

    Each request holds the keyword arguments of `parse_and_validate_in_process`.
    Each response is one JSON line holding either `result` or `error`. The real
    stdout is reserved for responses, so stray prints from the SDK go to stderr.
    """
    protocol_out = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr

    def respond(message: dict[str, Any]) -> None:
        protocol_out.write(json.dumps(message) + "\n")
        protocol_out.flush()

    respond({"ready": True})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            result = parse_and_validate_in_process(**json.loads(line))
            response: dict[str, Any] = {"result": result}
        except Exception as e:  # pylint: disable=broad-exception-caught
            response = {"error": f"{e}\n{traceback.format_exc()}"}
        respond(response)


class _Worker:
    """One long-lived worker process and the threads that drain its pipes."""

    _EOF = object()

    def __init__(self, command: Sequence[str]) -> None:
        env = os.environ.copy()
        python_path = env.get("PYTHONPATH")
        env["PYTHONPATH"] = (
            f"{_EVAL_ROOT}{os.pathsep}{python_path}" if python_path else _EVAL_ROOT
        )
        self._proc = subprocess.Popen(
            list(command),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        self._responses: queue.Queue[Any] = queue.Queue()
        self._stderr_tail: collections.deque[str] = collections.deque()
        self._stderr_len = 0
        self._stderr_lock = threading.Lock()
        assert self._proc.stdout is not None and self._proc.stderr is not None
        threading.Thread(
            target=self._drain_stdout, args=(self._proc.stdout,), daemon=True
        ).start()
        threading.Thread(
            target=self._drain_stderr, args=(self._proc.stderr,), daemon=True
        ).start()

        try:
            ready = self._receive(_WORKER_STARTUP_TIMEOUT_SEC)
        except TimeoutError:
            self.kill()
            raise RuntimeError(
                "Python SDK worker did not start within"
                f" {_WORKER_STARTUP_TIMEOUT_SEC}s.{self._stderr_suffix()}"
            ) from None
        if not ready.get("ready"):
            self.kill()
            raise RuntimeError(
                f"Python SDK worker sent an unexpected greeting: {ready!r}"
            )

    def _drain_stdout(self, stream: IO[str]) -> None:
        for line in stream:
            if line.strip():
                self._responses.put(line)
        self._responses.put(self._EOF)

    def _drain_stderr(self, stream: IO[str]) -> None:
        for line in stream:
            with self._stderr_lock:
                self._stderr_tail.append(line)
                self._stderr_len += len(line)
                while self._stderr_len > _STDERR_TAIL_CHARS and self._stderr_tail:
                    self._stderr_len -= len(self._stderr_tail.popleft())

    def _stderr_suffix(self) -> str:
        with self._stderr_lock:
            tail = "".join(self._stderr_tail).strip()
        return f"\nWorker stderr:\n{tail}" if tail else ""

    def _receive(self, timeout_sec: float | None) -> dict[str, Any]:
        try:
            item = self._responses.get(timeout=timeout_sec)
        except queue.Empty:
            raise TimeoutError from None
        if item is self._EOF:
            try:
                code = self._proc.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                self.kill()
                code = self._proc.returncode
            raise ValueError(
                "Python SDK worker exited without sending a result"
                f" (exit code {code}).{self._stderr_suffix()}"
            )
        try:
            message = json.loads(item)
        except json.JSONDecodeError as exc:
            self.kill()
            raise ValueError(
                f"Invalid JSON from Python SDK worker: {item.strip()}"
            ) from exc
        if not isinstance(message, dict):
            self.kill()
            raise ValueError(f"Unexpected message from Python SDK worker: {message!r}")
        return message

    def request(
        self, payload: dict[str, Any], timeout_sec: float | None
    ) -> dict[str, Any]:
        """Sends one request and waits up to `timeout_sec` for its response."""
        assert self._proc.stdin is not None
        try:
            self._proc.stdin.write(json.dumps(payload) + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError):
            pass  # The worker died; _receive reports its exit code.
        return self._receive(timeout_sec)

    def is_alive(self) -> bool:
        return self._proc.poll() is None

    def kill(self) -> None:
        if self._proc.poll() is None:
            self._proc.kill()
        try:
            self._proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            pass


class _WorkerPool:
    """Hands out idle workers, starting new ones on demand.

    A worker that times out, dies or misbehaves is killed and not reused. Idle
    workers exit on their own when this process exits and closes their stdin.
    """

    def __init__(self, command: Sequence[str] | None = None) -> None:
        self._command = (
            list(command) if command else [sys.executable, "-c", _WORKER_SOURCE]
        )
        self._idle: list[_Worker] = []
        self._lock = threading.Lock()
        self._max_idle = max(2, os.cpu_count() or 2)

    def run(self, payload: dict[str, Any], timeout_sec: float) -> dict[str, Any]:
        """Runs one request on a worker, killing the worker on timeout."""
        with self._lock:
            worker = self._idle.pop() if self._idle else None
        if worker is None or not worker.is_alive():
            worker = _Worker(self._command)

        healthy = False
        try:
            response = worker.request(payload, timeout_sec)
            healthy = True
        except TimeoutError:
            raise TimeoutError(
                f"Format compilation timed out after {timeout_sec}s and"
                " process was killed."
            ) from None
        finally:
            if healthy and worker.is_alive():
                with self._lock:
                    if len(self._idle) < self._max_idle:
                        self._idle.append(worker)
                        worker = None
            if worker is not None:
                worker.kill()

        if "error" in response:
            raise ValueError(response["error"])
        if "result" not in response:
            raise ValueError("Compilation produced no output.")
        return dict(response["result"])


_default_pool: _WorkerPool | None = None
_default_pool_lock = threading.Lock()


def _get_default_pool() -> _WorkerPool:
    global _default_pool
    with _default_pool_lock:
        if _default_pool is None:
            _default_pool = _WorkerPool()
        return _default_pool


class PythonSdkBridge(AgentSdkBridge):
    """Bridge for the Python A2UI Agent SDK (python/a2ui_agent).

    Args:
        worker_command: Command that starts a worker process. Defaults to a
            `python -c` interpreter serving `_worker_main`, shared by every
            bridge that uses the default. A custom command gets its own pool.
    """

    sdk_name = "python"

    def __init__(self, worker_command: Sequence[str] | None = None) -> None:
        self._pool = _WorkerPool(worker_command) if worker_command else None

    def generate_prompt(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str = "main",
        *,
        options: BridgeOptions | None = None,
    ) -> str:
        validate_sdk_format(self.sdk_name, format_name)
        norm_version = validate_sdk_version(self.sdk_name, version)
        opts = options.to_dict() if options is not None else None
        catalogs, examples = build_catalogs_and_examples(
            resolved_catalog_path, norm_version, opts
        )
        strategy = get_python_strategy(
            format_name,
            norm_version,
            catalogs,
            surface_id=surface_id,
            examples=examples,
            allowed_messages=options.allowed_messages if options else None,
        )
        return strategy.prompt_generator.generate()

    def parse_and_validate(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str,
        completion: str,
        timeout_sec: float = DEFAULT_PARSE_TIMEOUT_SEC,
        require_complete_tags: bool = False,
        *,
        validate: bool = True,
        options: BridgeOptions | None = None,
    ) -> dict[str, Any]:
        """Parses, and optionally validates, in a worker process.

        A `timeout_sec` of zero or less selects `DEFAULT_PARSE_TIMEOUT_SEC`, as
        the other SDK bridges do. On timeout the worker is killed and a
        `TimeoutError` is raised. Parse and validation failures, and a worker
        that dies mid-call, raise `ValueError`. `options`, when given, travel
        to the worker in their `to_dict` form under the `options` key.
        """
        validate_sdk_format(self.sdk_name, format_name)
        norm_version = validate_sdk_version(self.sdk_name, version)
        pool = self._pool or _get_default_pool()
        request: dict[str, Any] = {
            "format_name": format_name,
            "version": norm_version,
            "resolved_catalog_path": os.path.abspath(resolved_catalog_path),
            "surface_id": surface_id,
            "completion": completion,
            "require_complete_tags": require_complete_tags,
            "validate": validate,
        }
        # The key is only sent when set, so the worker sees the same request
        # it always did when no options are in play.
        if options is not None:
            request["options"] = options.to_dict()
        return pool.run(
            request, timeout_sec if timeout_sec > 0 else DEFAULT_PARSE_TIMEOUT_SEC
        )
