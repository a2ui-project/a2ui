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

"""Data models for decision-model gated templates."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from a2ui.core.schema import AgentToRendererMessage

GATE_EXTENSION_KEY = "a2ui_gate"
VARIANT_EXTENSION_KEY = "a2ui_variant"


@dataclass(frozen=True)
class GateSpec:
    """Boolean visibility gate attached to one template component."""

    component_id: str
    condition: str
    threshold: float = 0.5


@dataclass(frozen=True)
class VariantOption:
    """One mutually exclusive component variant inside a `VariantGroupSpec`."""

    component_id: str
    name: str
    description: str


@dataclass(frozen=True)
class VariantGroupSpec:
    """Mutually exclusive named variants competing in one `CHOICE` question."""

    group: str
    prompt: str
    options: tuple[VariantOption, ...]
    allow_none: bool = False
    min_confidence: float = 0.0


@dataclass(frozen=True)
class GatedTemplateSpec:
    """Hand-authored A2UI v1.0 surface with optional gated regions and variants.

    Components carry gate and variant annotations under `@metadata.extensions`
    (`a2ui_gate` and `a2ui_variant`), so the base template remains valid A2UI
    v1.0 JSON even without pruning.
    """

    id: str
    description: str
    components: tuple[Mapping[str, Any], ...]
    catalog_id: str | None = None
    required_paths: tuple[str, ...] = ()

    @classmethod
    def from_messages(
        cls,
        id: str,
        description: str,
        messages: Sequence[Mapping[str, Any] | AgentToRendererMessage],
        *,
        required_paths: Sequence[str] = (),
    ) -> GatedTemplateSpec:
        """Constructs a `GatedTemplateSpec` from v1.0 wire messages.

        Collects component dicts from both `createSurface.components` and
        `updateComponents.components`, and reads `catalogId` from the first
        `createSurface` message if present.
        """
        catalog_id: str | None = None
        components: list[Mapping[str, Any]] = []
        for raw_msg in messages:
            if isinstance(raw_msg, AgentToRendererMessage):
                msg: Mapping[str, Any] = raw_msg.model_dump(
                    by_alias=True, exclude_none=True
                )
            else:
                msg = raw_msg
            create_op = msg.get("createSurface")
            if isinstance(create_op, Mapping):
                if catalog_id is None and isinstance(create_op.get("catalogId"), str):
                    catalog_id = str(create_op["catalogId"])
                inline_comps = create_op.get("components")
                if isinstance(inline_comps, Sequence) and not isinstance(
                    inline_comps, (str, bytes)
                ):
                    components.extend(
                        c for c in inline_comps if isinstance(c, Mapping)
                    )
            update_op = msg.get("updateComponents")
            if isinstance(update_op, Mapping):
                upd_comps = update_op.get("components")
                if isinstance(upd_comps, Sequence) and not isinstance(
                    upd_comps, (str, bytes)
                ):
                    components.extend(c for c in upd_comps if isinstance(c, Mapping))
        return cls(
            id=id,
            description=description,
            components=tuple(components),
            catalog_id=catalog_id,
            required_paths=tuple(required_paths),
        )


@dataclass(frozen=True)
class GateDecisionRecord:
    """Recorded outcome of one boolean gate or variant group decision."""

    kind: Literal["gate", "variant"]
    target: str
    chosen: str
    probability: float
    kept_component_ids: tuple[str, ...] = ()
    pruned_component_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class GatedTemplateResult:
    """Outcome of evaluating and pruning a `GatedTemplateSpec`."""

    messages: list[AgentToRendererMessage] = field(default_factory=list)
    template_id: str | None = None
    kept_component_ids: tuple[str, ...] = ()
    pruned_component_ids: tuple[str, ...] = ()
    decisions: tuple[GateDecisionRecord, ...] = ()
    decision_calls: int = 0
    abstained: bool = False
    reason: str = ""
