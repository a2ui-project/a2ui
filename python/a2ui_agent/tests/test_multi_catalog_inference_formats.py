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

"""Unit tests for multi-catalog and per-component/per-function catalogId overrides across Express, Elemental, and Atom formats."""

import pytest

from a2ui.core import Catalog
from a2ui.inference_formats.experimental.atom import AtomFormat
from a2ui.inference_formats.experimental.elemental import ElementalFormat
from a2ui.inference_formats.experimental.express import ExpressFormat
from a2ui.inference_formats import (
    to_message_models,
)


@pytest.fixture
def primary_catalog() -> Catalog:
    return Catalog.from_json(
        {
            "catalogId": "https://a2ui.org/catalogs/primary",
            "components": {
                "Column": {
                    "properties": {
                        "children": {
                            "type": "array",
                            "items": {"type": "string"},
                        }
                    }
                },
                "Text": {
                    "properties": {
                        "text": {"type": "string"},
                    }
                },
                "SharedWidget": {
                    "allOf": [
                        {"$ref": "common_types.json#/$defs/Checkable"},
                        {
                            "properties": {
                                "primaryArg": {"type": "string"},
                                "action": {"type": "object"},
                            }
                        },
                    ]
                },
            },
            "functions": {
                "primaryCheck": {
                    "returnType": "boolean",
                    "properties": {
                        "args": {
                            "type": "object",
                            "properties": {
                                "target": {"type": "string"},
                            },
                            "required": ["target"],
                        }
                    },
                },
                "sharedFn": {
                    "returnType": "boolean",
                    "properties": {
                        "args": {
                            "type": "object",
                            "properties": {
                                "firstPrimary": {"type": "string"},
                                "secondPrimary": {"type": "string"},
                            },
                            "required": ["firstPrimary", "secondPrimary"],
                        }
                    },
                },
            },
        },
        protocol_version="v1.0",
    )


@pytest.fixture
def secondary_catalog() -> Catalog:
    return Catalog.from_json(
        {
            "catalogId": "https://a2ui.org/catalogs/secondary",
            "components": {
                "SecondaryCard": {
                    "properties": {
                        "headline": {"type": "string"},
                        "subtitle": {"type": "string"},
                    }
                },
                "SharedWidget": {
                    "allOf": [
                        {"$ref": "common_types.json#/$defs/Checkable"},
                        {
                            "properties": {
                                "secondaryArg": {"type": "string"},
                                "action": {"type": "object"},
                            }
                        },
                    ]
                },
            },
            "functions": {
                "secondaryCheck": {
                    "returnType": "boolean",
                    "properties": {
                        "args": {
                            "type": "object",
                            "properties": {
                                "threshold": {"type": "number"},
                            },
                            "required": ["threshold"],
                        }
                    },
                },
                "sharedFn": {
                    "returnType": "boolean",
                    "properties": {
                        "args": {
                            "type": "object",
                            "properties": {
                                "firstSecondary": {"type": "string"},
                                "secondSecondary": {"type": "string"},
                            },
                            "required": ["firstSecondary", "secondSecondary"],
                        }
                    },
                },
            },
        },
        protocol_version="v1.0",
    )


def test_express_multi_catalog_per_component_and_function_override(
    primary_catalog: Catalog, secondary_catalog: Catalog
) -> None:
    fmt = ExpressFormat(
        catalogs=[primary_catalog, secondary_catalog],
        surface_id="main",
        version="v1.0",
    )
    dsl = """<a2ui>
surface("main")
w1 = SharedWidget("from-primary", catalogId="https://a2ui.org/catalogs/primary", checks=[?primaryCheck("ok", "Bad primary"), ?secondaryCheck(42, "Bad secondary")])
w2 = SharedWidget("from-secondary", catalogId="https://a2ui.org/catalogs/secondary", checks=[?sharedFn("sec-1", "sec-2", "Check sec", {catalogId: "https://a2ui.org/catalogs/secondary"}), ?sharedFn("pri-1", "pri-2", "Check pri", {catalogId: "https://a2ui.org/catalogs/primary"})], action=sharedFn("act-pri-1", "act-pri-2", catalogId="https://a2ui.org/catalogs/primary"))
c1 = SecondaryCard("Title", "Sub")
root = Column([w1, w2, c1])
</a2ui>"""

    messages = fmt.parser.parse_response(dsl)[0].a2ui_json
    assert isinstance(messages, list)
    create_msg = next(m["createSurface"] for m in messages if "createSurface" in m)
    assert "catalogId" not in create_msg
    comps = {c["id"]: c for c in create_msg["components"]}

    # w1 uses primary catalog positional mapping via explicit catalogId, while
    # primaryCheck and secondaryCheck resolve uniquely by name across catalogs.
    assert comps["w1"]["primaryArg"] == "from-primary"
    assert comps["w1"]["catalogId"] == "https://a2ui.org/catalogs/primary"
    assert comps["w1"]["checks"] == [
        {
            "condition": {
                "@call": "primaryCheck",
                "catalogId": "https://a2ui.org/catalogs/primary",
                "args": {"target": "ok"},
            },
            "message": "Bad primary",
        },
        {
            "condition": {
                "@call": "secondaryCheck",
                "catalogId": "https://a2ui.org/catalogs/secondary",
                "args": {"threshold": 42},
            },
            "message": "Bad secondary",
        },
    ]

    # w2 overrides catalogId to secondary_catalog, while sharedFn (defined in
    # both catalogs) uses explicit catalogId overrides for each call.
    assert comps["w2"]["catalogId"] == "https://a2ui.org/catalogs/secondary"
    assert comps["w2"]["secondaryArg"] == "from-secondary"
    assert comps["w2"]["checks"] == [
        {
            "condition": {
                "@call": "sharedFn",
                "catalogId": "https://a2ui.org/catalogs/secondary",
                "args": {"firstSecondary": "sec-1", "secondSecondary": "sec-2"},
            },
            "message": "Check sec",
        },
        {
            "condition": {
                "@call": "sharedFn",
                "catalogId": "https://a2ui.org/catalogs/primary",
                "args": {"firstPrimary": "pri-1", "secondPrimary": "pri-2"},
            },
            "message": "Check pri",
        },
    ]
    assert comps["w2"]["action"] == {
        "functionCall": {
            "@call": "sharedFn",
            "catalogId": "https://a2ui.org/catalogs/primary",
            "args": {"firstPrimary": "act-pri-1", "secondPrimary": "act-pri-2"},
        }
    }

    assert comps["c1"] == {
        "id": "c1",
        "component": "SecondaryCard",
        "catalogId": "https://a2ui.org/catalogs/secondary",
        "headline": "Title",
        "subtitle": "Sub",
    }
    assert comps["root"] == {
        "id": "root",
        "component": "Column",
        "catalogId": "https://a2ui.org/catalogs/primary",
        "children": ["w1", "w2", "c1"],
    }

    # Verify decompilation and recompilation round-trip preserves catalogId overrides and positional args
    decompiled = fmt.parser.decompile(to_message_models(messages))
    assert 'catalogId="https://a2ui.org/catalogs/secondary"' in decompiled
    assert 'catalogId: "https://a2ui.org/catalogs/secondary"' in decompiled
    assert 'catalogId="https://a2ui.org/catalogs/primary"' in decompiled
    assert 'SecondaryCard("Title", "Sub")' in decompiled
    recompiled = fmt.parser.parse_response(f"<a2ui>\n{decompiled}\n</a2ui>")[
        0
    ].a2ui_json
    assert recompiled == messages

    # Also test standalone function call with catalogId override in Express
    call_dsl = """<a2ui>
sharedFn("call-sec-1", "call-sec-2", catalogId="https://a2ui.org/catalogs/secondary")
</a2ui>"""
    call_messages = fmt.parser.parse_response(call_dsl)[0].a2ui_json
    assert call_messages == [{
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "call_1",
            "callFunction": {
                "catalogId": "https://a2ui.org/catalogs/secondary",
                "@call": "sharedFn",
                "args": {
                    "firstSecondary": "call-sec-1",
                    "secondSecondary": "call-sec-2",
                },
            },
        },
    }]
    decompiled_call = fmt.parser.decompile(to_message_models(call_messages))
    assert 'catalogId="https://a2ui.org/catalogs/secondary"' in decompiled_call
    assert (
        fmt.parser.parse_response(f"<a2ui>\n{decompiled_call}\n</a2ui>")[0].a2ui_json
        == call_messages
    )


def test_elemental_multi_catalog_per_component_and_function_override(
    primary_catalog: Catalog, secondary_catalog: Catalog
) -> None:
    fmt = ElementalFormat(
        catalogs=[primary_catalog, secondary_catalog],
        surface_id="main",
    )
    surface_envelope = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "components": [
                {
                    "id": "w1",
                    "component": "SharedWidget",
                    "catalogId": "https://a2ui.org/catalogs/primary",
                    "primaryArg": "from-primary",
                    "checks": [{
                        "condition": {
                            "call": "sharedFn",
                            "catalogId": "https://a2ui.org/catalogs/secondary",
                            "args": {
                                "firstSecondary": "sec-1",
                                "secondSecondary": "sec-2",
                            },
                        },
                        "message": "Must match secondary",
                    }],
                },
                {
                    "id": "w2",
                    "component": "SharedWidget",
                    "catalogId": "https://a2ui.org/catalogs/secondary",
                    "secondaryArg": "from-secondary",
                    "action": {
                        "functionCall": {
                            "call": "sharedFn",
                            "catalogId": "https://a2ui.org/catalogs/primary",
                            "args": {
                                "firstPrimary": "pri-1",
                                "secondPrimary": "pri-2",
                            },
                        }
                    },
                },
                {
                    "id": "root",
                    "component": "Column",
                    "catalogId": "https://a2ui.org/catalogs/primary",
                    "children": ["w1", "w2"],
                },
            ],
        },
    }

    decompiled = fmt.parser.decompile(to_message_models(surface_envelope))
    assert '<link rel="catalog"' not in decompiled
    assert 'catalog-id="https://a2ui.org/catalogs/primary"' in decompiled
    assert 'catalog-id="https://a2ui.org/catalogs/secondary"' in decompiled
    assert "catalogId: 'https://a2ui.org/catalogs/secondary'" in decompiled
    assert "catalogId: 'https://a2ui.org/catalogs/primary'" in decompiled

    recompiled_list = fmt.parser.parse_response(f"<a2ui>\n{decompiled}\n</a2ui>")[
        0
    ].a2ui_json
    assert isinstance(recompiled_list, list)
    recompiled = recompiled_list[0]
    create_surf = recompiled["createSurface"]
    assert "catalogId" not in create_surf
    comps = {c["id"]: c for c in create_surf["components"]}

    assert comps["w1"]["primaryArg"] == "from-primary"
    assert comps["w1"]["catalogId"] == "https://a2ui.org/catalogs/primary"
    assert comps["w1"]["checks"] == [{
        "condition": {
            "@call": "sharedFn",
            "catalogId": "https://a2ui.org/catalogs/secondary",
            "args": {
                "firstSecondary": "sec-1",
                "secondSecondary": "sec-2",
            },
        },
        "message": "Must match secondary",
    }]

    assert comps["w2"]["catalogId"] == "https://a2ui.org/catalogs/secondary"
    assert comps["w2"]["secondaryArg"] == "from-secondary"
    assert comps["w2"]["action"] == {
        "functionCall": {
            "@call": "sharedFn",
            "catalogId": "https://a2ui.org/catalogs/primary",
            "args": {
                "firstPrimary": "pri-1",
                "secondPrimary": "pri-2",
            },
        }
    }
    assert comps["root"]["catalogId"] == "https://a2ui.org/catalogs/primary"

    # Also test standalone callFunction with catalogId override in Elemental
    call_envelope = {
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "call_1",
            "callFunction": {
                "@call": "sharedFn",
                "catalogId": "https://a2ui.org/catalogs/secondary",
                "args": {
                    "firstSecondary": "c-sec-1",
                    "secondSecondary": "c-sec-2",
                },
            },
        },
    }
    decompiled_call = fmt.parser.decompile(to_message_models(call_envelope))
    assert 'catalog-id="https://a2ui.org/catalogs/secondary"' in decompiled_call
    recompiled_call = fmt.parser.parse_response(f"<a2ui>\n{decompiled_call}\n</a2ui>")[
        0
    ].a2ui_json[0]
    assert recompiled_call["callRendererFunction"]["callFunction"] == {
        "@call": "sharedFn",
        "catalogId": "https://a2ui.org/catalogs/secondary",
        "args": {
            "firstSecondary": "c-sec-1",
            "secondSecondary": "c-sec-2",
        },
    }


def test_atom_multi_catalog_per_component_and_function_override(
    primary_catalog: Catalog, secondary_catalog: Catalog
) -> None:
    fmt = AtomFormat(
        catalogs=[primary_catalog, secondary_catalog],
        surface_id="main",
    )
    sexpr = """<a2ui>
(surface "main"
  (Column :id "root"
    (SharedWidget :id "w1" "from-primary" :catalogId "https://a2ui.org/catalogs/primary"
      :checks [
        (sharedFn :catalogId "https://a2ui.org/catalogs/secondary" :firstSecondary "sec-1" :secondSecondary "sec-2" :message "Must match secondary")
      ]
    )
    (SharedWidget :id "w2" "from-secondary" :catalogId "https://a2ui.org/catalogs/secondary"
      :checks [
        (sharedFn "inh-pri-1" "inh-pri-2" :catalogId "https://a2ui.org/catalogs/primary" :message "Explicit primary catalog")
        (secondaryCheck 3 :message "Only in secondary")
      ]
      :action (sharedFn "act-pri-1" "act-pri-2" :catalogId "https://a2ui.org/catalogs/primary")
    )
    (SecondaryCard :id "c1" "Title" "Sub")
  )
)
</a2ui>"""

    compiled_list = fmt.parser.parse_response(sexpr)[0].a2ui_json
    assert isinstance(compiled_list, list)
    assert len(compiled_list) == 1
    compiled = compiled_list[0]
    create_msg = compiled["createSurface"]
    assert "catalogId" not in create_msg
    comps = {c["id"]: c for c in create_msg["components"]}

    assert comps["w1"] == {
        "id": "w1",
        "component": "SharedWidget",
        "catalogId": "https://a2ui.org/catalogs/primary",
        "primaryArg": "from-primary",
        "checks": [{
            "condition": {
                "@call": "sharedFn",
                "catalogId": "https://a2ui.org/catalogs/secondary",
                "args": {
                    "firstSecondary": "sec-1",
                    "secondSecondary": "sec-2",
                },
            },
            "message": "Must match secondary",
        }],
    }

    assert comps["w2"] == {
        "id": "w2",
        "component": "SharedWidget",
        "catalogId": "https://a2ui.org/catalogs/secondary",
        "secondaryArg": "from-secondary",
        "checks": [
            {
                "condition": {
                    "@call": "sharedFn",
                    "catalogId": "https://a2ui.org/catalogs/primary",
                    "args": {
                        "firstPrimary": "inh-pri-1",
                        "secondPrimary": "inh-pri-2",
                    },
                },
                "message": "Explicit primary catalog",
            },
            {
                "condition": {
                    "@call": "secondaryCheck",
                    "catalogId": "https://a2ui.org/catalogs/secondary",
                    "args": {"threshold": 3},
                },
                "message": "Only in secondary",
            },
        ],
        "action": {
            "functionCall": {
                "@call": "sharedFn",
                "catalogId": "https://a2ui.org/catalogs/primary",
                "args": {
                    "firstPrimary": "act-pri-1",
                    "secondPrimary": "act-pri-2",
                },
            }
        },
    }
    assert comps["c1"] == {
        "id": "c1",
        "component": "SecondaryCard",
        "catalogId": "https://a2ui.org/catalogs/secondary",
        "headline": "Title",
        "subtitle": "Sub",
    }
    assert comps["root"] == {
        "id": "root",
        "component": "Column",
        "catalogId": "https://a2ui.org/catalogs/primary",
        "children": ["w1", "w2", "c1"],
    }

    # Round-trip decompile -> compile reproduces the message exactly.
    decompiled = fmt.parser.decompile(to_message_models(compiled))
    assert ':catalogId "https://a2ui.org/catalogs/secondary"' in decompiled
    assert ':catalogId "https://a2ui.org/catalogs/primary"' in decompiled
    recompiled_list = fmt.parser.parse_response(f"<a2ui>\n{decompiled}\n</a2ui>")[
        0
    ].a2ui_json
    assert len(recompiled_list) == 1
    recompiled = recompiled_list[0]
    assert {c["id"]: c for c in recompiled["createSurface"]["components"]} == comps
    assert recompiled == compiled

    # Also test standalone callFunction with catalogId override in Atom
    call_sexpr = """<a2ui>
(callFunction sharedFn :catalogId "https://a2ui.org/catalogs/secondary" :firstSecondary "call-sec-1" :secondSecondary "call-sec-2")
</a2ui>"""
    call_compiled = fmt.parser.parse_response(call_sexpr)[0].a2ui_json[0]
    assert call_compiled == {
        "version": "v1.0",
        "callRendererFunction": {
            "functionCallId": "call_1",
            "callFunction": {
                "@call": "sharedFn",
                "catalogId": "https://a2ui.org/catalogs/secondary",
                "args": {
                    "firstSecondary": "call-sec-1",
                    "secondSecondary": "call-sec-2",
                },
            },
        },
    }
    decompiled_call = fmt.parser.decompile(to_message_models(call_compiled))
    assert ':catalogId "https://a2ui.org/catalogs/secondary"' in decompiled_call
    assert (
        fmt.parser.parse_response(f"<a2ui>\n{decompiled_call}\n</a2ui>")[0].a2ui_json[0]
        == call_compiled
    )


def test_multi_catalog_prompt_generation_all_formats(
    primary_catalog: Catalog, secondary_catalog: Catalog
) -> None:
    for fmt_cls in (ExpressFormat, ElementalFormat, AtomFormat):
        fmt = fmt_cls(catalogs=[primary_catalog, secondary_catalog])
        assert fmt.catalogs == [primary_catalog, secondary_catalog]
        instructions = fmt.prompt_generator.generate_catalog_instructions()
        assert "https://a2ui.org/catalogs/primary" in instructions
        assert "https://a2ui.org/catalogs/secondary" in instructions
        assert "SecondaryCard" in instructions
        assert "secondaryCheck" in instructions


def test_atom_prescan_keyword_values_not_treated_as_keywords(
    primary_catalog: Catalog, secondary_catalog: Catalog
) -> None:
    fmt = AtomFormat(
        catalogs=[primary_catalog, secondary_catalog],
        surface_id="main",
    )
    sexpr = """<a2ui>
(surface "main" :theme ":catalogId" :title ":id"
  (Column :id "root"
    (Text :id "t1" :text ":catalogId")
    (SharedWidget :id "w1" :primaryArg ":catalogId" :catalogId "https://a2ui.org/catalogs/secondary" "from-secondary"
      :checks [
        (sharedFn :firstSecondary ":catalogId" :secondSecondary "sec-2" :catalogId "https://a2ui.org/catalogs/secondary" :message ":id")
      ]
    )
  )
)
</a2ui>"""
    compiled = fmt.parser.parse_response(sexpr)[0].a2ui_json[0]
    create_msg = compiled["createSurface"]
    assert create_msg["surfaceId"] == "main"
    assert "catalogId" not in create_msg
    comps = {c["id"]: c for c in create_msg["components"]}
    assert comps["t1"]["text"] == ":catalogId"
    assert comps["t1"]["catalogId"] == "https://a2ui.org/catalogs/primary"
    assert comps["w1"]["catalogId"] == "https://a2ui.org/catalogs/secondary"
    assert comps["w1"]["secondaryArg"] == "from-secondary"
    assert comps["w1"]["checks"] == [{
        "condition": {
            "@call": "sharedFn",
            "args": {
                "firstSecondary": ":catalogId",
                "secondSecondary": "sec-2",
            },
            "catalogId": "https://a2ui.org/catalogs/secondary",
        },
        "message": ":id",
    }]
