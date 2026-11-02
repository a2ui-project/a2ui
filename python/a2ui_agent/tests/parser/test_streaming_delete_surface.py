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

"""Tests for DirectJsonParser deleteSurface and surface recreation (Issue #3024)."""

from __future__ import annotations

import json

import pytest

from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.parser import A2uiPart
from a2ui.utils import RendererState


@pytest.fixture(scope="module")
def catalog_v08() -> CatalogApi:
    return BasicCatalog("0.8")


@pytest.fixture(scope="module")
def catalog_v09() -> CatalogApi:
    return BasicCatalog("0.9")


def _extract_v08(parts: list) -> list[tuple[str, str | None]]:
    out: list[dict] = []
    for part in parts:
        if isinstance(part, A2uiPart):
            out.extend(to_message_dicts(part.a2ui))
    res = []
    for m in out:
        msg_type = list(m)[0]
        val = m[msg_type]
        sid = val.get("surfaceId") if isinstance(val, dict) else val
        res.append((msg_type, sid))
    return res


def _turn(parser: DirectJsonParser, state: RendererState, msgs: list[dict]) -> list:
    """Streams one turn's response against the conversation's state."""
    stream = parser.open_stream(state=state)
    parts = stream.feed(f"{A2UI_OPEN_TAG}{json.dumps(msgs)}{A2UI_CLOSE_TAG}")
    return parts + stream.close()


def _run_v08(
    parser: DirectJsonParser, state: RendererState, msgs: list[dict]
) -> list[tuple[str, str | None]]:
    return _extract_v08(_turn(parser, state, msgs))


def _surf_v08(sid: str, txt: str) -> list[dict]:
    return [
        {"beginRendering": {"surfaceId": sid, "root": "root"}},
        {
            "surfaceUpdate": {
                "surfaceId": sid,
                "components": [{
                    "id": "root",
                    "component": {"Text": {"text": {"literalString": txt}}},
                }],
            }
        },
    ]


def _extract_v09(parts: list) -> list[tuple[str, str | None]]:
    out: list[dict] = []
    for part in parts:
        if isinstance(part, A2uiPart):
            out.extend(to_message_dicts(part.a2ui))
    res = []
    for m in out:
        msg_type = next(k for k in m if k != "version")
        val = m[msg_type]
        sid = val.get("surfaceId") if isinstance(val, dict) else val
        res.append((msg_type, sid))
    return res


def _run_v09(
    parser: DirectJsonParser, state: RendererState, msgs: list[dict]
) -> list[tuple[str, str | None]]:
    return _extract_v09(_turn(parser, state, msgs))


def _surf_v09(sid: str, txt: str, catalog_id: str) -> list[dict]:
    return [
        {
            "version": "v0.9",
            "createSurface": {"surfaceId": sid, "catalogId": catalog_id},
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": sid,
                "components": [{"id": "root", "component": "Text", "text": txt}],
            },
        },
    ]


def test_v08_delete_surface_and_recreate_across_turns(
    catalog_v08: CatalogApi,
) -> None:
    """v0.8 emits deleteSurface and allows re-creating the deleted surface across turns."""
    parser = DirectJsonParser(catalogs=[catalog_v08])
    state = RendererState([catalog_v08])

    assert _run_v08(parser, state, _surf_v08("s1", "hello")) == [
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
    ]
    assert _run_v08(parser, state, [{"deleteSurface": {"surfaceId": "s1"}}]) == [
        ("deleteSurface", "s1")
    ]
    assert _run_v08(parser, state, _surf_v08("s1", "hello again")) == [
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
    ]


def test_v08_delete_surface_and_recreate_in_single_response(
    catalog_v08: CatalogApi,
) -> None:
    """v0.8 emits both pre-delete and post-recreate surfaceUpdate messages in a single response."""
    parser = DirectJsonParser(catalogs=[catalog_v08])
    state = RendererState([catalog_v08])
    msgs = (
        _surf_v08("s1", "a")
        + [{"deleteSurface": {"surfaceId": "s1"}}]
        + _surf_v08("s1", "b")
    )
    assert _run_v08(parser, state, msgs) == [
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
        ("deleteSurface", "s1"),
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
    ]


def test_v08_duplicate_begin_rendering_without_delete_raises(
    catalog_v08: CatalogApi,
) -> None:
    """Duplicate beginRendering on s1 without deleteSurface raises A2uiValidationError and leaves the state as it was."""
    parser = DirectJsonParser(catalogs=[catalog_v08])
    state = RendererState([catalog_v08])
    with pytest.raises(A2uiValidationError, match="Surface s1 already exists"):
        _run_v08(
            parser,
            state,
            _surf_v08("s1", "a")
            + [{"beginRendering": {"surfaceId": "s1", "root": "root"}}],
        )
    assert _run_v08(parser, state, _surf_v08("s1", "recovered")) == [
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
    ]


def test_v09_delete_surface_and_recreate_same_and_changed_content(
    catalog_v09: CatalogApi,
) -> None:
    """v0.9 allows re-creating a deleted surface with either identical or changed content."""
    parser = DirectJsonParser(catalogs=[catalog_v09])
    state = RendererState([catalog_v09])
    cid = catalog_v09.catalog_id

    assert _run_v09(parser, state, _surf_v09("s1", "hello", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]
    assert _run_v09(
        parser, state, [{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}}]
    ) == [("deleteSurface", "s1")]
    assert _run_v09(parser, state, _surf_v09("s1", "hello", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]
    assert _run_v09(
        parser, state, [{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}}]
    ) == [("deleteSurface", "s1")]
    assert _run_v09(parser, state, _surf_v09("s1", "changed", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]


def test_v09_ignores_updates_after_delete_until_recreated(
    catalog_v09: CatalogApi,
) -> None:
    """v0.9 withholds updateComponents and updateDataModel for a deleted surface while streaming and rejects them if not recreated."""
    parser = DirectJsonParser(catalogs=[catalog_v09])
    state = RendererState([catalog_v09])
    cid = catalog_v09.catalog_id

    assert _run_v09(parser, state, _surf_v09("s1", "hello", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]
    invalid_after_delete = [
        {"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}},
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{"id": "root", "component": "Text", "text": "ignored"}],
            },
        },
        {
            "version": "v0.9",
            "updateDataModel": {
                "surfaceId": "s1",
                "value": {"name": "ignored"},
            },
        },
    ]
    open_chunk = f"{A2UI_OPEN_TAG}{json.dumps(invalid_after_delete)[:-1]}"
    stream = parser.open_stream(state=state)
    assert _extract_v09(stream.feed(open_chunk)) == [("deleteSurface", "s1")]
    with pytest.raises(A2uiValidationError, match="Surface not found for message: s1"):
        stream.feed(f"]{A2UI_CLOSE_TAG}")

    assert _run_v09(parser, state, _surf_v09("s1", "recreated", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]
