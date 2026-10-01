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

"""GoalItem macro definition."""

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
