# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Tasks for A2UI evaluation."""
# pylint: disable=duplicate-code

import os
import sys
from google import genai
from google.genai import errors
from inspect_ai import task, Task
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.scorer import scorer, Score
from a2ui_eval.dataset import load_a2ui_dataset
from a2ui_eval.strategies import get_solver
from a2ui_eval.scorers import a2ui_scorer, measured_model_graded_qa

# Paths relative to the eval directory where we run inspect
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.abspath(os.path.join(CURRENT_DIR, "datasets/v0_9_prompts.yaml"))
SCHEMA_PATH = os.path.abspath(os.path.join(CURRENT_DIR, "../specification/v0_9/json/server_to_client.json"))
CATALOG_PATH = os.path.abspath(os.path.join(CURRENT_DIR, "../specification/v0_9/catalogs/basic/catalog.json"))

GRADER_INSTRUCTIONS = """
After assessing the submitted answer, reply with 'GRADE: $LETTER' (without quotes) where LETTER is one of C, P or I.  Please choose ONE option for the grade: either "C" for correct answers, "P" for partial credit, or "I" for incorrect answers.

For example, after reviewing a correct answer you might write 'GRADE: C' or after reviewing an incorrect answer you might write 'GRADE: I'.

First, write out in a step by step manner your reasoning about the criterion to be sure that your conclusion is correct. Avoid simply stating the correct answers at the outset. Then, end with your answer formatted as 'GRADE: $LETTER' (without quotes) where LETTER is one of C, P or I.

Notes for grading:
1. Variations in capitalization, punctuation, and minor spacing differences should be considered acceptable as long as the semantic intent and required components are present.
2. Unless a specific vertical or horizontal order is explicitly requested in the task, variations in the order of components within a container should be considered acceptable.
3. Generated component IDs do not need to match any specific pattern or example in the target, as long as they are unique and correctly establish the requested parent-child relationships.
4. Minor variations in label text that preserve the core semantic meaning (e.g., 'Submit' vs 'Send', or 'First Name' vs 'Given Name') are acceptable unless exact literal text was requested.
5. The inclusion of valid optional properties defined in the schema (such as accessibility hints or default values) that were not explicitly requested should not be penalized as long as they make sense in context.
6. If data binding paths are not explicitly specified in the prompt, accept any logically sound path structure (e.g., accepting `/user/email` or simply `/email` when the prompt asks to "bind to the user's email" without specifying a full path).
7. Partial credit "P" can be awarded when the submitted answer is a correct answer with only minor cosmetic variations or additional valid optional properties that do not substantially change the meaning of the component.  When an answer is missing components or contains substantive errors, it should be considered incorrect and awarded an "I" grade.
"""

@task
def a2ui_v0_9_eval(
    list_models: bool = False, 
    grading_model: str = "google/gemini-3-flash-preview",
    strategy: str = "direct"
) -> Task:
    """Evaluation task for A2UI v0.9 protocol generation.

    Args:
        list_models: Whether to list available Gemini models and exit.
        grading_model: The model to use for LLM-as-a-judge grading.
        strategy: The evaluation strategy to use (e.g., 'direct').

    Returns:
        An Inspect Task object configured for A2UI v0.9 evaluation.
    """

    if list_models:
        client = genai.Client()
        print("\nAvailable Gemini Models:")
        try:
            for m in client.models.list():
                print(f"- {m.name}")
        except errors.APIError as e:
            print(f"Error listing models: {e}")

        @scorer(metrics=[])
        def dummy_scorer():
            async def score(state, target):  # pylint: disable=unused-argument
                return Score(value=1.0, explanation="Dummy pass")
            return score

        return Task(
            dataset=MemoryDataset(samples=[Sample(input="dummy", target="dummy")]),
            solver=[],
            scorer=[dummy_scorer()]
        )

    dataset = load_a2ui_dataset(DATASET_PATH)

    return Task(
        dataset=dataset,
        solver=get_solver(strategy, SCHEMA_PATH, CATALOG_PATH),
        scorer=[
            a2ui_scorer(CATALOG_PATH),
            measured_model_graded_qa(
                model=grading_model,
                instructions=GRADER_INSTRUCTIONS
            )
        ]
    )
