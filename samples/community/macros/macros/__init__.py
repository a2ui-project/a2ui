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

"""A2UI Community UI Macros package.

Exposes modular macro definitions organized with one macro per module file.
"""

from __future__ import annotations

from macros.employee_salary_card import EmployeeSalaryCard
from macros.feedback_item import FeedbackItem
from macros.goal_item import GoalItem
from macros.payroll_summary import PayrollSummary, render_payroll_summary
from macros.salary_card import SalaryCard
from macros.section_card import SectionCard
from macros.team_card import TeamCard
from macros.team_feedback_board import TeamFeedbackBoard
from macros.team_goal_list import TeamGoalList
from macros.team_member_knowledge_panel import TeamMemberKnowledgePanel
from macros.team_roster import TeamRoster
from macros.two_column_layout import TwoColumnLayout
from macros.user_profile import UserProfile

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

__all__ = [
    "ALL_MACROS",
    "EmployeeSalaryCard",
    "FeedbackItem",
    "GoalItem",
    "PayrollSummary",
    "SalaryCard",
    "SectionCard",
    "TeamCard",
    "TeamFeedbackBoard",
    "TeamGoalList",
    "TeamMemberKnowledgePanel",
    "TeamRoster",
    "TwoColumnLayout",
    "UserProfile",
    "render_payroll_summary",
]
