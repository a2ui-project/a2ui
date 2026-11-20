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

"""Checks that each sample agent starts and turns a model response into parts.

The model is replaced by a canned response, so no API key is needed. This
catches a sample that no longer works with the SDK before the nightly e2e
tests do.
"""

import json
from pathlib import Path
import subprocess
import sys

import pytest

SAMPLES_DIR = Path(__file__).parent.parent

# Runs outside the sample's directory so relative paths in `agent.py` cannot
# silently rely on `os.getcwd()`. Every sample has its own `agent` module, and
# the workspace venv has all samples on its path, so each runs in a process of
# its own, with its directory inserted first on `sys.path`.
_DRIVER = """
import asyncio
import importlib
import json
from pathlib import Path
import sys
from unittest.mock import MagicMock

from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.events import Event
from google.genai import types

from a2ui.core.schema import ProtocolVersion

sample_dir, agent_class, example = sys.argv[1:]
sys.path.insert(0, sample_dir)
agent = getattr(importlib.import_module("agent"), agent_class)(
    base_url="http://localhost"
)
response = (
    f"Here it is.\\n<a2ui-json>\\n{(Path(sample_dir) / example).read_text()}\\n</a2ui-json>"
)


async def run_async(**kwargs):
    # Streams the response in chunks, as the model would.
    for start in range(0, len(response), 64):
        chunk = response[start : start + 64]
        yield Event(
            author="model",
            content=types.Content(role="model", parts=[types.Part.from_text(text=chunk)]),
        )


for runner in agent._ui_runners.values():
    runner.run_async = run_async


async def main():
    ctx = MagicMock(spec=ReadonlyContext)
    ctx._invocation_context = MagicMock()
    ctx._invocation_context.session.state = {"base_url": "http://localhost"}
    instruction, bypass = await agent._ui_runners[
        ProtocolVersion.V0_9
    ].agent.canonical_instruction(ctx)
    assert bypass is True
    assert "---BEGIN " in instruction
    assert "${expression}" in instruction
    assert instruction.index("---BEGIN ") < instruction.index(
        "---BEGIN A2UI JSON SCHEMA---"
    )

    kinds = []
    async for event in agent.stream(
        "query", "session", ui_version=ProtocolVersion.V0_9
    ):
        kinds.extend(part.root.kind for part in event.get("parts", []))
    print(json.dumps(kinds))


asyncio.run(main())
"""


@pytest.mark.parametrize(
    "sample, agent_class, example",
    [
        ("restaurant_finder", "RestaurantAgent", "examples/0.9/booking_form.json"),
        ("custom-components-example", "ContactAgent", "examples/0.9/contact_card.json"),
    ],
)
def test_sample_agent_streams_response(sample, agent_class, example):
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            _DRIVER,
            str(SAMPLES_DIR / sample),
            agent_class,
            example,
        ],
        cwd=SAMPLES_DIR,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    kinds = json.loads(result.stdout.splitlines()[-1])
    assert "text" in kinds
    assert "data" in kinds
