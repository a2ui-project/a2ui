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
way. The user asked about their own problem, so thinking about JSON, schemas
or surface IDs is noise to them (issue #3576). `thinking_scorer` reads the
thinking a format strategy recorded for the model's first answer and scores
the share of its sentences that talk about the protocol. It does not affect
whether a sample passes.
"""

from __future__ import annotations

import re

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
    "a2ui_sentences",
    "a2ui_share",
    "free_of_a2ui",
    "thinking_scorer",
]

# Words that only come up when the model thinks about the protocol rather than
# the user's request. A bare "surface" or "component" is left out, since the
# request may well be about a kitchen surface or a dishwasher component.
_A2UI_TERMS = re.compile(
    r"a2ui|json|schema|catalog|surface ?ids?\b|createsurface|deletesurface"
    r"|updatecomponents|updatedatamodel|data ?model|data ?bindings?"
    r"|component ?ids?\b|root component",
    re.IGNORECASE,
)

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+|\n+")


def a2ui_sentences(thinking: str) -> tuple[list[str], list[str]]:
    """Splits `thinking` into sentences and picks those about A2UI.

    A heading line, such as Gemini's bold summary titles, counts as a
    sentence.

    Returns:
        Every non-empty sentence, and the ones that mention an A2UI term.
    """
    sentences = [s.strip() for s in _SENTENCE_END.split(thinking) if s.strip()]
    return sentences, [s for s in sentences if _A2UI_TERMS.search(s)]


def _scored(scores: list[SampleScore]) -> list[float]:
    """The values of the samples whose model showed thinking."""
    return [s.score.as_float() for s in scores if s.score.value != NOANSWER]


@metric
def a2ui_share() -> Metric:
    """Mean share of thinking sentences about A2UI. Lower is better."""

    def compute(scores: list[SampleScore]) -> float:
        values = _scored(scores)
        return sum(values) / len(values) if values else 0.0

    return compute


@metric
def free_of_a2ui() -> Metric:
    """Share of samples whose thinking never mentions A2UI. Higher is better."""

    def compute(scores: list[SampleScore]) -> float:
        values = _scored(scores)
        return sum(1 for v in values if v == 0) / len(values) if values else 0.0

    return compute


@scorer(metrics=[a2ui_share(), free_of_a2ui()])
def thinking_scorer() -> Scorer:
    """Scores the share of the model's thinking sentences that are about A2UI.

    The value is between 0 (the thinking is all about the user's request) and
    1 (every sentence is about the protocol). A sample whose model showed no
    thinking, or whose strategy records none, is scored `NOANSWER` and left
    out of both metrics.
    """

    async def score(state: TaskState, target: Target) -> Score:  # pylint: disable=unused-argument
        thinking = state.metadata.get(THINKING_KEY) or ""
        sentences, about_a2ui = a2ui_sentences(thinking)
        if not sentences:
            return Score(value=NOANSWER, explanation="The model showed no thinking.")
        explanation = (
            "\n".join(f"- {s}" for s in about_a2ui)
            if about_a2ui
            else "No sentence is about A2UI."
        )
        return Score(
            value=len(about_a2ui) / len(sentences),
            answer=thinking,
            explanation=explanation,
            metadata={
                "sentences": len(sentences),
                "a2ui_sentences": len(about_a2ui),
            },
        )

    return score
