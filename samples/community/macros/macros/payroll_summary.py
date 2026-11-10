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

"""PayrollSummary macro and programmatic render function."""

from __future__ import annotations

from typing import List

from a2ui.builder.v0_9 import ComponentBuilderNode
from a2ui.builder.v0_9.catalogs.basic import (
    Card,
    Column,
    Divider,
    Icon,
    Row,
    Text,
)
from a2ui.transformers.macros import macro
from services.employee_service import employee_service


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

    employees = employee_service.get_all()
    for emp_id, record in employees.items():
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
            text=f"{len(employees)} Employees",
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
def PayrollSummary(
    department: str = "Global Engineering", includeBonus: bool = True
) -> Card:
    """Payroll and compensation summary for an organization.

    Args:
        department: Department or division name.
        includeBonus: Whether to include annual bonus in calculation.
    """
    return render_payroll_summary(department=department, include_bonus=includeBonus)
