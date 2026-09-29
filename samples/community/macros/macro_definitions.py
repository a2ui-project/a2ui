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

"""A2UI UI Macros.

Defines all community UI macros using pure Python builder functions decorated
with @macro and standard Python docstrings for LLM parameter documentation.
"""

from __future__ import annotations

from typing import Any, List, Sequence

from a2ui.transformers.macros import macro
from a2ui.builder.v0_9 import Action, ActionEvent, ComponentBuilderNode, ComponentRef
from a2ui.builder.v0_9.catalogs.basic import (
    Button,
    Card,
    Column,
    Divider,
    Icon,
    Row,
    Text,
)


# ---------------------------------------------------------------------------
# 1. SalaryCard
# ---------------------------------------------------------------------------
@macro
def SalaryCard(
    employee_name: str,
    role: str,
    base_salary: str,
    annual_bonus: str,
    equity: str,
    clearance_level: str = "Level 1 - Public",
    verified_at: str = "Today",
) -> Card:
    """Layout card for employee compensation package with security verification badge.

    Args:
        employee_name: Employee full name.
        role: Job title or designation.
        base_salary: Formatted annual base salary (e.g. $150,000).
        annual_bonus: Annual bonus amount (e.g. $25,000).
        equity: Equity grant details (e.g. 2,000 RSUs).
        clearance_level: Security classification level.
        verified_at: Verification timestamp or date.
    """
    return Card(
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
                                Text(
                                    text="Verified Compensation",
                                    variant="caption",
                                ),
                            ],
                        ),
                        Text(text=clearance_level, variant="caption"),
                    ],
                ),
                Column(
                    children=[
                        Text(text=employee_name, variant="h3", id="name_txt"),
                        Text(text=role, variant="body"),
                    ]
                ),
                Divider(axis="horizontal"),
                Row(
                    justify="spaceBetween",
                    children=[
                        Column(
                            children=[
                                Text(text="Base Salary", variant="caption"),
                                Text(text=base_salary, variant="h4", id="sal_val"),
                            ]
                        ),
                        Column(
                            children=[
                                Text(text="Annual Bonus", variant="caption"),
                                Text(text=annual_bonus, variant="h4", id="bonus_val"),
                            ]
                        ),
                        Column(
                            children=[
                                Text(text="Equity Grant", variant="caption"),
                                Text(text=equity, variant="h4", id="equity_val"),
                            ]
                        ),
                    ],
                ),
                Divider(axis="horizontal"),
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Text(text=f"Verified: {verified_at}", variant="caption"),
                        Button(
                            action=Action(event=ActionEvent(name="download_pay_stub")),
                            child=Text(text="Download Pay Stub"),
                        ),
                    ],
                ),
            ]
        )
    )


# ---------------------------------------------------------------------------
# 2. UserProfile
# ---------------------------------------------------------------------------
@macro
def UserProfile(
    userId: str,
    userName: str,
    role: str,
    status: str = "Active",
) -> Card:
    """User profile summary card with avatar icon and status badge.

    Args:
        userId: Unique user or employee ID.
        userName: Full display name.
        role: Job designation.
        status: Current activity or employment status.
    """
    return Card(
        child=Column(
            align="center",
            children=[
                Icon(name="person"),
                Text(text=userName, variant="h3"),
                Text(text=role, variant="caption"),
                Text(text=f"Status: {status} ({userId})", variant="caption"),
            ],
        )
    )


# ---------------------------------------------------------------------------
# 3. FeedbackItem
# ---------------------------------------------------------------------------
@macro
def FeedbackItem(
    author: str,
    note: str,
    rating: int = 5,
) -> Card:
    """Review and feedback card with rating stars.

    Args:
        author: Reviewer full name.
        note: Detailed review commentary or feedback message.
        rating: Score from 1 to 5.
    """
    return Card(
        child=Column(
            children=[
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Text(text=author, variant="caption"),
                        Text(text=f"{'★' * rating} ({rating}/5)", variant="caption"),
                    ],
                ),
                Text(text=f'"{note}"', variant="body"),
            ]
        )
    )


# ---------------------------------------------------------------------------
# 4. GoalItem
# ---------------------------------------------------------------------------
@macro
def GoalItem(
    title: str,
    priority: str = "Medium",
    targetDate: str = "Q4",
) -> Card:
    """Quarterly performance objective item with priority badge.

    Args:
        title: Goal description or milestone title.
        priority: Urgency level (High, Medium, Low).
        targetDate: Scheduled completion date.
    """
    return Card(
        child=Column(
            children=[
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Text(text=f"Priority: {priority}", variant="caption"),
                        Icon(name="star"),
                    ],
                ),
                Text(text=title, variant="h4"),
                Divider(axis="horizontal"),
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Text(text=f"Due: {targetDate}", variant="caption"),
                        Button(
                            action=Action(event=ActionEvent(name="view_details")),
                            child=Text(text="View Details"),
                        ),
                    ],
                ),
            ]
        )
    )


# ---------------------------------------------------------------------------
# 5. SectionCard
# ---------------------------------------------------------------------------
@macro
def SectionCard(
    title: str,
    subtitle: str = "",
    content: ComponentBuilderNode | None = None,
) -> Card:
    """Standardized dashboard section container with header and nested content slot.

    Args:
        title: Section header title.
        subtitle: Secondary subtitle or section description.
        content: Component slot to place inside the section.
    """
    inner_children: List[ComponentBuilderNode] = [
        Text(text=title, variant="h3"),
    ]
    if subtitle:
        inner_children.append(Text(text=subtitle, variant="caption"))
    inner_children.append(Divider(axis="horizontal"))
    if content:
        if isinstance(content, (list, tuple)):
            inner_children.extend(
                ComponentRef(id=c) if isinstance(c, str) else c for c in content
            )
        else:
            node = ComponentRef(id=content) if isinstance(content, str) else content
            inner_children.append(node)

    return Card(
        child=Column(
            children=inner_children,
        )
    )


# ---------------------------------------------------------------------------
# 6. TeamCard
# ---------------------------------------------------------------------------
@macro
def TeamCard(
    title: str,
    members: Sequence[Any] = (),
) -> Card:
    """Team card with title and list of team members.

    Args:
        title: Team or division title.
        members: List of member dictionaries or component nodes.
    """
    member_nodes: List[ComponentBuilderNode] = []
    for m in members:
        if isinstance(m, ComponentBuilderNode):
            member_nodes.append(m)
        elif isinstance(m, str):
            member_nodes.append(ComponentRef(id=m))
        elif isinstance(m, dict):
            name = m.get("userName") or m.get("name") or "Member"
            role = m.get("role", "Staff")
            member_nodes.append(
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Row(
                            align="center",
                            children=[
                                Icon(name="person"),
                                Text(text=name, variant="body"),
                            ],
                        ),
                        Text(text=role, variant="caption"),
                    ],
                )
            )
            member_nodes.append(Divider(axis="horizontal"))

    return Card(
        child=Column(
            children=[
                Row(
                    align="center",
                    children=[
                        Icon(name="person"),
                        Text(text=title, variant="h4"),
                    ],
                ),
                Divider(axis="horizontal"),
                *member_nodes,
            ]
        )
    )


# ---------------------------------------------------------------------------
# 7. TeamRoster
# ---------------------------------------------------------------------------
@macro
def TeamRoster(
    orgTitle: str,
    teams: Sequence[Any] = (),
) -> Card:
    """Organization directory containing team cards.

    Args:
        orgTitle: Directory or unit title.
        teams: Team cards or subcomponents.
    """
    team_nodes: List[ComponentBuilderNode] = [
        ComponentRef(id=t) if isinstance(t, str) else t for t in teams
    ]
    return Card(
        child=Column(
            children=[
                Row(
                    align="center",
                    children=[
                        Icon(name="home"),
                        Text(text=orgTitle, variant="h3"),
                    ],
                ),
                Divider(axis="horizontal"),
                *team_nodes,
            ]
        )
    )


# ---------------------------------------------------------------------------
# 8. TeamGoalList
# ---------------------------------------------------------------------------
@macro
def TeamGoalList(
    teamName: str,
    goals: Sequence[Any] = (),
) -> Card:
    """Quarterly goals dashboard for a team.

    Args:
        teamName: Team or squad name.
        goals: List of goal dictionaries or goal items.
    """
    goal_nodes: List[ComponentBuilderNode] = []
    for g in goals:
        if isinstance(g, ComponentBuilderNode):
            goal_nodes.append(g)
        elif isinstance(g, str):
            goal_nodes.append(ComponentRef(id=g))
        elif isinstance(g, dict):
            goal_nodes.append(
                GoalItem(
                    title=g.get("title", ""),
                    priority=g.get("priority", "Medium"),
                    targetDate=g.get("targetDate", "Q4"),
                )
            )

    return Card(
        child=Column(
            children=[
                Row(
                    align="center",
                    children=[
                        Icon(name="star"),
                        Text(
                            text=f"Strategic Objectives: {teamName}",
                            variant="h3",
                        ),
                    ],
                ),
                Divider(axis="horizontal"),
                *goal_nodes,
            ]
        )
    )


# ---------------------------------------------------------------------------
# 9. TeamFeedbackBoard
# ---------------------------------------------------------------------------
@macro
def TeamFeedbackBoard(
    teamName: str,
    feedbacks: Sequence[Any] = (),
) -> Card:
    """Feedback and retrospective board.

    Args:
        teamName: Board topic or team name.
        feedbacks: List of feedback items or dictionaries.
    """
    fb_nodes: List[ComponentBuilderNode] = []
    for f in feedbacks:
        if isinstance(f, ComponentBuilderNode):
            fb_nodes.append(f)
        elif isinstance(f, str):
            fb_nodes.append(ComponentRef(id=f))
        elif isinstance(f, dict):
            rating_val = f.get("rating")
            try:
                rating = int(float(rating_val)) if rating_val is not None else 5
            except (ValueError, TypeError):
                rating = 5
            fb_nodes.append(
                FeedbackItem(
                    author=f.get("author", "Anonymous"),
                    note=f.get("note", ""),
                    rating=rating,
                )
            )

    return Card(
        child=Column(
            children=[
                Row(
                    align="center",
                    children=[
                        Icon(name="info"),
                        Text(
                            text=f"Feedback & Retrospective: {teamName}",
                            variant="h3",
                        ),
                    ],
                ),
                Divider(axis="horizontal"),
                *fb_nodes,
            ]
        )
    )


# ---------------------------------------------------------------------------
# 10. TeamMemberKnowledgePanel
# ---------------------------------------------------------------------------
@macro
def TeamMemberKnowledgePanel(
    userName: str,
    role: str,
    experienceYears: Any = 5,
    completedTasks: Any = 100,
) -> Card:
    """Competency and knowledge panel for a team member.

    Args:
        userName: Member full name.
        role: Member job title.
        experienceYears: Years of experience.
        completedTasks: Count of completed projects or tasks.
    """
    years_str = (
        f"{experienceYears} Yrs"
        if not str(experienceYears).endswith("Yrs")
        else str(experienceYears)
    )
    tasks_str = (
        f"{completedTasks} Done"
        if not str(completedTasks).endswith("Done")
        else str(completedTasks)
    )
    return Card(
        child=Column(
            children=[
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Text(text=f"Competency: {userName}", variant="h3"),
                        Icon(name="check"),
                    ],
                ),
                Text(text=role, variant="caption"),
                Divider(axis="horizontal"),
                Row(
                    justify="spaceBetween",
                    children=[
                        Column(
                            children=[
                                Text(text="Tenure", variant="caption"),
                                Text(text=years_str, variant="h4"),
                            ]
                        ),
                        Column(
                            children=[
                                Text(text="Projects", variant="caption"),
                                Text(text=tasks_str, variant="h4"),
                            ]
                        ),
                        Column(
                            children=[
                                Text(text="Satisfaction", variant="caption"),
                                Text(text="98%", variant="h4"),
                            ]
                        ),
                    ],
                ),
            ]
        )
    )


# ---------------------------------------------------------------------------
# 11. TwoColumnLayout
# ---------------------------------------------------------------------------
@macro
def TwoColumnLayout(
    left: ComponentBuilderNode,
    right: ComponentBuilderNode,
) -> Row:
    """Two-column responsive grid container.

    Args:
        left: Content component for left column.
        right: Content component for right column.
    """

    def _to_nodes(val: Any) -> List[ComponentBuilderNode]:
        if isinstance(val, (list, tuple)):
            return [ComponentRef(id=x) if isinstance(x, str) else x for x in val]
        elif isinstance(val, str):
            return [ComponentRef(id=val)]
        elif isinstance(val, ComponentBuilderNode):
            return [val]
        return []

    return Row(
        justify="spaceBetween",
        children=[
            Column(children=_to_nodes(left)),
            Column(children=_to_nodes(right)),
        ],
    )


# ---------------------------------------------------------------------------
# Dynamic Database & Programmatic Resolvers
# ---------------------------------------------------------------------------

EMPLOYEE_COMPENSATION_DB = {
    "emp_101": {
        "employeeName": "Dr. Elena Vance",
        "role": "Principal Systems Architect",
        "baseSalary": "$215,000",
        "annualBonus": "$45,000",
        "equity": "3,500 RSUs",
        "clearanceLevel": "Level 5 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_102": {
        "employeeName": "Marcus Vance",
        "role": "Streaming & Protocols Lead",
        "baseSalary": "$195,000",
        "annualBonus": "$38,000",
        "equity": "2,800 RSUs",
        "clearanceLevel": "Level 4 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_103": {
        "employeeName": "Aria Chen",
        "role": "Head of Design Systems",
        "baseSalary": "$205,000",
        "annualBonus": "$42,000",
        "equity": "3,100 RSUs",
        "clearanceLevel": "Level 5 - Confidential",
        "verifiedAt": "2026-08-13",
    },
    "emp_104": {
        "employeeName": "Liam Kjell",
        "role": "Senior Framework Engineer",
        "baseSalary": "$180,000",
        "annualBonus": "$32,000",
        "equity": "2,200 RSUs",
        "clearanceLevel": "Level 3 - Internal",
        "verifiedAt": "2026-08-13",
    },
}


def fetch_employee_compensation(employee_id: str) -> dict[str, Any]:
    """Fetches verified confidential compensation package from internal HR database."""
    if employee_id not in EMPLOYEE_COMPENSATION_DB:
        raise ValueError(
            f"Employee ID '{employee_id}' not found in HR compensation records."
            f" Available: {list(EMPLOYEE_COMPENSATION_DB.keys())}"
        )
    return EMPLOYEE_COMPENSATION_DB[employee_id]


def render_payroll_summary(
    department: str = "Global Engineering",
    includeBonus: bool = True,
    include_bonus: bool | None = None,
) -> Card:
    """Programmatic dynamic template: performs Python math, loops, formatting, and builds an AST table."""
    if include_bonus is not None:
        includeBonus = include_bonus
    else:
        include_bonus = includeBonus
    total_base = 0
    total_bonus = 0
    rows: List[ComponentBuilderNode] = []

    for emp_id, record in EMPLOYEE_COMPENSATION_DB.items():
        base_int = int(record["baseSalary"].replace("$", "").replace(",", ""))
        bonus_int = int(record["annualBonus"].replace("$", "").replace(",", ""))
        total_base += base_int
        total_bonus += bonus_int

        cols: List[ComponentBuilderNode] = [
            Text(text=record["employeeName"], variant="body"),
            Text(text=record["role"], variant="caption"),
            Text(text=record["baseSalary"], variant="body"),
        ]
        if include_bonus:
            cols.append(Text(text=record["annualBonus"], variant="body"))

        rows.append(
            Row(
                justify="spaceBetween",
                align="center",
                children=cols,
            )
        )
        rows.append(Divider(axis="horizontal"))

    header_cols: List[ComponentBuilderNode] = [
        Text(text="Employee", variant="caption"),
        Text(text="Role", variant="caption"),
        Text(text="Base Salary", variant="caption"),
    ]
    if include_bonus:
        header_cols.append(Text(text="Annual Bonus", variant="caption"))

    total_cols: List[ComponentBuilderNode] = [
        Text(text="TOTAL PAYROLL", variant="h4"),
        Text(
            text=f"{len(EMPLOYEE_COMPENSATION_DB)} Employees",
            variant="caption",
        ),
        Text(text=f"${total_base:,}", variant="h4"),
    ]
    if include_bonus:
        total_cols.append(Text(text=f"${total_bonus:,}", variant="h4"))

    total_budget = total_base + (total_bonus if include_bonus else 0)

    return Card(
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
                                Text(
                                    text=(
                                        f"Payroll & Compensation Summary: {department}"
                                    ),
                                    variant="h3",
                                ),
                            ],
                        ),
                        Text(
                            text="Confidential HR Record",
                            variant="caption",
                        ),
                    ],
                ),
                Divider(axis="horizontal"),
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=header_cols,
                ),
                Divider(axis="horizontal"),
                *rows,
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=total_cols,
                ),
                Divider(axis="horizontal"),
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Text(
                            text="🔒 Computed live by server Python execution engine",
                            variant="caption",
                        ),
                        Text(
                            text=f"Total Budget: ${total_budget:,}",
                            variant="caption",
                        ),
                    ],
                ),
            ],
        )
    )


@macro
def EmployeeSalaryCard(employeeId: str = "emp_101") -> Card:
    """Secure verified employee compensation card. Pass employeeId ('emp_101', 'emp_102', 'emp_103', 'emp_104').

    Args:
        employeeId: Unique employee identifier in HR compensation records.
    """
    record = fetch_employee_compensation(employeeId)
    return SalaryCard(
        employee_name=record["employeeName"],
        role=record["role"],
        base_salary=record["baseSalary"],
        annual_bonus=record["annualBonus"],
        equity=record["equity"],
        clearance_level=record["clearanceLevel"],
        verified_at=record["verifiedAt"],
    )


@macro
def PayrollSummary(
    department: str = "Global Engineering", includeBonus: bool = True
) -> Card:
    """Payroll and compensation summary for an organization.

    Args:
        department: Department or division name.
        includeBonus: Whether to include annual bonus in calculation.
    """
    return render_payroll_summary(department=department, include_bonus=includeBonus)


ALL_MACROS = [
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
    EmployeeSalaryCard,
    PayrollSummary,
]
