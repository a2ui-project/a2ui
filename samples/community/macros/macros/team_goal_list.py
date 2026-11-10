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

"""TeamGoalList macro definition."""

from __future__ import annotations

from typing import Any, List, Sequence

from a2ui.builder.v0_9 import ComponentBuilderNode, ComponentRef
from a2ui.builder.v0_9.catalogs.basic import Card, Column, Divider, Icon, Row, Text
from a2ui.transformers.macros import macro
from macros.goal_item import GoalItem


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
