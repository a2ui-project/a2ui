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

"""SectionCard macro definition."""

from __future__ import annotations

from typing import List

from a2ui.builder.v0_9 import ComponentBuilderNode, ComponentRef
from a2ui.builder.v0_9.catalogs.basic import Card, Column, Divider, Text
from a2ui.transformers.macros import macro


@macro
def SectionCard(
    title: str,
    subtitle: str = "",
    content: ComponentBuilderNode | None = None,
) -> Card:
    """Standardized dashboard section container with header and nested content slot.

    Args:
        title: Section header title.
        subtitle: Secondary subtitle or section description.
        content: Component slot to place inside the section.
    """
    inner_children: List[ComponentBuilderNode] = [
        Text(text=title, variant="h3"),
    ]
    if subtitle:
        inner_children.append(Text(text=subtitle, variant="caption"))
    inner_children.append(Divider(axis="horizontal"))
    if content:
        if isinstance(content, (list, tuple)):
            inner_children.extend(
                ComponentRef(id=c) if isinstance(c, str) else c for c in content
            )
        else:
            node = ComponentRef(id=content) if isinstance(content, str) else content
            inner_children.append(node)

    return Card(
        child=Column(
            children=inner_children,
        )
    )
