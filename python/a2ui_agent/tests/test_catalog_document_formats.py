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

"""End-to-end tests for inference formats, macros, and resolver on CatalogModel & Catalog Documents."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.builder.v1_0 import Card, Column, Text
from a2ui.catalog_transformers import (
    ComponentPruningTransformer,
    FunctionPruningTransformer,
)
from a2ui.core import (
    A2uiCatalogError,
    ActionType,
    ArrayType,
    BooleanType,
    Catalog,
    CatalogModel,
    ChildListType,
    ChildType,
    ComponentDefinition,
    ConstType,
    EnumType,
    FunctionDefinition,
    IntegerType,
    NumberType,
    ObjectType,
    ParameterDefinition,
    RefType,
    StringType,
    UnionType,
    ValidationResultReturnType,
    VoidReturnType,
    is_catalog_document,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats._shared import CatalogSchemaHelper
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.inference_formats.experimental.atom import AtomFormat
from a2ui.inference_formats.experimental.elemental import ElementalFormat
from a2ui.inference_formats.express import ExpressFormat
from a2ui.processor import CatalogConfig
from a2ui.transformers.macros import MacroExpander, macro
from a2ui.utils import resolve_catalogs


def _pure_catalog_document() -> dict[str, Any]:
    return {
        "formatVersion": "1.0",
        "protocolVersion": "1.0",
        "catalogId": "https://example.com/catalogs/agent_doc/v1",
        "title": "Agent Doc Catalog",
        "instructions": "Use `Column` as the root layout container.",
        "types": {
            "Weight": {"type": "number", "min": 0, "description": "Flex weight."},
        },
        "components": [
            {
                "name": "Column",
                "description": "Vertical layout container.",
                "parameters": [
                    {
                        "name": "children",
                        "type": "childList",
                        "required": True,
                        "description": "Child components.",
                    },
                    {"name": "weight", "type": "ref", "ref": "Weight"},
                ],
            },
            {
                "name": "Text",
                "description": "Displays text.",
                "parameters": [
                    {
                        "name": "text",
                        "type": "string",
                        "dynamic": True,
                        "required": True,
                        "description": "Text content.",
                    },
                    {
                        "name": "variant",
                        "type": "enum",
                        "values": ["h1", "body"],
                        "default": "body",
                    },
                    {"name": "weight", "type": "ref", "ref": "Weight"},
                ],
            },
            {
                "name": "Button",
                "description": "Interactive button.",
                "checkable": True,
                "parameters": [
                    {"name": "child", "type": "child", "required": True},
                    {"name": "action", "type": "action", "required": True},
                    {"name": "disabled", "type": "boolean", "default": False},
                ],
            },
            {
                "name": "ChoicePicker",
                "description": "Option selector.",
                "parameters": [
                    {
                        "name": "options",
                        "type": "array",
                        "required": True,
                        "items": {
                            "type": "object",
                            "properties": [
                                {
                                    "name": "label",
                                    "type": "string",
                                    "dynamic": True,
                                    "required": True,
                                },
                                {
                                    "name": "value",
                                    "type": "string",
                                    "required": True,
                                },
                            ],
                        },
                    },
                    {
                        "name": "value",
                        "type": "array",
                        "dynamic": True,
                        "items": {"type": "string"},
                    },
                ],
            },
        ],
        "functions": [
            {
                "name": "required",
                "description": "Checks a value is non-empty.",
                "returnType": "validationResult",
                "parameters": [
                    {"name": "value", "type": "any", "dynamic": True, "required": True}
                ],
            },
            {
                "name": "openUrl",
                "description": "Opens a URL.",
                "returnType": "void",
                "requiresUserActivation": True,
                "parameters": [{
                    "name": "url",
                    "type": "string",
                    "dynamic": True,
                    "format": "uri",
                    "required": True,
                }],
            },
        ],
    }


def test_canonical_catalog_formats_never_call_to_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Proves Express, Elemental, and Atom operate directly on CatalogModel without `to_json()`."""
    doc = _pure_catalog_document()
    cat = Catalog.from_document(doc)

    def _forbid_to_json(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("to_json() must not be called for canonical catalogs")

    monkeypatch.setattr(cat, "to_json", _forbid_to_json)

    # 1. CatalogSchemaHelper reads everything from CatalogModel.
    helper = CatalogSchemaHelper(cat)
    assert helper.get_component_properties("Text") == ["text", "variant", "weight"]
    assert helper.get_component_properties("Button") == [
        "child",
        "action",
        "disabled",
        "checks",
    ]
    assert helper.is_checkable("Button")
    assert helper.get_property_enum("Text", "variant") == ["h1", "body"]
    assert helper.get_property_type("Button", "child") == "Child"
    assert helper.get_property_type("Button", "action") == "Action"
    assert helper.get_property_type("Column", "children") == "ChildList"
    assert helper.property_accepts_number("Text", "weight")
    assert not helper.property_accepts_number("Text", "variant")
    assert helper.property_expects_option_objects("ChoicePicker", "options")
    assert helper.instructions == "Use `Column` as the root layout container."

    # 2. Express prompt generation + compile + decompile.
    express = ExpressFormat([cat])
    express_prompt = express.prompt_generator.generate()
    assert "• Text(text, variant? (static), weight? (static))" in express_prompt
    assert (
        "• Button(child (static), action (static), disabled? (static), checks?"
        " (static))"
        in express_prompt
    )
    assert "Use `Column` as the root layout container." in express_prompt

    express_parser = express.create_parser()
    express_msgs = express_parser.compile(
        'title = Text("Hello", "h1")\n'
        'btn_txt = Text("Go")\n'
        'btn = Button(btn_txt, Event("go"))\n'
        'picker = ChoicePicker(["A", "B"], $/sel)\n'
        "root = Column([title, btn, picker])\n"
    )
    assert len(express_msgs) == 1
    decompiled_express = express.prompt_generator.decompile(express_msgs)
    assert "Text(" in decompiled_express
    assert "Column(" in decompiled_express

    # 3. Elemental prompt generation + compile + decompile.
    elemental = ElementalFormat([cat])
    elemental_prompt = elemental.prompt_generator.generate()
    assert "interface Text" in elemental_prompt
    assert "onClick: Action" in elemental_prompt
    assert "function openUrl(" in elemental_prompt

    elemental_parser = elemental.create_parser()
    elemental_msgs = elemental_parser.compile(
        '<body id="main">'
        '<ui-column id="root">'
        '<ui-text id="t1" text="Hello" variant="h1" />'
        '<ui-button id="b1" on-click="{Event(\'go\')}">'
        '<ui-text id="bt" text="Go" />'
        "</ui-button>"
        "</ui-column>"
        "</body>"
    )
    assert len(elemental_msgs) == 1
    decompiled_elemental = elemental_parser.decompile(elemental_msgs)
    assert "<ui-column" in decompiled_elemental

    # 4. Atom prompt generation + compile + decompile.
    atom = AtomFormat([cat])
    atom_prompt = atom.prompt_generator.generate()
    assert "(Text :text :variant? :weight?)" in atom_prompt
    assert "(openUrl :url)" in atom_prompt

    atom_parser = atom.create_parser()
    atom_msgs = atom_parser.compile(
        '(Column (Text "Hello" :variant "h1")'
        ' (Button (Text "Go") :action (Event "go")))'
    )
    assert len(atom_msgs) == 1
    decompiled_atom = atom_parser.decompile(atom_msgs)
    assert "(Column" in decompiled_atom


def test_direct_json_and_pruning_transformers_with_catalog_document() -> None:
    """DirectJsonFormat and pruning transformers work seamlessly on Catalog Document catalogs."""
    cat = Catalog.from_document(_pure_catalog_document())

    direct = DirectJsonFormat([cat])
    prompt = direct.prompt_generator.generate()
    # DirectJsonFormat emits JSON Schema matching Common Types Schema (not Catalog Document).
    assert '"$defs"' in prompt
    assert '"formatVersion"' not in prompt
    assert "Common Types Schema" in prompt

    pruned_comps = ComponentPruningTransformer(["Text"]).transform(cat)
    assert list(pruned_comps.components.keys()) == ["Text"]
    assert not is_catalog_document(pruned_comps.to_json())
    assert is_catalog_document(pruned_comps.to_document())

    pruned_fns = FunctionPruningTransformer(["openUrl"]).transform(cat)
    assert [f.name for f in pruned_fns.model.functions] == ["openUrl"]
    assert not is_catalog_document(pruned_fns.to_json())
    assert is_catalog_document(pruned_fns.to_document())


def test_macro_expander_with_catalog_document_base() -> None:
    """MacroExpander augments a Catalog Document base catalog cleanly."""
    base_doc = BasicCatalog("1.0").to_document()
    base_cat = Catalog.from_document(base_doc)

    @macro
    def GreetingCard(heading: str) -> Card:
        """A simple greeting card macro."""
        return Card(child=Column(children=[Text(text=heading)]))

    expander = MacroExpander([GreetingCard], catalog_id=base_cat.catalog_id)
    inf_cat = expander.transform_to_inference_catalog(base_cat)
    assert "GreetingCard" in inf_cat.components
    assert not is_catalog_document(inf_cat.to_json())
    assert is_catalog_document(inf_cat.to_document())

    express = ExpressFormat([inf_cat])
    msgs = express.create_parser().compile('root = GreetingCard("Welcome")')
    lowered = expander.transform_to_transport(msgs)
    dumped = [m.model_dump(by_alias=True, exclude_none=True) for m in lowered]
    comp_names = [c["component"] for c in dumped[0]["createSurface"]["components"]]
    assert "GreetingCard" not in comp_names
    assert "Card" in comp_names


def test_inline_catalog_resolver_accepts_catalog_document() -> None:
    """resolve_catalogs parses and validates Catalog Document inline catalogs."""
    registered = CatalogConfig(catalog=BasicCatalog("1.0"))
    inline_doc = _pure_catalog_document()
    caps = {
        "1.0": {
            "supportedCatalogIds": [BasicCatalog("1.0").catalog_id],
            "inlineCatalogs": [inline_doc],
        }
    }
    active = resolve_catalogs([registered], caps, accepts_inline_catalogs=True)
    assert [c.catalog_id for c in active] == [
        BasicCatalog("1.0").catalog_id,
        inline_doc["catalogId"],
    ]
    assert not is_catalog_document(active[1].to_json())
    assert is_catalog_document(active[1].to_document())

    # Malformed inline Catalog Document raises A2uiCatalogError.
    bad_doc = dict(inline_doc)
    bad_doc["components"] = [{"name": "Surface", "parameters": []}]
    bad_caps = {
        "1.0": {
            "supportedCatalogIds": [BasicCatalog("1.0").catalog_id],
            "inlineCatalogs": [bad_doc],
        }
    }
    with pytest.raises(A2uiCatalogError):
        resolve_catalogs([registered], bad_caps, accepts_inline_catalogs=True)


def test_pure_catalog_model_authoring_with_formats() -> None:
    """Catalog.from_model works directly with ExpressFormat without intermediate serialization."""
    model = CatalogModel(
        catalog_id="https://example.com/in_memory/v1",
        protocol_version="1.0",
        types={"Tone": EnumType(values=("info", "warn"))},
        components=(
            ComponentDefinition(
                name="Alert",
                description="Status alert.",
                parameters=(
                    ParameterDefinition(
                        name="message",
                        type=StringType(dynamic=True),
                        required=True,
                    ),
                    ParameterDefinition(
                        name="tone",
                        type=RefType(ref="Tone"),
                    ),
                    ParameterDefinition(
                        name="child",
                        type=ChildType(),
                    ),
                    ParameterDefinition(
                        name="items",
                        type=ChildListType(),
                    ),
                    ParameterDefinition(
                        name="onDismiss",
                        type=ActionType(),
                    ),
                    ParameterDefinition(
                        name="meta",
                        type=ObjectType(
                            properties=(
                                ParameterDefinition(
                                    name="priority",
                                    type=NumberType(min=0, max=5),
                                ),
                                ParameterDefinition(
                                    name="pinned",
                                    type=BooleanType(),
                                ),
                            )
                        ),
                    ),
                    ParameterDefinition(
                        name="tags",
                        type=ArrayType(items=StringType()),
                    ),
                ),
            ),
        ),
        functions=(
            FunctionDefinition(
                name="checkTone",
                return_type=ValidationResultReturnType(),
                parameters=(
                    ParameterDefinition(
                        name="tone", type=StringType(dynamic=True), required=True
                    ),
                ),
            ),
            FunctionDefinition(
                name="dismiss",
                return_type=VoidReturnType(),
            ),
        ),
    )
    cat = Catalog.from_model(model)
    express = ExpressFormat([cat])
    prompt = express.prompt_generator.generate()
    assert "• Alert(" in prompt
    assert "Must be one of: 'info', 'warn'" in prompt
    msgs = express.create_parser().compile(
        'root = Alert("Heads up", "warn", _, _, Event("close"))'
    )
    assert len(msgs) == 1


def test_dynamic_union_elemental_ts_mapping_cyclic_types_and_resolver_version_guard() -> (
    None
):
    """Covers B2, H5.2, H6.1, H6.2, and M7 regressions in a2ui_agent."""
    model = CatalogModel(
        catalog_id="https://example.com/edge_formats/v1",
        protocol_version="1.0",
        types={
            "Score": NumberType(min=0, max=100),
            "TreeNode": ObjectType(
                properties=(
                    ParameterDefinition(name="label", type=StringType(), required=True),
                    ParameterDefinition(
                        name="children",
                        type=ArrayType(items=RefType(ref="TreeNode")),
                    ),
                )
            ),
        },
        components=(
            ComponentDefinition(
                name="EdgeWidget",
                parameters=(
                    ParameterDefinition(
                        name="dynUnion",
                        type=UnionType(
                            variants=(StringType(), IntegerType()), dynamic=True
                        ),
                    ),
                    ParameterDefinition(
                        name="numEnum",
                        type=EnumType(values=(1, 2, 3), value_type="number"),
                    ),
                    ParameterDefinition(
                        name="boolEnum",
                        type=EnumType(values=(True, False), value_type="boolean"),
                    ),
                    ParameterDefinition(
                        name="tag",
                        type=ConstType(value="fixed"),
                    ),
                    ParameterDefinition(
                        name="fileRef",
                        type=ObjectType(
                            properties=(
                                ParameterDefinition(
                                    name="path", type=StringType(), required=True
                                ),
                                ParameterDefinition(name="size", type=IntegerType()),
                            )
                        ),
                    ),
                    ParameterDefinition(
                        name="tree",
                        type=RefType(ref="TreeNode"),
                    ),
                ),
            ),
        ),
        functions=(
            FunctionDefinition(name="getScore", return_type=RefType(ref="Score")),
        ),
    )
    cat = Catalog.from_model(model)
    helper = CatalogSchemaHelper(cat)
    assert helper.property_allows_databinding("EdgeWidget", "dynUnion")

    # Express accepts $path binding on UnionType(dynamic=True).
    express = ExpressFormat([cat])
    express_prompt = express.prompt_generator.generate()
    assert "dynUnion? (static)" not in express_prompt
    express_msgs = express.create_parser().compile("root = EdgeWidget($/val)")
    assert len(express_msgs) == 1

    # Elemental maps numeric/bool enums, ConstType, domain {path, size} objects,
    # RefType function return_type, and structural cyclic TreeNode without RecursionError.
    elemental = ElementalFormat([cat])
    el_prompt = elemental.prompt_generator.generate()
    assert "numEnum?: 1 | 2 | 3;" in el_prompt
    assert "boolEnum?: true | false;" in el_prompt
    assert "tag?: 'fixed';" in el_prompt
    assert "fileRef?: {path: string; size?: number};" in el_prompt
    assert "tree?: {label: string; children?: any[]};" in el_prompt
    assert "function getScore(): number;" in el_prompt

    # resolve_catalogs rejects inline Catalog Document whose protocolVersion mismatches capability key.
    registered = CatalogConfig(catalog=BasicCatalog("1.0"))
    mismatched_doc = _pure_catalog_document()
    mismatched_doc["protocolVersion"] = "0.9"
    with pytest.raises(A2uiCatalogError, match="protocolVersion"):
        resolve_catalogs(
            [registered],
            {
                "1.0": {
                    "supportedCatalogIds": [BasicCatalog("1.0").catalog_id],
                    "inlineCatalogs": [mismatched_doc],
                }
            },
            accepts_inline_catalogs=True,
        )
