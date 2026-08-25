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

import os
from pathlib import Path
import pytest
from a2ui.inference_formats.experimental.template import (
    Template,
    StaticTemplate,
    DynamicTemplate,
    Param,
    ParamType,
    ParamRef,
    Concat,
    TemplateComponent,
    TemplateLoop,
    TemplateProcessor,
    TemplateInferenceFormat,
    A2uiTemplateManager,
    flatten_nested_layout,
    normalize_node,
    A2UIComponent,
    A2UIComponentList,
    TemplateParams,
    TemplateId,
    InstanceId,
)


def get_examples_dir() -> str:
    curr = Path(__file__).resolve()
    while curr != curr.parent:
        if (curr / "specification").exists():
            return str(curr / "specification" / "proposals" / "templates" / "examples")
        curr = curr.parent
    raise RuntimeError("Could not locate repo root containing 'specification'")


def load_example(name: str) -> Template:
    file_path = os.path.join(get_examples_dir(), f"{name}.yaml")
    return Template.from_yaml_file(file_path)[0]


def test_user_profile_template_expansion():
    user_profile = load_example("user_profile")
    processor = TemplateProcessor(templates=[user_profile])

    expanded = processor.expand_template(
        instance_id="alice_card",
        template_id="UserProfile",
        passed_params={
            "userId": "u123",
            "userName": "Alice Smith",
            "role": "Admin",
        },
    )

    assert len(expanded) == 5

    card = next(c for c in expanded if c["id"] == "alice_card")
    assert card["component"] == "Card"

    name_text = next(
        c
        for c in expanded
        if "text" in c and c.get("component") == "Text" and c["text"] == "Alice Smith"
    )
    assert name_text is not None

    role_text = next(
        c
        for c in expanded
        if "text" in c and c.get("component") == "Text" and c["text"] == "Admin"
    )
    assert role_text is not None


def test_user_profile_default_role():
    user_profile = load_example("user_profile")
    processor = TemplateProcessor(templates=[user_profile])

    expanded = processor.expand_template(
        instance_id="bob_card",
        template_id="UserProfile",
        passed_params={
            "userId": "u456",
            "userName": "Bob",
        },
    )

    role_text = next(c for c in expanded if "text" in c and c["text"] == "Member")
    assert role_text is not None


def test_nested_team_card_loop_unrolling():
    user_profile = load_example("user_profile")
    team_card = load_example("team_card")
    processor = TemplateProcessor(templates=[user_profile, team_card])

    data = {
        "teamName": "Core Architecture",
        "members": [
            {"userId": "u1", "userName": "Elena", "role": "Principal"},
            {"userId": "u2", "userName": "Marcus"},
        ],
    }

    expanded = processor.expand_template(
        instance_id="arch_team",
        template_id="TeamCard",
        passed_params=data,
    )

    root_card = next(c for c in expanded if c["id"] == "arch_team")
    assert root_card["component"] == "Card"

    # Elena's name
    elena_name = next(c for c in expanded if "text" in c and c["text"] == "Elena")
    assert elena_name is not None

    # Marcus default role
    marcus_role = next(c for c in expanded if "text" in c and c["text"] == "Member")
    assert marcus_role is not None


def test_team_roster_template():
    user_profile = load_example("user_profile")
    team_card = load_example("team_card")
    team_roster = load_example("team_roster")

    processor = TemplateProcessor(templates=[user_profile, team_card, team_roster])

    expanded = processor.expand_template(
        instance_id="roster",
        template_id="TeamRoster",
        passed_params={
            "directoryTitle": "Global Directory",
            "children": ["team_1", "team_2"],
        },
    )

    root = next(c for c in expanded if c["id"] == "roster")
    assert root["component"] == "Column"


def test_goal_item_and_team_goal_list():
    goal_item = load_example("goal_item")
    team_goal_list = load_example("team_goal_list")

    processor = TemplateProcessor(templates=[goal_item, team_goal_list])

    expanded = processor.expand_template(
        instance_id="team_goals",
        template_id="TeamGoalList",
        passed_params={
            "teamName": "Protocol Team",
            "goals": [
                {
                    "title": "Upgrade Agent SDK",
                    "priority": "High",
                    "targetDate": "2026-08-30",
                },
                {"title": "Clean Demos", "targetDate": "2026-09-15"},
            ],
        },
    )

    assert any(c["id"] == "team_goals" for c in expanded)
    assert any("Upgrade Agent SDK" in str(c.get("text")) for c in expanded)


def test_feedback_item_and_board():
    feedback_item = load_example("feedback_item")
    feedback_board = load_example("team_feedback_board")

    processor = TemplateProcessor(templates=[feedback_item, feedback_board])

    expanded = processor.expand_template(
        instance_id="board",
        template_id="TeamFeedbackBoard",
        passed_params={
            "teamName": "Core Engineers",
            "feedbacks": [
                {"author": "Alice", "note": "Great synchronous speed!", "rating": 5},
            ],
        },
    )

    assert any(c["id"] == "board" for c in expanded)
    assert any("Great synchronous speed!" in str(c.get("text")) for c in expanded)


def test_section_card_with_slots():
    section_card = load_example("section_card")
    processor = TemplateProcessor(templates=[section_card])

    expanded = processor.expand_template(
        instance_id="sec",
        template_id="SectionCard",
        passed_params={
            "title": "Settings",
            "description": "Configure your options",
            "headerAction": "settings_btn",
            "children": ["opt_1", "opt_2"],
        },
    )

    action_slot = next(c for c in expanded if c["id"] == "sec_action_slot")
    assert action_slot["children"] == ["settings_btn"]

    body_container = next(c for c in expanded if c["id"] == "sec_body_container")
    assert body_container["children"] == ["opt_1", "opt_2"]


def test_process_message_create_surface():
    user_profile = load_example("user_profile")
    processor = TemplateProcessor(templates=[user_profile])

    msg = {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "user_view",
            "components": [{
                "id": "my_user",
                "component": "UserProfile",
                "userId": "usr_999",
                "userName": "Sarah Connor",
                "role": "Defender",
            }],
        },
    }

    processed = processor.process_message(msg)
    components = processed["createSurface"]["components"]
    assert len(components) == 5
    assert components[0]["id"] == "root"
    assert components[0]["component"] == "Card"


def test_template_inference_format_end_to_end():
    user_profile = load_example("user_profile")
    manager = TemplateInferenceFormat(
        templates=[user_profile],
        surface_id="main_surface",
        version="0.9.1",
    )

    # 1. Check prompt generation includes UserProfile signature when include_schema=True
    prompt = manager.prompt_generator.generate(
        role_description="Test Agent", include_schema=True
    )
    assert "UserProfile" in prompt

    # 2. Check parsing and expansion of Express DSL response
    llm_output = """
    Here is your profile card:
    <a2ui>
    root = UserProfile("usr_99", "Sarah Jenkins", "Lead Designer")
    </a2ui>
    """

    parts = manager.parser.parse_response(llm_output)
    assert len(parts) == 1
    assert "Here is your profile card:" in parts[0].text
    assert parts[0].a2ui_json is not None

    messages = parts[0].a2ui_json
    assert len(messages) == 2

    # In v0.9.1, createSurface and updateComponents are separate
    create_surface = messages[0].get("createSurface")
    assert create_surface is not None
    assert create_surface["surfaceId"] == "main_surface"

    update_components = messages[1].get("updateComponents")
    assert update_components is not None
    assert update_components["surfaceId"] == "main_surface"

    components = update_components["components"]
    assert len(components) == 5
    name_text = next(
        c
        for c in components
        if c.get("component") == "Text" and c.get("text") == "Sarah Jenkins"
    )
    assert name_text is not None
    role_text = next(
        c
        for c in components
        if c.get("component") == "Text" and c.get("text") == "Lead Designer"
    )
    assert role_text is not None


def test_multi_document_yaml_loading_and_forward_references():
    yaml_suite = """
version: "0.1"
templateId: RosterView
description: Top-level roster view.
parameters:
  title: {type: string}
  members: {type: array}
layout:
  component: Column
  children:
    - component: Text
      text: ${title}
      variant: h1
    - component: Column
      children:
        loop:
          param: members
          template: MemberCard # Forward reference to MemberCard below!

---

version: "0.1"
templateId: MemberCard
description: Member identity card.
parameters:
  name: {type: string}
  title: {type: string}
layout:
  component: Card
  child:
    component: Column
    children:
      - component: Text
        text: ${name}
        variant: h3
      - component: Text
        text: ${title}
        variant: caption
"""
    templates = StaticTemplate.from_yaml_string(yaml_suite)
    assert len(templates) == 2
    assert templates[0].template_id == "RosterView"
    assert templates[1].template_id == "MemberCard"

    # Expand RosterView (which forward-references MemberCard)
    processor = TemplateProcessor(templates=templates)
    expanded = processor.expand_template(
        "inst_1",
        "RosterView",
        {
            "title": "Engineering Team",
            "members": [
                {"name": "Alice", "title": "Staff Engineer"},
                {"name": "Bob", "title": "Tech Lead"},
            ],
        },
    )

    assert any(c.get("text") == "Engineering Team" for c in expanded)
    assert any(c.get("text") == "Alice" for c in expanded)
    assert any(c.get("text") == "Bob" for c in expanded)


def test_inline_loop_expansion():
    yaml_tmpl = """
version: "0.1"
templateId: InlineListCard
description: Card with inline unrolled loop items.
parameters:
  teamName: {type: string}
  skills: {type: array}
layout:
  component: Card
  child:
    component: Column
    children:
      - component: Text
        text: ${teamName}
        variant: h2
      - component: Column
        children:
          loop:
            param: skills
            as: skill
            item:
              component: Row
              justify: spaceBetween
              children:
                - component: Text
                  text: ${skill.name}
                - component: Text
                  text: "Lvl ${skill.level}"
"""

    template = StaticTemplate.from_yaml(yaml_tmpl)
    processor = TemplateProcessor(templates=[template])

    expanded = processor.expand_template(
        "inst_inline",
        "InlineListCard",
        {
            "teamName": "Frontend Guild",
            "skills": [
                {"name": "TypeScript", "level": "Expert"},
                {"name": "A2UI Protocols", "level": "Master"},
            ],
        },
    )

    assert any(c.get("text") == "Frontend Guild" for c in expanded)
    assert any(c.get("text") == "TypeScript" for c in expanded)
    assert any(c.get("text") == "Lvl Master" for c in expanded)


def test_missing_template_reference_raises_clear_error():
    yaml_tmpl = """
version: "0.1"
templateId: BadReference
parameters:
  items: {type: array}
layout:
  component: Column
  children:
    loop:
      param: items
      template: NonExistentTemplate
"""
    tmpl = StaticTemplate.from_yaml(yaml_tmpl)
    processor = TemplateProcessor(templates=[tmpl])

    with pytest.raises(
        ValueError, match="Template 'NonExistentTemplate' is not registered"
    ):
        processor.expand_template("inst_bad", "BadReference", {"items": [{"id": 1}]})


def test_recursion_cycle_guard():
    # Template A references Template B, and Template B references Template A
    yaml_suite = """
version: "0.1"
templateId: NodeA
parameters:
  dummy: {type: string, default: "x"}
layout:
  component: Column
  children:
    - component: NodeB

---

version: "0.1"
templateId: NodeB
parameters:
  dummy: {type: string, default: "y"}
layout:
  component: Column
  children:
    - component: NodeA
"""
    templates = StaticTemplate.from_yaml_string(yaml_suite)
    processor = TemplateProcessor(templates=templates)

    with pytest.raises(ValueError, match="Circular template reference detected"):
        processor.expand_template("cycle_root", "NodeA", {})


def test_non_text_parameter_type_preservation():
    yaml_tmpl = """
version: "0.1"
templateId: TypedControls
description: Card showing numbers, booleans, and objects.
parameters:
  count: {type: integer}
  isActive: {type: boolean}
  actionObj: {type: action}
layout:
  component: Card
  child:
    component: Column
    children:
      - component: Slider
        value: ${count}
        disabled: ${isActive}
      - component: Button
        onClick: ${actionObj}
"""

    tmpl = StaticTemplate.from_yaml(yaml_tmpl)
    processor = TemplateProcessor(templates=[tmpl])

    expanded = processor.expand_template(
        "ctrl_1",
        "TypedControls",
        {
            "count": 42,
            "isActive": False,
            "actionObj": {"actionId": "submit_form", "context": {"user": "alice"}},
        },
    )

    slider = next(c for c in expanded if c.get("component") == "Slider")
    assert slider["value"] == 42
    assert type(slider["value"]) is int
    assert slider["disabled"] is False
    assert type(slider["disabled"]) is bool

    btn = next(c for c in expanded if c.get("component") == "Button")
    assert btn["onClick"] == {"actionId": "submit_form", "context": {"user": "alice"}}
    assert type(btn["onClick"]) is dict


def test_dynamic_template_with_resolver():
    salary_layout = load_example("salary_card")

    # Mock database lookup resolver
    def resolve_salary(employeeId: str):
        db = {
            "emp_101": {
                "employeeName": "Dr. Elena Vance",
                "role": "Principal Systems Architect",
                "baseSalary": "$215,000",
                "annualBonus": "$45,000",
                "equity": "3,500 RSUs",
                "clearanceLevel": "Level 5 - Confidential",
                "verifiedAt": "2026-08-13",
            }
        }
        if employeeId not in db:
            raise ValueError(f"Unknown employee {employeeId}")
        return db[employeeId]

    dynamic_tmpl = DynamicTemplate(
        template_id="EmployeeSalaryCard",
        resolver=resolve_salary,
        layout=salary_layout,
        description="Secure employee salary card resolved server-side.",
    )

    assert "employeeId" in dynamic_tmpl.parameters
    assert dynamic_tmpl.is_dynamic is True

    processor = TemplateProcessor(templates=[dynamic_tmpl])
    synthetic_cat = processor.generate_inference_catalog()
    assert "EmployeeSalaryCard" in synthetic_cat["components"]

    expanded = processor.expand_template(
        "salary_inst", "EmployeeSalaryCard", {"employeeId": "emp_101"}
    )
    assert len(expanded) > 5

    name_txt = next(c for c in expanded if c.get("text") == "Dr. Elena Vance")
    assert name_txt is not None

    sal_val = next(c for c in expanded if c.get("text") == "$215,000")
    assert sal_val is not None


def test_programmatic_dynamic_template_render():
    def render_server_health(serverId: str, includeDisks: bool = True):
        status_icon = "check_circle" if serverId == "srv_01" else "warning"

        disk_items = []
        if includeDisks:
            mounts = [("/", 45), ("/data", 82), ("/var/log", 12)]
            for mount, usage in mounts:
                disk_items.append({
                    "component": "Row",
                    "justify": "spaceBetween",
                    "children": [
                        {"component": "Text", "text": mount, "variant": "caption"},
                        {
                            "component": "Text",
                            "text": f"{usage}% used",
                            "variant": "caption",
                        },
                    ],
                })

        return {
            "component": "Card",
            "child": {
                "component": "Column",
                "children": [
                    {
                        "component": "Row",
                        "justify": "spaceBetween",
                        "align": "center",
                        "children": [
                            {
                                "component": "Text",
                                "text": f"Server {serverId}",
                                "variant": "h3",
                            },
                            {"component": "Icon", "name": status_icon},
                        ],
                    },
                    {"component": "Divider", "axis": "horizontal"},
                    {"component": "Text", "text": "CPU Load: 24.5%", "variant": "body"},
                    {"component": "Column", "children": disk_items},
                ],
            },
        }

    dyn_tmpl = DynamicTemplate(
        template_id="LiveServerHealth",
        render=render_server_health,
        description="Live server diagnostics.",
    )

    assert "serverId" in dyn_tmpl.parameters
    assert "includeDisks" in dyn_tmpl.parameters

    processor = TemplateProcessor(templates=[dyn_tmpl])
    expanded = processor.expand_template(
        "srv_dash",
        "LiveServerHealth",
        {"serverId": "srv_01", "includeDisks": True},
    )

    assert len(expanded) > 6
    root_card = next(c for c in expanded if c["id"] == "srv_dash")
    assert root_card["component"] == "Card"

    server_title = next(c for c in expanded if c.get("text") == "Server srv_01")
    assert server_title is not None

    disk_entry = next(c for c in expanded if c.get("text") == "82% used")
    assert disk_entry is not None


def test_programmatic_dynamic_template_duck_typing():
    # Mock class that implements .to_dict() protocol
    class MockCustomBadge:

        def __init__(self, label: str):
            self.label = label

        def to_dict(self):
            return {
                "component": "Card",
                "child": {
                    "component": "Text",
                    "text": f"[ {self.label} ]",
                    "variant": "caption",
                },
            }

    def render_badge(tag: str):
        return MockCustomBadge(tag)

    dyn_tmpl = DynamicTemplate(
        template_id="CustomBadgeView",
        render=render_badge,
    )

    processor = TemplateProcessor(templates=[dyn_tmpl])
    expanded = processor.expand_template(
        "badge_inst", "CustomBadgeView", {"tag": "ACTIVE"}
    )

    root = next(c for c in expanded if c["id"] == "badge_inst")
    assert root["component"] == "Card"
    text_node = next(c for c in expanded if c.get("text") == "[ ACTIVE ]")
    assert text_node is not None


def test_template_versioning_valid():
    yaml_content = """
version: "0.1"
templateId: SimpleVersionedTest
parameters:
  title:
    type: string
layout:
  component: Text
  text: ${title}
"""
    tmpl = StaticTemplate.from_yaml(yaml_content)
    assert tmpl.version == "0.1"
    d = tmpl.to_dict()
    assert d["version"] == "0.1"
    assert "version: '0.1'" in tmpl.to_yaml() or 'version: "0.1"' in tmpl.to_yaml()


def test_template_versioning_invalid():
    yaml_content = """
version: "0.2"
templateId: InvalidVersionTest
parameters:
  title:
    type: string
layout:
  component: Text
  text: ${title}
"""
    with pytest.raises(ValueError, match="Unsupported template version"):
        StaticTemplate.from_yaml(yaml_content)


def test_dynamic_template_resolve_non_dict_fallback():
    # Resolver returns None instead of a dict
    def bad_resolver():
        return None

    layout = StaticTemplate.from_yaml("""
version: "0.1"
templateId: LayoutForBadResolver
parameters:
  name:
    type: string
    default: FallbackName
layout:
  component: Text
  text: ${name}
""")

    dyn_tmpl = DynamicTemplate(
        template_id="BadResolverTemplate",
        resolver=bad_resolver,
        layout=layout,
    )
    processor = TemplateProcessor(templates=[dyn_tmpl])
    # Should not raise TypeError: unsupported operand type(s) for **: 'NoneType'
    expanded = processor.expand_template("bad_inst", "BadResolverTemplate", {})
    assert any(c.get("text") == "FallbackName" for c in expanded)


def test_template_data_binding_expression_on_primitive_param():
    yaml_content = """
version: "0.1"
templateId: PrimitiveWithBinding
parameters:
  label:
    type: string
layout:
  component: Text
  text: ${label}
"""
    tmpl = StaticTemplate.from_yaml(yaml_content)
    processor = TemplateProcessor(templates=[tmpl])
    # Pass an A2UI DataBinding dict to a primitive string param
    expanded = processor.expand_template(
        "inst_1", "PrimitiveWithBinding", {"label": {"path": "/session/userName"}}
    )
    text_node = next(c for c in expanded if c["id"] == "inst_1")
    assert text_node["text"] == {"path": "/session/userName"}


def test_programmatic_dynamic_template_extra_params_filtered():
    # Function that takes only 'title' without **kwargs
    def strict_render(title: str):
        return {
            "component": "Text",
            "text": title,
        }

    dyn_tmpl = DynamicTemplate(
        template_id="StrictTitleView",
        render=strict_render,
    )
    processor = TemplateProcessor(templates=[dyn_tmpl])
    # Pass extra parameter 'extra_field' that strict_render doesn't accept
    expanded = processor.expand_template(
        "strict_inst",
        "StrictTitleView",
        {"title": "Hello World", "extra_field": 12345},
    )
    text_node = next(c for c in expanded if c["id"] == "strict_inst")
    assert text_node["text"] == "Hello World"


def test_loop_definition_anyof_validation():
    # Loop missing both 'template' and 'item'
    invalid_yaml = """
version: "0.1"
templateId: InvalidLoopTemplate
parameters:
  items:
    type: array
layout:
  component: Column
  children:
    loop:
      param: items
"""
    with pytest.raises(ValueError, match="fails template_definition.json schema"):
        StaticTemplate.from_yaml(invalid_yaml)


def test_circular_template_reference_detection():
    # Template A references Template B which references Template A
    tmpl_a = StaticTemplate.from_yaml("""
version: "0.1"
templateId: CircularA
parameters: {}
layout:
  component: CircularB
""")

    tmpl_b = StaticTemplate.from_yaml("""
version: "0.1"
templateId: CircularB
parameters: {}
layout:
  component: CircularA
""")

    processor = TemplateProcessor(templates=[tmpl_a, tmpl_b])
    with pytest.raises(ValueError, match="Circular template reference detected"):
        processor.expand_template("inst_circ", "CircularA", {})


def test_normalize_node_dataclass_support():
    from dataclasses import dataclass

    @dataclass
    class CustomComponent:
        component: str
        text: str

    node = CustomComponent(component="Text", text="Hello Dataclass")
    d = normalize_node(node)
    assert isinstance(d, dict)
    assert d["component"] == "Text"
    assert d["text"] == "Hello Dataclass"


def test_dynamic_template_loop_custom_as_variable():
    # Verify that custom 'as: member' works without failing validation
    custom_loop_yaml = """
version: "0.1"
templateId: CustomLoopVarTemplate
parameters:
  members:
    type: array
layout:
  component: Column
  children:
    loop:
      param: members
      as: member
      item:
        component: Text
        text: ${member.name}
"""
    tmpl = StaticTemplate.from_yaml(custom_loop_yaml)
    assert tmpl.template_id == "CustomLoopVarTemplate"


def test_template_processor_completely_optional_base_catalog():
    tmpl = StaticTemplate.from_yaml("""
version: "0.1"
templateId: PureTemplate
parameters:
  title: {type: string}
layout:
  component: Card
  child:
    component: Text
    text: ${title}
""")
    # Initialize processor with NO base catalog whatsoever
    processor = TemplateProcessor(templates=[tmpl])
    assert processor.base_catalog is None
    assert processor.base_catalog_id is None

    # Synthetic catalog has no hardcoded primitives, only registered template
    cat = processor.generate_inference_catalog()
    assert "PureTemplate" in cat["components"]
    assert "Card" not in cat["components"]
    assert "Text" not in cat["components"]

    # Expansion works flawlessly
    expanded = processor.expand_template(
        "pure_inst", "PureTemplate", {"title": "Autonomous"}
    )
    assert len(expanded) == 2
    assert any(c.get("text") == "Autonomous" for c in expanded)

    # Process message does not inject any catalogId if base_catalog_id is None
    msg = {
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": "client_custom_catalog",
            "components": [],
        }
    }
    out_msg = processor.process_message(msg)
    assert out_msg["createSurface"]["catalogId"] == "client_custom_catalog"


def test_template_processor_with_custom_domain_catalog():
    # Catalog from custom domain with zero basic catalog references
    custom_catalog = {
        "$id": "https://company.org/custom_medical_catalog.json",
        "components": {
            "PatientChart": {"type": "object"},
            "VitalsGauge": {"type": "object"},
        },
        "functions": {},
    }

    tmpl = StaticTemplate.from_yaml("""
version: "0.1"
templateId: MedicalReport
parameters:
  patientName: {type: string}
layout:
  component: PatientChart
  properties:
    name: ${patientName}
""")

    processor = TemplateProcessor(templates=[tmpl], base_catalog=custom_catalog)
    assert (
        processor.base_catalog_id == "https://company.org/custom_medical_catalog.json"
    )

    # Inference catalog dynamically discovers custom catalog components
    cat = processor.generate_inference_catalog()
    assert "PatientChart" in cat["components"]
    assert "VitalsGauge" in cat["components"]
    assert "MedicalReport" in cat["components"]
    # No standard Basic Catalog primitives injected
    assert "Card" not in cat["components"]
    assert "Button" not in cat["components"]

    # Process message properly rewrites surface catalogId to custom catalog ID
    msg = {
        "createSurface": {
            "surfaceId": "med_surf",
            "catalogId": "placeholder",
            "components": [],
        }
    }
    out_msg = processor.process_message(msg)
    assert (
        out_msg["createSurface"]["catalogId"]
        == "https://company.org/custom_medical_catalog.json"
    )


def test_type_aliases_and_private_helpers():
    params: TemplateParams = {"user": {"profile": {"tier": "Pro"}}}
    from a2ui.inference_formats.experimental.template.processor import _resolve_param_path, _substitute_params

    found, val = _resolve_param_path("user.profile.tier", params)
    assert found is True
    assert val == "Pro"

    sub = _substitute_params("${user.profile.tier}", params)
    assert sub == "Pro"
