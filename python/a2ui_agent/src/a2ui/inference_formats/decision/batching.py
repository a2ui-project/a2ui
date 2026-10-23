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

"""Event-loop window batching wrapper for `DecisionBackend` implementations."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .backends import DecisionBackend, _AsyncClosable
from .models import (
    DecisionAnswer,
    DecisionBatch,
    DecisionDistribution,
    DecisionQuery,
    DecisionQuestion,
    QuestionKind,
)


@dataclass(frozen=True)
class _QueueEntry:
    """One queued question awaiting batched execution."""

    question: DecisionQuestion
    shared_context: Mapping[str, Any]
    future: asyncio.Future[DecisionAnswer]


def _query_to_question(query: DecisionQuery, seq: int) -> DecisionQuestion:
    """Wraps a `DecisionQuery` as a `CHOICE` `DecisionQuestion` for batching."""
    task_str = str(getattr(query.task, "value", query.task))
    raw_id = query.context.get("question_id")
    question_id = (
        str(raw_id) if isinstance(raw_id, str) and raw_id else f"{task_str}:q_{seq}"
    )
    descriptions = query.context.get("candidate_descriptions")
    option_texts: tuple[str, ...] = ()
    if isinstance(descriptions, Mapping) and all(
        c in descriptions for c in query.candidates
    ):
        option_texts = tuple(str(descriptions[c]) for c in query.candidates)
    return DecisionQuestion(
        id=question_id,
        kind=QuestionKind.CHOICE,
        prompt=query.prompt,
        options=query.candidates,
        option_texts=option_texts,
        context=query.context,
        allow_none=False,
    )


def _set_future_result(
    future: asyncio.Future[DecisionAnswer], answer: DecisionAnswer
) -> None:
    """Resolves `future` with `answer` if it has not already been cancelled."""
    if not future.done():
        future.set_result(answer)


def _set_future_exception(
    future: asyncio.Future[DecisionAnswer], exc: BaseException
) -> None:
    """Rejects `future` with `exc` if it has not already been cancelled."""
    if not future.done():
        future.set_exception(exc)


class BatchingDecisionBackend(_AsyncClosable):
    """Coalesces concurrent `predict` and `answer` calls into `inner.answer`."""

    def __init__(
        self,
        inner: DecisionBackend,
        *,
        window_ms: float = 2.0,
        max_pairs: int = 400,
    ) -> None:
        if window_ms < 0.0:
            raise ValueError(f"window_ms must be non-negative, got {window_ms}")
        if max_pairs < 1:
            raise ValueError(f"max_pairs must be >= 1, got {max_pairs}")
        self.inner = inner
        self.window_ms = float(window_ms)
        self.max_pairs = int(max_pairs)
        self._seq = 0
        self._pending: list[_QueueEntry] = []
        self._scheduled_flush: asyncio.Task[None] | None = None
        self._active_flushes: set[asyncio.Task[None]] = set()

    def _enqueue(
        self, question: DecisionQuestion, shared_context: Mapping[str, Any]
    ) -> asyncio.Future[DecisionAnswer]:
        """Appends `question` to the pending window and ensures a flush is scheduled."""
        loop = asyncio.get_running_loop()
        future: asyncio.Future[DecisionAnswer] = loop.create_future()
        self._pending.append(
            _QueueEntry(
                question=question,
                shared_context=shared_context,
                future=future,
            )
        )
        if self._scheduled_flush is None or self._scheduled_flush.done():
            task = loop.create_task(self._flush())
            self._scheduled_flush = task
            self._active_flushes.add(task)
            task.add_done_callback(self._active_flushes.discard)
        return future

    def _collect(self, entries: Sequence[_QueueEntry]) -> list[list[_QueueEntry]]:
        """Partitions `entries` into conflict-free chunks bounded by `max_pairs`."""
        chunks: list[list[_QueueEntry]] = []
        current: list[_QueueEntry] = []
        current_ids: set[str] = set()
        current_pairs = 0

        for entry in entries:
            q_id = entry.question.id
            q_pairs = len(entry.question.candidates())
            exceeds_pairs = bool(current) and (current_pairs + q_pairs > self.max_pairs)
            if q_id in current_ids or exceeds_pairs:
                chunks.append(current)
                current = []
                current_ids = set()
                current_pairs = 0
            current.append(entry)
            current_ids.add(q_id)
            current_pairs += q_pairs

        if current:
            chunks.append(current)
        return chunks

    async def _dispatch(self, chunk: Sequence[_QueueEntry]) -> None:
        """Executes one coalesced chunk against `inner.answer` and resolves futures."""
        merged_context: dict[str, Any] = {}
        for entry in chunk:
            merged_context.update(entry.shared_context)
        batch = DecisionBatch(
            shared_context=merged_context,
            questions=tuple(entry.question for entry in chunk),
        )
        try:
            answers = await self.inner.answer(batch)
            if len(answers) != len(chunk):
                raise ValueError(
                    f"Expected {len(chunk)} answers from backend, got {len(answers)}."
                )
        except Exception as exc:
            if len(chunk) == 1:
                _set_future_exception(chunk[0].future, exc)
                return
            for entry in chunk:
                await self._dispatch((entry,))
            return

        for entry, ans in zip(chunk, answers):
            _set_future_result(entry.future, ans)

    async def _flush(self) -> None:
        """Waits one window, drains queued entries, and dispatches chunks."""
        await asyncio.sleep(self.window_ms / 1000.0)
        if not self._pending:
            return
        entries = list(self._pending)
        self._pending.clear()
        self._scheduled_flush = None
        chunks = self._collect(entries)
        await asyncio.gather(*(self._dispatch(chunk) for chunk in chunks))

    async def predict(self, query: DecisionQuery) -> DecisionDistribution:
        """Coalesces `query` into the active batch window and returns its distribution."""
        if not query.candidates:
            return await self.inner.predict(query)
        self._seq += 1
        question = _query_to_question(query, self._seq)
        answer = await self._enqueue(question, query.context)
        return answer.distribution

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Coalesces all questions in `batch` into the active window."""
        if not batch.questions:
            return ()
        futures = [self._enqueue(q, batch.shared_context) for q in batch.questions]
        results = await asyncio.gather(*futures)
        return tuple(results)

    async def aclose_current_loop(self) -> None:
        """Drains flushes on the running loop and closes loop-local inner state."""
        loop = asyncio.get_running_loop()
        while True:
            loop_tasks = tuple(t for t in self._active_flushes if t.get_loop() is loop)
            if not loop_tasks:
                break
            self._active_flushes.difference_update(loop_tasks)
            await asyncio.gather(*loop_tasks, return_exceptions=True)
        close_fn = getattr(self.inner, "aclose_current_loop", None)
        if callable(close_fn):
            await close_fn()

    async def aclose(self) -> None:
        """Drains any pending flushes and closes the inner backend."""
        while self._active_flushes:
            pending_tasks = tuple(self._active_flushes)
            self._active_flushes.difference_update(pending_tasks)
            await asyncio.gather(*pending_tasks, return_exceptions=True)
        await self.inner.aclose()


__all__ = ["BatchingDecisionBackend"]
