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

"""Typesafe template definitions using A2UI builder components.

Eliminates raw YAML files in favor of strongly-typed Python layouts.
"""

from __future__ import annotations

from typing import Any, Dict, List

from a2ui.inference_formats.experimental.macros.builder import (
    Action,
    Button,
    Card,
    Column,
    Divider,
    Icon,
    Row,
    Text,
)
from a2ui.inference_formats.experimental.template import (
    DynamicTemplate,
    StaticTemplate,
)

BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"

# ---------------------------------------------------------------------------
# 1. SalaryCard (Static Layout used by EmployeeSalaryCard)
# ---------------------------------------------------------------------------
salary_card_layout = Card(
    child=Column(
        children=[
            Row(
                justify="spaceBetween",
                align="center",
                children=[
                    Row(
                        align="center",
                        children=[
                            Icon(name="lock"),
                            Text(text="Verified Compensation", variant="caption"),
                        ],
                    ),
                    Text(text="{{ clearanceLevel }}", variant="caption"),
                ],
            ),
            Column(
                children=[
                    Text(text="{{ employeeName }}", variant="h3", id="name_txt"),
                    Text(text="{{ role }}", variant="body"),
                ]
            ),
            Divider(axis="horizontal"),
            Row(
                justify="spaceBetween",
                children=[
                    Column(
                        children=[
                            Text(text="Base Salary", variant="caption"),
                            Text(text="{{ baseSalary }}", variant="h4", id="sal_val"),
                        ]
                    ),
                    Column(
                        children=[
                            Text(text="Annual Bonus", variant="caption"),
                            Text(text="{{ annualBonus }}", variant="h4", id="bonus_val"),
                        ]
                    ),
                    Column(
                        children=[
                            Text(text="Equity Grant", variant="caption"),
                            Text(text="{{ equity }}", variant="h4", id="equity_val"),
                        ]
                    ),
                ],
            ),
            Divider(axis="horizontal"),
            Row(
                justify="spaceBetween",
                align="center",
                children=[
                    Text(text="Verified: {{ verifiedAt }}", variant="caption"),
                    Button(
                        action=Action(event="download_pay_stub"),
                        child=Text(text="Download Pay Stub"),
                    ),
                ],
            ),
        ]
    )
)

SalaryCard = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "SalaryCard",
    "templateId": "SalaryCard",
    "description": (
        "Layout card for employee compensation package with security verification"
        " badge."
    ),
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "employeeName": {"type": "string", "title": "Employee Full Name"},
        "role": {"type": "string", "title": "Job Title"},
        "baseSalary": {"type": "string", "title": "Base Salary"},
        "annualBonus": {"type": "string", "title": "Annual Bonus"},
        "equity": {"type": "string", "title": "Equity Grants"},
        "clearanceLevel": {
            "type": "string",
            "title": "Security Clearance",
            "default": "Level 4 - Confidential",
        },
        "verifiedAt": {
            "type": "string",
            "title": "Verification Date",
            "default": "2026-08-13",
        },
    },
    "layout": salary_card_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 2. UserProfile
# ---------------------------------------------------------------------------
user_profile_layout = Card(
    child=Column(
        align="center",
        children=[
            Icon(name="person"),
            Text(text="{{ userName }}", variant="h3"),
            Text(text="{{ role }}", variant="caption"),
        ],
    )
)

UserProfile = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "UserProfile",
    "templateId": "UserProfile",
    "description": "User profile card displaying avatar, full name, and role.",
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "userId": {"type": "string", "title": "User ID"},
        "userName": {"type": "string", "title": "User Name"},
        "role": {"type": "string", "title": "Role", "default": "Member"},
    },
    "sampleData": {
        "userId": "usr_101",
        "userName": "Alice Smith",
        "role": "Lead Architect",
    },
    "layout": user_profile_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 3. FeedbackItem
# ---------------------------------------------------------------------------
feedback_item_layout = Card(
    child=Column(
        children=[
            Text(text="{{ note }}", variant="body"),
            Divider(axis="horizontal"),
            Row(
                justify="spaceBetween",
                align="center",
                children=[
                    Text(text="{{ author }}", variant="caption"),
                    Text(text="Rating: {{ rating }}/5", variant="caption"),
                ],
            ),
        ]
    )
)

FeedbackItem = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "FeedbackItem",
    "templateId": "FeedbackItem",
    "description": "Card showing feedback note, author, and rating.",
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "author": {"type": "string", "title": "Author Name"},
        "note": {"type": "string", "title": "Feedback Note"},
        "rating": {
            "type": "number",
            "title": "Feedback Rating",
            "minimum": 1,
            "maximum": 5,
            "default": 5,
        },
    },
    "sampleData": {
        "author": "Dr. Elena Vance",
        "note": "A2UI templates are fast and easy to compose.",
        "rating": 5,
    },
    "layout": feedback_item_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 4. GoalItem
# ---------------------------------------------------------------------------
goal_item_layout = Card(
    child=Column(
        children=[
            Row(
                justify="spaceBetween",
                align="center",
                children=[
                    Text(text="Priority: {{ priority }}", variant="caption"),
                    Icon(name="star"),
                ],
            ),
            Text(text="{{ title }}", variant="h4"),
            Divider(axis="horizontal"),
            Row(
                justify="spaceBetween",
                align="center",
                children=[
                    Text(text="Due: {{ targetDate }}", variant="caption"),
                    Button(
                        action=Action(event="view_details"),
                        child=Text(text="View Details"),
                    ),
                ],
            ),
        ]
    )
)

GoalItem = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "GoalItem",
    "templateId": "GoalItem",
    "description": (
        "Card showing an individual objective with priority, title, target"
        " date, and action button."
    ),
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "title": {"type": "string", "title": "Goal Title"},
        "priority": {
            "type": "enum",
            "title": "Priority Level",
            "values": ["High", "Medium", "Low"],
            "default": "Medium",
        },
        "targetDate": {"type": "string", "title": "Target Date", "default": "2026-12-31"},
    },
    "sampleData": {
        "title": "Launch A2UI SDK v1.0",
        "priority": "High",
        "targetDate": "2026-09-30",
    },
    "layout": goal_item_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 5. SectionCard
# ---------------------------------------------------------------------------
section_card_layout = Card(
    child=Column(
        children=[
            Row(
                justify="spaceBetween",
                align="center",
                children=[
                    Text(text="{{ title }}", variant="h3"),
                    Column(id="action_slot", children="{{ headerAction }}"),  # type: ignore
                ],
            ),
            Text(text="{{ description }}", variant="caption"),
            Divider(axis="horizontal"),
            Column(id="body_container", children="{{ children }}"),  # type: ignore
        ]
    )
)

SectionCard = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "SectionCard",
    "templateId": "SectionCard",
    "description": (
        "Standard container card with title, description, optional action, and"
        " child components."
    ),
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "title": {"type": "string", "title": "Section Title"},
        "description": {
            "type": "string",
            "title": "Section Description",
            "default": "",
        },
        "headerAction": {"type": "child", "title": "Header Action Component"},
        "children": {"type": "children", "title": "Section Children", "default": []},
    },
    "sampleData": {
        "title": "Protocol Overview",
        "description": "High-level summary of the streaming architecture.",
        "children": [],
    },
    "layout": section_card_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 6. TeamCard
# ---------------------------------------------------------------------------
team_card_layout = Card(
    child=Column(
        children=[
            Row(
                justify="spaceBetween",
                align="center",
                children=[
                    Text(text="{{ teamName }}", variant="h3"),
                    Icon(name="person"),
                ],
            ),
            Divider(axis="horizontal"),
            Column(
                children={"loop": {"param": "members", "template": "UserProfile"}}  # type: ignore
            ),
        ]
    )
)

TeamCard = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "TeamCard",
    "templateId": "TeamCard",
    "description": "Card showing team header and unrolled member cards.",
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "teamName": {"type": "string", "title": "Team Name"},
        "members": {
            "type": "array",
            "title": "Team Members List",
            "items": {
                "type": "object",
                "properties": {
                    "userId": {"type": "string"},
                    "userName": {"type": "string"},
                    "role": {"type": "string", "default": "Member"},
                },
                "required": ["userId", "userName"],
            },
        },
    },
    "sampleData": {
        "teamName": "Antigravity Devs",
        "members": [
            {"userId": "usr_101", "userName": "Alice Smith", "role": "Lead Architect"},
            {"userId": "usr_102", "userName": "Bob Jones", "role": "Senior Engineer"},
            {
                "userId": "usr_103",
                "userName": "Charlie Brown",
                "role": "Product Manager",
            },
        ],
    },
    "layout": team_card_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 7. TeamRoster
# ---------------------------------------------------------------------------
team_roster_layout = Column(
    children=[
        Text(text="{{ directoryTitle }}", variant="h1"),
        Divider(axis="horizontal"),
        Column(children="{{ children }}"),  # type: ignore
    ]
)

TeamRoster = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "TeamRoster",
    "templateId": "TeamRoster",
    "description": (
        "Team directory roster with styled header banner and nested team lists."
    ),
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "directoryTitle": {"type": "string", "title": "Directory Title"},
        "children": {"type": "children", "title": "Team Cards List", "default": []},
    },
    "sampleData": {
        "directoryTitle": "Global Engineering Directory",
        "children": [],
    },
    "layout": team_roster_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 8. TeamGoalList
# ---------------------------------------------------------------------------
team_goal_list_layout = Column(
    children=[
        Card(
            child=Row(
                align="center",
                children=[
                    Icon(name="star"),
                    Text(text="Strategic Objectives: {{ teamName }}", variant="h2"),
                ],
            )
        ),
        Column(
            id="goals_container",
            children={"loop": {"param": "goals", "template": "GoalItem"}},  # type: ignore
        ),
    ]
)

TeamGoalList = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "TeamGoalList",
    "templateId": "TeamGoalList",
    "description": "List of team goals with header banner.",
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "teamName": {"type": "string", "title": "Team Name"},
        "goals": {
            "type": "array",
            "title": "Goals List",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "priority": {
                        "type": "enum",
                        "values": ["High", "Medium", "Low"],
                        "default": "Medium",
                    },
                    "targetDate": {"type": "string"},
                },
                "required": ["title"],
            },
        },
    },
    "sampleData": {
        "teamName": "A2UI Core Team",
        "goals": [
            {
                "title": (
                    "Implement bidirectional child/children container resolution"
                ),
                "priority": "High",
                "targetDate": "2026-07-15",
            },
            {
                "title": "Upgrade all templates to standard Basic Catalog components",
                "priority": "High",
                "targetDate": "2026-07-10",
            },
        ],
    },
    "layout": team_goal_list_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 9. TeamFeedbackBoard
# ---------------------------------------------------------------------------
team_feedback_board_layout = Column(
    children=[
        Card(
            child=Row(
                align="center",
                children=[
                    Icon(name="mail"),
                    Text(
                        text="Feedback & Retrospective: {{ teamName }}",
                        variant="h2",
                    ),
                ],
            )
        ),
        Column(
            id="feedbacks_container",
            children={"loop": {"param": "feedbacks", "template": "FeedbackItem"}},  # type: ignore
        ),
    ]
)

TeamFeedbackBoard = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "TeamFeedbackBoard",
    "templateId": "TeamFeedbackBoard",
    "description": "Feedback board showing team header and feedback items.",
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "teamName": {"type": "string", "title": "Team Name"},
        "feedbacks": {
            "type": "array",
            "title": "Feedbacks List",
            "items": {
                "type": "object",
                "properties": {
                    "author": {"type": "string"},
                    "note": {"type": "string"},
                    "rating": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 5,
                        "default": 5,
                    },
                },
                "required": ["author", "note"],
            },
        },
    },
    "sampleData": {
        "teamName": "Streaming & Protocols Guild",
        "feedbacks": [
            {
                "author": "Dr. Elena Vance",
                "note": (
                    "Splitting createSurface and updateComponents cleanly"
                    " unblocked sequential stream processing."
                ),
                "rating": 5,
            },
            {
                "author": "Marcus Vance",
                "note": (
                    "Unrolling nested lists statically in Python enables instant"
                    " frontend mounting with zero runtime recursion."
                ),
                "rating": 5,
            },
        ],
    },
    "layout": team_feedback_board_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 10. TeamMemberKnowledgePanel
# ---------------------------------------------------------------------------
knowledge_panel_layout = Card(
    child=Column(
        children=[
            Row(
                align="center",
                children=[
                    Icon(name="check"),
                    Text(text="Competency: {{ userName }}", variant="h4"),
                ],
            ),
            Divider(axis="horizontal"),
            Row(
                justify="spaceBetween",
                children=[
                    Column(
                        align="center",
                        children=[
                            Text(text="Role", variant="caption"),
                            Text(text="{{ role }}", variant="body"),
                        ],
                    ),
                    Column(
                        align="center",
                        children=[
                            Text(text="Experience", variant="caption"),
                            Text(text="{{ experienceYears }} Yrs", variant="body"),
                        ],
                    ),
                    Column(
                        align="center",
                        children=[
                            Text(text="Tasks", variant="caption"),
                            Text(text="{{ completedTasks }} Done", variant="body"),
                        ],
                    ),
                ],
            ),
            Text(text="Verified Core Contributor", variant="caption"),
        ]
    )
)

TeamMemberKnowledgePanel = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "TeamMemberKnowledgePanel",
    "templateId": "TeamMemberKnowledgePanel",
    "description": (
        "Card showing competency panel with user experience years and completed task"
        " count."
    ),
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "userName": {"type": "string", "title": "User Display Name"},
        "role": {"type": "string", "title": "Role Name"},
        "experienceYears": {
            "type": "integer",
            "title": "Years of Experience",
            "minimum": 0,
        },
        "completedTasks": {
            "type": "integer",
            "title": "Completed Tasks Count",
            "minimum": 0,
        },
    },
    "sampleData": {
        "userName": "Alice Smith",
        "role": "Systems Architect",
        "experienceYears": 9,
        "completedTasks": 142,
    },
    "layout": knowledge_panel_layout.to_dict(),
})

# ---------------------------------------------------------------------------
# 11. TwoColumnLayout
# ---------------------------------------------------------------------------
two_column_layout = Column(
    children=[
        Column(children="{{ headerChild }}"),  # type: ignore
        Divider(axis="horizontal"),
        Row(
            children=[
                Column(children="{{ leftChildren }}"),  # type: ignore
                Column(children="{{ rightChildren }}"),  # type: ignore
            ]
        ),
    ]
)

TwoColumnLayout = StaticTemplate.from_dict({
    "version": "0.1",
    "name": "TwoColumnLayout",
    "templateId": "TwoColumnLayout",
    "description": (
        "Responsive two-column dashboard layout with banner header and split"
        " content regions."
    ),
    "catalogs": [BASIC_CATALOG_ID],
    "parameters": {
        "headerChild": {"type": "child", "title": "Header Component Slot"},
        "leftChildren": {
            "type": "children",
            "title": "Left Column Children",
            "default": [],
        },
        "rightChildren": {
            "type": "children",
            "title": "Right Column Children",
            "default": [],
        },
    },
    "sampleData": {
        "headerChild": {"component": "Text", "text": "Header Title"},
        "leftChildren": [],
        "rightChildren": [],
    },
    "layout": two_column_layout.to_dict(),
})


def get_all_templates() -> List[StaticTemplate]:
    """Returns all typesafe StaticTemplate definitions."""
    return [
        SalaryCard,
        UserProfile,
        FeedbackItem,
        GoalItem,
        SectionCard,
        TeamCard,
        TeamRoster,
        TeamGoalList,
        TeamFeedbackBoard,
        TeamMemberKnowledgePanel,
        TwoColumnLayout,
    ]
