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

"""In-memory hierarchy container for A2UI builder component trees."""

from __future__ import annotations

import json
from typing import Any, Optional

from .base_node import ComponentBuilderNode
from .flattener import flatten_component_tree


class ComponentTree:
    """A component hierarchy: one primary root, plus any subtrees that stand alone.

    A single :class:`ComponentBuilderNode` is already a tree, so for authoring
    this container adds nothing over the node itself. It exists for the parsing
    direction, where a payload does not always reduce to one root: an
    unrecognized container component holds children the parser can still type,
    but cannot attach to anything. Those become unlinked subtrees, retained
    alongside the primary root rather than dropped or degraded to plain dicts.

    Round-trip parsing is specified but not yet implemented, so the unlinked
    collection is not present yet; see R8 of the typesafe builder API feature
    blueprint. The container is the place it will live.

    A tree is transport-agnostic: it knows its own shape but not how a given
    protocol version packages it. Envelope construction lives in the versioned
    ``envelopes`` module so the message schema and the protocol version stay in
    one place. ``surface_id`` records the surface a parsed payload came from, so
    a read-modify-write cycle can emit back to it; it is not consulted when
    authoring, where the envelope helpers take the surface explicitly.
    """

    def __init__(
        self,
        root: ComponentBuilderNode,
        surface_id: str | None = None,
    ):
        self.root = root
        self.surface_id = surface_id

    def flatten(self) -> list[dict[str, Any]]:
        """Serializes the primary tree into flat component dicts."""
        return flatten_component_tree(self.root, root_id=self.root.id or "root")

    def to_json(self, indent: Optional[int] = None) -> str:
        """Serializes the component list into a JSON string."""
        return json.dumps(self.flatten(), indent=indent)

