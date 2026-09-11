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

"""Conformance tests verifying fluent builder serialization against golden JSON files."""

import json
import os
from typing import Any
import pytest
import yaml

from a2ui.builder.v0_9 import (
    AccessibilityAttributes,
    Action,
    CheckRule,
    ComponentRef,
    ComponentTree,
    DynamicChildList,
    FunctionCall,
    bind,
    create_surface,
    flatten_component_tree,
    update_components,
)
from a2ui.builder.v0_9.catalogs import basic_catalog
from a2ui.builder.v0_9.catalogs.basic_catalog import (
    Button,
    Card,
    Column,
    Divider,
    Icon,
    Row,
    Text,
    open_url,
    regex,
)

GOLDEN_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "../../../../../conformance/builder/golden",
    )
)
BUILDER_YAML_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "../../../../../conformance/builder/builder.yaml",
    )
)


def _load_golden(filename: str) -> Any:
    path = os.path.join(GOLDEN_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def test_conformance_01_primitive_components():
    """01: Primitive components with static attributes and strict enums."""
    tree = [
        Text(id="header_text", text="Welcome to A2UI", variant="h1"),
        Divider(id="divider_0", axis="horizontal"),
        Text(id="body_text", text="This is a simple text component.", variant="body"),
    ]
    actual = flatten_component_tree(tree)
    expected = _load_golden("01_primitive_components.json")
    assert actual == expected


def test_conformance_02_nested_hierarchy_and_slots():
    """02: Nested component trees with single and multi-child slots."""
    tree = Card(
        id="main_card",
        child=Column(
            id="main_col",
            children=[
                Text(id="title", text="Dashboard", variant="h2"),
                Divider(id="div_1"),
                Row(
                    id="action_row",
                    children=[
                        Icon(id="save_icon", name="check"),
                        Button(
                            id="btn_save",
                            variant="primary",
                            child=Text(id="btn_save_text", text="Save Changes"),
                            action=Action(event="save_changes"),
                        ),
                    ],
                ),
            ],
        ),
    )
    actual = flatten_component_tree(tree)
    expected = _load_golden("02_nested_hierarchy_and_slots.json")
    assert actual == expected


def test_conformance_03_automatic_id_allocation():
    """03: Scoped deterministic ID allocation via IdAllocator."""
    tree = Card(
        child=Column(
            children=[
                Text(text="First Item"),
                Text(text="Second Item"),
            ],
        ),
    )
    actual = flatten_component_tree(tree, root_id="panel")
    expected = _load_golden("03_automatic_id_allocation.json")
    assert actual == expected


def test_conformance_04_data_bindings():
    """04: Dynamic data bindings with path normalization."""
    tree = Card(
        id="profile_card",
        child=Column(
            id="profile_col",
            children=[
                Text(id="user_greeting", text=bind("user/displayName"), variant="h3"),
                Text(id="user_balance", text=bind("/account/balance"), variant="body"),
            ],
        ),
    )
    actual = flatten_component_tree(tree)
    expected = _load_golden("04_data_bindings.json")
    assert actual == expected


def test_conformance_05_accessibility_attributes():
    """05: Native Pydantic serialization of AccessibilityAttributes."""
    tree = Button(
        id="accessible_button",
        accessibility=AccessibilityAttributes(
            label="Submit Application",
            description="Transmits all form entries to the review server",
            live="assertive",
            hidden=bind("/form/isSubmitting"),
        ),
        child=Text(id="btn_label", text="Submit"),
        action=Action(event="submit_application"),
    )
    actual = flatten_component_tree(tree)
    expected = _load_golden("05_accessibility_attributes.json")
    assert actual == expected


def test_conformance_06_actions_and_function_calls():
    """06: Actions with server event context maps and client functions."""
    btn_event = Button(
        id="btn_checkout",
        variant="primary",
        child=Text(id="txt_checkout", text="Checkout"),
        action=Action(
            event="order_checkout",
            context={
                "cartId": "cart_99",
                "userId": bind("/session/uid"),
                "total": 49.99,
            },
        ),
    )

    btn_fn = Button(
        id="btn_help",
        child=Text(id="txt_help", text="Help Center"),
        action=Action(
            function=open_url(url="https://a2ui.org/docs", call_id="nav_help")
        ),
    )

    tree = Column(id="action_col", children=[btn_event, btn_fn])
    actual = flatten_component_tree(tree)
    expected = _load_golden("06_actions_and_function_calls.json")
    assert actual == expected


def test_conformance_07_dynamic_child_list():
    """07: DynamicChildList templates bound to data model collections."""
    tree = Column(
        id="feed_container",
        children=DynamicChildList(
            data_model_path="feed/posts",
            template=Card(
                id="post_card",
                child=Text(id="post_title", text=bind("title")),
            ),
        ),
    )
    actual = flatten_component_tree(tree)
    expected = _load_golden("07_dynamic_child_list.json")
    assert actual == expected


def test_conformance_08_component_references():
    """08: External surface component slot references (ComponentRef)."""
    tree = Card(
        id="outer_card",
        child=Column(
            id="inner_col",
            children=[
                Text(id="intro_text", text="Header"),
                ComponentRef(id="existing_surface_widget"),
            ],
        ),
    )
    actual = flatten_component_tree(tree)
    expected = _load_golden("08_component_references.json")
    assert actual == expected


def test_conformance_09_surface_lifecycle_envelopes():
    """09: Packaging component trees into standard A2UI envelopes."""
    root = Card(id="hero_card", child=Text(id="hero_txt", text="A2UI"))

    create_msgs = create_surface("main_surface", root=root, catalog_id="org.a2ui.basic")
    update_msgs = update_components("main_surface", root=root)

    tree = ComponentTree(root=root, surface_id="main_surface")
    full_surface = tree.to_surface(
        surface_id="main_surface",
        catalog_id="org.a2ui.basic",
        data_model={"/session/user": "Alice"},
    )

    actual = {
        "create_surface": [
            m.model_dump(by_alias=True, exclude_none=True)
            if hasattr(m, "model_dump")
            else m
            for m in create_msgs
        ],
        "update_components": [
            m.model_dump(by_alias=True, exclude_none=True)
            if hasattr(m, "model_dump")
            else m
            for m in update_msgs
        ],
        "full_surface": full_surface,
    }
    expected = _load_golden("09_surface_lifecycle_envelopes.json")
    assert actual == expected


def test_conformance_10_validation_rules():
    """10: Client validation rules (CheckRule) with function condition."""
    rule = CheckRule(
        condition=regex(value=bind("/user/zip"), pattern="^[0-9]{5}$"),
        message="ZIP code must be 5 digits",
    )
    actual = rule.to_dict()
    expected = _load_golden("10_validation_rules.json")
    assert actual == expected


# =============================================================================
# Declarative YAML Suite Loader (Thread 41)
# =============================================================================


def load_ast_from_yaml(val: Any) -> Any:
    """Recursively constructs A2UI builder AST nodes from declarative YAML test structures."""
    if isinstance(val, list):
        return [load_ast_from_yaml(item) for item in val]
    if isinstance(val, dict):
        if "$bind" in val:
            return bind(val["$bind"])
        if "$componentRef" in val:
            return ComponentRef(id=val["$componentRef"])
        if "$dynamicChildList" in val:
            d = val["$dynamicChildList"]
            return DynamicChildList(
                data_model_path=d["dataModelPath"],
                template=load_ast_from_yaml(d["template"]),
            )
        if "component" in val:
            comp_type = val["component"]
            cls = getattr(basic_catalog, comp_type)
            kwargs = {
                k: load_ast_from_yaml(v)
                for k, v in val.items()
                if k != "component"
            }
            return cls(**kwargs)
        if "call" in val:
            call_name = val["call"]
            args = {k: load_ast_from_yaml(v) for k, v in val.get("args", {}).items()}
            return FunctionCall(call=call_name, args=args, call_id=val.get("callId"))
        if "event" in val or "function" in val:
            kwargs = {}
            if "event" in val:
                kwargs["event"] = val["event"]
            if "function" in val:
                kwargs["function"] = load_ast_from_yaml(val["function"])
            if "context" in val:
                kwargs["context"] = {k: load_ast_from_yaml(v) for k, v in val["context"].items()}
            return Action(**kwargs)
        if "label" in val and "value" in val and len(val) == 2:
            return basic_catalog.ChoiceOption(label=load_ast_from_yaml(val["label"]), value=val["value"])
        if "title" in val and "child" in val and len(val) == 2:
            return basic_catalog.TabItem(title=load_ast_from_yaml(val["title"]), child=load_ast_from_yaml(val["child"]))
        if "label" in val or "description" in val or "live" in val or "hidden" in val:
            return AccessibilityAttributes(**{k: load_ast_from_yaml(v) for k, v in val.items()})
        return {k: load_ast_from_yaml(v) for k, v in val.items()}
    return val


def _load_yaml_cases():
    if not os.path.exists(BUILDER_YAML_PATH):
        return []
    with open(BUILDER_YAML_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("tests", [])


@pytest.mark.parametrize(
    "case",
    _load_yaml_cases(),
    ids=lambda c: c["id"],
)
def test_declarative_conformance_suite(case: dict[str, Any]):
    """Verifies that the declarative builder.yaml suite executes identically across all SDKs."""
    test_type = case.get("type", "tree")
    golden = _load_golden(case["golden"])

    if test_type == "tree":
        ast = load_ast_from_yaml(case["input"])
        root_id = case.get("root_id")
        actual = flatten_component_tree(ast, root_id=root_id)
        assert actual == golden
    elif test_type == "envelopes":
        root = load_ast_from_yaml(case["input"])
        surface_id = case["surface_id"]
        catalog_id = case["catalog_id"]
        data_model = case.get("data_model")

        create_msgs = create_surface(surface_id, root=root, catalog_id=catalog_id)
        update_msgs = update_components(surface_id, root=root)
        tree = ComponentTree(root=root, surface_id=surface_id)
        full_surface = tree.to_surface(
            surface_id=surface_id,
            catalog_id=catalog_id,
            data_model=data_model,
        )

        actual = {
            "create_surface": [
                m.model_dump(by_alias=True, exclude_none=True)
                if hasattr(m, "model_dump")
                else m
                for m in create_msgs
            ],
            "update_components": [
                m.model_dump(by_alias=True, exclude_none=True)
                if hasattr(m, "model_dump")
                else m
                for m in update_msgs
            ],
            "full_surface": full_surface,
        }
        assert actual == golden
    elif test_type == "rule":
        cond_raw = case["input"]["condition"]
        args = {k: load_ast_from_yaml(v) for k, v in cond_raw.get("args", {}).items()}
        cond = FunctionCall(call=cond_raw["call"], args=args)
        rule = CheckRule(condition=cond, message=case["input"]["message"])
        assert rule.to_dict() == golden

