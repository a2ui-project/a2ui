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

"""EmployeeSalaryCard macro definition."""

from __future__ import annotations

from a2ui.builder.v0_9.catalogs.basic import Card
from a2ui.transformers.macros import macro
from macros.salary_card import SalaryCard
from services.employee_service import employee_service


@macro
def EmployeeSalaryCard(employeeId: str = "emp_101") -> Card:
    """Secure verified employee compensation card. Pass employeeId ('emp_101', 'emp_102', 'emp_103', 'emp_104').

    Args:
        employeeId: Unique employee identifier in HR compensation records.
    """
    record = employee_service.get_employee(employeeId)
    return SalaryCard(
        employee_name=record["employeeName"],
        role=record["role"],
        base_salary=record["baseSalary"],
        annual_bonus=record["annualBonus"],
        equity=record["equity"],
        clearance_level=record["clearanceLevel"],
        verified_at=record["verifiedAt"],
    )
