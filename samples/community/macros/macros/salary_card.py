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

"""SalaryCard macro definition."""

from __future__ import annotations

from a2ui.builder.v0_9 import Action, ActionEvent
from a2ui.builder.v0_9.catalogs.basic import (
    Button,
    Card,
    Column,
    Divider,
    Icon,
    Row,
    Text,
)
from a2ui.transformers.macros import macro


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
