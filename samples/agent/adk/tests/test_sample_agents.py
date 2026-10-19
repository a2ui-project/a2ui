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

"""Runs the sample agents' turns against a fake model and a mirrored client.

A fake runner replays the samples' example responses in place of the model,
and `_Client` mirrors the surfaces a v0.9 or v1.0 renderer holds, so a test
can tell whether a turn sends a `createSurface` for a surface the client
already holds, which the protocol defines as an error.
"""

import asyncio
from collections.abc import Callable, Iterator
import contextlib
import importlib
import json
import os
from pathlib import Path
import re
import sys
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.utils import to_version_number

SAMPLES_DIR = Path(__file__).parent.parent
# The modules of the samples, which share these names.
_SAMPLE_MODULES = (
    "a2ui_examples",
    "agent",
    "agent_executor",
    "prompt_builder",
    "tools",
)
_VERSIONS = [ProtocolVersion.V0_9, ProtocolVersion.V1_0]
# The sentence of the custom-components prompt that lists the surfaces the
# client shows.
_SURFACES_RULE = re.compile(r"already shows these surfaces: ([^\n]*)")

Response = str | Callable[[str, str], str]


@contextlib.contextmanager
def _sample(name: str) -> Iterator[tuple[ModuleType, ModuleType]]:
    """Imports a sample's agent and executor modules from its directory."""
    path = SAMPLES_DIR / name
    saved_modules = {m: sys.modules.pop(m) for m in _SAMPLE_MODULES if m in sys.modules}
    saved_path = list(sys.path)
    saved_cwd = os.getcwd()
    sys.path.insert(0, str(path))
    os.chdir(path)
    try:
        yield importlib.import_module("agent"), importlib.import_module(
            "agent_executor"
        )
    finally:
        for module in _SAMPLE_MODULES:
            sys.modules.pop(module, None)
        sys.modules.update(saved_modules)
        sys.path[:] = saved_path
        os.chdir(saved_cwd)


def _event(text: str, partial: bool) -> SimpleNamespace:
    return SimpleNamespace(
        partial=partial,
        content=SimpleNamespace(parts=[SimpleNamespace(text=text)]),
    )


class _FakeRunner:
    """Replays responses in place of an ADK runner, in chunks when streaming.

    A response may be a function of the system instruction and the user
    message, which stands in for a model that follows them.
    """

    def __init__(self, instruction: str, responses: list[Response]):
        self.instruction = instruction
        self.responses = responses
        self.messages: list[str] = []

    async def run_async(self, **kwargs: Any):
        message = kwargs["new_message"].parts[0].text
        self.messages.append(message)
        response = self.responses.pop(0)
        if callable(response):
            response = response(self.instruction, message)
        if kwargs["run_config"].streaming_mode.name == "SSE":
            for i in range(0, len(response), 40):
                yield _event(response[i : i + 40], True)
        yield _event(response, False)


class _Client:
    """Mirrors the surfaces of a v0.9 or v1.0 renderer, and records errors."""

    def __init__(self) -> None:
        self.surfaces: set[str] = set()
        self.errors: list[str] = []

    def receive(self, parts: list[Any]) -> list[str]:
        """Applies the parts, and returns a summary of each."""
        summary = []
        for part in parts:
            root = part.root
            if hasattr(root, "text"):
                summary.append(f"text:{root.text}")
                continue
            kind = next(k for k in root.data if k != "version")
            surface_id = root.data[kind].get("surfaceId")
            summary.append(f"{kind}:{surface_id}")
            if kind == "createSurface":
                if surface_id in self.surfaces:
                    self.errors.append(f"createSurface for existing {surface_id}")
                self.surfaces.add(surface_id)
            elif kind == "deleteSurface":
                if surface_id not in self.surfaces:
                    self.errors.append(f"deleteSurface for unknown {surface_id}")
                self.surfaces.discard(surface_id)
            elif surface_id not in self.surfaces:
                self.errors.append(f"{kind} for unknown {surface_id}")
        return summary


def _wrap(messages: list[dict[str, Any]], text: str = "Here you go.") -> str:
    return f"{text}\n<a2ui-json>{json.dumps(messages)}</a2ui-json>"


def _load(path: str) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


async def _turn(
    agent: Any,
    client: _Client,
    version: ProtocolVersion,
    capabilities: dict[str, Any],
    query: str,
    responses: list[Response],
    *,
    use_streaming: bool,
    session_id: str = "session",
) -> tuple[list[str], list[_FakeRunner]]:
    """Runs one request through the agent, and sends its parts to the client."""
    runners: list[_FakeRunner] = []

    def build_runner(instruction: str) -> _FakeRunner:
        runners.append(_FakeRunner(instruction, responses))
        return runners[-1]

    agent._build_runner = build_runner
    summary: list[str] = []
    async for item in agent.stream(
        query, session_id, version, capabilities, use_streaming=use_streaming
    ):
        summary += client.receive(item.get("parts", []))
    return summary, runners


def _following_surfaces_rule(
    messages: list[dict[str, Any]], version: ProtocolVersion
) -> Response:
    """A model that deletes each listed surface before it creates it again."""

    def respond(instruction: str, message: str) -> str:
        listed: set[str] = set()
        for text in (instruction, message):
            for match in _SURFACES_RULE.finditer(text):
                listed.update(re.findall(r"`([^`]+)`", match.group(1)))
        created = [
            m["createSurface"]["surfaceId"]
            for m in messages
            if "createSurface" in m and m["createSurface"]["surfaceId"] in listed
        ]
        deletions = [
            {"version": version.value, "deleteSurface": {"surfaceId": surface_id}}
            for surface_id in created
        ]
        return _wrap(deletions + messages)

    return respond


def _custom_capabilities(version: ProtocolVersion) -> dict[str, Any]:
    inline_catalog = _load(f"inline_catalog_{to_version_number(version)}.json")
    # The v0.9 capabilities model takes `functions` as a list, and this
    # catalog writes them as an object.
    inline_catalog.pop("functions", None)
    return {
        version.value: {
            "supportedCatalogIds": [BasicCatalog(version).catalog_id],
            "inlineCatalogs": [inline_catalog],
        }
    }


@pytest.mark.parametrize("use_streaming", [True, False])
@pytest.mark.parametrize("version", _VERSIONS, ids=lambda v: v.value)
def test_custom_components_repeats_lookups_and_actions(version, use_streaming):
    """Later turns of a conversation update or replace its surfaces."""
    with _sample("custom-components-example") as (agent_module, _):
        agent = agent_module.ContactAgent("http://localhost:10004")
        client = _Client()
        caps = _custom_capabilities(version)
        multi_surface = _load(
            f"examples/{to_version_number(version)}/multi_surface.json"
        )

        async def run() -> None:
            first, _ = await _turn(
                agent,
                client,
                version,
                caps,
                "Who is Casey Smith?",
                [_following_surfaces_rule(multi_surface, version)],
                use_streaming=use_streaming,
            )
            assert "createSurface:contact-card" in first

            second, runners = await _turn(
                agent,
                client,
                version,
                caps,
                "Who is Alex Jordan?",
                [_following_surfaces_rule(multi_surface, version)] * 2,
                use_streaming=use_streaming,
            )
            assert _SURFACES_RULE.search(runners[0].instruction)
            assert len(runners[0].messages) == 1, "the second lookup was retried"
            assert second.index("deleteSurface:contact-card") < second.index(
                "createSurface:contact-card"
            )

            for _ in range(2):
                sent, _ = await _turn(
                    agent,
                    client,
                    version,
                    caps,
                    "ACTION: send_message (contact: Casey Smith)",
                    [],
                    use_streaming=use_streaming,
                )
                assert "createSurface:action-modal" in sent
                assert not any("can't be shown" in s for s in sent)

            closed, _ = await _turn(
                agent,
                client,
                version,
                caps,
                "ACTION: close_modal",
                [],
                use_streaming=use_streaming,
            )
            assert closed == ["text:Modal closed."]

        asyncio.run(run())
        assert client.errors == []


@pytest.mark.parametrize("version", _VERSIONS, ids=lambda v: v.value)
def test_custom_components_retry_lists_the_surfaces_a_failed_stream_left(version):
    """The retry message lists the surfaces the failed attempt sent."""
    with _sample("custom-components-example") as (agent_module, _):
        agent = agent_module.ContactAgent("http://localhost:10004")
        client = _Client()
        multi_surface = _load(
            f"examples/{to_version_number(version)}/multi_surface.json"
        )
        broken = multi_surface[:-1] + [{
            "version": version.value,
            "updateDataModel": {"surfaceId": "unknown", "value": {}},
        }]

        sent, runners = asyncio.run(
            _turn(
                agent,
                client,
                version,
                _custom_capabilities(version),
                "Who is Casey Smith?",
                [_wrap(broken), _following_surfaces_rule(multi_surface, version)],
                use_streaming=True,
            )
        )
        assert _SURFACES_RULE.search(runners[0].messages[1])
        assert not any("having trouble" in s for s in sent)
        assert client.errors == []


@pytest.mark.parametrize("version", _VERSIONS, ids=lambda v: v.value)
def test_restaurant_finder_streaming_retry_and_repeat_search(version):
    """A retry and a second search don't create a surface the client holds."""
    with _sample("restaurant_finder") as (agent_module, _):
        agent = agent_module.RestaurantAgent("http://localhost:10002")
        client = _Client()
        caps = {
            version.value: {"supportedCatalogIds": [BasicCatalog(version).catalog_id]}
        }
        number = to_version_number(version)
        single_column = _load(f"examples/{number}/single_column_list.json")
        # The last message fails after the earlier ones were streamed.
        broken = single_column[:-1] + [{
            "version": version.value,
            "updateDataModel": {"surfaceId": "unknown", "value": {}},
        }]

        async def run() -> None:
            sent, runners = await _turn(
                agent,
                client,
                version,
                caps,
                "Find 3 Italian restaurants in New York",
                [_wrap(broken, "Results:"), _wrap(single_column, "Results:")],
                use_streaming=True,
            )
            assert len(runners[0].messages) == 2
            assert sent.count("createSurface:default") == 2
            assert sent.index("deleteSurface:default") > sent.index(
                "createSurface:default"
            )
            assert not any("having trouble" in s for s in sent)

            for use_streaming in (True, False):
                sent, _ = await _turn(
                    agent,
                    client,
                    version,
                    caps,
                    "Find 8 Chinese restaurants in New York",
                    [_wrap(_load(f"examples/{number}/two_column_list.json"))],
                    use_streaming=use_streaming,
                )
                assert sent.index("deleteSurface:default") < sent.index(
                    "createSurface:default"
                )

        asyncio.run(run())
        assert client.errors == []


@pytest.mark.parametrize("sample", ["custom-components-example", "restaurant_finder"])
@pytest.mark.parametrize(
    "data",
    [
        {"version": "v1.0", "action": {"name": "go"}},
        {"messages": [{"version": "v1.0", "action": {"name": "go"}}]},
        [{"version": "v1.0", "action": {"name": "go"}}],
        {"version": "v0.9", "action": {"name": "go"}},
        {"userAction": {"name": "go"}},
    ],
    ids=["v1.0", "v1.0-wrapped", "v1.0-list", "v0.9", "v0.8"],
)
def test_executors_find_the_action_in_each_shape(sample, data):
    with _sample(sample) as (_, executor_module):
        assert executor_module._find_ui_event(data) == {"name": "go"}
