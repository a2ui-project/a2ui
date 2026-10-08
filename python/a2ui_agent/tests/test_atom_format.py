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

"""Tests for the Atom S-expression inference format."""

from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts, to_message_models
from a2ui.inference_formats.experimental.atom import (
    AtomCompiler,
    AtomDecompiler,
    AtomFormat,
)
from a2ui.parser import A2uiCompilationError

PRI = "https://a2ui.org/test/primary"
SEC = "https://a2ui.org/test/secondary"

_CHILD_LIST = {"$ref": "common_types.json#/$defs/ChildList"}
_CHILD = {"$ref": "common_types.json#/$defs/ComponentId"}
_DYN_STRING = {"$ref": "common_types.json#/$defs/DynamicString"}
_ACTION = {"$ref": "common_types.json#/$defs/Action"}


def _component(name: str, props: dict[str, Any], required: list[str] | None = None):
    return {
        "type": "object",
        "properties": {"component": {"const": name}, **props},
        "required": ["component", *(required or [])],
    }


def _function(args: dict[str, Any], required: list[str] | None = None):
    return {
        "returnType": "boolean",
        "properties": {
            "args": {
                "type": "object",
                "properties": args,
                "required": required or [],
            }
        },
    }


def _primary(version: str = "v1.0") -> CatalogApi:
    return Catalog.from_json(
        {
            "catalogId": PRI,
            "components": {
                "Box": _component("Box", {"children": _CHILD_LIST}),
                "Label": _component("Label", {"text": _DYN_STRING}, ["text"]),
                "Press": _component(
                    "Press", {"child": _CHILD, "action": _ACTION}, ["child"]
                ),
            },
            "functions": {
                "check": _function({"value": {"type": "string"}}, ["value"]),
            },
        },
        protocol_version=version,
    )


def _secondary(version: str = "v1.0") -> CatalogApi:
    return Catalog.from_json(
        {
            "catalogId": SEC,
            "components": {
                "Stack": _component("Stack", {"items": _CHILD_LIST}),
                "Deck": _component("Deck", {"cards": _CHILD_LIST}),
                "Note": _component("Note", {"body": _DYN_STRING}, ["body"]),
                "Pager": _component(
                    "Pager",
                    {
                        "pages": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string"},
                                    "child": _CHILD,
                                },
                                "required": ["title", "child"],
                            },
                        }
                    },
                ),
            },
            "functions": {
                "secOnly": _function({"limit": {"type": "number"}}, ["limit"]),
            },
        },
        protocol_version=version,
    )


@pytest.fixture(name="basic")
def fixture_basic() -> CatalogApi:
    return BasicCatalog("1.0")


@pytest.fixture(name="compiler")
def fixture_compiler(basic: CatalogApi) -> AtomCompiler:
    return AtomCompiler([basic])


@pytest.fixture(name="decompiler")
def fixture_decompiler(basic: CatalogApi) -> AtomDecompiler:
    return AtomDecompiler([basic])


def _compile(compiler: AtomCompiler, text: str) -> list[dict[str, Any]]:
    return to_message_dicts(compiler.compile(text))


def _compile_one(compiler: AtomCompiler, text: str) -> dict[str, Any]:
    messages = _compile(compiler, text)
    assert len(messages) == 1
    return messages[0]


def _components(message: dict[str, Any]) -> dict[str, dict[str, Any]]:
    body = message.get("createSurface") or message["updateComponents"]
    return {c["id"]: c for c in body["components"]}


def _by_id(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Returns the messages with component lists keyed by id, for comparison."""
    result = []
    for message in messages:
        message = dict(message)
        for key in ("createSurface", "updateComponents"):
            if key in message and "components" in message[key]:
                body = dict(message[key])
                body["components"] = {c["id"]: c for c in body["components"]}
                message[key] = body
        result.append(message)
    return result


def _round_trip(
    compiler: AtomCompiler, decompiler: AtomDecompiler, messages: list[dict[str, Any]]
) -> str:
    """Decompiles messages, recompiles the text, and checks nothing changed."""
    text = decompiler.decompile(to_message_models(messages))
    assert _by_id(_compile(compiler, text)) == _by_id(messages)
    return text


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def test_compiler_requires_a_catalog() -> None:
    with pytest.raises(A2uiCatalogError):
        AtomCompiler([])


def test_duplicate_catalog_ids_raise() -> None:
    with pytest.raises(A2uiCatalogError):
        AtomCompiler([_primary(), _primary()])
    with pytest.raises(A2uiCatalogError):
        AtomFormat([_primary(), _primary()])


def test_format_without_catalog_is_an_error() -> None:
    with pytest.raises(A2uiCatalogError, match="At least one catalog"):
        AtomFormat([])


# ---------------------------------------------------------------------------
# Compiling components
# ---------------------------------------------------------------------------


def test_compile_notification_card(compiler: AtomCompiler) -> None:
    text = """(data $/icon "check" $/title "Enable notification")
(Card
  (Column :align "center"
    (Icon $/icon)
    (Text $/title)
    (Row :justify "center"
      (Button :action (Event "accept") (Text "Yes")))))"""
    message = _compile_one(compiler, text)
    surface = message["createSurface"]
    assert surface["dataModel"] == {"icon": "check", "title": "Enable notification"}
    comps = _components(message)
    assert comps["root"]["component"] == "Card"
    column = comps[comps["root"]["child"]]
    assert column["component"] == "Column"
    assert column["align"] == "center"
    icon, title, row = (comps[cid] for cid in column["children"])
    assert icon["name"] == {"@path": "/icon"}
    assert title["text"] == {"@path": "/title"}
    button = comps[row["children"][0]]
    assert button["action"] == {"event": {"name": "accept"}}
    assert comps[button["child"]] == {
        "id": button["child"],
        "component": "Text",
        "text": "Yes",
    }


def test_compile_auto_heals_missing_parens(compiler: AtomCompiler) -> None:
    comps = _components(_compile_one(compiler, '(Card (Column (Text "Hello World"'))
    assert [c["component"] for c in comps.values()].count("Text") == 1
    assert comps["root"]["component"] == "Card"


def test_compile_empty_text_raises(compiler: AtomCompiler) -> None:
    with pytest.raises(ValueError):
        compiler.compile("")


def test_unknown_component_raises(compiler: AtomCompiler) -> None:
    with pytest.raises(ValueError, match="Unknown component type 'Mystery'"):
        compiler.compile('(Mystery (Text "Label"))')


def test_unknown_component_hints_at_other_catalog() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    with pytest.raises(ValueError, match=f':catalogId "{SEC}"'):
        compiler.compile(f'(Box (Note :catalogId "{PRI}" "x"))')


def test_component_unknown_in_every_catalog_raises() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    with pytest.raises(ValueError, match="not defined in any catalog"):
        compiler.compile('(Box (Mystery "x"))')


def test_compile_primitives_and_bindings(compiler: AtomCompiler) -> None:
    comps = _components(
        _compile_one(
            compiler,
            '(Column (Text $/user/name) (Text (@path "relative/x")) (Slider :value'
            " $/v :min 0 :max 2.5))",
        )
    )
    first, second, slider = (comps[cid] for cid in comps["root"]["children"])
    assert first["text"] == {"@path": "/user/name"}
    assert second["text"] == {"@path": "relative/x"}
    assert slider["min"] == 0
    assert slider["max"] == 2.5


def test_compile_function_call(compiler: AtomCompiler) -> None:
    comps = _components(
        _compile_one(compiler, '(Text :text (formatString "Hello ${/name}"))')
    )
    assert comps["root"]["text"] == {
        "@call": "formatString",
        "args": {"value": "Hello ${/name}"},
    }


def test_compile_event_context(compiler: AtomCompiler) -> None:
    comps = _components(
        _compile_one(
            compiler,
            '(Button :action (Event "submit" :user $/name :age 30) (Text "Go"))',
        )
    )
    assert comps["root"]["action"] == {
        "event": {
            "name": "submit",
            "context": {"user": {"@path": "/name"}, "age": 30},
        }
    }


def test_tagged_children_list_and_id_references(compiler: AtomCompiler) -> None:
    comps = _components(
        _compile_one(compiler, '(Column :children [(Text "A") "existing_id"])')
    )
    children = comps["root"]["children"]
    assert comps[children[0]]["text"] == "A"
    assert children[1] == "existing_id"


def test_invalid_enum_falls_back_to_schema_default(compiler: AtomCompiler) -> None:
    comps = _components(
        _compile_one(
            compiler,
            '(ChoicePicker :value $/sel :options ["A" "B"] :variant "checkboxes")',
        )
    )
    picker = comps["root"]
    assert picker["variant"] == "mutuallyExclusive"
    assert picker["options"] == [
        {"label": "A", "value": "A"},
        {"label": "B", "value": "B"},
    ]


def test_list_template_and_tabs_round_trip(
    compiler: AtomCompiler, decompiler: AtomDecompiler
) -> None:
    text = (
        "(Column (List :children (template :items $/users (Card (Text"
        ' $/item/name)))) (Tabs :tabs [(item :title "A" :child (Text "a"))]))'
    )
    message = _compile_one(compiler, text)
    comps = _components(message)
    lst, tabs = (comps[cid] for cid in comps["root"]["children"])
    assert lst["children"]["path"] == "/users"
    card = comps[lst["children"]["componentId"]]
    assert comps[card["child"]]["text"] == {"@path": "item/name"}
    assert tabs["tabs"][0]["title"] == "A"
    assert comps[tabs["tabs"][0]["child"]]["text"] == "a"
    _round_trip(compiler, decompiler, [message])


def test_template_item_variable_only_rewrites_template_subtree(
    compiler: AtomCompiler,
) -> None:
    text = (
        "(Column (Text $/row/title) (List :children (template :items $/rows :item"
        " row (Text $/row/title))))"
    )
    comps = _components(_compile_one(compiler, text))
    outside, lst = (comps[cid] for cid in comps["root"]["children"])
    assert outside["text"] == {"@path": "/row/title"}
    inside = comps[lst["children"]["componentId"]]
    assert inside["text"] == {"@path": "item/title"}


# ---------------------------------------------------------------------------
# Ids
# ---------------------------------------------------------------------------


def test_duplicate_explicit_id_raises(compiler: AtomCompiler) -> None:
    with pytest.raises(ValueError, match="dup"):
        compiler.compile('(Column (Text :id "dup" "a") (Text :id "dup" "b"))')


def test_generated_ids_skip_explicit_ids(compiler: AtomCompiler) -> None:
    comps = _components(
        _compile_one(compiler, '(Column (Text "generated") (Text :id "node_0" "x"))')
    )
    first, second = comps["root"]["children"]
    assert second == "node_0"
    assert first != "node_0"
    assert comps["node_0"]["text"] == "x"


def test_ids_restart_for_each_compile(compiler: AtomCompiler) -> None:
    first = _compile_one(compiler, '(Column (Text "a"))')
    second = _compile_one(compiler, '(Column (Text "a"))')
    assert first == second


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def test_data_only_input_is_a_root_data_update(compiler: AtomCompiler) -> None:
    message = _compile_one(compiler, '(data $/rating [] $/likes [] $/comments "")')
    assert message["updateDataModel"] == {
        "surfaceId": "main",
        "value": {"rating": [], "likes": [], "comments": ""},
    }


def test_explicit_surface_without_components_still_creates_it(
    compiler: AtomCompiler,
) -> None:
    message = _compile_one(compiler, '(surface "s1") (data $/a 1)')
    assert message["createSurface"]["surfaceId"] == "s1"
    assert message["createSurface"]["dataModel"] == {"a": 1}


def test_delete_surface(compiler: AtomCompiler, decompiler: AtomDecompiler) -> None:
    message = _compile_one(compiler, '(deleteSurface "dashboard-1")')
    assert message == {
        "version": "v1.0",
        "deleteSurface": {"surfaceId": "dashboard-1"},
    }
    assert (
        _round_trip(compiler, decompiler, [message]) == '(deleteSurface "dashboard-1")'
    )


def test_call_function_ids_are_unique_and_round_trip(
    compiler: AtomCompiler, decompiler: AtomDecompiler, basic: CatalogApi
) -> None:
    messages = _compile(
        compiler,
        '(callFunction "openUrl" :url "https://a.example")\n'
        '(callFunction "openUrl" :url "https://b.example")',
    )
    assert [m["callRendererFunction"]["functionCallId"] for m in messages] == [
        "call_1",
        "call_2",
    ]
    assert messages[0]["callRendererFunction"]["callFunction"] == {
        "@call": "openUrl",
        "catalogId": basic.catalog_id,
        "args": {"url": "https://a.example"},
    }
    text = _round_trip(compiler, decompiler, messages)
    assert ':functionCallId "call_1"' in text


def test_explicit_function_call_id_is_kept(compiler: AtomCompiler) -> None:
    messages = _compile(
        compiler,
        '(callFunction "openUrl" :url "u")\n'
        '(callFunction "openUrl" :functionCallId "call_1" :url "v")',
    )
    ids = [m["callRendererFunction"]["functionCallId"] for m in messages]
    assert ids[1] == "call_1"
    assert ids[0] != "call_1"


def test_update_data_model_with_path(
    compiler: AtomCompiler, decompiler: AtomDecompiler
) -> None:
    messages = _compile(
        compiler,
        '(updateDataModel "main" :path "/a/b" :value 5)\n'
        '(updateDataModel "main" :value "scalar")\n'
        '(updateDataModel "main" :path "/gone" :value null)',
    )
    assert [m["updateDataModel"] for m in messages] == [
        {"surfaceId": "main", "path": "/a/b", "value": 5},
        {"surfaceId": "main", "value": "scalar"},
        {"surfaceId": "main", "path": "/gone", "value": None},
    ]
    _round_trip(compiler, decompiler, messages)


def test_update_components_marker_round_trip(
    compiler: AtomCompiler, decompiler: AtomDecompiler
) -> None:
    message = _compile_one(compiler, '(updateComponents "main")\n(Text :id "t1" "new")')
    assert message["updateComponents"] == {
        "surfaceId": "main",
        "components": [{"id": "t1", "component": "Text", "text": "new"}],
    }
    text = _round_trip(compiler, decompiler, [message])
    assert text.startswith('(updateComponents "main")')


def test_multi_message_round_trip_in_source_order() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    decompiler = AtomDecompiler([_primary(), _secondary()])
    text = (
        '(surface "a")\n(Box (Label "hi"))\n'
        '(surface "b")\n(Stack (Note "there"))\n'
        '(deleteSurface "c")'
    )
    messages = _compile(compiler, text)
    assert [next(k for k in m if k != "version") for m in messages] == [
        "createSurface",
        "createSurface",
        "deleteSurface",
    ]
    # With several catalogs a surface has no default catalog, so every
    # component names the only catalog that defines it.
    assert "catalogId" not in messages[0]["createSurface"]
    assert "catalogId" not in messages[1]["createSurface"]
    assert {c["catalogId"] for c in _components(messages[0]).values()} == {PRI}
    assert {c["catalogId"] for c in _components(messages[1]).values()} == {SEC}
    assert _components(messages[1])["root"]["component"] == "Stack"
    decompiled = _round_trip(compiler, decompiler, messages)
    assert ":catalogId" not in decompiled


def test_secondary_catalog_templates_and_object_lists() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    decompiler = AtomDecompiler([_primary(), _secondary()])
    text = (
        '(surface "s2")\n'
        "(Stack (Deck :cards (template :items $/notes (Note $/item/body)))"
        ' (Pager :pages [(item :title "P1" :child (Note "x"))]))'
    )
    message = _compile_one(compiler, text)
    comps = _components(message)
    deck, pager = (comps[cid] for cid in comps["root"]["items"])
    assert deck["cards"]["path"] == "/notes"
    assert comps[deck["cards"]["componentId"]]["body"] == {"@path": "item/body"}
    assert pager["pages"][0]["title"] == "P1"
    assert comps[pager["pages"][0]["child"]]["body"] == "x"
    assert all(c["catalogId"] == SEC for c in comps.values())
    _round_trip(compiler, decompiler, [message])


def test_escaping_round_trip(
    compiler: AtomCompiler, decompiler: AtomDecompiler
) -> None:
    message = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": compiler.catalogs[0].catalog_id,
            "components": [
                {"id": "root", "component": "Column", "children": ["q", "k"]},
                {"id": "q", "component": "Text", "text": 'say "hi"\n\\ok'},
                {"id": "k", "component": "Text", "text": ":id"},
            ],
            "dataModel": {
                "list": [1, "two", {"three": 3}],
                "nested": {"a b": "spaced key", "c": [True, None]},
            },
        },
    }
    _round_trip(compiler, decompiler, [message])


_ZIP_CHECK = {
    "condition": {
        "@call": "regex",
        "args": {"pattern": "^[0-9]{5}$", "value": {"@path": "/zip"}},
    },
    "message": "Bad zip",
}


@pytest.mark.parametrize(
    "checks",
    [
        '(regex "^[0-9]{5}$" "Bad zip")',
        '[(regex "^[0-9]{5}$" "Bad zip")]',
        '(regex :pattern "^[0-9]{5}$" :message "Bad zip")',
        '(regex :value $/zip :pattern "^[0-9]{5}$" :message "Bad zip")',
        '(regex $/zip "^[0-9]{5}$" "Bad zip")',
        '(regex :value $/zip "^[0-9]{5}$" "Bad zip")',
    ],
)
def test_check_positional_args_skip_implicit_value(
    compiler: AtomCompiler, checks: str
) -> None:
    message = _compile_one(
        compiler, f'(TextField :label "Zip" :value $/zip :checks {checks})'
    )
    field = _components(message)["root"]
    checks_out = field["checks"]
    for check in checks_out:
        check["condition"]["args"] = dict(sorted(check["condition"]["args"].items()))
    assert checks_out == [_ZIP_CHECK]


def test_check_implicit_value_does_not_depend_on_property_order(
    compiler: AtomCompiler,
) -> None:
    message = _compile_one(
        compiler,
        '(TextField :checks (regex "^[0-9]{5}$" "Bad zip") :label "Zip" :value $/zip)',
    )
    rule = _components(message)["root"]["checks"][0]
    assert rule["message"] == "Bad zip"
    assert rule["condition"]["args"] == {
        "pattern": "^[0-9]{5}$",
        "value": {"@path": "/zip"},
    }


def test_check_without_component_value_maps_positionally(
    compiler: AtomCompiler,
) -> None:
    # Without a component value nothing is bound implicitly, so the first
    # positional argument fills `value`, as for any function call.
    message = _compile_one(
        compiler, '(TextField :label "x" :checks (regex $/other "^a$" "Must be a"))'
    )
    rule = _components(message)["root"]["checks"][0]
    assert rule == {
        "condition": {
            "@call": "regex",
            "args": {"value": {"@path": "/other"}, "pattern": "^a$"},
        },
        "message": "Must be a",
    }


def test_check_rule_object_form_is_kept(compiler: AtomCompiler) -> None:
    message = _compile_one(
        compiler,
        '(TextField :label "Zip" :value $/zip'
        ' :checks (:condition (required) :message "Needed"))',
    )
    assert _components(message)["root"]["checks"] == [{
        "condition": {"@call": "required", "args": {"value": {"@path": "/zip"}}},
        "message": "Needed",
    }]


def test_checks_round_trip(compiler: AtomCompiler, decompiler: AtomDecompiler) -> None:
    message = _compile_one(
        compiler,
        '(TextField :label "Zip" :value $/zip'
        ' :checks [(required) (regex "^[0-9]{5}$" "Bad zip")])',
    )
    text = _round_trip(compiler, decompiler, [message])
    assert ':pattern "^[0-9]{5}$"' in text
    assert ':message "Bad zip"' in text


def test_raw_json_input_is_accepted(compiler: AtomCompiler) -> None:
    message = _compile_one(
        compiler,
        '<a2ui-json>{"version": "v1.0", "deleteSurface": {"surfaceId": "j"}}'
        "</a2ui-json>",
    )
    assert message["deleteSurface"]["surfaceId"] == "j"


# ---------------------------------------------------------------------------
# Multiple catalogs
# ---------------------------------------------------------------------------


TER = "https://a2ui.org/test/tertiary"


def _tertiary() -> CatalogApi:
    """A catalog that redefines `Label` and `check` from the primary catalog."""
    return Catalog.from_json(
        {
            "catalogId": TER,
            "components": {
                "Label": _component(
                    "Label", {"text": _DYN_STRING, "tone": {"type": "string"}}
                ),
            },
            "functions": {
                "check": _function({"pattern": {"type": "string"}}, ["pattern"]),
            },
        },
        protocol_version="v1.0",
    )


def _with_component_catalogs(
    messages: list[dict[str, Any]], decompiler_catalog: str | None = None
) -> list[dict[str, Any]]:
    """Rewrites messages to the form the compiler emits with several catalogs.

    `createSurface` loses its `catalogId`, and each component without one gets
    the surface's catalog (or `decompiler_catalog`) instead.
    """
    result = []
    for message in messages:
        message = dict(message)
        body = message.get("createSurface")
        if isinstance(body, dict):
            body = dict(body)
            surface_cat = body.pop("catalogId", decompiler_catalog)
            body["components"] = [
                {"catalogId": surface_cat, **c} if "catalogId" not in c else c
                for c in body.get("components", [])
            ]
            message["createSurface"] = body
        result.append(message)
    return result


def test_names_resolve_by_unique_lookup_across_catalogs() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    text = '(Box (Note :body (check "v")) (Note :body (secOnly 3)))'
    message = _compile_one(compiler, text)
    assert "catalogId" not in message["createSurface"]
    comps = _components(message)
    assert comps["root"]["catalogId"] == PRI
    first, second = (comps[cid] for cid in comps["root"]["children"])
    assert first["catalogId"] == SEC
    assert first["body"] == {"@call": "check", "catalogId": PRI, "args": {"value": "v"}}
    assert second["body"] == {
        "@call": "secOnly",
        "catalogId": SEC,
        "args": {"limit": 3},
    }


def test_ambiguous_component_name_needs_catalog_id() -> None:
    compiler = AtomCompiler([_primary(), _tertiary()])
    with pytest.raises(ValueError, match="defined in several catalogs") as err:
        compiler.compile('(Box (Label "x"))')
    assert PRI in str(err.value) and TER in str(err.value)
    comps = _components(
        _compile_one(compiler, f'(Box (Label :catalogId "{TER}" :tone "warm" "x"))')
    )
    label = comps[comps["root"]["children"][0]]
    assert label == {
        "id": label["id"],
        "component": "Label",
        "catalogId": TER,
        "text": "x",
        "tone": "warm",
    }


def test_ambiguous_function_name_needs_catalog_id() -> None:
    compiler = AtomCompiler([_primary(), _tertiary()])
    with pytest.raises(ValueError, match="function 'check' is defined in several"):
        compiler.compile(f'(Label :catalogId "{PRI}" :text (check "v"))')
    comps = _components(
        _compile_one(
            compiler,
            f'(Label :catalogId "{PRI}" :text (check :catalogId "{TER}" "^a$"))',
        )
    )
    assert comps["root"]["text"] == {
        "@call": "check",
        "catalogId": TER,
        "args": {"pattern": "^a$"},
    }


def test_header_catalog_rejected_with_several_catalogs() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    with pytest.raises(ValueError, match="single catalog"):
        compiler.compile(f'(surface "s" :catalogId "{PRI}")\n(Box)')
    with pytest.raises(ValueError, match="single catalog"):
        compiler.compile(f'(surface "s" "{PRI}")\n(Box)')
    with pytest.raises(ValueError, match="single catalog"):
        compiler.compile(
            f'(updateComponents "s" :catalogId "{SEC}")\n(Note :id "n" "x")'
        )


def test_header_catalog_allowed_with_a_single_catalog() -> None:
    compiler = AtomCompiler([_primary()])
    message = _compile_one(compiler, f'(surface "s" :catalogId "{PRI}")\n(Box)')
    assert message["createSurface"]["catalogId"] == PRI
    assert "catalogId" not in _components(message)["root"]
    with pytest.raises(ValueError, match="Unknown catalogId"):
        compiler.compile(f'(surface "s" :catalogId "{SEC}")\n(Box)')


def test_update_components_carry_catalog_ids_with_several_catalogs() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    message = _compile_one(
        compiler, '(updateComponents "s")\n(Note :id "n" "x")\n(Label :id "l" "y")'
    )
    assert {c["id"]: c["catalogId"] for c in _components(message).values()} == {
        "n": SEC,
        "l": PRI,
    }


def test_bare_string_child_wraps_in_parent_catalog() -> None:
    compiler = AtomCompiler([_primary(), _tertiary()])
    comps = _components(_compile_one(compiler, '(Box "hello")'))
    child = comps[comps["root"]["children"][0]]
    assert child == {
        "id": child["id"],
        "component": "Label",
        "catalogId": PRI,
        "text": "hello",
    }


def test_standalone_call_resolves_by_name_with_several_catalogs() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    message = _compile_one(compiler, "(callFunction secOnly :limit 2)")
    assert message["callRendererFunction"]["callFunction"] == {
        "catalogId": SEC,
        "@call": "secOnly",
        "args": {"limit": 2},
    }
    ambiguous = AtomCompiler([_primary(), _tertiary()])
    with pytest.raises(ValueError, match="defined in several catalogs"):
        ambiguous.compile('(callFunction check :value "v")')


def test_decompile_several_catalogs_names_only_ambiguous_catalogs() -> None:
    catalogs = [_primary(), _tertiary()]
    compiler, decompiler = AtomCompiler(catalogs), AtomDecompiler(catalogs)
    # Input with a createSurface catalog, as examples or history may have.
    messages = [{
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": PRI,
            "components": [
                {"id": "root", "component": "Box", "children": ["a", "b"]},
                {"id": "a", "component": "Label", "text": {"@call": "check"}},
                {"id": "b", "component": "Label", "catalogId": TER, "text": "t"},
            ],
            "dataModel": {},
        },
    }]
    text = decompiler.decompile(to_message_models(messages))
    assert text.startswith('(surface "main")')
    assert f'(Label :id "a" :catalogId "{PRI}"' in text
    assert f'(check :catalogId "{PRI}")' in text
    assert f'(Label :id "b" :catalogId "{TER}"' in text
    assert "(Box :catalogId" not in text
    recompiled = _compile(compiler, text)
    expected = _with_component_catalogs(messages)
    expected[0]["createSurface"]["components"][1]["text"] = {
        "@call": "check",
        "catalogId": PRI,
        "args": {},
    }
    assert _by_id(recompiled) == _by_id(expected)


def test_several_catalogs_require_v1() -> None:
    from a2ui.inference_formats.experimental.atom import AtomParser

    catalogs = [_primary("v0.9"), _secondary("v0.9")]
    for factory in (AtomCompiler, AtomDecompiler, AtomFormat, AtomParser):
        with pytest.raises(A2uiCatalogError, match="v1.0"):
            factory(catalogs)


def test_explicit_unknown_catalog_raises() -> None:
    compiler = AtomCompiler([_primary(), _secondary()])
    with pytest.raises((ValueError, A2uiCatalogError)):
        compiler.compile('(Box :catalogId "https://nowhere" (Label "x"))')


# ---------------------------------------------------------------------------
# v0.9 catalogs
# ---------------------------------------------------------------------------


def test_v09_catalog_splits_create_and_update() -> None:
    compiler = AtomCompiler([_primary("v0.9")])
    messages = _compile(compiler, '(data $/t "x") (Box (Label $/t))')
    assert [next(k for k in m if k != "version") for m in messages] == [
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    assert all(m["version"] == "v0.9" for m in messages)
    comps = _components(messages[1])
    assert comps[comps["root"]["children"][0]]["text"] == {"path": "/t"}
    assert messages[2]["updateDataModel"]["value"] == {"t": "x"}


def test_v09_rejects_per_component_catalog() -> None:
    compiler = AtomCompiler([_primary("v0.9")])
    with pytest.raises(ValueError, match="requires protocol v1.0"):
        compiler.compile(f'(Box (Label :catalogId "{PRI}" "x"))')


# ---------------------------------------------------------------------------
# Format, parser and prompt generator
# ---------------------------------------------------------------------------


def test_format_and_parser_integration(basic: CatalogApi) -> None:
    parser = AtomFormat([basic], surface_id="main").parser
    raw = '<a2ui>(Card (Text "Hello"))</a2ui>'
    assert parser.has_format_content(raw, complete=True)
    assert not parser.has_format_content("no tags", complete=True)
    assert len(parser.unwrap(raw)) == 1
    compiled = to_message_dicts(parser.compile('(Card (Text "Hello"))'))
    assert len(compiled) == 1
    assert "createSurface" in compiled[0]
    wrapped = parser.wrap_decompiled_blocks(['(Card (Text "Hello"))'])
    assert wrapped.startswith("<a2ui>")
    assert wrapped.endswith("</a2ui>")


def test_parser_wraps_errors(basic: CatalogApi) -> None:
    with pytest.raises(A2uiCompilationError):
        AtomFormat([basic]).parser.compile(12345)  # type: ignore[arg-type]


def test_prompt_generator_single_catalog(basic: CatalogApi) -> None:
    prompt = AtomFormat([basic]).prompt_generator.generate(
        role_description="You are a helpful UI generator.",
        workflow_description="Follow standard A2UI guidelines.",
    )
    assert "You are a helpful UI generator." in prompt
    assert "Follow standard A2UI guidelines." in prompt
    assert "A2UI Atom S-Expression notation" in prompt
    assert "Component Catalog Signatures" in prompt
    assert "- (Card" in prompt
    assert "- (formatString :value" in prompt
    assert "Multiple Catalogs" not in prompt


def test_prompt_generator_multi_catalog_rules() -> None:
    generator = AtomFormat([_primary(), _secondary()]).prompt_generator
    rules = generator.generate_base_rules()
    assert "Multiple Catalogs" in rules
    assert f"`{PRI}`" in rules
    assert f"`{SEC}`" in rules
    assert ':catalogId "catalog_id"' in rules
    instructions = generator.generate_catalog_instructions()
    assert f"## Catalog `{PRI}`\n" in instructions
    assert f"## Catalog `{SEC}`" in instructions
    assert "- (secOnly :limit)" in instructions


def test_catalogs_property_returns_a_copy() -> None:
    fmt = AtomFormat([_primary()])
    fmt.catalogs.append(_secondary())
    fmt.prompt_generator.catalogs.append(_secondary())
    assert [c.catalog_id for c in fmt.catalogs] == [PRI]


def test_prompt_examples_are_decompiled(tmp_path, basic: CatalogApi) -> None:
    (tmp_path / "example.json").write_text(
        '[{"version": "v1.0", "createSurface": {"surfaceId": "main", "catalogId":'
        f' "{basic.catalog_id}", "components": [{{"id": "root", "component":'
        ' "Text", "text": "Hi"}]}}]'
    )
    generator = AtomFormat([basic], examples_path=str(tmp_path)).prompt_generator
    examples = generator.generate_examples()
    assert '(Text :text "Hi")' in examples
    assert "<a2ui>" in examples
