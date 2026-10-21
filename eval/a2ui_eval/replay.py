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

"""Cross-SDK completion replay store.

A Python eval run records every model completion keyed by sample name,
strategy and protocol version. Later runs against the TypeScript and Dart
bridges replay those completions instead of calling the model again, so one
inference pass validates all three SDKs.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ReplayKey = tuple[str, str, str]


def prompt_sha256(prompt: str) -> str:
    """Hex SHA-256 of a system prompt, used to detect prompt drift on replay."""
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RecordedCompletion:
    """One recorded model completion."""

    sample_name: str
    strategy: str
    version: str
    completion: str
    prompt_sha256: str

    @property
    def key(self) -> ReplayKey:
        return (self.sample_name, self.strategy, self.version)


class CompletionReplayStore:
    """Append-only JSONL store of recorded completions.

    Records are keyed by `(sample_name, strategy, version)`; a later record
    with the same key replaces the earlier one on lookup.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._records: dict[ReplayKey, RecordedCompletion] = {}

    @property
    def path(self) -> Path | None:
        return self._path

    def __len__(self) -> int:
        return len(self._records)

    def records(self) -> list[RecordedCompletion]:
        """The stored completions, one per key, in insertion order."""
        with self._lock:
            return list(self._records.values())

    def record(
        self,
        sample_name: str,
        strategy: str,
        version: str,
        completion: str,
        prompt_sha256: str,
    ) -> RecordedCompletion:
        """Stores a completion in memory and appends it to the JSONL file."""
        rec = RecordedCompletion(
            sample_name=sample_name,
            strategy=strategy,
            version=version,
            completion=completion,
            prompt_sha256=prompt_sha256,
        )
        with self._lock:
            self._records[rec.key] = rec
            if self._path is not None:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                with self._path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(asdict(rec)) + "\n")
        return rec

    def lookup(
        self, sample_name: str, strategy: str, version: str
    ) -> RecordedCompletion | None:
        """Returns the recorded completion for the key, or None."""
        return self._records.get((sample_name, strategy, version))

    @classmethod
    def load(cls, path: Path) -> CompletionReplayStore:
        """Loads a JSONL replay file; further `record` calls append to it."""
        store = cls(path)
        if not path.exists():
            return store
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rec = RecordedCompletion(**json.loads(line))
                    store._records[rec.key] = rec
        return store

    @classmethod
    def from_eval_log(cls, eval_log_path: Path) -> CompletionReplayStore:
        """Builds an in-memory store from an Inspect AI `.eval` log.

        The strategy and version come from the log's `task_args` (falling back
        to `eval.metadata`). Each sample contributes its final completion keyed
        by `sample.metadata["name"]`; samples without a name or completion are
        skipped.
        """
        from inspect_ai.log import read_eval_log  # pylint: disable=import-outside-toplevel

        log = read_eval_log(str(eval_log_path))
        task_args: dict[str, Any] = dict(log.eval.task_args or {})
        task_meta: dict[str, Any] = dict(log.eval.metadata or {})
        strategy = str(
            task_args.get("strategy") or task_meta.get("strategy") or "direct"
        )
        version = str(task_args.get("version") or task_meta.get("version") or "")

        store = cls()
        for sample in log.samples or []:
            name = (sample.metadata or {}).get("name")
            completion = _sample_completion(sample)
            if not name or not completion:
                continue
            store.record(
                sample_name=str(name),
                strategy=strategy,
                version=version,
                completion=completion,
                prompt_sha256=prompt_sha256(_first_system_text(sample.messages)),
            )
        return store


def _sample_completion(sample: Any) -> str:
    """The sample's raw model completion.

    The first assistant message is preferred over `output.completion`: for
    formats other than Direct JSON the compile step rewrites `output` into an
    `<a2ui-json>` payload, while the message log keeps what the model wrote.
    """
    for message in getattr(sample, "messages", None) or []:
        if message.role == "assistant" and message.text:
            return str(message.text)
    output = getattr(sample, "output", None)
    if output is not None and output.completion:
        return str(output.completion)
    return ""


def _first_system_text(messages: list[Any] | None) -> str:
    """The text of the first system message, or an empty string."""
    for message in messages or []:
        if message.role == "system":
            return str(message.text)
    return ""


__all__ = [
    "CompletionReplayStore",
    "RecordedCompletion",
    "prompt_sha256",
]
