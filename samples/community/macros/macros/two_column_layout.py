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

"""TwoColumnLayout macro definition."""

from __future__ import annotations

from typing import Any, List

from a2ui.builder.v0_9 import ComponentBuilderNode, ComponentRef
from a2ui.builder.v0_9.catalogs.basic import Column, Row
from a2ui.transformers.macros import macro


@macro
def TwoColumnLayout(
    left: ComponentBuilderNode,
    right: ComponentBuilderNode,
) -> Row:
    """Two-column responsive grid container.

    Args:
        left: Content component for left column.
        right: Content component for right column.
    """

    def _to_nodes(val: Any) -> List[ComponentBuilderNode]:
        if isinstance(val, (list, tuple)):
            return [ComponentRef(id=x) if isinstance(x, str) else x for x in val]
        elif isinstance(val, str):
            return [ComponentRef(id=val)]
        elif isinstance(val, ComponentBuilderNode):
            return [val]
        return []

    return Row(
        justify="spaceBetween",
        children=[
            Column(children=_to_nodes(left)),
            Column(children=_to_nodes(right)),
        ],
    )
