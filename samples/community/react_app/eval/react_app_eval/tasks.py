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

"""Inspect tasks of the ReactApp and Express multi-line suites.

Both reuse the eval runner's Express solver chain and scorers, add the ReactApp
prompt fragment where the sample's catalogs include the ReactApp catalog, and
add their own scorer before the LLM judge.
"""

from __future__ import annotations

from collections.abc import Sequence

from a2ui_eval.scorers import a2ui_scorer, measured_model_graded_qa
from a2ui_eval.shared.utils import measured_generate
from a2ui_eval.strategies.format import compile_format_payload, format_system_prompt
from inspect_ai import Task, task
from inspect_ai.scorer import Scorer

from .dataset import load_dataset
from .scorers import express_multiline_scorer, react_app_scorer
from .solvers import react_app_server_compile, react_app_system_prompt

__all__ = [
    "DEFAULT_MODEL",
    "GRADER_INSTRUCTIONS",
    "express_multiline_v1_0",
    "react_app_v1_0",
]

DEFAULT_MODEL = "google/gemini-3.5-flash"
"""The application model of the prototype, used to generate and to judge."""

GRADER_INSTRUCTIONS = """
After assessing the submitted answer, reply with 'GRADE: $LETTER' (without quotes) where LETTER is one of C, P or I: "C" for correct, "P" for partial credit, "I" for incorrect.

First, reason step by step about each criterion of the rubric. Then end with 'GRADE: $LETTER'.

Notes for grading:
1. The answer is the compiled A2UI JSON. Component IDs, ordering inside containers, label wording and optional properties may vary as long as the rubric's intent holds.
2. A `ReactApp` component holds a React app as TSX in `source`. Judge whether the app does what the rubric asks: read the code. It talks to the page only through the `a2ui` module (`useData`, `setData`, `callFunction`, `useFunction`, `dispatchAction`, `VegaChart`, and the primitives `Card`, `Button`, `Text`, `Slider`, `Stack`).
3. Native components and the app share state through data model paths: a native component bound to `/x` and an app calling `useData("/x", ...)` are connected. Check that the paths line up when the rubric asks for a connection.
4. Penalize a `ReactApp` used for something native components already do well (a static label, a plain form) only when the rubric says so.
5. Headings may be written as Markdown in a `Text` (for example `## Title`).
6. Give "P" when the answer works but misses a minor part of the rubric, and "I" when a required part is missing or broken.
"""


def _judge(grading_model: str, no_judge: bool) -> Scorer:
    return measured_model_graded_qa(
        model=grading_model, instructions=GRADER_INSTRUCTIONS, no_judge=no_judge
    )


def _express_task(
    dataset_name: str,
    suite_scorer: Scorer,
    *,
    grading_model: str,
    no_judge: bool,
    tags: str | Sequence[str] | None,
    max_validation_retries: int,
    bindings: bool = False,
    repair: bool = False,
) -> Task:
    version = "1.0"
    return Task(
        dataset=load_dataset(
            dataset_name, version=version, format_name="express", tags=tags
        ),
        solver=[
            format_system_prompt("express", version),
            react_app_system_prompt(version, bindings=bindings),
            measured_generate(),
            compile_format_payload(
                "express", version, max_validation_retries=max_validation_retries
            ),
            react_app_server_compile(repair=repair),
        ],
        scorer=[
            a2ui_scorer(version=version),
            suite_scorer,
            _judge(grading_model, no_judge),
        ],
        metadata={
            "suite": dataset_name,
            "strategy": "express",
            "version": version,
            "bindings": bindings,
            "repair": repair,
        },
    )


@task
def react_app_v1_0(
    grading_model: str = DEFAULT_MODEL,
    no_judge: bool = False,
    tags: str | Sequence[str] | None = None,
    max_validation_retries: int = 0,
    bindings: bool = False,
    repair: bool = False,
) -> Task:
    """ReactApp suite: the three use cases and three extra apps.

    With `bindings`, the prompt includes the `a2ui:bindings` declarations; with
    `repair`, apps that fail the server compile go back to the model (at most
    two rounds) before scoring.
    """
    return _express_task(
        "react_app_v1_0",
        react_app_scorer(),
        grading_model=grading_model,
        no_judge=no_judge,
        tags=tags,
        max_validation_retries=max_validation_retries,
        bindings=bindings,
        repair=repair,
    )


@task
def express_multiline_v1_0(
    grading_model: str = DEFAULT_MODEL,
    no_judge: bool = False,
    tags: str | Sequence[str] | None = None,
    max_validation_retries: int = 0,
) -> Task:
    """Express multi-line suite: code, Markdown, regexes and quotes in string values."""
    return _express_task(
        "express_multiline_v1_0",
        express_multiline_scorer(),
        grading_model=grading_model,
        no_judge=no_judge,
        tags=tags,
        max_validation_retries=max_validation_retries,
    )
