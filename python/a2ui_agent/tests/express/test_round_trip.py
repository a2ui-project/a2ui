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

"""Lossless decompile -> compile round trips for A2UI Express.

Covers the basic catalog examples end to end, and the DSL forms that carry
message details which positional component arguments cannot: explicit
component ids, references to components outside the block, explicit
`functionCallId`s, `sendDataModel` and empty event contexts.
"""

import glob
import json
import os
from typing import Any

import pytest

from a2ui.core import A2uiValidationError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts, to_message_models
from a2ui.inference_formats._shared import coalesce_surface_messages
from a2ui.inference_formats.express import (
    ExpressCompiler,
    ExpressDecompiler,
    ExpressValidationError,
)

from ..repo_paths import find_repo_root

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
EXAMPLE_FILES = sorted(
    glob.glob(os.path.join(REPO_ROOT, "catalogs", "basic", "v1", "examples", "*.json"))
)
SURFACE = "s1"


@pytest.fixture(name="catalog", scope="module")
def _catalog():
    return BasicCatalog("1.0")


@pytest.fixture(name="compiler", scope="module")
def _compiler(catalog):
    return ExpressCompiler([catalog])


@pytest.fixture(name="decompiler", scope="module")
def _decompiler(catalog):
    return ExpressDecompiler([catalog])


@pytest.fixture(name="catalog_v09", scope="module")
def _catalog_v09():
    return BasicCatalog("0.9")


@pytest.fixture(name="compiler_v09", scope="module")
def _compiler_v09(catalog_v09):
    return ExpressCompiler([catalog_v09], version="v0.9")


@pytest.fixture(name="decompiler_v09", scope="module")
def _decompiler_v09(catalog_v09):
    return ExpressDecompiler([catalog_v09])


def _normalize(messages: Any) -> list[dict[str, Any]]:
    """Coalesces a payload so that split and merged surface creation compare equal.

    A root `updateDataModel` may omit `path`; the DSL writes it as `$/`, so an
    absent path is compared as `/`.
    """
    normalized = []
    for item in coalesce_surface_messages(to_message_dicts(messages)):
        message = item.message
        update = message.get("updateDataModel")
        if isinstance(update, dict) and not update.get("path"):
            update["path"] = "/"
        normalized.append(message)
    return normalized


def _round_trip(compiler, decompiler, messages):
    dsl = decompiler.decompile(to_message_models(messages))
    return dsl, compiler.compile(dsl)


def _create(components, **extra):
    return {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": SURFACE,
            "catalogId": BasicCatalog("1.0").catalog_id,
            "components": components,
            **extra,
        },
    }


def _update(components):
    return {
        "version": "v1.0",
        "updateComponents": {"surfaceId": SURFACE, "components": components},
    }


def _renderer_call(function_call_id, url):
    return {
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": function_call_id,
            "callFunction": {
                "catalogId": BasicCatalog("1.0").catalog_id,
                "@call": "openUrl",
                "args": {"url": url},
            },
        },
    }


@pytest.mark.parametrize(
    "example_file", EXAMPLE_FILES, ids=lambda p: os.path.basename(p)
)
def test_basic_catalog_example_round_trips(example_file, compiler, decompiler):
    with open(example_file, "r", encoding="utf-8") as f:
        messages = json.load(f)["messages"]

    dsl, recompiled = _round_trip(compiler, decompiler, messages)

    assert _normalize(recompiled) == _normalize(messages), dsl


def test_examples_are_found():
    assert len(EXAMPLE_FILES) > 30


def _create_v09(components):
    return [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": SURFACE,
                "catalogId": BasicCatalog("0.9").catalog_id,
                "sendDataModel": False,
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {"surfaceId": SURFACE, "components": components},
        },
    ]


def _update_v09(components):
    return {
        "version": "v0.9",
        "updateComponents": {"surfaceId": SURFACE, "components": components},
    }


def test_non_identifier_ids_are_written_with_id_argument(compiler_v09, decompiler_v09):
    messages = _create_v09([
        {"id": "root", "component": "Column", "children": ["content-grid"]},
        {"id": "content-grid", "component": "Text", "text": "Hi"},
    ])

    dsl, recompiled = _round_trip(compiler_v09, decompiler_v09, messages)

    assert dsl == (
        'surface("s1", sendDataModel=false)\n'
        "root = Column([content_grid])\n"
        'content_grid = Text("Hi", id="content-grid")'
    )
    assert _normalize(recompiled) == _normalize(messages)


def test_derived_variable_names_do_not_collide(compiler_v09, decompiler_v09):
    messages = _create_v09([
        {
            "id": "root",
            "component": "Row",
            "children": ["a-b", "a_b", "1st", "true"],
        },
        {"id": "a-b", "component": "Text", "text": "dash"},
        {"id": "a_b", "component": "Text", "text": "underscore"},
        {"id": "1st", "component": "Text", "text": "digit"},
        {"id": "true", "component": "Text", "text": "keyword"},
    ])

    dsl, recompiled = _round_trip(compiler_v09, decompiler_v09, messages)

    assert "root = Row([a_b_2, a_b, _1st, _true])" in dsl
    assert 'a_b_2 = Text("dash", id="a-b")' in dsl
    assert 'a_b = Text("underscore")' in dsl
    assert _normalize(recompiled) == _normalize(messages)


def test_v1_rejects_non_identifier_component_id(decompiler):
    messages = [
        _create([
            {"id": "root", "component": "Column", "children": ["content-grid"]},
            {"id": "content-grid", "component": "Text", "text": "Hi"},
        ])
    ]

    with pytest.raises(
        A2uiValidationError,
        match="Component id 'content-grid' must be a valid UAX #31 identifier",
    ) as exc_info:
        decompiler.decompile(to_message_models(messages))

    assert len(exc_info.value.details) == 1
    assert exc_info.value.details[0].code == "invalid_identifier"
    assert exc_info.value.details[0].path == "components.content-grid.id"


def test_v1_reserved_word_id_is_derived(compiler, decompiler):
    messages = [
        _create([
            {"id": "root", "component": "Row", "children": ["true", "_"]},
            {"id": "true", "component": "Text", "text": "keyword"},
            {"id": "_", "component": "Text", "text": "placeholder"},
        ])
    ]

    dsl, recompiled = _round_trip(compiler, decompiler, messages)

    assert "root = Row([_true, __])" in dsl
    assert '_true = Text("keyword", id="true")' in dsl
    assert '__ = Text("placeholder", id="_")' in dsl
    assert _normalize(recompiled) == _normalize(messages)


def test_unicode_identifiers_round_trip(compiler, decompiler):
    combining_id = "e\u0301"
    messages = [
        _create([
            {
                "id": "root",
                "component": "Column",
                "children": ["größe", "名前", combining_id],
            },
            {"id": "größe", "component": "Text", "text": "Size"},
            {"id": "名前", "component": "Text", "text": "Name"},
            {"id": combining_id, "component": "Text", "text": "Accent"},
        ])
    ]

    dsl, recompiled = _round_trip(compiler, decompiler, messages)

    assert f"root = Column([größe, 名前, {combining_id}])" in dsl
    assert 'größe = Text("Size")' in dsl
    assert '名前 = Text("Name")' in dsl
    assert f'{combining_id} = Text("Accent")' in dsl
    assert _normalize(recompiled) == _normalize(messages)


def test_out_of_scope_references(compiler, decompiler):
    messages = [
        _update([
            {
                "id": "card",
                "component": "Column",
                "children": ["earlier_title", "earlier-body"],
            },
        ])
    ]

    dsl, recompiled = _round_trip(compiler, decompiler, messages)

    assert 'card = Column([earlier_title, "earlier-body"])' in dsl
    assert _normalize(recompiled) == _normalize(messages)


def test_out_of_scope_reference_colliding_with_block_variable_is_quoted(
    compiler_v09, decompiler_v09
):
    messages = [
        _update_v09([
            {"id": "card", "component": "Row", "children": ["x-y", "x_y"]},
            {"id": "x-y", "component": "Text", "text": "in block"},
        ])
    ]

    dsl, recompiled = _round_trip(compiler_v09, decompiler_v09, messages)

    assert 'card = Row([x_y, "x_y"])' in dsl
    assert _normalize(recompiled) == _normalize(messages)


def test_compiler_id_argument_sets_component_id_and_references(compiler_v09):
    dsl = (
        'root = Column([grid, Text("inline", id="inline-text")])\n'
        'grid = Text("Hi", id="content-grid")'
    )

    components = to_message_dicts(compiler_v09.compile(dsl))[1]["updateComponents"][
        "components"
    ]

    assert components == [
        {
            "id": "root",
            "component": "Column",
            "children": ["content-grid", "inline-text"],
        },
        {"id": "inline-text", "component": "Text", "text": "inline"},
        {"id": "content-grid", "component": "Text", "text": "Hi"},
    ]


def test_compiler_rejects_non_uax31_id_in_v1_0(compiler):
    with pytest.raises(ExpressValidationError, match="not a valid UAX 31 identifier"):
        compiler.compile('root = Column([grid]); grid = Text("Hi", id="a-b")')


def test_compiler_rejects_non_string_id(compiler):
    with pytest.raises(ExpressValidationError, match="id must be a non-empty"):
        compiler.compile('root = Text("Hi", id=3)')


def test_explicit_function_call_ids_round_trip(compiler, decompiler):
    messages = [
        _renderer_call("call_1", "https://a.example"),
        _renderer_call("open-docs", "https://b.example"),
        _renderer_call("call_3", "https://c.example"),
    ]

    dsl, recompiled = _round_trip(compiler, decompiler, messages)

    assert dsl.splitlines() == [
        'openUrl("https://a.example")',
        'openUrl("https://b.example", functionCallId="open-docs")',
        'openUrl("https://c.example")',
    ]
    assert to_message_dicts(recompiled) == messages


def test_compiler_rejects_non_string_function_call_id(compiler):
    with pytest.raises(ExpressValidationError, match="functionCallId"):
        compiler.compile('openUrl("https://a.example", functionCallId=1)')


@pytest.mark.parametrize("flag", [True, False])
def test_send_data_model_round_trips(compiler, decompiler, flag):
    messages = [
        _create(
            [{"id": "root", "component": "Text", "text": "Hi"}],
            sendDataModel=flag,
        )
    ]

    dsl, recompiled = _round_trip(compiler, decompiler, messages)

    assert dsl.splitlines()[0] == (
        f'surface("s1", sendDataModel={"true" if flag else "false"})'
    )
    assert _normalize(recompiled) == _normalize(messages)


def test_surface_rejects_non_bool_send_data_model(compiler):
    with pytest.raises(ExpressValidationError, match="sendDataModel"):
        compiler.compile('surface("s1", sendDataModel="yes")\nroot = Text("Hi")')


def test_empty_event_context_round_trips(compiler, decompiler):
    messages = [
        _create([
            {"id": "label", "component": "Text", "text": "Go"},
            {
                "id": "root",
                "component": "Button",
                "child": "label",
                "action": {"event": {"name": "go", "context": {}}},
            },
        ])
    ]

    dsl, recompiled = _round_trip(compiler, decompiler, messages)

    assert 'Event("go", {})' in dsl
    assert _normalize(recompiled) == _normalize(messages)
