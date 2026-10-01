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

"""UserProfile macro definition."""

from __future__ import annotations

from a2ui.builder.v0_9.catalogs.basic import Card, Column, Icon, Text
from a2ui.transformers.macros import macro


@macro
def UserProfile(
    userId: str,
    userName: str,
    role: str,
    status: str = "Active",
) -> Card:
    """User profile summary card with avatar icon and status badge.

    Args:
        userId: Unique user or employee ID.
        userName: Full display name.
        role: Job designation.
        status: Current activity or employment status.
    """
    return Card(
        child=Column(
            align="center",
            children=[
                Icon(name="person"),
                Text(text=userName, variant="h3"),
                Text(text=role, variant="caption"),
                Text(text=f"Status: {status} ({userId})", variant="caption"),
            ],
        )
    )
