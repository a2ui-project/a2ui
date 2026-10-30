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

"""Tests for DirectJsonParser data model deduplication and surface lifecycle (Issue #3023)."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core import CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.parser import A2uiPart
from a2ui.utils import RendererState


@pytest.fixture(scope="module")
def catalog_v09() -> CatalogApi:
    return BasicCatalog("0.9")


@pytest.fixture(scope="module")
def catalog_v08() -> CatalogApi:
    return BasicCatalog("0.8")


def _collect_a2ui_messages(
    parser: DirectJsonParser,
    chunk: str,
    state: RendererState | None = None,
) -> list[dict[str, Any]]:
    stream = parser.open_stream(state=state)
    parts = stream.feed(chunk) + stream.close()
    msgs: list[dict[str, Any]] = []
    for part in parts:
        if isinstance(part, A2uiPart):
            msgs.extend(to_message_dicts(part.a2ui))
    return msgs


def test_v09_scenario_a_two_surfaces_identical_initial_data_model(
    catalog_v09: CatalogApi,
) -> None:
    """Scenario A: Two surfaces initialized with identical data models in one stream."""
    parser = DirectJsonParser(catalogs=[catalog_v09])
    cid = catalog_v09.catalog_id

    stream = (
        f"{A2UI_OPEN_TAG}["
        '{"version": "v0.9", "createSurface": {"surfaceId": "surface_1",'
        f' "catalogId": "{cid}"}}}},'
        '{"version": "v0.9", "updateComponents": {"surfaceId": "surface_1",'
        ' "components": [{"id": "root", "component": "Text", "text": {"path":'
        ' "/title"}}]}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "surface_1", "path":'
        ' "/title", "value": "Loading..."}},'
        '{"version": "v0.9", "createSurface": {"surfaceId": "surface_2",'
        f' "catalogId": "{cid}"}}}},'
        '{"version": "v0.9", "updateComponents": {"surfaceId": "surface_2",'
        ' "components": [{"id": "root", "component": "Text", "text": {"path":'
        ' "/title"}}]}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "surface_2", "path":'
        ' "/title", "value": "Loading..."}}'
        f"]{A2UI_CLOSE_TAG}"
    )

    msgs = _collect_a2ui_messages(parser, stream)
    udm_msgs = [m["updateDataModel"] for m in msgs if "updateDataModel" in m]
    assert udm_msgs == [
        {"surfaceId": "surface_1", "path": "/title", "value": "Loading..."},
        {"surfaceId": "surface_2", "path": "/title", "value": "Loading..."},
    ]

    chunked_stream = parser.open_stream()
    chunked_msgs: list[dict[str, Any]] = []
    for i in range(0, len(stream), 5):
        for part in chunked_stream.feed(stream[i : i + 5]):
            if isinstance(part, A2uiPart):
                chunked_msgs.extend(to_message_dicts(part.a2ui))
    for part in chunked_stream.close():
        if isinstance(part, A2uiPart):
            chunked_msgs.extend(to_message_dicts(part.a2ui))
    chunked_udm = [m["updateDataModel"] for m in chunked_msgs if "updateDataModel" in m]
    assert chunked_udm == [
        {"surfaceId": "surface_1", "path": "/title", "value": "Loading..."},
        {"surfaceId": "surface_2", "path": "/title", "value": "Loading..."},
    ]


def test_v09_scenario_b_revert_path_A_B_A_within_or_across_turns(
    catalog_v09: CatalogApi,
) -> None:
    """Scenario B: Updating a path A -> B -> A on the same surface."""
    parser = DirectJsonParser(catalogs=[catalog_v09])
    state = RendererState([catalog_v09])
    cid = catalog_v09.catalog_id

    turn1 = (
        f"{A2UI_OPEN_TAG}["
        '{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        f' "{cid}"}}}},'
        '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
        ' [{"id": "root", "component": "Text", "text": {"path": "/status"}}]}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path": "/status",'
        ' "value": "idle"}}'
        f"]{A2UI_CLOSE_TAG}"
    )
    turn2 = (
        f'{A2UI_OPEN_TAG}[{{"version": "v0.9", "updateDataModel": {{"surfaceId": "s1",'
        f' "path": "/status", "value": "busy"}}}}]{A2UI_CLOSE_TAG}'
    )
    turn3 = (
        f'{A2UI_OPEN_TAG}[{{"version": "v0.9", "updateDataModel": {{"surfaceId": "s1",'
        f' "path": "/status", "value": "idle"}}}}]{A2UI_CLOSE_TAG}'
    )

    msgs1 = _collect_a2ui_messages(parser, turn1, state=state)
    msgs2 = _collect_a2ui_messages(parser, turn2, state=state)
    msgs3 = _collect_a2ui_messages(parser, turn3, state=state)

    udm1 = [m["updateDataModel"] for m in msgs1 if "updateDataModel" in m]
    udm2 = [m["updateDataModel"] for m in msgs2 if "updateDataModel" in m]
    udm3 = [m["updateDataModel"] for m in msgs3 if "updateDataModel" in m]

    assert len(udm1) == 1 and udm1[0]["value"] == "idle"
    assert len(udm2) == 1 and udm2[0]["value"] == "busy"
    assert len(udm3) == 1 and udm3[0]["value"] == "idle"

    turn4 = (
        f"{A2UI_OPEN_TAG}["
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path":'
        ' "/status", "value": "idle"}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path":'
        ' "/status", "value": "busy"}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path":'
        ' "/status", "value": "idle"}}'
        f"]{A2UI_CLOSE_TAG}"
    )
    msgs4 = _collect_a2ui_messages(parser, turn4, state=state)
    udm4 = [m["updateDataModel"]["value"] for m in msgs4 if "updateDataModel" in m]
    assert udm4 == ["idle", "busy", "idle"]


def test_v09_scenario_c_recreate_surface_after_delete_surface(
    catalog_v09: CatalogApi,
) -> None:
    """Scenario C: Recreating a surface after deleteSurface with identical data."""
    parser = DirectJsonParser(catalogs=[catalog_v09])
    state = RendererState([catalog_v09])
    cid = catalog_v09.catalog_id

    stream1 = (
        f"{A2UI_OPEN_TAG}["
        '{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        f' "{cid}"}}}},'
        '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
        ' [{"id": "root", "component": "Text", "text": {"path": "/msg"}}]}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path": "/msg",'
        ' "value": "Hello"}},'
        '{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}}'
        f"]{A2UI_CLOSE_TAG}"
    )
    stream2 = (
        f"{A2UI_OPEN_TAG}["
        '{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        f' "{cid}"}}}},'
        '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
        ' [{"id": "root", "component": "Text", "text": {"path": "/msg"}}]}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path": "/msg",'
        ' "value": "Hello"}}'
        f"]{A2UI_CLOSE_TAG}"
    )

    msgs1 = _collect_a2ui_messages(parser, stream1, state=state)
    msgs2 = _collect_a2ui_messages(parser, stream2, state=state)

    assert any("deleteSurface" in m for m in msgs1)
    assert any("createSurface" in m for m in msgs2)
    assert any("updateComponents" in m for m in msgs2)
    udm2 = [m["updateDataModel"] for m in msgs2 if "updateDataModel" in m]
    assert len(udm2) == 1
    assert udm2[0] == {"surfaceId": "s1", "path": "/msg", "value": "Hello"}


def test_v09_partial_sniffing_deduplicates_within_inflight_object_only(
    catalog_v09: CatalogApi,
) -> None:
    """Sniffed partial updateDataModel deltas do not re-emit on completion, but allow later updates."""
    parser = DirectJsonParser(catalogs=[catalog_v09])
    state = RendererState([catalog_v09])
    stream = parser.open_stream(state=state)
    cid = catalog_v09.catalog_id

    c1 = (
        f"{A2UI_OPEN_TAG}["
        '{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        f' "{cid}"}}}},'
        '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
        ' [{"id": "root", "component": "Text", "text": "hi"}]}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "value": {"a":'
        ' "hello"'
    )
    c2 = f"}}}}}}]{A2UI_CLOSE_TAG}"

    msgs_c1 = [
        m
        for part in stream.feed(c1)
        if isinstance(part, A2uiPart)
        for m in to_message_dicts(part.a2ui)
    ]
    msgs_c2 = [
        m
        for part in stream.feed(c2)
        if isinstance(part, A2uiPart)
        for m in to_message_dicts(part.a2ui)
    ]

    udm_c1 = [m["updateDataModel"] for m in msgs_c1 if "updateDataModel" in m]
    udm_c2 = [m["updateDataModel"] for m in msgs_c2 if "updateDataModel" in m]
    # Partial sniff emitted {"a": "hello"} in c1, so completion in c2 is deduplicated
    assert len(udm_c1) == 1
    assert udm_c1[0]["value"] == {"a": "hello"}
    assert len(udm_c2) == 0

    # A subsequent updateDataModel with the same value in a later block IS emitted
    c3 = (
        f'{A2UI_OPEN_TAG}[{{"version": "v0.9", "updateDataModel": {{"surfaceId": "s1",'
        f' "value": {{"a": "hello"}}}}}}]{A2UI_CLOSE_TAG}'
    )
    msgs_c3 = [
        m
        for part in stream.feed(c3) + stream.close()
        if isinstance(part, A2uiPart)
        for m in to_message_dicts(part.a2ui)
    ]
    udm_c3 = [m["updateDataModel"] for m in msgs_c3 if "updateDataModel" in m]
    assert len(udm_c3) == 1
    assert udm_c3[0]["value"] == {"a": "hello"}


def test_v08_across_surfaces_turns_and_falsy_values(
    catalog_v08: CatalogApi,
) -> None:
    """v0.8 dataModelUpdate works across surfaces, turns, and falsy values (False, 0, '')."""
    parser = DirectJsonParser(catalogs=[catalog_v08])
    state = RendererState([catalog_v08])

    stream1 = (
        f'{A2UI_OPEN_TAG}[{{"beginRendering": {{"surfaceId": "s1", "root":'
        ' "root"}},{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id":'
        ' "root", "component": {"Text": {"text": {"path":'
        ' "/title"}}}}]}},{"dataModelUpdate": {"surfaceId": "s1", "path": "/",'
        ' "contents": [{"key": "title", "valueString": ""},{"key": "count",'
        ' "valueNumber": 0},{"key": "flag", "valueBoolean":'
        ' false}]}},{"beginRendering": {"surfaceId": "s2", "root":'
        ' "root"}},{"surfaceUpdate": {"surfaceId": "s2", "components": [{"id":'
        ' "root", "component": {"Text": {"text": {"path":'
        ' "/title"}}}}]}},{"dataModelUpdate": {"surfaceId": "s2", "path": "/",'
        ' "contents": [{"key": "title", "valueString": ""},{"key": "count",'
        ' "valueNumber": 0},{"key": "flag", "valueBoolean":'
        f" false}}]}}}}]{A2UI_CLOSE_TAG}"
    )

    msgs1 = _collect_a2ui_messages(parser, stream1, state=state)
    dmu1 = [m["dataModelUpdate"] for m in msgs1 if "dataModelUpdate" in m]
    assert len(dmu1) == 2
    assert dmu1[0]["surfaceId"] == "s1"
    assert dmu1[1]["surfaceId"] == "s2"

    # Turn 2: delete s1 and recreate it with the same dataModelUpdate
    stream2 = (
        f'{A2UI_OPEN_TAG}[{{"deleteSurface": {{"surfaceId":'
        ' "s1"}},{"beginRendering": {"surfaceId": "s1", "root":'
        ' "root"}},{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id":'
        ' "root", "component": {"Text": {"text": {"path":'
        ' "/title"}}}}]}},{"dataModelUpdate": {"surfaceId": "s1", "path": "/",'
        f' "contents": [{{"key": "title", "valueString": ""}}]}}}}]{A2UI_CLOSE_TAG}'
    )
    msgs2 = _collect_a2ui_messages(parser, stream2, state=state)
    assert any("deleteSurface" in m for m in msgs2)
    assert any("beginRendering" in m for m in msgs2)
    assert any("surfaceUpdate" in m for m in msgs2)
    dmu2 = [m["dataModelUpdate"] for m in msgs2 if "dataModelUpdate" in m]
    assert len(dmu2) == 1
    assert dmu2[0]["surfaceId"] == "s1"


def test_v09_partial_update_data_model_without_value_waits_until_value_or_close(
    catalog_v09: CatalogApi,
) -> None:
    """An open updateDataModel with path but no value yet waits until value arrives or the object closes."""
    parser = DirectJsonParser(catalogs=[catalog_v09])
    state = RendererState([catalog_v09])
    stream = parser.open_stream(state=state)
    cid = catalog_v09.catalog_id

    c1 = (
        f"{A2UI_OPEN_TAG}["
        '{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        f' "{cid}"}}}},'
        '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
        ' [{"id": "root", "component": "Text", "text": {"path": "/title"}}]}},'
        '{"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path": "/title"'
    )
    c2 = f', "value": "Ready"}}}}]{A2UI_CLOSE_TAG}'

    msgs_c1 = [
        m
        for part in stream.feed(c1)
        if isinstance(part, A2uiPart)
        for m in to_message_dicts(part.a2ui)
    ]
    assert [m["updateDataModel"] for m in msgs_c1 if "updateDataModel" in m] == []

    msgs_c2 = [
        m
        for part in stream.feed(c2) + stream.close()
        if isinstance(part, A2uiPart)
        for m in to_message_dicts(part.a2ui)
    ]
    assert [m["updateDataModel"] for m in msgs_c2 if "updateDataModel" in m] == [
        {"surfaceId": "s1", "path": "/title", "value": "Ready"}
    ]
