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

"""FeedbackItem macro definition."""

from __future__ import annotations

from a2ui.builder.v0_9.catalogs.basic import Card, Column, Row, Text
from a2ui.transformers.macros import macro


@macro
def FeedbackItem(
    author: str,
    note: str,
    rating: int = 5,
) -> Card:
    """Review and feedback card with rating stars.

    Args:
        author: Reviewer full name.
        note: Detailed review commentary or feedback message.
        rating: Score from 1 to 5.
    """
    return Card(
        child=Column(
            children=[
                Row(
                    justify="spaceBetween",
                    align="center",
                    children=[
                        Text(text=author, variant="caption"),
                        Text(text=f"{'★' * rating} ({rating}/5)", variant="caption"),
                    ],
                ),
                Text(text=f'"{note}"', variant="body"),
            ]
        )
    )
