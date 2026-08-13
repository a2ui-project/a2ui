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

import json
import os
import pytest
from a2ui.template import (
    Template,
    TemplateProcessor,
    TemplateInferenceFormat,
    A2uiTemplateManager,
)


def get_examples_dir() -> str:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(
        os.path.dirname(os.path.dirname(current_dir)),
        "src",
        "a2ui",
        "template",
        "examples",
    )


def load_example(name: str) -> Template:
    file_path = os.path.join(get_examples_dir(), f"{name}.json")
    return Template.from_json_file(file_path)


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
    assert card["child"] == "alice_card_col"

    col = next(c for c in expanded if c["id"] == "alice_card_col")
    assert col["component"] == "Column"
    assert col["children"] == [
        "alice_card_avatar_icon",
        "alice_card_name_text",
        "alice_card_role_text",
    ]

    name_text = next(c for c in expanded if c["id"] == "alice_card_name_text")
    assert name_text["text"] == "Alice Smith"

    role_text = next(c for c in expanded if c["id"] == "alice_card_role_text")
    assert role_text["text"] == "Admin"


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

    role_text = next(c for c in expanded if c["id"] == "bob_card_role_text")
    assert role_text["text"] == "Member"


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

    # Verify unrolled children in members_col
    members_col = next(c for c in expanded if c["id"] == "arch_team_members_col")
    assert members_col["children"] == [
        "arch_team_members_col_item_0",
        "arch_team_members_col_item_1",
    ]

    # Elena's card
    elena_card = next(c for c in expanded if c["id"] == "arch_team_members_col_item_0")
    assert elena_card["component"] == "Card"

    elena_name = next(
        c for c in expanded if c["id"] == "arch_team_members_col_item_0_name_text"
    )
    assert elena_name["text"] == "Elena"

    # Marcus default role
    marcus_role = next(
        c for c in expanded if c["id"] == "arch_team_members_col_item_1_role_text"
    )
    assert marcus_role["text"] == "Member"


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
    assert root["children"] == ["roster_title_banner", "roster_roster_list"]

    roster_list = next(c for c in expanded if c["id"] == "roster_roster_list")
    assert roster_list["children"] == ["team_1", "team_2"]


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
    assert any(c["id"] == "team_goals_goals_container_item_0" for c in expanded)
    assert any(c["id"] == "team_goals_goals_container_item_1" for c in expanded)


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
    assert any(c["id"] == "board_feedbacks_container_item_0" for c in expanded)


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
    name_text = next(c for c in components if c["id"] == "root_name_text")
    assert name_text["text"] == "Sarah Jenkins"
    role_text = next(c for c in components if c["id"] == "root_role_text")
    assert role_text["text"] == "Lead Designer"


def test_template_full_object_schema_and_nested_properties():
    # Define a template with a full JSON schema object parameter
    tmpl_data = {
        "templateId": "DeveloperBadge",
        "parameters": {
            "developer": {
                "type": "object",
                "properties": {
                    "handle": {"type": "string"},
                    "details": {
                        "type": "object",
                        "properties": {
                            "team": {"type": "string"},
                            "stars": {"type": "integer"},
                        },
                        "required": ["team", "stars"],
                    },
                },
                "required": ["handle", "details"],
            }
        },
        "components": [
            {"id": "root", "component": "Card", "child": "badge_col"},
            {
                "id": "badge_col",
                "component": "Column",
                "children": ["dev_handle", "dev_stars"],
            },
            {
                "id": "dev_handle",
                "component": "Text",
                "text": "Developer: ${developer.handle} (${developer.details.team})",
            },
            {
                "id": "dev_stars",
                "component": "Text",
                "text": "Stars: ${developer.details.stars}",
            },
        ],
        "sampleData": {
            "developer": {
                "handle": "@octocat",
                "details": {"team": "Core Dev", "stars": 120},
            }
        },
    }

    tmpl = Template.from_dict(tmpl_data)
    processor = TemplateProcessor(templates=[tmpl])

    expanded = processor.expand_template(
        instance_id="dev_1",
        template_id="DeveloperBadge",
        passed_params={
            "developer": {
                "handle": "@jsmith",
                "details": {"team": "Infrastructure", "stars": 350},
            }
        },
    )

    handle_text = next(c for c in expanded if c["id"] == "dev_1_dev_handle")
    assert handle_text["text"] == "Developer: @jsmith (Infrastructure)"
    stars_text = next(c for c in expanded if c["id"] == "dev_1_dev_stars")
    assert stars_text["text"] == "Stars: 350"


def test_template_static_validation_rejection():
    # Rejects invalid property reference in component definition
    invalid_tmpl_data = {
        "templateId": "BadTemplate",
        "parameters": {
            "user": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                },
            }
        },
        "components": [{
            "id": "root",
            "component": "Text",
            "text": "${user.nonexistent_field}",
        }],
    }

    with pytest.raises(ValueError, match="not declared in parameter 'user'"):
        Template.from_dict(invalid_tmpl_data)


def test_template_runtime_schema_validation_rejection():
    tmpl_data = {
        "templateId": "StrictScore",
        "parameters": {
            "score": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
            }
        },
        "components": [{"id": "root", "component": "Text", "text": "Score: ${score}"}],
    }

    tmpl = Template.from_dict(tmpl_data)
    processor = TemplateProcessor(templates=[tmpl])

    # Valid score passes
    expanded = processor.expand_template("score_1", "StrictScore", {"score": 85})
    assert expanded[0]["text"] == "Score: 85"

    # String passed instead of integer fails validation
    with pytest.raises(ValueError, match="failed validation"):
        processor.expand_template("score_2", "StrictScore", {"score": "not_a_number"})


def test_template_json_concat_and_format_expressions():
    tmpl_data = {
        "templateId": "FormattedCard",
        "parameters": {
            "title": {"type": "string"},
            "level": {"type": "enum", "values": ["Senior", "Principal"]},
            "years": {"type": "integer"},
        },
        "components": [
            {
                "id": "root",
                "component": "Card",
                "child": "txt",
            },
            {
                "id": "txt",
                "component": "Text",
                "text": {
                    "concat": [
                        {"param": "level"},
                        " ",
                        {"param": "title"},
                        " (",
                        {"param": "years"},
                        " yrs)",
                    ]
                },
            },
        ],
        "sampleData": {
            "title": "Engineer",
            "level": "Principal",
            "years": 10,
        },
    }

    tmpl = Template.from_dict(tmpl_data)
    processor = TemplateProcessor(templates=[tmpl])

    expanded = processor.expand_template(
        "inst_1",
        "FormattedCard",
        {"title": "Architect", "level": "Principal", "years": 12},
    )
    txt_comp = next(c for c in expanded if c["id"] == "inst_1_txt")
    assert txt_comp["text"] == "Principal Architect (12 yrs)"

    # Test invalid enum value
    with pytest.raises(ValueError, match="failed validation"):
        processor.expand_template(
            "inst_2",
            "FormattedCard",
            {"title": "Architect", "level": "Junior", "years": 1},
        )


def test_template_definition_schema_rejection_for_invalid_template():
    # Missing required 'components' field
    invalid_tmpl = {
        "templateId": "BadTemplate",
        "parameters": {"name": {"type": "string"}},
    }
    with pytest.raises(ValueError, match="fails template_definition.json schema"):
        Template.from_dict(invalid_tmpl)
