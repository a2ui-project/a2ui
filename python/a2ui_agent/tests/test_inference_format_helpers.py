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

"""Tests for the helpers shared by the inference formats."""

from __future__ import annotations

import json
from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import v1_0
from a2ui.inference_formats import (
    DirectJsonDecompiler,
    DirectJsonParser,
    to_message_dicts,
    to_message_models,
)
from a2ui.inference_formats._shared import (
    build_catalog_helpers,
    catalogs_protocol_version,
    check_catalogs,
    check_mixed_catalogs,
    coalesce_surface_messages,
    normalize_prompt_example_messages,
    surface_catalog_id,
)

PRIMARY = "https://example.com/catalogs/primary"
SECONDARY = "https://example.com/catalogs/secondary"


def _catalog(catalog_id: str, protocol_version: str = "v1.0") -> Catalog:
    return Catalog(catalog_id=catalog_id, protocol_version=protocol_version)


# --- Lossless message conversion ---


@pytest.mark.parametrize(
    "message",
    [
        pytest.param(
            {
                "version": "v1.0",
                "callRendererFunction": {
                    "functionCallId": "fn-7",
                    "callFunction": {
                        "catalogId": PRIMARY,
                        "@call": "openUrl",
                        "args": {"url": "https://a2ui.org"},
                    },
                },
            },
            id="v1_0_call_keeps_at_call_and_call_id",
        ),
        pytest.param(
            {
                "version": "v1.0",
                "updateDataModel": {"surfaceId": "s1", "path": "/a", "value": None},
            },
            id="v1_0_explicit_null_value",
        ),
        pytest.param(
            {"version": "v0.9", "updateDataModel": {"surfaceId": "s1", "path": "/a"}},
            id="v0_9_omitted_value_stays_omitted",
        ),
        pytest.param(
            {
                "version": "v1.0",
                "createSurface": {
                    "surfaceId": "s1",
                    "catalogId": SECONDARY,
                    "components": [{
                        "id": "root",
                        "component": "Text",
                        "text": {"@path": "/title"},
                    }],
                },
            },
            id="v1_0_create_with_at_path",
        ),
        pytest.param(
            {
                "version": "v0.9",
                "createSurface": {"surfaceId": "s1", "catalogId": PRIMARY},
            },
            id="v0_9_create",
        ),
        pytest.param(
            {"beginRendering": {"surfaceId": "s1", "root": "root"}},
            id="v0_8_without_version",
        ),
    ],
)
def test_message_round_trip_is_lossless(message: dict[str, Any]):
    assert to_message_dicts(to_message_models([message])) == [message]


def test_to_message_models_invents_no_catalog_id():
    message = {"version": "v1.0", "createSurface": {"surfaceId": "s1"}}
    assert to_message_dicts(to_message_models([message])) == [message]


def test_to_message_models_invents_no_surface_id():
    message = {"version": "v1.0", "deleteSurface": {}}
    with pytest.raises(A2uiValidationError):
        to_message_models([message])


def test_to_message_models_does_not_rewrite_a_top_level_call_function():
    message = {"version": "v1.0", "callFunction": {"@call": "openUrl", "args": {}}}
    with pytest.raises(A2uiValidationError):
        to_message_models([message])


def test_to_message_models_accepts_a_single_message():
    message = {"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}
    assert to_message_dicts(to_message_models(message)) == [message]


def test_to_message_models_rejects_a_string():
    with pytest.raises(TypeError):
        to_message_models("not a message")  # type: ignore[arg-type]


def test_to_message_dicts_writes_the_version_of_a_model_built_without_it():
    model = v1_0.DeleteSurfaceMessage(deleteSurface=v1_0.DeleteSurface(surfaceId="s1"))
    assert to_message_dicts([model]) == [
        {"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}
    ]


def test_to_message_dicts_rejects_other_items():
    with pytest.raises(TypeError):
        to_message_dicts([42])  # type: ignore[list-item]


def test_normalize_prompt_example_messages_fills_in_example_defaults():
    models = normalize_prompt_example_messages(
        [
            {"createSurface": {}},
            {"callFunction": {"@call": "openUrl", "args": {"url": "x"}}},
            {"version": "1.0", "deleteSurface": {"surfaceId": "s2"}},
        ],
        version="v1.0",
        default_catalog_id=PRIMARY,
    )
    assert to_message_dicts(models) == [
        {
            "version": "v1.0",
            "createSurface": {"surfaceId": "main", "catalogId": PRIMARY},
        },
        {
            "version": "v1.0",
            "callRendererFunction": {
                "functionCallId": "call_1",
                "callFunction": {
                    "@call": "openUrl",
                    "args": {"url": "x"},
                    "catalogId": PRIMARY,
                },
            },
        },
        {"version": "v1.0", "deleteSurface": {"surfaceId": "s2"}},
    ]


@pytest.mark.parametrize("bad_version", [None, ""])
def test_normalize_prompt_example_messages_rejects_empty_or_none_version(
    bad_version: Any,
):
    with pytest.raises(A2uiValidationError, match="Version cannot be None or empty"):
        normalize_prompt_example_messages(
            [{"version": bad_version, "deleteSurface": {"surfaceId": "s1"}}],
            version="v1.0",
            default_catalog_id=PRIMARY,
        )


# --- Direct JSON ---


def test_direct_json_compile_passes_messages_through_unchanged():
    messages = [
        {
            "version": "v1.0",
            "updateDataModel": {"surfaceId": "s1", "path": "/a", "value": None},
        },
        {
            "version": "v1.0",
            "callRendererFunction": {
                "functionCallId": "fn-1",
                "callFunction": {
                    "catalogId": PRIMARY,
                    "@call": "openUrl",
                    "args": {"url": "https://a2ui.org"},
                },
            },
        },
    ]
    parser = DirectJsonParser([BasicCatalog("1.0")])
    compiled = parser.compile(json.dumps(messages))
    assert to_message_dicts(compiled) == messages


def test_direct_json_compile_of_invalid_messages_raises_validation_error():
    parser = DirectJsonParser([BasicCatalog("1.0")])
    with pytest.raises(A2uiValidationError):
        parser.compile('[{"version": "v1.0", "notAMessage": {}}]')


def test_direct_json_decompiler_writes_the_messages_unchanged():
    message = {
        "version": "v1.0",
        "updateDataModel": {"surfaceId": "s1", "path": "/a", "value": None},
    }
    notation = DirectJsonDecompiler().decompile(to_message_models([message]))
    assert json.loads(notation) == [message]


# --- Catalogs ---


def test_check_catalogs_returns_a_new_list_in_order():
    catalogs = (_catalog(SECONDARY), _catalog(PRIMARY))
    checked = check_catalogs(catalogs)
    assert checked == list(catalogs)
    checked.pop()
    assert len(check_catalogs(catalogs)) == 2


def test_check_catalogs_rejects_duplicate_ids():
    with pytest.raises(A2uiCatalogError, match="Duplicate catalog ID"):
        check_catalogs([_catalog(PRIMARY), _catalog(PRIMARY)])


def test_check_catalogs_rejects_mixed_protocol_versions():
    with pytest.raises(A2uiCatalogError, match="incompatible protocol versions"):
        check_catalogs([_catalog(PRIMARY, "v1.0"), _catalog(SECONDARY, "v0.9")])


def test_check_catalogs_requires_a_catalog():
    with pytest.raises(A2uiCatalogError, match="At least one catalog"):
        check_catalogs([])


def test_check_catalogs_rejects_a_single_catalog_not_in_a_sequence():
    with pytest.raises(TypeError):
        check_catalogs(_catalog(PRIMARY))  # type: ignore[arg-type]


def test_check_mixed_catalogs_requires_v10_when_multiple_catalogs():
    assert len(check_mixed_catalogs([_catalog(PRIMARY, "v0.9")])) == 1
    assert (
        len(
            check_mixed_catalogs(
                [_catalog(PRIMARY, "v1.0"), _catalog(SECONDARY, "v1.0")]
            )
        )
        == 2
    )
    with pytest.raises(A2uiCatalogError, match="Several catalogs need A2UI v1.0"):
        check_mixed_catalogs([_catalog(PRIMARY, "v0.9"), _catalog(SECONDARY, "v0.9")])


def test_surface_catalog_id_returns_id_only_for_single_catalog():
    assert surface_catalog_id([_catalog(PRIMARY)]) == PRIMARY
    assert surface_catalog_id([_catalog(PRIMARY), _catalog(SECONDARY)]) is None


def test_catalogs_protocol_version_reads_the_catalogs_version():
    assert catalogs_protocol_version([_catalog(PRIMARY, "0.9")]) == "v0.9"
    assert catalogs_protocol_version([_catalog(PRIMARY, "v1.0")]) == "v1.0"


def test_build_catalog_helpers_keys_by_catalog_id_in_order():
    helpers = build_catalog_helpers([_catalog(PRIMARY), _catalog(SECONDARY)])
    assert list(helpers) == [PRIMARY, SECONDARY]


def test_build_catalog_helpers_rejects_duplicate_ids():
    with pytest.raises(A2uiCatalogError):
        build_catalog_helpers([_catalog(PRIMARY), _catalog(PRIMARY)])


# --- Coalescing ---


def _create(sid: str, cat: str = SECONDARY, **extra: Any) -> dict[str, Any]:
    return {
        "version": "v1.0",
        "createSurface": {"surfaceId": sid, "catalogId": cat, **extra},
    }


def _components(sid: str, *ids: str) -> dict[str, Any]:
    return {
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": sid,
            "components": [{"id": i, "component": "Text", "text": i} for i in ids],
        },
    }


def _data(sid: str, value: Any, path: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"surfaceId": sid, "value": value}
    if path is not None:
        body["path"] = path
    return {"version": "v1.0", "updateDataModel": body}


def test_coalesce_merges_split_create_components_and_root_data():
    coalesced = coalesce_surface_messages(
        [_create("s1"), _components("s1", "root"), _data("s1", {"a": 1}, "/")]
    )
    assert len(coalesced) == 1
    assert coalesced[0].message["createSurface"]["components"][0]["id"] == "root"
    assert coalesced[0].message["createSurface"]["dataModel"] == {"a": 1}
    assert coalesced[0].surface_catalog_id == SECONDARY
    assert not coalesced[0].is_update


@pytest.mark.parametrize("path", [None, "", "/"])
def test_coalesce_root_data_update_replaces_the_data_model(path: str | None):
    coalesced = coalesce_surface_messages(
        [_create("s1", dataModel={"a": 1, "b": 2}), _data("s1", {"a": 3}, path)]
    )
    assert [c.message for c in coalesced] == [_create("s1", dataModel={"a": 3})]


def test_coalesce_keeps_a_sub_path_data_update():
    coalesced = coalesce_surface_messages([_create("s1"), _data("s1", 5, "/count")])
    assert [c.message for c in coalesced] == [_create("s1"), _data("s1", 5, "/count")]
    assert coalesced[1].is_update
    assert coalesced[1].surface_catalog_id == SECONDARY


def test_coalesce_keeps_a_root_data_update_without_an_object_value():
    deletion = {"version": "v1.0", "updateDataModel": {"surfaceId": "s1"}}
    coalesced = coalesce_surface_messages([_create("s1"), deletion])
    assert [c.message for c in coalesced] == [_create("s1"), deletion]


def test_coalesce_keeps_a_bare_create_before_delete():
    delete = {"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}
    coalesced = coalesce_surface_messages([_create("s1"), delete])
    assert [c.message for c in coalesced] == [_create("s1"), delete]
    assert coalesced[1].surface_catalog_id == SECONDARY


def test_coalesce_keeps_an_incremental_update_with_its_surface_catalog():
    messages = [
        _create("s1"),
        _data("s1", 1, "/n"),
        _components("s1", "root"),
    ]
    coalesced = coalesce_surface_messages(messages)
    assert [c.message for c in coalesced] == messages
    update = coalesced[2]
    assert update.is_update
    assert update.operation == "updateComponents"
    assert update.surface_id == "s1"
    assert update.surface_catalog_id == SECONDARY
    # The catalog travels beside the message rather than inside it.
    assert "catalogId" not in update.message["updateComponents"]


def test_coalesce_second_component_update_stays_an_update():
    coalesced = coalesce_surface_messages(
        [_create("s1"), _components("s1", "root"), _components("s1", "root", "x")]
    )
    assert len(coalesced) == 2
    assert coalesced[1].is_update
    assert coalesced[1].surface_catalog_id == SECONDARY


def test_coalesce_merges_interleaved_surfaces_independently():
    coalesced = coalesce_surface_messages([
        _create("a", PRIMARY),
        _create("b", SECONDARY),
        _components("a", "root"),
        _components("b", "root"),
    ])
    assert [c.message["createSurface"]["surfaceId"] for c in coalesced] == ["a", "b"]
    assert all("components" in c.message["createSurface"] for c in coalesced)
    assert [c.surface_catalog_id for c in coalesced] == [PRIMARY, SECONDARY]


def test_coalesce_does_not_merge_across_a_function_call():
    call = {
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "c1",
            "callFunction": {"catalogId": PRIMARY, "@call": "openUrl", "args": {}},
        },
    }
    coalesced = coalesce_surface_messages(
        [_create("s1"), call, _components("s1", "root")]
    )
    assert len(coalesced) == 3
    assert coalesced[1].surface_catalog_id is None
    assert coalesced[2].is_update


def test_coalesce_update_for_a_surface_created_elsewhere_has_no_catalog():
    coalesced = coalesce_surface_messages([_components("s9", "root")])
    assert coalesced[0].is_update
    assert coalesced[0].surface_catalog_id is None


def test_coalesce_accepts_models():
    coalesced = coalesce_surface_messages(
        to_message_models([_create("s1"), _components("s1", "root")])
    )
    assert len(coalesced) == 1
    assert "components" in coalesced[0].message["createSurface"]


def test_coalesce_rejects_other_items():
    with pytest.raises(TypeError):
        coalesce_surface_messages(["createSurface"])  # type: ignore[list-item]


def test_coalesce_does_not_mutate_its_input():
    messages = [_create("s1"), _components("s1", "root")]
    snapshot = json.loads(json.dumps(messages))
    coalesce_surface_messages(messages)
    assert messages == snapshot
