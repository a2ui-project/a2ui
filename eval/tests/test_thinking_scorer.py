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

"""Unit tests for the scorer that measures A2UI talk in the model's thinking."""

from inspect_ai.model import ChatMessageAssistant, ContentReasoning, ContentText
from inspect_ai.model import ModelName
from inspect_ai.scorer import NOANSWER, SampleScore, Score, Target
from inspect_ai.solver import TaskState
import pytest

from a2ui_eval.shared.utils import THINKING_KEY, visible_thinking
from a2ui_eval.thinking_scorer import (
    a2ui_share,
    free_of_a2ui,
    thinking_scorer,
)


def _state(thinking: str | None) -> TaskState:
    metadata = {} if thinking is None else {THINKING_KEY: thinking}
    return TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        metadata=metadata,
    )


@pytest.mark.asyncio
async def test_thinking_scorer_scores_the_share_the_sdk_would_hide() -> None:
    score = await thinking_scorer()(
        _state("The user cooks daily. I'll add a createSurface."),
        Target(""),
    )
    assert score.value == pytest.approx(22 / 40)
    assert score.metadata == {"characters": 40, "shown_characters": 18}
    assert score.explanation.endswith("\n\nThe user cooks daily.")


@pytest.mark.asyncio
async def test_thinking_scorer_scores_zero_for_thinking_about_the_request() -> None:
    score = await thinking_scorer()(
        _state("The countertop surface is narrow. A quiet pump matters."),
        Target(""),
    )
    assert score.value == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("thinking", [None, "", "  \n"])
async def test_thinking_scorer_has_no_answer_without_thinking(
    thinking: str | None,
) -> None:
    score = await thinking_scorer()(_state(thinking), Target(""))
    assert score.value == NOANSWER


def test_metrics_leave_out_samples_without_thinking() -> None:
    scores = [
        SampleScore(score=Score(value=0.0), sample_id=1),
        SampleScore(score=Score(value=0.5), sample_id=2),
        SampleScore(score=Score(value=NOANSWER), sample_id=3),
    ]
    assert a2ui_share()(scores) == 0.25
    assert free_of_a2ui()(scores) == 0.5
    assert a2ui_share()([]) == 0.0


def test_visible_thinking_reads_reasoning_and_redacted_summaries() -> None:
    message = ChatMessageAssistant(
        content=[
            ContentReasoning(reasoning="First thought."),
            ContentReasoning(
                reasoning="c2lnbmF0dXJl", summary="Second.", redacted=True
            ),
            ContentReasoning(reasoning="c2lnbmF0dXJl", redacted=True),
            ContentText(text="The answer."),
        ]
    )
    assert visible_thinking(message) == "First thought.\n\nSecond."
    assert visible_thinking(ChatMessageAssistant(content="No thinking.")) == ""
