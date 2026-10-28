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

"""Shared payload fixtures and scripted answers for layout tests.

The four payloads are the worked examples from the layout design (a resort
overview, host health, a transfer confirmation, and podcast settings).
`ScriptedAnswers` turns a mapping of question ids to answers into a scorer for
`DeterministicMockBackend`, so planner and end-to-end tests share one way of
scripting a batch.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
import math
from typing import Any

from a2ui.inference_formats.decision import (
    DecisionDistribution,
    DecisionQuery,
    DeterministicMockBackend,
)


@dataclass(frozen=True)
class LayoutFixture:
    """One worked-example surface: intent, payload, and mutable paths."""

    name: str
    intent: str
    payload: Mapping[str, Any]
    mutable_paths: tuple[str, ...] = ()


RESORT = LayoutFixture(
    name="resort",
    intent="Show the resort overview",
    payload={
        "name": "Casa Verde",
        "logoUrl": "https://example.com/casa-verde/logo.png",
        "rating": 4.6,
        "priceFrom": 240,
        "about": (
            "A quiet hillside resort twenty minutes from the old town, with a"
            " spring-fed pool, garden suites, and a breakfast terrace that looks"
            " over the valley. Families and walkers come back year after year."
        ),
        "photos": [
            {"url": "https://example.com/casa-verde/1.jpg", "caption": "Pool at dusk"},
            {"url": "https://example.com/casa-verde/2.jpg", "caption": "Garden suite"},
            {
                "url": "https://example.com/casa-verde/3.jpg",
                "caption": "Breakfast terrace",
            },
        ],
    },
)

HOST = LayoutFixture(
    name="host",
    intent="Show CPU utilization for prod-1",
    payload={
        "host": "prod-1",
        "cpu": 0.78,
        "cpuDelta": 0.12,
        "status": "degraded",
        "uptimeHours": 412,
    },
)

TRANSFER = LayoutFixture(
    name="transfer",
    intent="Confirm sending $50 to Alex before it goes through",
    payload={
        "amount": 50,
        "currency": "USD",
        "recipient": "Alex Chen",
        "fee": 0.5,
        "arrives": "2026-10-24",
        "actions": ["Send", "Cancel"],
    },
    mutable_paths=("/actions",),
)

SETTINGS = LayoutFixture(
    name="settings",
    intent="Playback and notification settings",
    payload={
        "playback": {"skipForward": "30 seconds", "autoDownload": True, "speed": 1.25},
        "notifications": {"newEpisodes": True, "digest": False},
        "account": {"signOut": "Sign out"},
    },
    mutable_paths=("/playback", "/notifications", "/account"),
)

FIXTURES: dict[str, LayoutFixture] = {
    f.name: f for f in (RESORT, HOST, TRANSFER, SETTINGS)
}

ScriptedValue = float | str | tuple[str, float] | Mapping[str, float]
"""How one answer may be scripted.

A float is the yes probability of a boolean question or the expected level of
a score question; a str is the chosen option of a choice question (with
probability 0.9); a ``(option, probability)`` pair sets that probability; a
mapping is the full distribution.
"""


def _choice_distribution(
    chosen: str, probability: float, candidates: tuple[str, ...]
) -> dict[str, float]:
    """Gives `chosen` `probability` and shares the rest among the others."""
    others = [c for c in candidates if c != chosen]
    if chosen not in candidates:
        raise ValueError(f"Scripted option {chosen!r} is not among {candidates}.")
    rest = (1.0 - probability) / len(others) if others else 0.0
    return {c: probability if c == chosen else rest for c in candidates}


def _score_distribution(expected: float, levels: tuple[str, ...]) -> dict[str, float]:
    """Splits mass between the two levels around `expected` so the mean matches."""
    top = len(levels) - 1
    value = min(max(expected, 0.0), float(top))
    low = min(int(math.floor(value)), top)
    high = min(low + 1, top)
    weight_high = value - low
    probs = {level: 0.0 for level in levels}
    probs[levels[low]] += 1.0 - weight_high
    probs[levels[high]] += weight_high
    return probs


def _boolean_distribution(yes: float) -> dict[str, float]:
    return {"yes": yes, "no": 1.0 - yes}


@dataclass
class ScriptedAnswers:
    """Question id to scripted answer, as a scorer for `DeterministicMockBackend`.

    Unscripted questions get a uniform distribution. Every question id scored
    is appended to `asked`, in call order, for assertions.
    """

    answers: Mapping[str, ScriptedValue] = field(default_factory=dict)
    asked: list[str] = field(default_factory=list)

    def scorer(self, query: DecisionQuery) -> DecisionDistribution:
        """Scores a query built by `_AnswerViaPredict` from a `DecisionQuestion`."""
        question_id = str(query.context.get("question_id", ""))
        kind = str(query.context.get("question_kind", "choice"))
        self.asked.append(question_id)
        probs = self._probabilities(
            self.answers.get(question_id), kind, query.candidates
        )
        return DecisionDistribution(
            probabilities=probs, calibrated=True, top_logit_margin=2.5
        )

    def backend(self) -> DeterministicMockBackend:
        """A mock backend that answers through `scorer`."""
        return DeterministicMockBackend(scorer=self.scorer)

    @staticmethod
    def _probabilities(
        scripted: ScriptedValue | None, kind: str, candidates: tuple[str, ...]
    ) -> dict[str, float]:
        if scripted is None:
            return {c: 1.0 / len(candidates) for c in candidates} if candidates else {}
        if isinstance(scripted, Mapping):
            return dict(scripted)
        if isinstance(scripted, tuple):
            return _choice_distribution(scripted[0], scripted[1], candidates)
        if isinstance(scripted, str):
            return _choice_distribution(scripted, 0.9, candidates)
        if kind == "boolean":
            return _boolean_distribution(float(scripted))
        if kind == "score":
            return _score_distribution(float(scripted), candidates)
        raise ValueError(f"A choice question cannot be scripted with {scripted!r}.")
