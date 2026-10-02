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

"""A2UI UI Macros facade.

Re-exports all modular macro definitions from the `macros` package and mock
database operations from the `services` package.
"""

from __future__ import annotations

from macros import (
    ALL_MACROS,
    EmployeeSalaryCard,
    FeedbackItem,
    GoalItem,
    PayrollSummary,
    SalaryCard,
    SectionCard,
    TeamCard,
    TeamFeedbackBoard,
    TeamGoalList,
    TeamMemberKnowledgePanel,
    TeamRoster,
    TwoColumnLayout,
    UserProfile,
    render_payroll_summary,
)
from services import (
    EMPLOYEE_COMPENSATION_DB,
    EmployeeDatabaseService,
    employee_service,
    fetch_employee_compensation,
)

__all__ = [
    "ALL_MACROS",
    "EMPLOYEE_COMPENSATION_DB",
    "EmployeeDatabaseService",
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
    "employee_service",
    "fetch_employee_compensation",
    "render_payroll_summary",
]
