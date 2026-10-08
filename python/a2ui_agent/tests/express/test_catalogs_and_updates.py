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

"""Express catalog resolution, update blocks, and multi-statement compilation.

Covers how un-annotated components and calls are looked up by name across
catalogs (and stamped with their catalogId when several are active), the
`updateSurface(...)` statement, `updateDataModel` paths, reserved `@` keys per
protocol version, and multi-catalog prompt rules.
"""

from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, Catalog
from a2ui.inference_formats import to_message_dicts, to_message_models
from a2ui.inference_formats.experimental.express import (
    EXPRESS_RULES,
    ExpressCompiler,
    ExpressFormat,
    ExpressParser,
    ExpressValidationError,
)
from a2ui.parser import A2uiCompilationValidationError

PRIMARY = "test/primary"
SECONDARY = "test/secondary"

_DYNAMIC_STRING = {"$ref": "common_types.json#/$defs/DynamicString"}
_CHECKABLE = {"$ref": "common_types.json#/$defs/Checkable"}


def _fn(*props: str, types: dict[str, str] | None = None) -> dict[str, Any]:
    types = types or {}
    return {
        "returnType": "boolean",
        "properties": {
            "args": {
                "type": "object",
                "properties": {p: {"type": types.get(p, "string")} for p in props},
                "required": list(props[:1]),
            }
        },
    }


def _catalog(catalog_id: str, components: dict, functions: dict, version: str):
    return Catalog.from_json(
        {"catalogId": catalog_id, "components": components, "functions": functions},
        protocol_version=version,
    )


def _primary(version: str = "v1.0") -> Catalog:
    return _catalog(
        PRIMARY,
        {
            "Column": {
                "properties": {
                    "children": {"$ref": "common_types.json#/$defs/ChildList"}
                }
            },
            "Text": {"properties": {"text": _DYNAMIC_STRING}},
            "Input": {
                "allOf": [
                    _CHECKABLE,
                    {"properties": {"value": _DYNAMIC_STRING, "action": {}}},
                ]
            },
        },
        {
            "required": _fn("value"),
            "sharedFn": _fn("firstPrimary", "secondPrimary"),
        },
        version,
    )


def _secondary(version: str = "v1.0") -> Catalog:
    return _catalog(
        SECONDARY,
        {
            "Panel": {
                "allOf": [
                    _CHECKABLE,
                    {
                        "properties": {
                            "headline": _DYNAMIC_STRING,
                            "content": {"$ref": "common_types.json#/$defs/ComponentId"},
                            "action": {},
                        }
                    },
                ]
            },
        },
        {
            "sharedFn": _fn("firstSecondary", "secondSecondary"),
            "secOnly": _fn("limit", types={"limit": "number"}),
        },
        version,
    )


@pytest.fixture
def parser() -> ExpressParser:
    return ExpressParser([_primary(), _secondary()], surface_id="main")


def _compile(parser: ExpressParser, dsl: str) -> list[dict[str, Any]]:
    return to_message_dicts(parser.compile(dsl))


def _round_trip(parser: ExpressParser, messages: list[dict[str, Any]]) -> str:
    """Decompiles messages, asserts they recompile unchanged, returns the DSL."""
    dsl = parser.decompile(to_message_models(messages))
    assert _compile(parser, dsl) == messages, dsl
    return dsl


# --- Catalog resolution by name (several catalogs, v1.0) ---


def test_multi_catalog_create_omits_catalog_id_and_stamps_every_component_and_call(
    parser: ExpressParser,
) -> None:
    messages = _compile(
        parser,
        """
surface("s1")
root = Column([panel])
panel = Panel("Head", Text("inline"), ?sharedFn("a", "b", {catalogId: "test/primary"}), action=secOnly(3))
""",
    )
    create = messages[0]["createSurface"]
    assert "catalogId" not in create
    comps = {c["id"]: c for c in create["components"]}
    assert comps["root"] == {
        "id": "root",
        "component": "Column",
        "catalogId": PRIMARY,
        "children": ["panel"],
    }
    assert comps["panel"] == {
        "id": "panel",
        "component": "Panel",
        "catalogId": SECONDARY,
        "headline": "Head",
        "content": "panel_content",
        "checks": [{
            "condition": {
                "@call": "sharedFn",
                "catalogId": PRIMARY,
                "args": {"firstPrimary": "a", "secondPrimary": "b"},
            },
            "message": "Sharedfn check failed",
        }],
        "action": {
            "functionCall": {
                "@call": "secOnly",
                "catalogId": SECONDARY,
                "args": {"limit": 3},
            }
        },
    }
    assert comps["panel_content"] == {
        "id": "panel_content",
        "component": "Text",
        "catalogId": PRIMARY,
        "text": "inline",
    }
    dsl = _round_trip(parser, messages)
    # Only the name both catalogs define is written with its catalog.
    assert 'surface("s1")' in dsl
    assert '{catalogId: "test/primary"}' in dsl
    assert f'catalogId="{SECONDARY}"' not in dsl
    assert f'catalogId="{PRIMARY}"' not in dsl


@pytest.mark.parametrize(
    "dsl",
    [
        'root = Input($/x, action=sharedFn("a", "b"))',
        'root = Input($/x, ?sharedFn("a", "b"))',
        'sharedFn("a", "b")',
    ],
)
def test_unannotated_name_defined_in_several_catalogs_fails(
    parser: ExpressParser, dsl: str
) -> None:
    with pytest.raises(
        A2uiCompilationValidationError,
        match=(
            r"'sharedFn' is defined in several catalogs: \['test/primary',"
            r" 'test/secondary'\]"
        ),
    ):
        parser.compile(dsl)


def test_unannotated_name_defined_in_no_catalog_fails(parser: ExpressParser) -> None:
    with pytest.raises(
        A2uiCompilationValidationError,
        match="Unknown component 'Bogus' not defined in any catalog",
    ):
        parser.compile('root = Bogus("x")')
    with pytest.raises(
        A2uiCompilationValidationError,
        match="Unknown function 'bogusFn' not defined in any catalog",
    ):
        parser.compile("root = Text(bogusFn(1))")


def test_explicit_catalog_id_wins_over_lookup_by_name(parser: ExpressParser) -> None:
    with pytest.raises(
        A2uiCompilationValidationError,
        match="Unknown function 'secOnly' not defined in catalog 'test/primary'",
    ):
        parser.compile('root = Input($/x, action=secOnly(3, catalogId="test/primary"))')

    messages = _compile(
        parser,
        'root = Input($/x, action=sharedFn("c", "d", catalogId="test/secondary"))',
    )
    root = messages[0]["createSurface"]["components"][0]
    assert root["action"] == {
        "functionCall": {
            "@call": "sharedFn",
            "catalogId": SECONDARY,
            "args": {"firstSecondary": "c", "secondSecondary": "d"},
        }
    }
    _round_trip(parser, messages)


def test_decompile_reads_unannotated_check_against_its_surface_catalog(
    parser: ExpressParser,
) -> None:
    # Input messages may still name a surface catalog, for example in history.
    messages = [{
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": PRIMARY,
            "components": [{
                "id": "root",
                "component": "Panel",
                "catalogId": SECONDARY,
                "checks": [{
                    "condition": {
                        "@call": "sharedFn",
                        "args": {"firstPrimary": "x", "secondPrimary": "y"},
                    },
                    "message": "Custom",
                }],
            }],
        },
    }]
    dsl = parser.decompile(to_message_models(messages))
    assert 'surface("s1")' in dsl
    assert (
        'root = Panel(?sharedFn("x", "y", "Custom", {catalogId: "test/primary"}))'
        in dsl
    )
    recompiled = _compile(parser, dsl)
    assert "catalogId" not in recompiled[0]["createSurface"]
    check = recompiled[0]["createSurface"]["components"][0]["checks"][0]
    assert check["condition"]["catalogId"] == PRIMARY


def test_check_message_after_skipped_parameter_round_trips(
    parser: ExpressParser,
) -> None:
    messages = _compile(
        parser,
        """
surface("s1")
root = Input($/name, ?sharedFn("a", _, "Pick two", {catalogId: "test/primary"}))
""",
    )
    check = messages[0]["createSurface"]["components"][0]["checks"][0]
    assert check == {
        "condition": {
            "@call": "sharedFn",
            "catalogId": PRIMARY,
            "args": {"firstPrimary": "a"},
        },
        "message": "Pick two",
    }
    _round_trip(parser, messages)


def test_check_binds_component_value_implicitly(parser: ExpressParser) -> None:
    messages = _compile(parser, 'surface("s1")\nroot = Input($/name, ?required)')
    check = messages[0]["createSurface"]["components"][0]["checks"][0]
    assert check["condition"] == {
        "@call": "required",
        "catalogId": PRIMARY,
        "args": {"value": {"@path": "/name"}},
    }
    assert "?required" in _round_trip(parser, messages)


def test_decompile_reads_bare_call_check_as_its_condition(
    parser: ExpressParser,
) -> None:
    # The basic catalog's prompt example writes a check without the
    # `condition` wrapper; it is read as the condition itself.
    messages = [{
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": PRIMARY,
            "components": [{
                "id": "root",
                "component": "Input",
                "value": {"@path": "/name"},
                "checks": [{"@call": "required"}],
            }],
        },
    }]
    dsl = parser.decompile(to_message_models(messages))
    assert "root = Input($/name, ?required)" in dsl


# --- Catalog ids ---


def test_single_catalog_surface_line_may_name_its_catalog() -> None:
    compiler = ExpressCompiler([_primary()])
    with pytest.raises(ExpressValidationError, match="Unknown catalog 'bogus'"):
        compiler.compile('surface("s", "bogus")\nroot = Text("x")')
    for dsl in ('surface("s", "test/primary")\nroot = Text("x")', 'root = Text("x")'):
        msgs = to_message_dicts(compiler.compile(dsl))
        assert msgs[0]["createSurface"]["catalogId"] == PRIMARY
        assert "catalogId" not in msgs[0]["createSurface"]["components"][0]


@pytest.mark.parametrize(
    "dsl",
    [
        'surface("s", "test/secondary")\nroot = Panel("x")',
        'surface("s", catalogId="test/primary")\nroot = Text("x")',
    ],
)
def test_surface_line_naming_a_catalog_fails_with_several_catalogs(
    parser: ExpressParser, dsl: str
) -> None:
    with pytest.raises(
        A2uiCompilationValidationError, match="several catalogs are active"
    ):
        parser.compile(dsl)


def test_several_catalogs_before_v1_0_are_rejected() -> None:
    v09 = [_primary("v0.9"), _secondary("v0.9")]
    for factory in (ExpressCompiler, ExpressFormat, ExpressParser):
        with pytest.raises(A2uiCatalogError, match="need A2UI v1.0"):
            factory(v09)
    compiler = ExpressCompiler([_primary(), _secondary()], version="v0.9")
    with pytest.raises(A2uiCatalogError, match="need A2UI v1.0"):
        compiler.compile('root = Text("x")')


def test_compile_emits_the_catalog_actually_used() -> None:
    compiler = ExpressCompiler([_primary(), _secondary()])
    msgs = to_message_dicts(compiler.compile('root = Panel("x")'))
    assert "catalogId" not in msgs[0]["createSurface"]
    assert msgs[0]["createSurface"]["components"][0]["catalogId"] == SECONDARY
    call = to_message_dicts(compiler.compile("secOnly(1)"))[0]
    assert call["callRendererFunction"]["callFunction"]["catalogId"] == SECONDARY

    single = ExpressCompiler([_primary()])
    call = to_message_dicts(single.compile('sharedFn("a", "b")'))[0]
    assert call["callRendererFunction"]["callFunction"]["catalogId"] == PRIMARY


@pytest.mark.parametrize(
    "dsl",
    [
        'root = Text("x", catalogId="test/primary")',
        'root = Input("x", action=sharedFn("a", "b", catalogId="test/primary"))',
        'root = Input("x", ?sharedFn("a", "b", {catalogId: "test/primary"}))',
    ],
)
def test_v0_9_rejects_per_component_and_per_function_catalog_ids(dsl: str) -> None:
    compiler = ExpressCompiler([_primary("v0.9")], version="v0.9")
    with pytest.raises(ExpressValidationError, match="catalogId"):
        compiler.compile(dsl)


def test_v0_9_allows_a_surface_catalog() -> None:
    compiler = ExpressCompiler([_primary("v0.9")], version="v0.9")
    msgs = to_message_dicts(
        compiler.compile('surface("s", "test/primary")\nroot = Text("x")')
    )
    assert msgs[0]["createSurface"]["catalogId"] == PRIMARY


# --- Reserved keys per version ---


def test_v1_0_writes_reserved_keys_and_v0_9_plain_keys() -> None:
    dsl = """
root = Column(_template($/items, item))
item = Input($name, ?required, action=sharedFn($/a, "b"))
"""
    v1 = to_message_dicts(ExpressCompiler([_primary()]).compile(dsl))
    comps = {c["id"]: c for c in v1[0]["createSurface"]["components"]}
    assert comps["root"]["children"] == {"path": "/items", "componentId": "item"}
    assert comps["item"]["value"] == {"@path": "name"}
    assert comps["item"]["action"]["functionCall"]["@call"] == "sharedFn"
    assert comps["item"]["action"]["functionCall"]["args"]["firstPrimary"] == {
        "@path": "/a"
    }

    v09 = to_message_dicts(
        ExpressCompiler([_primary("v0.9")], version="v0.9").compile(dsl)
    )
    comps = {c["id"]: c for c in v09[1]["updateComponents"]["components"]}
    assert comps["root"]["children"] == {"path": "/items", "componentId": "item"}
    assert comps["item"]["value"] == {"path": "name"}
    assert comps["item"]["checks"][0]["condition"]["call"] == "required"
    assert comps["item"]["action"]["functionCall"]["call"] == "sharedFn"


# --- updateComponents and updateDataModel paths ---


def test_update_components_on_non_default_surface_round_trips(
    parser: ExpressParser,
) -> None:
    messages = [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "s2",
                "components": [{
                    "id": "root",
                    "component": "Panel",
                    "catalogId": SECONDARY,
                    "headline": "A",
                }],
            },
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s2",
                "components": [{
                    "id": "sub",
                    "component": "Panel",
                    "catalogId": SECONDARY,
                    "headline": "B",
                }],
            },
        },
    ]
    dsl = _round_trip(parser, messages)
    assert dsl.count('surface("s2")') == 2
    assert "catalogId" not in dsl


def test_decompile_update_reads_components_against_the_created_surface_catalog(
    parser: ExpressParser,
) -> None:
    messages = [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "s2",
                "catalogId": PRIMARY,
                "components": [{"id": "root", "component": "Text", "text": "A"}],
            },
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s2",
                "components": [{
                    "id": "greeting",
                    "component": "Input",
                    "value": {"@path": "/v"},
                    "action": {
                        "functionCall": {
                            "@call": "sharedFn",
                            "args": {"firstPrimary": "p"},
                        }
                    },
                }],
            },
        },
    ]
    dsl = parser.decompile(to_message_models(messages))
    assert dsl.count('surface("s2")') == 2
    assert 'greeting = Input($/v, sharedFn("p", catalogId="test/primary"))' in dsl
    recompiled = _compile(parser, dsl)
    assert recompiled[1]["updateComponents"]["components"][0]["catalogId"] == PRIMARY


def test_decompile_component_with_no_catalog_on_unknown_surface_fails(
    parser: ExpressParser,
) -> None:
    messages = [{
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "greeting", "component": "Text", "text": "New"}],
        },
    }]
    with pytest.raises(ExpressValidationError, match="names no catalogId"):
        parser.decompile(to_message_models(messages))


def test_update_components_round_trips_with_surface_directive(
    parser: ExpressParser,
) -> None:
    messages = [{
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{
                "id": "greeting",
                "component": "Text",
                "catalogId": PRIMARY,
                "text": "New",
            }],
        },
    }]
    dsl = _round_trip(parser, messages)
    assert dsl.splitlines()[0] == 'surface("s1")'


def test_update_surface_components_carry_their_catalog(parser: ExpressParser) -> None:
    messages = _compile(
        parser,
        """
surface("s2")
root = Panel("A")
surface("s2")
sub = Panel("B")
""",
    )
    assert messages[1] == {
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "s2",
            "components": [{
                "id": "sub",
                "component": "Panel",
                "catalogId": SECONDARY,
                "headline": "B",
            }],
        },
    }


@pytest.mark.parametrize(
    "path, value, expected_line",
    [
        ("/user", {"name": "Ada"}, '$/user = {name: "Ada"}'),
        ("/count", 5, "$/count = 5"),
        ("/", {"a": 3}, "$/a = 3"),
    ],
)
def test_update_data_model_decompiled_as_leaf_assignments(
    parser: ExpressParser, path: str, value: Any, expected_line: str
) -> None:
    messages = [{
        "version": "v1.0",
        "updateDataModel": {"surfaceId": "s1", "path": path, "value": value},
    }]
    dsl = parser.decompile(to_message_models(messages))
    assert dsl.splitlines() == ['surface("s1")', expected_line]


def test_update_surface_compiles_data_paths_into_nested_data_model() -> None:
    compiler = ExpressCompiler([_primary("v0.9")], version="v0.9")
    msgs = to_message_dicts(compiler.compile('surface("s1")\n$/a/b = 1\n$/c = "x"'))
    assert msgs == [
        {
            "version": "v0.9",
            "updateDataModel": {
                "surfaceId": "s1",
                "path": "/",
                "value": {"a": {"b": 1}, "c": "x"},
            },
        },
    ]


def test_root_update_after_create_replaces_data_model(parser: ExpressParser) -> None:
    create = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "components": [{
                "id": "root",
                "component": "Text",
                "catalogId": PRIMARY,
                "text": "x",
            }],
            "dataModel": {"a": 1, "b": 2},
        },
    }
    update = {
        "version": "v1.0",
        "updateDataModel": {"surfaceId": "s1", "path": "/", "value": {"a": 3}},
    }
    dsl = parser.decompile(to_message_models([create, update]))
    assert "$/a = 3" in dsl
    assert "$/b" not in dsl
    recompiled = _compile(parser, dsl)
    assert recompiled[0]["createSurface"]["dataModel"] == {"a": 3}

    # Once the create is closed by another message, the root update is kept
    # as an explicit update rather than folded in.
    call = {
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "call_1",
            "callFunction": {
                "catalogId": PRIMARY,
                "@call": "sharedFn",
                "args": {"firstPrimary": "p"},
            },
        },
    }
    dsl = _round_trip(parser, [create, call, update])
    assert 'surface("s1")\n$/a = 3' in dsl
    assert 'sharedFn("p", catalogId="test/primary")' in dsl


def test_create_then_delete_round_trips(parser: ExpressParser) -> None:
    messages = [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "catalogId": PRIMARY,
                    "text": "x",
                }],
            },
        },
        {"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}},
    ]
    _round_trip(parser, messages)


def test_decompile_escapes_surface_ids(parser: ExpressParser) -> None:
    messages = [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": 'a"b',
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "catalogId": PRIMARY,
                    "text": "x",
                }],
            },
        },
        {"version": "v1.0", "deleteSurface": {"surfaceId": 'a"b'}},
    ]
    dsl = _round_trip(parser, messages)
    assert 'deleteSurface("a\\"b")' in dsl


# --- Multi-statement compilation ---


def test_compile_returns_every_statement_in_order(parser: ExpressParser) -> None:
    messages = _compile(
        parser,
        """
surface("a")
root = Text("A")
sharedFn("x", "y", catalogId="test/primary")
surface("b")
root = Panel("B")
deleteSurface("c")
sharedFn("p", "q", catalogId="test/secondary")
""",
    )
    assert [next(k for k in m if k != "version") for m in messages] == [
        "createSurface",
        "callRendererFunction",
        "createSurface",
        "deleteSurface",
        "callRendererFunction",
    ]
    assert messages[1]["callRendererFunction"] == {
        "functionCallId": "call_1",
        "callFunction": {
            "catalogId": PRIMARY,
            "@call": "sharedFn",
            "args": {"firstPrimary": "x", "secondPrimary": "y"},
        },
    }
    assert "catalogId" not in messages[2]["createSurface"]
    assert messages[2]["createSurface"]["components"][0]["catalogId"] == SECONDARY
    assert messages[3]["deleteSurface"] == {"surfaceId": "c"}
    assert messages[4]["callRendererFunction"]["functionCallId"] == "call_2"
    assert messages[4]["callRendererFunction"]["callFunction"]["catalogId"] == (
        SECONDARY
    )
    assert _round_trip(parser, messages)


def test_standalone_call_resolves_by_name(parser: ExpressParser) -> None:
    messages = _compile(parser, 'surface("b")\nroot = Text("B")\nsecOnly(2)')
    call = messages[1]["callRendererFunction"]["callFunction"]
    assert call == {"catalogId": SECONDARY, "@call": "secOnly", "args": {"limit": 2}}


# --- Prompt rules ---


def test_single_catalog_prompt_rules_are_the_base_rules() -> None:
    fmt = ExpressFormat([_primary()])
    rules = fmt.prompt_generator.generate_base_rules()
    assert rules == EXPRESS_RULES
    assert "surface(" in rules
    assert "Multiple Catalogs" not in rules


def test_multi_catalog_prompt_rules_explain_catalog_selection() -> None:
    fmt = ExpressFormat([_primary(), _secondary()])
    gen = fmt.prompt_generator
    rules = gen.generate_base_rules()
    assert rules.startswith(EXPRESS_RULES)
    assert "## Multiple Catalogs" in rules
    assert f"- `{PRIMARY}`\n" in rules
    assert f"- `{SECONDARY}`\n" in rules
    assert "default" not in rules.split("## Multiple Catalogs")[1]
    assert "do not name a catalog on a `surface` line" in rules
    assert f'surface("dashboard-surface-1", "{SECONDARY}")' not in rules
    assert f'catalogId="{SECONDARY}"' in rules
    assert f'{{catalogId: "{SECONDARY}"}}' in rules
    # The names several catalogs define are listed, derived from the catalogs.
    assert f"- Function `sharedFn`: `{PRIMARY}`, `{SECONDARY}`" in rules
    assert "`secOnly`" not in rules

    prompt = gen.generate(role_description="Agent")
    assert "## Multiple Catalogs" in prompt
    instructions = gen.generate_catalog_instructions()
    assert f"# Catalog `{PRIMARY}`\n" in instructions
    assert f"# Catalog `{SECONDARY}`\n" in instructions
    assert "(default)" not in instructions
