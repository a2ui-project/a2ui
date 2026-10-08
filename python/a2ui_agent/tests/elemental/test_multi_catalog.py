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

"""Multi-catalog, update, and catalog-resolution tests for the Elemental format."""

from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, Catalog
from a2ui.inference_formats import to_message_dicts, to_message_models
from a2ui.inference_formats.experimental.elemental import (
    ElementalCompiler,
    ElementalDecompiler,
    ElementalFormat,
    ElementalParser,
)

PRI = "https://example.com/catalogs/primary"
SEC = "https://example.com/catalogs/secondary"

pytestmark = pytest.mark.filterwarnings("ignore::UserWarning")


def _fn(props: dict[str, Any]) -> dict[str, Any]:
    return {
        "returnType": "boolean",
        "properties": {"args": {"type": "object", "properties": props}},
    }


def _catalogs(version: str = "v1.0") -> tuple[Catalog, Catalog]:
    child_list = {"$ref": "common_types.json#/$defs/ChildList"}
    component_id = {"$ref": "common_types.json#/$defs/ComponentId"}
    primary = Catalog.from_json(
        {
            "catalogId": PRI,
            "components": {
                "Column": {"properties": {"children": child_list}},
                "Text": {"properties": {"text": {"type": "string"}}},
                # A leaf in the primary catalog, a container in the secondary.
                "Box": {"properties": {"label": {"type": "string"}}},
                "Widget": {
                    "allOf": [
                        {"$ref": "common_types.json#/$defs/Checkable"},
                        {
                            "properties": {
                                "primaryArg": {"type": "string"},
                                "label": {"type": "string"},
                            }
                        },
                    ]
                },
            },
            "functions": {
                "sharedFn": _fn({"firstPrimary": {"type": "string"}}),
                "openUrl": _fn({"url": {"type": "string"}}),
            },
        },
        protocol_version=version,
    )
    secondary = Catalog.from_json(
        {
            "catalogId": SEC,
            "components": {
                "Note": {
                    "allOf": [
                        {"$ref": "common_types.json#/$defs/Checkable"},
                        {"properties": {"body": {"type": "string"}}},
                    ]
                },
                "Box": {"properties": {"child": component_id}},
                "Widget": {
                    "allOf": [
                        {"$ref": "common_types.json#/$defs/Checkable"},
                        {
                            "properties": {
                                "secondaryArg": {"type": "string"},
                                "label": {"type": "string"},
                            }
                        },
                    ]
                },
            },
            "functions": {
                "sharedFn": _fn({"firstSecondary": {"type": "string"}}),
                "notify": _fn({"message": {"type": "string"}}),
            },
        },
        protocol_version=version,
    )
    return primary, secondary


@pytest.fixture
def parser() -> ElementalParser:
    return ElementalParser(list(_catalogs()), surface_id="main")


def _compile(parser: ElementalParser, body: str) -> list[dict[str, Any]]:
    part = parser.parse_response(f"<a2ui>\n{body}\n</a2ui>")[0]
    return to_message_dicts(part.a2ui)


def _components(messages: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    # v1.0 carries the components in `createSurface`; v0.9 in a following
    # `updateComponents`.
    op = next(
        body
        for m in messages
        for body in (m.get("createSurface"), m.get("updateComponents"))
        if body and "components" in body
    )
    return {c["id"]: c for c in op["components"]}


def test_hand_written_second_catalog_component(parser: ElementalParser) -> None:
    messages = _compile(
        parser,
        f"""<body id="main">
  <ui-column id="root">
    <ui-note id="n" body="from-sec" />
    <ui-widget id="w" catalog-id="{SEC}" secondary-arg="from-sec" />
    <ui-widget id="p" catalog-id="{PRI}" primary-arg="from-pri" />
  </ui-column>
</body>""",
    )
    comps = _components(messages)
    assert "catalogId" not in messages[0]["createSurface"]
    assert comps["root"] == {
        "id": "root",
        "component": "Column",
        "catalogId": PRI,
        "children": ["n", "w", "p"],
    }
    assert comps["n"] == {
        "id": "n",
        "component": "Note",
        "catalogId": SEC,
        "body": "from-sec",
    }
    # The same component name resolves against a different schema per catalog.
    assert comps["w"] == {
        "id": "w",
        "component": "Widget",
        "catalogId": SEC,
        "secondaryArg": "from-sec",
    }
    assert comps["p"] == {
        "id": "p",
        "component": "Widget",
        "catalogId": PRI,
        "primaryArg": "from-pri",
    }


def test_ambiguous_component_and_function_require_catalog_id(
    parser: ElementalParser,
) -> None:
    with pytest.raises(Exception, match="The component 'Widget' is defined in"):
        _compile(parser, '<body id="main"><ui-widget id="root" /></body>')
    with pytest.raises(Exception, match="The function 'sharedFn' is defined in"):
        _compile(
            parser,
            '<body id="main"><ui-text id="root" text="{sharedFn(firstPrimary: \'x\')}"'
            " /></body>",
        )


def test_container_tags_are_looked_up_per_catalog(parser: ElementalParser) -> None:
    # `Box` holds a child only in the secondary catalog. In the primary
    # catalog it is a leaf, so the unclosed tag ends before the next component.
    messages = _compile(
        parser,
        f"""<body id="main">
  <ui-column id="root">
    <ui-box id="leaf" catalog-id="{PRI}" label="L">
    <ui-text id="after" text="sibling" />
    <ui-box id="holder" catalog-id="{SEC}">
      <ui-text id="inside" text="child" />
    </ui-box>
  </ui-column>
</body>""",
    )
    comps = _components(messages)
    assert comps["root"]["children"] == ["leaf", "after", "holder"]
    assert comps["holder"]["child"] == "inside"


def test_unannotated_unique_call_resolves_across_catalogs(
    parser: ElementalParser,
) -> None:
    messages = _compile(
        parser,
        f"""<body id="main">
  <ui-widget id="root" catalog-id="{SEC}" label="{{openUrl(url: $/a)}}" />
</body>""",
    )
    label = _components(messages)["root"]["label"]
    # `openUrl` is uniquely defined in PRI, so it resolves without `catalogId:`
    # in markup and stamps `catalogId: PRI` on the compiled call.
    assert label == {
        "@call": "openUrl",
        "catalogId": PRI,
        "args": {"url": {"@path": "/a"}},
    }

    decompiled = parser.decompile(to_message_models(messages))
    assert "catalogId:" not in decompiled
    assert _compile(parser, decompiled) == messages


def test_unannotated_unique_check_resolves_across_catalogs(
    parser: ElementalParser,
) -> None:
    payload = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "components": [{
                "id": "root",
                "component": "Widget",
                "catalogId": SEC,
                "checks": [{
                    "condition": {
                        "@call": "openUrl",
                        "catalogId": PRI,
                        "args": {"url": "x"},
                    },
                    "message": "Bad",
                }],
            }],
        },
    }
    decompiled = parser.decompile(to_message_models(payload))
    assert "openUrl(url: 'x', message: 'Bad')" in decompiled
    assert _compile(parser, decompiled) == [payload]


def test_explicit_function_catalog_for_shared_function_round_trips(
    parser: ElementalParser,
) -> None:
    payload = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "components": [{
                "id": "root",
                "component": "Widget",
                "catalogId": SEC,
                "label": {
                    "@call": "sharedFn",
                    "catalogId": SEC,
                    "args": {"firstSecondary": "s"},
                },
            }],
        },
    }
    decompiled = parser.decompile(to_message_models(payload))
    assert f"catalogId: '{SEC}'" in decompiled
    assert _compile(parser, decompiled) == [payload]


def test_update_components_round_trip_on_non_default_surface(
    parser: ElementalParser,
) -> None:
    payload = [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "s2",
                "components": [{"id": "root", "component": "Widget", "catalogId": SEC}],
            },
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s2",
                "components": [{
                    "id": "root",
                    "component": "Widget",
                    "catalogId": SEC,
                    "secondaryArg": "z",
                }],
            },
        },
    ]
    blocks = parser.decompile_blocks(to_message_models(payload))
    assert len(blocks) == 2
    assert blocks[1].startswith('<body id="s2" update>')
    assert '<link rel="catalog"' not in blocks[1]
    assert f'catalog-id="{SEC}"' in blocks[1]

    recompiled = [m for b in blocks for m in _compile(parser, b)]
    assert recompiled == payload


def test_update_components_without_create_round_trips(
    parser: ElementalParser,
) -> None:
    payload = {
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": "main",
            "components": [
                {"id": "root", "component": "Text", "catalogId": PRI, "text": "new"}
            ],
        },
    }
    decompiled = parser.decompile(to_message_models(payload))
    assert decompiled.startswith('<body id="main" update>')
    assert "catalog-id=" not in decompiled
    assert _compile(parser, decompiled) == [payload]


@pytest.mark.parametrize(
    "op",
    [
        {"surfaceId": "main", "path": "/user/name", "value": "Ada"},
        {"surfaceId": "main", "path": "/items", "value": [1, 2]},
        {"surfaceId": "main", "path": "/", "value": {"a": 3}},
    ],
)
def test_update_data_model_round_trip_keeps_path(
    parser: ElementalParser, op: dict[str, Any]
) -> None:
    payload = {"version": "v1.0", "updateDataModel": op}
    decompiled = parser.decompile(to_message_models(payload))
    assert decompiled.startswith('<body id="main" update>')
    assert _compile(parser, decompiled) == [payload]


def test_root_data_update_after_create_replaces_data_model(
    parser: ElementalParser,
) -> None:
    payload = [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "main",
                "components": [
                    {"id": "root", "component": "Text", "catalogId": PRI, "text": "t"}
                ],
                "dataModel": {"a": 1, "b": 2},
            },
        },
        {
            "version": "v1.0",
            "updateDataModel": {"surfaceId": "main", "path": "/", "value": {"a": 3}},
        },
    ]
    blocks = parser.decompile_blocks(to_message_models(payload))
    recompiled = [m for b in blocks for m in _compile(parser, b)]
    assert recompiled[0]["createSurface"]["dataModel"] == {"a": 3}


def test_update_body_with_components_and_data(parser: ElementalParser) -> None:
    messages = _compile(
        parser,
        """<body id="main" update>
  <script type="application/json" path="/count">5</script>
  <ui-text id="root" text="{$/count}" />
</body>""",
    )
    assert messages == [
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "main",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "catalogId": PRI,
                    "text": {"@path": "/count"},
                }],
            },
        },
        {
            "version": "v1.0",
            "updateDataModel": {"surfaceId": "main", "path": "/count", "value": 5},
        },
    ]


@pytest.mark.parametrize(
    "body",
    [
        '<body id="m"><ui-text id="r" catalog-id="https://unknown" /></body>',
        (
            '<body id="m"><ui-text id="r" text="{sharedFn(catalogId:'
            " 'https://unknown')}\" /></body>"
        ),
        '<ui-call-function name="sharedFn" catalog-id="https://unknown" />',
    ],
)
def test_compile_rejects_unknown_catalog_ids(
    parser: ElementalParser, body: str
) -> None:
    with pytest.raises(Exception, match="Unknown catalogId 'https://unknown'"):
        _compile(parser, body)


def test_compile_rejects_link_catalog_when_multiple_catalogs_active(
    parser: ElementalParser,
) -> None:
    with pytest.raises(Exception, match="only a single catalog allows"):
        _compile(
            parser,
            f'<body id="m"><link rel="catalog" href="{PRI}"><ui-text id="r" /></body>',
        )


def test_compile_rejects_unknown_link_with_single_catalog() -> None:
    single = ElementalParser([_catalogs()[0]])
    with pytest.raises(Exception, match="Unknown catalogId"):
        _compile(
            single,
            '<body id="m"><link rel="catalog" href="https://a2ui.org/catalog.json">'
            '<ui-text id="r" /></body>',
        )


def test_decompile_rejects_unknown_catalog_ids(parser: ElementalParser) -> None:
    payload = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "components": [
                {"id": "root", "component": "Text", "catalogId": "https://unknown"}
            ],
        },
    }
    with pytest.raises(ValueError, match="Unknown catalogId 'https://unknown'"):
        parser.decompile(to_message_models(payload))


def test_single_catalog_link_accepted_when_matching() -> None:
    compiler = ElementalCompiler([_catalogs()[0]])
    plain = '<body id="m"><ui-box id="root" /></body>'
    linked = (
        f'<body id="m"><link rel="catalog" href="{PRI}"><ui-box id="root" /></body>'
    )
    assert (
        compiler.compile(plain)[0].model_dump(by_alias=True)["createSurface"][
            "catalogId"
        ]
        == PRI
    )
    assert (
        compiler.compile(linked)[0].model_dump(by_alias=True)["createSurface"][
            "catalogId"
        ]
        == PRI
    )


def test_call_function_catalog_and_script_args(parser: ElementalParser) -> None:
    messages = _compile(
        parser,
        f"""<ui-call-function id="c1" name="notify" catalog-id="{SEC}">
  <script type="application/json" slot="args">{{"message": "hi"}}</script>
</ui-call-function>""",
    )
    assert messages == [{
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "c1",
            "callFunction": {
                "catalogId": SEC,
                "@call": "notify",
                "args": {"message": "hi"},
            },
        },
    }]
    decompiled = parser.decompile(to_message_models(messages))
    # `notify` is uniquely defined in SEC, so decompile omits `catalog-id`.
    assert "catalog-id=" not in decompiled
    assert _compile(parser, decompiled) == messages

    # Without catalog-id, a unique function still stamps its catalogId.
    default_call = _compile(parser, '<ui-call-function name="openUrl" url="u" />')
    assert default_call[0]["callRendererFunction"]["callFunction"]["catalogId"] == PRI


def test_want_response_is_not_special(parser: ElementalParser) -> None:
    payload = {
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "c1",
            "callFunction": {
                "catalogId": PRI,
                "@call": "openUrl",
                "args": {"url": "u"},
            },
        },
    }
    assert "want-response" not in parser.decompile(to_message_models(payload))


_ODD = 'a"b&<c'


def test_attribute_values_with_quotes_round_trip(parser: ElementalParser) -> None:
    payload = [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": _ODD,
                "components": [
                    {
                        "id": _ODD,
                        "component": "Text",
                        "catalogId": PRI,
                        "text": f"say {_ODD} 'hi'",
                    },
                    {
                        "id": "t2",
                        "component": "Text",
                        "catalogId": PRI,
                        "text": {
                            "@call": "sharedFn",
                            "catalogId": PRI,
                            "args": {"firstPrimary": f"{_ODD} 'x'"},
                        },
                    },
                    {
                        "id": "root",
                        "component": "Column",
                        "catalogId": PRI,
                        "children": [_ODD, "t2"],
                    },
                ],
                "dataModel": {"k": _ODD},
            },
        },
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": _ODD,
                "components": [
                    {"id": "t2", "component": "Text", "catalogId": PRI, "text": _ODD}
                ],
            },
        },
        {
            "version": "v1.0",
            "updateDataModel": {"surfaceId": _ODD, "path": f"/{_ODD}", "value": 1},
        },
        {
            "version": "v1.0",
            "callRendererFunction": {
                "functionCallId": _ODD,
                "callFunction": {
                    "catalogId": PRI,
                    "@call": "openUrl",
                    "args": {"url": _ODD},
                },
            },
        },
        {"version": "v1.0", "deleteSurface": {"surfaceId": _ODD}},
    ]
    blocks = parser.decompile_blocks(to_message_models(payload))
    assert '<body id="a&quot;b&amp;&lt;c"' in blocks[0]
    assert all(_ODD not in block for block in blocks)
    assert [m for b in blocks for m in _compile(parser, b)] == payload


def test_catalog_ids_with_quotes_round_trip() -> None:
    odd_catalog = f"https://example.com/{_ODD}"
    primary, _ = _catalogs()
    secondary = Catalog.from_json(
        {
            "catalogId": odd_catalog,
            "components": {"Box": {"properties": {"label": {"type": "string"}}}},
            "functions": {"notify": _fn({"message": {"type": "string"}})},
        },
        protocol_version="v1.0",
    )
    parser = ElementalParser([primary, secondary])
    payload = [
        {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "s",
                "components": [{
                    "id": "root",
                    "component": "Box",
                    "catalogId": odd_catalog,
                    "label": "l",
                }],
            },
        },
        {
            "version": "v1.0",
            "callRendererFunction": {
                "functionCallId": "c",
                "callFunction": {
                    "catalogId": odd_catalog,
                    "@call": "notify",
                    "args": {"message": "m"},
                },
            },
        },
    ]
    blocks = parser.decompile_blocks(to_message_models(payload))
    assert all(odd_catalog not in block for block in blocks)
    assert [m for b in blocks for m in _compile(parser, b)] == payload


def test_entity_escaped_expression_attribute_round_trips(
    parser: ElementalParser,
) -> None:
    compiled = _compile(
        parser,
        '<body id="s"><ui-text id="root" text="{openUrl(url: '
        "'it\\&#x27;s &quot;x&quot; &amp; &lt;y&gt;')}\" /></body>",
    )
    assert _components(compiled)["root"]["text"]["args"] == {"url": 'it\'s "x" & <y>'}
    decompiled = parser.decompile(to_message_models(compiled))
    assert _compile(parser, decompiled) == compiled


@pytest.mark.parametrize("version", ["v0.9", "v0.9.1"])
def test_v0_9_message_sequence_round_trips(version: str) -> None:
    v09 = ElementalParser([_catalogs(version)[0]])
    messages = _compile(
        v09,
        '<body id="m"><script type="application/json">{"a": "x"}</script>'
        '<ui-column id="root"><ui-text id="t" text="{$/a}" /></ui-column></body>',
    )
    assert [next(k for k in m if k != "version") for m in messages] == [
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    blocks = v09.decompile_blocks(to_message_models(messages))
    recompiled = [m for b in blocks for m in _compile(v09, b)]
    assert recompiled == messages


def test_several_catalogs_before_v1_are_rejected() -> None:
    for factory in (
        ElementalFormat,
        ElementalParser,
        ElementalCompiler,
        ElementalDecompiler,
    ):
        with pytest.raises(A2uiCatalogError, match="v1.0"):
            factory(list(_catalogs("v0.9")))


def test_v0_9_catalogs_keep_plain_keys_and_reject_overrides() -> None:
    v09 = ElementalParser([_catalogs("v0.9")[0]])
    messages = _compile(
        v09,
        '<body id="m"><ui-text id="root" text="{sharedFn(firstPrimary: $/a)}"'
        " /></body>",
    )
    assert _components(messages)["root"]["text"] == {
        "call": "sharedFn",
        "args": {"firstPrimary": {"path": "/a"}},
    }
    with pytest.raises(Exception, match="requires protocol v1.0"):
        _compile(v09, f'<body id="m"><ui-widget id="root" catalog-id="{PRI}" /></body>')
    with pytest.raises(Exception, match="requires protocol v1.0"):
        _compile(
            v09,
            '<body id="m"><ui-text id="root"'
            f" text=\"{{sharedFn(firstPrimary: 'x', catalogId: '{PRI}')}}\""
            " /></body>",
        )


@pytest.mark.parametrize("version", ["v0.9", "v0.9.1"])
def test_v0_9_catalogs_emit_v0_9_message_sequence(version: str) -> None:
    compiler = ElementalCompiler([_catalogs(version)[0]])
    html = (
        '<body id="m">'
        '<script type="application/json">{"a": "x"}</script>'
        '<script type="application/json" path="/b">2</script>'
        '<ui-text id="root" text="{$/a}" />'
        "</body>"
    )
    messages = to_message_dicts(compiler.compile(html))
    assert messages == [
        {"version": version, "createSurface": {"surfaceId": "m", "catalogId": PRI}},
        {
            "version": version,
            "updateComponents": {
                "surfaceId": "m",
                "components": [
                    {"id": "root", "component": "Text", "text": {"path": "/a"}}
                ],
            },
        },
        {
            "version": version,
            "updateDataModel": {"surfaceId": "m", "path": "/", "value": {"a": "x"}},
        },
        {
            "version": version,
            "updateDataModel": {"surfaceId": "m", "path": "/b", "value": 2},
        },
    ]
    # The dicts validate as messages of that protocol version.
    assert to_message_dicts(to_message_models(messages)) == messages

    update = to_message_dicts(
        compiler.compile('<body id="m" update><ui-text id="root" text="y" /></body>')
    )
    assert update == [{
        "version": version,
        "updateComponents": {
            "surfaceId": "m",
            "components": [{"id": "root", "component": "Text", "text": "y"}],
        },
    }]
    delete = to_message_dicts(compiler.compile('<ui-delete-surface surface-id="m" />'))
    assert delete == [{"version": version, "deleteSurface": {"surfaceId": "m"}}]
    with pytest.raises(ValueError, match="requires protocol v1.0"):
        compiler.compile('<ui-call-function name="openUrl" url="https://a.b" />')


def test_v1_0_single_catalog_emits_catalog_id_on_create_surface() -> None:
    compiler = ElementalCompiler([_catalogs("v1.0")[0]])
    messages = to_message_dicts(
        compiler.compile(
            '<body id="m"><script type="application/json">{"a": "x"}</script>'
            '<ui-text id="root" text="{$/a}" /></body>'
        )
    )
    assert messages == [{
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "m",
            "catalogId": PRI,
            "components": [
                {"id": "root", "component": "Text", "text": {"@path": "/a"}}
            ],
            "dataModel": {"a": "x"},
        },
    }]


def test_v1_0_multi_catalog_omits_catalog_id_on_create_surface() -> None:
    compiler = ElementalCompiler(list(_catalogs("v1.0")))
    messages = to_message_dicts(
        compiler.compile(
            '<body id="m"><script type="application/json">{"a": "x"}</script>'
            '<ui-text id="root" text="{$/a}" /></body>'
        )
    )
    assert messages == [{
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "m",
            "components": [{
                "id": "root",
                "component": "Text",
                "catalogId": PRI,
                "text": {"@path": "/a"},
            }],
            "dataModel": {"a": "x"},
        },
    }]


def test_v0_8_catalogs_are_rejected() -> None:
    with pytest.raises(A2uiCatalogError, match="v0.8"):
        ElementalCompiler([_catalogs("v0.8")[0]])


def test_multi_catalog_prompt_rules() -> None:
    fmt = ElementalFormat(catalogs=list(_catalogs()))
    rules = fmt.prompt_generator.generate_base_rules()
    assert "[CATALOG_ID]" not in rules
    assert f"- `{PRI}`" in rules
    assert f"- `{SEC}`" in rules
    assert "(default)" not in rules
    assert 'Do not add `<link rel="catalog">` tags.' in rules
    assert 'catalog-id="' in rules
    assert "catalogId: '" in rules
    assert '<body id="id" update>' in rules

    instructions = fmt.prompt_generator.generate_catalog_instructions()
    assert instructions.count("type DataBinding") == 1
    assert f"## Catalog `{PRI}`\n" in instructions
    assert f"## Catalog `{SEC}`" in instructions

    prompt = fmt.prompt_generator.generate("Role", include_schema=True)
    assert "[CATALOG_ID]" not in prompt


def test_single_catalog_prompt_rules() -> None:
    fmt = ElementalFormat(catalogs=[_catalogs()[0]])
    rules = fmt.prompt_generator.generate_base_rules()
    assert "[CATALOG_ID]" not in rules
    assert f"the catalog `{PRI}`" in rules
    assert "## Catalogs" not in rules


def test_v0_9_prompt_rules_forbid_overrides() -> None:
    fmt = ElementalFormat(catalogs=[_catalogs("v0.9")[0]])
    rules = fmt.prompt_generator.generate_base_rules()
    assert "Do not add" in rules
    assert "catalog-id" in rules
    # v0.9 has no callRendererFunction, so the prompt does not offer it.
    assert "<ui-call-function" not in rules
    v1_rules = ElementalFormat(catalogs=list(_catalogs())).prompt_generator
    assert "<ui-call-function" in v1_rules.generate_base_rules()


def test_undeclared_function_call_and_check_with_single_catalog_round_trips() -> None:
    single = ElementalParser([_catalogs()[0]])
    messages = _compile(
        single,
        '<body id="main">'
        '<ui-widget id="root" label="{undeclaredFn(foo: \'bar\')}"'
        " checks=\"{[undeclaredCheck(x: 1, message: 'Bad')]}\" />"
        "</body>",
    )
    comp = _components(messages)["root"]
    assert comp["label"] == {"@call": "undeclaredFn", "args": {"foo": "bar"}}
    assert comp["checks"] == [{
        "condition": {"@call": "undeclaredCheck", "args": {"x": 1}},
        "message": "Bad",
    }]
    decompiled = single.decompile(to_message_models(messages))
    assert _compile(single, decompiled) == messages


def test_multi_catalog_prompt_generator_guards_empty_components() -> None:
    fn_catalog = Catalog.from_json(
        {
            "catalogId": "https://example.com/functions-only",
            "functions": {"myFunc": _fn({"val": {"type": "string"}})},
        },
        protocol_version="v1.0",
    )
    pri_cat = _catalogs()[0]
    fmt = ElementalFormat(catalogs=[pri_cat, fn_catalog])
    instructions = fmt.prompt_generator.generate_catalog_instructions()
    assert "## Catalog `https://example.com/functions-only`" in instructions
    # Should not contain empty typescript code block
    assert "```typescript\n\n```" not in instructions
    assert "Helper functions of this catalog" in instructions


def test_catalog_description_reuses_cached_helper() -> None:
    pri_cat, sec_cat = _catalogs()
    fmt = ElementalFormat(catalogs=[pri_cat, sec_cat])
    gen = fmt.prompt_generator
    # Call with catalog in helpers
    h = gen.helpers.get(getattr(pri_cat, "catalog_id", None)) or CatalogSchemaHelper(
        pri_cat
    )
    assert h is gen.helpers[PRI]
    output = gen.generate_catalog_instructions(catalog=pri_cat)
    assert "interface Column" in output


def test_catalog_instructions_replaces_indented_json_with_re_sub() -> None:
    pri_cat = _catalogs()[0]
    fmt = ElementalFormat(catalogs=[pri_cat])
    gen = fmt.prompt_generator
    helper = gen.helpers[PRI]

    helper.catalog["instructions"] = (
        'Here is an example:\n   ```json\n   [{"version": "v1.0", "createSurface":'
        ' {"surfaceId": "main", "components": [{"id": "t1", "component": "Text",'
        ' "text": "hello"}]}}]\n   ```\nEnd of example.'
    )
    result = gen._catalog_instructions(helper)
    assert "```html" in result
    assert "<ui-text" in result
    assert "```json" not in result
