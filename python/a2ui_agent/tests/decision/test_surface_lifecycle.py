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

"""Surface lifecycle across turns: create, update in place, and replace."""

from __future__ import annotations

from collections.abc import Callable, Iterator
import json
from typing import Any

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import DecisionFormat, DecisionFormatFactory
from a2ui.parser import A2uiCompilationValidationError, A2uiPart
from a2ui.parser.messages import to_message_dicts
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState

from .layout_fixtures import HOST, SETTINGS, ScriptedValue, mock_backend

CATALOG = BasicCatalog("v1.0")

HOST_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("monitor", 0.90),
    "stakes": 1.0,
    "urgency": 1.4,
    "archetype:monitor": ("dashboard", 0.85),
    "gate:banner": 0.80,
    "gate:headline": 0.90,
    "gate:facts": 0.80,
    "archetype:inspect": ("detail", 0.85),
}

SETTINGS_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("input", 0.80),
    "stakes": 1.2,
    "urgency": 0.2,
    "archetype:input": ("settings", 0.90),
    "gate:groups": 0.90,
    "gate:actions": 0.90,
}

Turn = Callable[[dict[str, Any]], list[dict[str, Any]]]


def _response(block: dict[str, Any]) -> str:
    return f"Here it is.\n<a2ui>{json.dumps(block)}</a2ui>"


def _messages(parts: list[Any]) -> list[dict[str, Any]]:
    return [
        d for p in parts if isinstance(p, A2uiPart) for d in to_message_dicts(p.a2ui)
    ]


def _kinds(dicts: list[dict[str, Any]]) -> list[str]:
    return [next(k for k in d if k != "version") for d in dicts]


def _bound_state_turns(scripted: dict[str, ScriptedValue]) -> Turn:
    """Turns through `A2uiRequestProcessor` bound to one `RendererState`."""
    processor = A2uiRequestProcessor(
        catalogs=[CATALOG],
        format_factory=DecisionFormatFactory(backend=mock_backend(**scripted)),
        state=RendererState([CATALOG]),
    )
    return lambda block: _messages(processor.parse_response(_response(block)))


def _conversation_turns(scripted: dict[str, ScriptedValue]) -> Turn:
    """Turns with no bound state: the format keeps one per conversation id."""
    fmt = DecisionFormat([CATALOG], backend=mock_backend(**scripted))
    return lambda block: _messages(
        fmt.create_parser(conversation_id="c1").parse_response(_response(block))
    )


TURN_FACTORIES = pytest.mark.parametrize(
    "make_turns",
    [_bound_state_turns, _conversation_turns],
    ids=["bound_state", "state_none_per_conversation"],
)


class _Client:
    """Applies messages the way a renderer does and reports what `root` reaches."""

    def __init__(self) -> None:
        self.components: dict[str, dict[str, Any]] = {}

    def apply(self, dicts: list[dict[str, Any]]) -> None:
        for d in dicts:
            if "deleteSurface" in d:
                self.components = {}
            for comp in d.get("createSurface", {}).get("components", []):
                self.components[comp["id"]] = comp
            for comp in d.get("updateComponents", {}).get("components", []):
                self.components[comp["id"]] = comp

    def reachable(self) -> set[str]:
        seen: set[str] = set()
        stack = ["root"]
        while stack:
            cid = stack.pop()
            if cid in seen or cid not in self.components:
                continue
            seen.add(cid)
            stack.extend(self._refs(self.components[cid]))
        return seen

    def _refs(self, value: Any) -> Iterator[str]:
        if isinstance(value, str) and value in self.components:
            yield value
        elif isinstance(value, dict):
            for key, sub in value.items():
                if key != "id":
                    yield from self._refs(sub)
        elif isinstance(value, list):
            for sub in value:
                yield from self._refs(sub)


def _ids(dicts: list[dict[str, Any]]) -> set[str]:
    return {
        c["id"]
        for d in dicts
        for c in d.get("updateComponents", {}).get("components", [])
    }


@TURN_FACTORIES
def test_create_update_in_place_then_replace(make_turns: Callable[..., Turn]) -> None:
    turn = make_turns(HOST_SCRIPTED)
    client = _Client()
    block = {"intent": HOST.intent, "payload": HOST.payload, "surfaceId": "ops"}

    first = turn(block)
    assert _kinds(first) == ["createSurface", "updateComponents", "updateDataModel"]
    client.apply(first)
    assert client.reachable() == _ids(first)

    detail = {**block, "payload": {**HOST.payload, "about": "Primary database host."}}
    second = turn(detail)
    assert _kinds(second) == ["updateComponents", "updateDataModel"]
    client.apply(second)
    assert client.reachable() == _ids(second)
    assert "root" in client.reachable()

    third = turn({**block, "replace": True})
    assert _kinds(third) == [
        "deleteSurface",
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    client.apply(third)
    assert set(client.components) == _ids(third) == client.reachable()


@TURN_FACTORIES
def test_update_needing_send_data_model_escalates_to_replace(
    make_turns: Callable[..., Turn],
) -> None:
    turn = make_turns(SETTINGS_SCRIPTED)
    block = {
        "intent": SETTINGS.intent,
        "payload": SETTINGS.payload,
        "mutablePaths": list(SETTINGS.mutable_paths),
        "surfaceId": "prefs",
    }

    first = turn(block)
    assert _kinds(first)[0] == "createSurface"
    assert "sendDataModel" not in first[0]["createSurface"]

    with_save = {**block, "actions": {"save": "Save"}}
    second = turn(with_save)
    assert _kinds(second) == [
        "deleteSurface",
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    assert second[1]["createSurface"]["sendDataModel"] is True

    third = turn({**with_save, "actions": {"save": "Save changes"}})
    assert _kinds(third) == ["updateComponents", "updateDataModel"]

    fourth = turn({**with_save, "actions": {"save": "Save changes"}})
    assert _kinds(fourth) == ["updateDataModel"]


@TURN_FACTORIES
def test_region_update_replaces_only_named_block(
    make_turns: Callable[..., Turn],
) -> None:
    turn = make_turns(HOST_SCRIPTED)
    client = _Client()
    block = {"intent": HOST.intent, "payload": HOST.payload, "surfaceId": "ops"}

    first = turn(block)
    assert _kinds(first) == ["createSurface", "updateComponents", "updateDataModel"]
    client.apply(first)
    initial_reachable = client.reachable()
    initial_headline_ids = {
        cid for cid in initial_reachable if cid.startswith("headline_")
    }
    initial_other_ids = initial_reachable - initial_headline_ids
    assert "headline_item_1" in initial_headline_ids

    # Re-plan only `headline` with `/uptimeHours` excluded so the second headline
    # tile is dropped while `banner`, `facts`, and `root` are untouched.
    region_turn = turn({
        **block,
        "region": "headline",
        "exclude": ["/uptimeHours"],
    })
    assert _kinds(region_turn) == ["updateComponents", "updateDataModel"]
    emitted_ids = _ids(region_turn)
    assert emitted_ids
    assert all(cid.startswith("headline_") for cid in emitted_ids)
    assert "headline_root" in emitted_ids
    assert "headline_item_1" not in emitted_ids

    client.apply(region_turn)
    after_reachable = client.reachable()
    after_headline_ids = {cid for cid in after_reachable if cid.startswith("headline_")}
    after_other_ids = after_reachable - after_headline_ids

    # Old child ids of the replaced block are no longer reachable from `root`,
    # and every other block's ids are unchanged.
    assert "headline_item_1" not in after_reachable
    assert after_headline_ids == emitted_ids
    assert after_other_ids == initial_other_ids


def test_region_update_errors_without_cached_plan_or_when_block_is_absent() -> None:
    fmt = DecisionFormat([CATALOG], backend=mock_backend(**HOST_SCRIPTED))
    parser = fmt.create_parser(conversation_id="region-errors")
    block = {"intent": HOST.intent, "payload": HOST.payload, "surfaceId": "ops"}

    with pytest.raises(A2uiCompilationValidationError, match="no cached"):
        parser.parse_response(_response({**block, "region": "headline"}))

    parser.parse_response(_response(block))
    with pytest.raises(A2uiCompilationValidationError, match="has no block"):
        parser.parse_response(_response({**block, "region": "form"}))


def test_separate_conversations_keep_separate_surfaces() -> None:
    fmt = DecisionFormat([CATALOG], backend=mock_backend(**HOST_SCRIPTED))
    block = {"intent": HOST.intent, "payload": HOST.payload, "surfaceId": "ops"}
    for conversation in ("a", "b"):
        parser = fmt.create_parser(conversation_id=conversation)
        assert _kinds(_messages(parser.parse_response(_response(block))))[0] == (
            "createSurface"
        )


@TURN_FACTORIES
def test_full_surface_update_after_region_update_does_not_hit_stale_cache(
    make_turns: Callable[..., Turn],
) -> None:
    turn = make_turns(HOST_SCRIPTED)
    client = _Client()
    block = {"intent": HOST.intent, "payload": HOST.payload, "surfaceId": "ops"}

    first = turn(block)
    client.apply(first)
    assert "headline_item_1" in client.reachable()

    region_turn = turn({
        **block,
        "region": "headline",
        "exclude": ["/uptimeHours"],
    })
    client.apply(region_turn)
    assert "headline_item_1" not in client.reachable()

    # Reverting to a full-surface update (`region=None`) with the original shape
    # must miss the region-tainted cache entry and re-emit `updateComponents`.
    full_turn = turn({
        **block,
        "payload": {**HOST.payload, "cpu": 0.44},
    })
    assert _kinds(full_turn) == ["updateComponents", "updateDataModel"]
    client.apply(full_turn)
    assert "headline_item_1" in client.reachable()
