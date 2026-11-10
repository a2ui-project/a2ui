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

"""TeamFeedbackBoard macro definition."""

from __future__ import annotations

from typing import Any, List, Sequence

from a2ui.builder.v0_9 import ComponentBuilderNode, ComponentRef
from a2ui.builder.v0_9.catalogs.basic import Card, Column, Divider, Icon, Row, Text
from a2ui.transformers.macros import macro
from macros.feedback_item import FeedbackItem


@macro
def TeamFeedbackBoard(
    teamName: str,
    feedbacks: Sequence[Any] = (),
) -> Card:
    """Feedback and retrospective board.

    Args:
        teamName: Board topic or team name.
        feedbacks: List of feedback items or dictionaries.
    """
    fb_nodes: List[ComponentBuilderNode] = []
    for f in feedbacks:
        if isinstance(f, ComponentBuilderNode):
            fb_nodes.append(f)
        elif isinstance(f, str):
            fb_nodes.append(ComponentRef(id=f))
        elif isinstance(f, dict):
            rating_val = f.get("rating")
            try:
                rating = int(float(rating_val)) if rating_val is not None else 5
            except (ValueError, TypeError):
                rating = 5
            fb_nodes.append(
                FeedbackItem(
                    author=f.get("author", "Anonymous"),
                    note=f.get("note", ""),
                    rating=rating,
                )
            )

    return Card(
        child=Column(
            children=[
                Row(
                    align="center",
                    children=[
                        Icon(name="info"),
                        Text(
                            text=f"Feedback & Retrospective: {teamName}",
                            variant="h3",
                        ),
                    ],
                ),
                Divider(axis="horizontal"),
                *fb_nodes,
            ]
        )
    )
