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

"""TeamMemberKnowledgePanel macro definition."""

from __future__ import annotations

from typing import Any

from a2ui.builder.v0_9.catalogs.basic import (
    Card,
    Column,
    Divider,
    Icon,
    Row,
    Text,
)
from a2ui.transformers.macros import macro


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
