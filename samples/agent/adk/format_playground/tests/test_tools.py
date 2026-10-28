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

"""Tests for format playground ADK tools and their decision synthesis."""

from __future__ import annotations

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.processor import CatalogConfig
from a2ui.inference_formats.decision import (
    ArchetypeGrammar,
    CatalogDecisionGraph,
    DecisionSynthesizer,
    SynthesisStage,
)
from tools import (
    TOOL_INTENTS,
    TOOL_MUTABLE_PATHS,
    TOOLS,
    get_host_health,
    get_playback_settings,
    get_resort,
    get_transfer_quote,
)
from .fakes import (
    HOST_ANSWERS,
    RESORT_ANSWERS,
    SETTINGS_ANSWERS,
    TRANSFER_ANSWERS,
    scripted_backend,
)


def test_all_tools_have_intents_and_mutable_paths() -> None:
    assert len(TOOLS) == 4
    for tool in TOOLS:
        name = getattr(tool, "__name__", "")
        assert name in TOOL_INTENTS
        assert name in TOOL_MUTABLE_PATHS
        assert TOOL_INTENTS[name]


def test_tool_direct_calls() -> None:
    assert "cpu" in get_host_health("host-01")
    assert "resorts" in get_resort("vail")
    assert "fee" in get_transfer_quote(100.0, "hotel")
    assert "volume" in get_playback_settings()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_fn", "kwargs", "answers"),
    [
        (get_host_health, {"host": "prod-db-01"}, HOST_ANSWERS),
        (get_resort, {"name": "whistler"}, RESORT_ANSWERS),
        (
            get_transfer_quote,
            {"amount": 1000.0, "recipient": "Manhattan"},
            TRANSFER_ANSWERS,
        ),
        (get_playback_settings, {}, SETTINGS_ANSWERS),
    ],
)
async def test_tool_result_synthesizes_to_archetype(tool_fn, kwargs, answers) -> None:
    catalog = BasicCatalog("1.0")
    graph = CatalogDecisionGraph([catalog])
    synthesizer = DecisionSynthesizer(
        graph,
        backend=scripted_backend(answers),
        archetypes=ArchetypeGrammar.default(),
    )
    result = tool_fn(**kwargs)
    name = tool_fn.__name__
    intent = TOOL_INTENTS[name]
    mutable_paths = TOOL_MUTABLE_PATHS[name]

    output = await synthesizer.synthesize(
        intent, result, surface_id="test", mutable_paths=mutable_paths
    )
    assert output.stage is SynthesisStage.ARCHETYPE
    assert output.messages
