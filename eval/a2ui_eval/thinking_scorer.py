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

"""Measures how much of the model's thinking is about A2UI.

An app can show the model's thinking to the user while the answer is on its
way. The user asked about their own problem, so thinking about the format, its
code or its data model is noise to them (issue #3576). `thinking_scorer` reads
the thinking a format strategy recorded for the model's first answer and
scores the share of it that the SDK's `remove_a2ui_thinking` would hide from
the user. It does not affect whether a sample passes.
"""

from __future__ import annotations

from a2ui.core import remove_a2ui_thinking
from inspect_ai.scorer import (
    NOANSWER,
    Metric,
    SampleScore,
    Score,
    Scorer,
    Target,
    metric,
    scorer,
)
from inspect_ai.solver import TaskState

from .shared.utils import THINKING_KEY

__all__ = [
    "a2ui_share",
    "free_of_a2ui",
    "thinking_scorer",
]


def _length(text: str) -> int:
    """The number of characters in `text`, not counting whitespace."""
    return sum(1 for c in text if not c.isspace())


def _scored(scores: list[SampleScore]) -> list[float]:
    """The values of the samples whose model showed thinking."""
    return [s.score.as_float() for s in scores if s.score.value != NOANSWER]


@metric
def a2ui_share() -> Metric:
    """Mean share of the thinking that is about A2UI. Lower is better."""

    def compute(scores: list[SampleScore]) -> float:
        values = _scored(scores)
        return sum(values) / len(values) if values else 0.0

    return compute


@metric
def free_of_a2ui() -> Metric:
    """Share of samples whose thinking is never about A2UI. Higher is better."""

    def compute(scores: list[SampleScore]) -> float:
        values = _scored(scores)
        return sum(1 for v in values if v == 0) / len(values) if values else 0.0

    return compute


@scorer(metrics=[a2ui_share(), free_of_a2ui()])
def thinking_scorer() -> Scorer:
    """Scores the share of the model's thinking that is about A2UI.

    The value is the share of the thinking's characters, not counting
    whitespace, that `remove_a2ui_thinking` removes: 0 when the thinking is
    all about the user's request, and 1 when all of it is about the protocol.
    A sample whose model showed no thinking, or whose strategy records none,
    is scored `NOANSWER` and left out of both metrics.
    """

    async def score(state: TaskState, target: Target) -> Score:  # pylint: disable=unused-argument
        thinking = state.metadata.get(THINKING_KEY) or ""
        total = _length(thinking)
        if not total:
            return Score(value=NOANSWER, explanation="The model showed no thinking.")
        shown = remove_a2ui_thinking(thinking)
        return Score(
            value=1 - _length(shown) / total,
            answer=thinking,
            explanation=(
                f"The thinking an app shows after `remove_a2ui_thinking`:\n\n{shown}"
            ),
            metadata={"characters": total, "shown_characters": _length(shown)},
        )

    return score
