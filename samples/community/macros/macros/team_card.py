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

"""TeamCard macro definition."""

from __future__ import annotations

from typing import Any, List, Sequence

from a2ui.builder.v0_9 import ComponentBuilderNode, ComponentRef
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
