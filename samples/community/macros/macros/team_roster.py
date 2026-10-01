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

"""TeamRoster macro definition."""

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
