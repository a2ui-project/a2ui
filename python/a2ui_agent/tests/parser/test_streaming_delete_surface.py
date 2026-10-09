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

"""Tests for DirectJsonStreamParser deleteSurface and surface recreation (Issue #3024)."""

from __future__ import annotations

import json

import pytest

from a2ui.core import CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonStreamParser
from a2ui.schema import A2UI_CLOSE_TAG, A2UI_OPEN_TAG


@pytest.fixture(scope="module")
def catalog_v08() -> CatalogApi:
    return BasicCatalog("0.8")


@pytest.fixture(scope="module")
def catalog_v09() -> CatalogApi:
    return BasicCatalog("0.9")


def _run_v08(
    parser: DirectJsonStreamParser, msgs: list[dict]
) -> list[tuple[str, str | None]]:
    out: list[dict] = []
    chunk = f"{A2UI_OPEN_TAG}{json.dumps(msgs)}{A2UI_CLOSE_TAG}"
    for part in parser.process_chunk(chunk):
        out.extend(part.a2ui_json or [])
    res = []
    for m in out:
        msg_type = list(m)[0]
        val = m[msg_type]
        sid = val.get("surfaceId") if isinstance(val, dict) else val
        res.append((msg_type, sid))
    return res


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


def _run_v09(
    parser: DirectJsonStreamParser, msgs: list[dict]
) -> list[tuple[str, str | None]]:
    out: list[dict] = []
    chunk = f"{A2UI_OPEN_TAG}{json.dumps(msgs)}{A2UI_CLOSE_TAG}"
    for part in parser.process_chunk(chunk):
        out.extend(part.a2ui_json or [])
    res = []
    for m in out:
        msg_type = next(k for k in m if k != "version")
        val = m[msg_type]
        sid = val.get("surfaceId") if isinstance(val, dict) else val
        res.append((msg_type, sid))
    return res


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
    parser = DirectJsonStreamParser(catalogs=[catalog_v08])

    assert _run_v08(parser, _surf_v08("s1", "hello")) == [
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
    ]
    assert _run_v08(parser, [{"deleteSurface": {"surfaceId": "s1"}}]) == [
        ("deleteSurface", "s1")
    ]
    assert _run_v08(parser, _surf_v08("s1", "hello again")) == [
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
    ]


def test_v08_delete_surface_and_recreate_in_single_response(
    catalog_v08: CatalogApi,
) -> None:
    """v0.8 emits both pre-delete and post-recreate surfaceUpdate messages in a single response."""
    parser = DirectJsonStreamParser(catalogs=[catalog_v08])
    msgs = (
        _surf_v08("s1", "a")
        + [{"deleteSurface": {"surfaceId": "s1"}}]
        + _surf_v08("s1", "b")
    )
    assert _run_v08(parser, msgs) == [
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
        ("deleteSurface", "s1"),
        ("beginRendering", "s1"),
        ("surfaceUpdate", "s1"),
    ]


def test_v08_duplicate_begin_rendering_does_not_leak_buffered_start(
    catalog_v08: CatalogApi,
) -> None:
    """Duplicate beginRendering on s1 does not leak _buffered_start_message or emit deleteSurface for uncreated s2."""
    parser = DirectJsonStreamParser(catalogs=[catalog_v08])
    assert _run_v08(
        parser,
        [
            {"beginRendering": {"surfaceId": "s1", "root": "root"}},
            {"beginRendering": {"surfaceId": "s1", "root": "root"}},
            {"deleteSurface": {"surfaceId": "s2"}},
        ],
    ) == [("beginRendering", "s1")]


def test_v09_delete_surface_and_recreate_same_and_changed_content(
    catalog_v09: CatalogApi,
) -> None:
    """v0.9 allows re-creating a deleted surface with either identical or changed content."""
    parser = DirectJsonStreamParser(catalogs=[catalog_v09])
    cid = catalog_v09.catalog_id

    assert _run_v09(parser, _surf_v09("s1", "hello", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]
    assert _run_v09(
        parser, [{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}}]
    ) == [("deleteSurface", "s1")]
    assert _run_v09(parser, _surf_v09("s1", "hello", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]
    assert _run_v09(
        parser, [{"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}}]
    ) == [("deleteSurface", "s1")]
    assert _run_v09(parser, _surf_v09("s1", "changed", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]


def test_v09_ignores_updates_after_delete_until_recreated(
    catalog_v09: CatalogApi,
) -> None:
    """v0.9 ignores updateComponents and updateDataModel for a deleted surface until createSurface arrives."""
    parser = DirectJsonStreamParser(catalogs=[catalog_v09])
    cid = catalog_v09.catalog_id

    assert _run_v09(parser, _surf_v09("s1", "hello", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]
    assert _run_v09(
        parser,
        [
            {"version": "v0.9", "deleteSurface": {"surfaceId": "s1"}},
            {
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": "s1",
                    "components": [
                        {"id": "root", "component": "Text", "text": "ignored"}
                    ],
                },
            },
            {
                "version": "v0.9",
                "updateDataModel": {
                    "surfaceId": "s1",
                    "value": {"name": "ignored"},
                },
            },
        ],
    ) == [("deleteSurface", "s1")]
    assert _run_v09(parser, _surf_v09("s1", "recreated", cid)) == [
        ("createSurface", "s1"),
        ("updateComponents", "s1"),
    ]
