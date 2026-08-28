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

from pydantic import BaseModel
from a2ui.core.catalog import Catalog, ComponentApi
from a2ui.core.catalog.reference_map import (
    ComponentRefSpec,
    extract_child_refs_from_val,
    _is_single_child_ref,
    _is_child_list_ref,
    _resolve_schema_ref,
    analyze_child_ref_schema,
    build_component_ref_map,
)
from a2ui.core.schema.common_types import (
    ComponentId,
    SingleReference,
    TemplateChildList,
)


def test_ref_uri_helpers():
    # Single child references
    assert _is_single_child_ref(
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"
    )
    assert _is_single_child_ref("common_types.json#/$defs/Child")
    assert _is_single_child_ref("#/definitions/Child")
    assert not _is_single_child_ref("common_types.json#/$defs/ChildList")
    assert not _is_single_child_ref("common_types.json#/$defs/DynamicString")

    # Child list references
    assert _is_child_list_ref(
        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList"
    )
    assert _is_child_list_ref("#/definitions/ChildList")
    assert not _is_child_list_ref("common_types.json#/$defs/ComponentId")
    assert not _is_child_list_ref("common_types.json#/$defs/Child")


def test_extract_child_refs_from_val():
    # 1. None / empty
    assert list(extract_child_refs_from_val(None)) == []
    assert list(extract_child_refs_from_val("")) == []

    # 2. Single string component ID
    assert list(extract_child_refs_from_val("comp1")) == [("comp1", "")]

    # 3. SingleReference instance
    assert list(extract_child_refs_from_val(SingleReference("slot_btn"))) == [
        ("slot_btn", "")
    ]

    # 4. TemplateChildList instance
    tpl = TemplateChildList(componentId=ComponentId("card_template"), path="/items")
    assert list(extract_child_refs_from_val(tpl)) == [("card_template", "componentId")]

    # 5. List of string IDs
    assert list(extract_child_refs_from_val(["child1", "child2"])) == [
        ("child1", "[0]"),
        ("child2", "[1]"),
    ]

    # 6. Template child dictionary
    dict_tpl = {"componentId": "tab_template", "path": "/data"}
    assert list(extract_child_refs_from_val(dict_tpl)) == [
        ("tab_template", "componentId")
    ]

    # 7. Single child slot dictionary
    assert list(extract_child_refs_from_val({"child": "main_view"})) == [
        ("main_view", "child")
    ]

    # 8. List of nested tab objects
    tabs_val = [
        {"title": "Tab 1", "child": "panel1"},
        {"title": "Tab 2", "child": "panel2"},
    ]
    assert list(extract_child_refs_from_val(tabs_val)) == [
        ("panel1", "[0].child"),
        ("panel2", "[1].child"),
    ]

    # 9. Nested dictionary structures
    nested_val = {
        "header": {"child": "hdr_comp"},
        "footer": "ftr_comp",
    }
    refs = dict(list(extract_child_refs_from_val(nested_val)))
    assert refs["hdr_comp"] == "header.child"
    assert refs["ftr_comp"] == "footer"


def test_analyze_child_ref_schema_json_schema():
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "leftSlot": {"$ref": "common_types.json#/$defs/ComponentId"},
            "rightSlot": {"$ref": "common_types.json#/$defs/Child"},
            "children": {"$ref": "common_types.json#/$defs/ChildList"},
            "tabs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "content": {"$ref": "common_types.json#/$defs/ComponentId"},
                    },
                },
            },
        },
    }

    spec = analyze_child_ref_schema(schema)
    assert spec.single_refs == {"leftSlot", "rightSlot"}
    assert "children" in spec.list_refs
    assert "tabs" in spec.list_refs
    assert spec.nested_refs["tabs"] == {"content"}
    assert spec.is_child_prop("leftSlot")
    assert spec.is_child_prop("rightSlot")
    assert spec.is_child_prop("children")
    assert not spec.is_child_prop("title")


def test_analyze_child_ref_schema_pydantic_model():
    class TabItem(BaseModel):
        title: str
        child: SingleReference

    class ComplexContainer(BaseModel):
        header_child: SingleReference
        body_children: list[SingleReference]
        tabs: list[TabItem]
        description: str

    spec = analyze_child_ref_schema(ComplexContainer)
    assert spec.single_refs == {"header_child"}
    assert "body_children" in spec.list_refs
    assert "tabs" in spec.list_refs
    assert spec.nested_refs["tabs"] == {"child"}
    assert not spec.is_child_prop("description")


def test_build_component_ref_map_and_catalog_integration():
    cat = Catalog(
        catalog_id="https://a2ui.org/custom-test-cat",
        protocol_version="v1.0",
        components=[
            ComponentApi(
                name="SplitView",
                schema={
                    "type": "object",
                    "properties": {
                        "primary": {"$ref": "common_types.json#/$defs/Child"},
                        "secondary": {"$ref": "common_types.json#/$defs/Child"},
                    },
                },
            ),
            ComponentApi(
                name="Button",
                schema={
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                    },
                },
            ),
        ],
        functions=[],
    )

    ref_map = build_component_ref_map(cat)
    assert "SplitView" in ref_map
    assert "Button" in ref_map
    assert ref_map["SplitView"].single_refs == {"primary", "secondary"}
    assert ref_map["Button"].single_refs == set()

    # Verify lazy catalog property and lookup
    assert cat.component_ref_map == ref_map
    spec = cat.get_component_ref_spec("SplitView")
    assert spec is not None
    assert spec.single_refs == {"primary", "secondary"}


def test_resolve_schema_ref():
    local_schema = {
        "type": "object",
        "$defs": {
            "HeaderSlot": {
                "type": "object",
                "properties": {"child": {"$ref": "common_types.json#/$defs/Child"}},
            },
            "Deep": {"nested": {"item": {"type": "string"}}},
        },
    }
    catalog_schema = {
        "components": {
            "CustomCard": {
                "properties": {"content": {"$ref": "common_types.json#/$defs/Child"}}
            }
        }
    }

    # 1. Invalid or external URIs return None
    assert (
        _resolve_schema_ref(
            "https://example.com/schema.json", local_schema, catalog_schema
        )
        is None
    )
    assert (
        _resolve_schema_ref(
            "common_types.json#/$defs/Child", local_schema, catalog_schema
        )
        is None
    )
    assert _resolve_schema_ref(None, local_schema, catalog_schema) is None

    # 2. Local $defs resolution
    res = _resolve_schema_ref("#/$defs/HeaderSlot", local_schema, catalog_schema)
    assert res is not None
    assert "properties" in res

    res_deep = _resolve_schema_ref(
        "#/$defs/Deep/nested/item", local_schema, catalog_schema
    )
    assert res_deep == {"type": "string"}

    # 3. Catalog schema resolution
    res_cat = _resolve_schema_ref(
        "#/components/CustomCard", local_schema, catalog_schema
    )
    assert res_cat is not None
    assert "properties" in res_cat

    # 4. Non-existent path returns None
    assert (
        _resolve_schema_ref("#/$defs/NonExistent", local_schema, catalog_schema) is None
    )
    assert _resolve_schema_ref("#/unknown/path", local_schema, catalog_schema) is None

    # 5. Cycle prevention
    visited = {"#/$defs/HeaderSlot"}
    assert (
        _resolve_schema_ref(
            "#/$defs/HeaderSlot", local_schema, catalog_schema, visited=visited
        )
        is None
    )


def test_basic_catalog_v08_pydantic_ref_map():
    from a2ui.core.basic_catalog import v0_8
    from a2ui.core.state.component_model import ComponentModel

    cat = v0_8.BasicCatalog()
    ref_map = cat.component_ref_map

    # reference_map strictly follows A2UI protocol ($ref / SingleReference), returning empty specs for v0.8
    assert "Card" in ref_map
    assert ref_map["Card"].single_refs == set()

    assert "Column" in ref_map
    assert ref_map["Column"].list_refs == set()

    # ComponentModel get_child_references uses v0_8_heuristic_child_prop_key as fallback for v0.8 components
    card_model = ComponentModel(
        "card1", "Card", catalog=cat, properties={"child": "child1"}
    )
    refs = dict(list(card_model.get_child_references()))
    assert refs == {"child1": "child"}

    col_model = ComponentModel(
        "col1", "Column", catalog=cat, properties={"children": ["c1", "c2"]}
    )
    col_refs = dict(list(col_model.get_child_references()))
    assert col_refs == {"c1": "children.[0]", "c2": "children.[1]"}


def test_basic_catalog_v09_pydantic_ref_map():
    from a2ui.core.basic_catalog import v0_9

    cat = v0_9.BasicCatalog()
    ref_map = cat.component_ref_map

    assert "Card" in ref_map
    assert ref_map["Card"].single_refs == {"child"}

    assert "Column" in ref_map
    assert ref_map["Column"].list_refs == {"children"}

    assert "Tabs" in ref_map
    assert "tabs" in ref_map["Tabs"].list_refs
    assert ref_map["Tabs"].nested_refs["tabs"] == {"child"}

    assert "Modal" in ref_map
    assert ref_map["Modal"].single_refs == {"trigger", "content"}

    assert "Button" in ref_map
    assert ref_map["Button"].single_refs == {"child"}

    assert "Text" in ref_map
    assert ref_map["Text"].single_refs == set()
    assert ref_map["Text"].list_refs == set()


def test_basic_catalog_v10_pydantic_ref_map():
    from a2ui.core.basic_catalog import v1_0

    cat = v1_0.BasicCatalog()
    ref_map = cat.component_ref_map

    assert "Card" in ref_map
    assert ref_map["Card"].single_refs == {"child"}

    assert "Column" in ref_map
    assert ref_map["Column"].list_refs == {"children"}

    assert "Tabs" in ref_map
    assert "tabs" in ref_map["Tabs"].list_refs
    assert ref_map["Tabs"].nested_refs["tabs"] == {"child"}

    assert "Modal" in ref_map
    assert ref_map["Modal"].single_refs == {"trigger", "content"}

    assert "Text" in ref_map
    assert ref_map["Text"].single_refs == set()


def test_json_catalog_from_specification_v10():
    import json
    import os

    spec_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../../specification/v1_0/catalogs/basic/catalog.json",
        )
    )
    assert os.path.exists(spec_path), f"Specification catalog not found at {spec_path}"
    with open(spec_path, "r", encoding="utf-8") as f:
        raw_catalog = json.load(f)

    cat = Catalog.from_json(
        raw_catalog,
        catalog_id="https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
        protocol_version="v1.0",
    )
    ref_map = cat.component_ref_map

    assert "Card" in ref_map
    assert ref_map["Card"].single_refs == {"child"}

    assert "Column" in ref_map
    assert ref_map["Column"].list_refs == {"children"}

    assert "Tabs" in ref_map
    assert "tabs" in ref_map["Tabs"].list_refs
    assert ref_map["Tabs"].nested_refs["tabs"] == {"child"}

    assert "Modal" in ref_map
    assert ref_map["Modal"].single_refs == {"trigger", "content"}

    assert "Text" in ref_map
    assert ref_map["Text"].single_refs == set()


def test_json_catalog_from_specification_v09():
    import json
    import os

    spec_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../../specification/v0_9/catalogs/basic/catalog.json",
        )
    )
    assert os.path.exists(spec_path), f"Specification catalog not found at {spec_path}"
    with open(spec_path, "r", encoding="utf-8") as f:
        raw_catalog = json.load(f)

    cat = Catalog.from_json(
        raw_catalog,
        catalog_id="https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
        protocol_version="v0.9",
    )
    ref_map = cat.component_ref_map

    assert "Card" in ref_map
    assert ref_map["Card"].single_refs == {"child"}

    assert "Column" in ref_map
    assert ref_map["Column"].list_refs == {"children"}

    assert "Tabs" in ref_map
    assert "tabs" in ref_map["Tabs"].list_refs
    assert ref_map["Tabs"].nested_refs["tabs"] == {"child"}

    assert "Modal" in ref_map
    assert ref_map["Modal"].single_refs == {"trigger", "content"}


def test_json_catalog_from_specification_v091():
    import json
    import os

    spec_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "../../../specification/v0_9_1/catalogs/basic/catalog.json",
        )
    )
    assert os.path.exists(spec_path), f"Specification catalog not found at {spec_path}"
    with open(spec_path, "r", encoding="utf-8") as f:
        raw_catalog = json.load(f)

    cat = Catalog.from_json(
        raw_catalog,
        catalog_id="https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json",
        protocol_version="v0.9.1",
    )
    ref_map = cat.component_ref_map

    assert "Card" in ref_map
    assert ref_map["Card"].single_refs == {"child"}

    assert "Column" in ref_map
    assert ref_map["Column"].list_refs == {"children"}

    assert "Tabs" in ref_map
    assert "tabs" in ref_map["Tabs"].list_refs
    assert ref_map["Tabs"].nested_refs["tabs"] == {"child"}

    assert "Modal" in ref_map
    assert ref_map["Modal"].single_refs == {"trigger", "content"}


def test_custom_catalog_pydantic_models():
    from a2ui.core.catalog.components import ModelComponentApi

    class AccordionSection(BaseModel):
        header: str
        contentSlot: SingleReference

    class Accordion(BaseModel):
        sections: list[AccordionSection]
        fallbackView: SingleReference

    class HeroBanner(BaseModel):
        title: str
        ctaActionSlot: SingleReference

    cat = Catalog(
        catalog_id="https://a2ui.org/custom-pydantic-cat",
        protocol_version="v1.0",
        components=[
            ModelComponentApi(Accordion, name="Accordion"),
            ModelComponentApi(HeroBanner, name="HeroBanner"),
        ],
        functions=[],
    )

    ref_map = cat.component_ref_map
    assert "Accordion" in ref_map
    assert ref_map["Accordion"].single_refs == {"fallbackView"}
    assert "sections" in ref_map["Accordion"].list_refs
    assert ref_map["Accordion"].nested_refs["sections"] == {"contentSlot"}

    assert "HeroBanner" in ref_map
    assert ref_map["HeroBanner"].single_refs == {"ctaActionSlot"}


def test_custom_catalog_json_schemas():
    custom_json = {
        "catalogId": "https://a2ui.org/custom-json-cat",
        "protocolVersion": "v1.0",
        "components": {
            "DashboardLayout": {
                "type": "object",
                "properties": {
                    "sidebar": {
                        "$ref": (
                            "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Child"
                        )
                    },
                    "main": {
                        "$ref": (
                            "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"
                        )
                    },
                    "widgets": {
                        "$ref": (
                            "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList"
                        )
                    },
                },
            },
            "MetricCard": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "value": {"type": "number"},
                },
            },
        },
    }

    cat = Catalog.from_json(
        custom_json,
        catalog_id="https://a2ui.org/custom-json-cat",
        protocol_version="v1.0",
    )
    ref_map = cat.component_ref_map

    assert "DashboardLayout" in ref_map
    assert ref_map["DashboardLayout"].single_refs == {"sidebar", "main"}
    assert ref_map["DashboardLayout"].list_refs == {"widgets"}

    assert "MetricCard" in ref_map
    assert ref_map["MetricCard"].single_refs == set()
    assert ref_map["MetricCard"].list_refs == set()


def test_unreferenced_child_property_names_return_empty_ref_spec():
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "child": {"type": "string"},
            "children": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
    }

    # reference_map strictly requires $ref to ComponentId/Child/ChildList
    spec = analyze_child_ref_schema(schema)
    assert spec.single_refs == set()
    assert spec.list_refs == set()
