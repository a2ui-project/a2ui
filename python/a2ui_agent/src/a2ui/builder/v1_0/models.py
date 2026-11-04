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

"""Protocol v1.0 data models, bindings, actions, and type aliases for A2UI builders.

Re-exports ``AccessibilityAttributes``, ``ActionEvent``, ``CheckRule``,
``DataBinding``, and ``FunctionCall`` from ``a2ui.core.schema.v1_0``.
Defines ``ComponentBuilderNode``, ``Action``, and ``DynamicChildList`` locally
for ergonomic authoring.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Self, TypeAlias

from pydantic import (
    AliasChoices,
    AliasPath,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    field_serializer,
    model_validator,
)

from a2ui.core.schema.v1_0 import (
    AccessibilityAttributes as AccessibilityAttributes,
    ActionEvent as ActionEvent,
    CheckRule as CheckRule,
    ComponentCommonMetadata,
    CreateSurfaceMetadata,
    DataBinding as DataBinding,
    Extensions,
    FunctionCall as FunctionCall,
    LiteralObject,
)
from ..core.base_model import BuilderBaseModel
from ..core.base_node import ComponentBuilderNode as CoreComponentBuilderNode
from ..core.child import Child


class ComponentBuilderNode(CoreComponentBuilderNode):
    """Base class for A2UI Protocol v1.0 component builders with envelope attributes."""

    catalog_id: str | None = Field(default=None, alias="catalogId")
    accessibility: AccessibilityAttributes | None = None
    extensions: Extensions | None = Field(
        default=None,
        serialization_alias="metadata",
        validation_alias=AliasChoices(
            "extensions", AliasPath("metadata", "extensions")
        ),
    )

    @field_serializer("extensions")
    def _serialize_extensions(
        self, value: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        if value is None:
            return None
        return {"extensions": value}

    @property
    def metadata(self) -> dict[str, Any] | None:
        """Returns the component's metadata envelope, or None when empty."""
        if self.extensions is None:
            return None
        return {"extensions": dict(self.extensions)}

    @metadata.setter
    def metadata(self, metadata: dict[str, Any] | None) -> None:
        """Replaces the component's metadata envelope after validating UAX #31 keys."""
        if metadata is None:
            self.extensions = None
            return
        validated = ComponentCommonMetadata.model_validate(metadata)
        self.extensions = dict(validated.extensions) if validated.extensions else None

    def with_extension(self, key: str, value: Any) -> Self:
        """Attaches or updates a single extension key on the component."""
        validated = ComponentCommonMetadata.model_validate(
            {"extensions": {**(self.extensions or {}), key: value}}
        )
        self.extensions = dict(validated.extensions) if validated.extensions else None
        return self


def set_surface_extensions(
    messages: Sequence[Any],
    *,
    surface_id: str | None = None,
    extensions: dict[str, Any] | None,
) -> list[Any]:
    """Attaches ``metadata.extensions`` to the matching ``createSurface`` message(s).

    Args:
        messages: Sequence of A2UI v1.0 message models or message dicts.
        surface_id: Optional surface ID filter. If omitted, updates all
            ``createSurface`` messages in ``messages``.
        extensions: Extension map (validated for UAX 31 keys), or ``None`` to clear.

    Returns:
        A new list of messages with ``metadata`` updated on matching ``createSurface``
        entries.
    """
    validated_meta = (
        CreateSurfaceMetadata(extensions=dict(extensions)) if extensions else None
    )
    result: list[Any] = []
    for msg in messages:
        create_surface = getattr(msg, "create_surface", None)
        if create_surface is not None:
            if surface_id is None or create_surface.surface_id == surface_id:
                updated_cs = create_surface.model_copy(
                    update={"metadata": validated_meta}
                )
                result.append(msg.model_copy(update={"create_surface": updated_cs}))
            else:
                result.append(msg)
        elif isinstance(msg, dict) and isinstance(msg.get("createSurface"), dict):
            cs = msg["createSurface"]
            if surface_id is None or cs.get("surfaceId") == surface_id:
                new_cs = dict(cs)
                if validated_meta is not None and validated_meta.extensions:
                    new_cs["metadata"] = {"extensions": dict(validated_meta.extensions)}
                else:
                    new_cs.pop("metadata", None)
                result.append({**msg, "createSurface": new_cs})
            else:
                result.append(msg)
        else:
            result.append(msg)
    return result


# Canonical Protocol Type Aliases
DynamicString = StrictStr | DataBinding | FunctionCall
DynamicNumber = StrictInt | StrictFloat | DataBinding | FunctionCall
DynamicBoolean = StrictBool | DataBinding | FunctionCall
DynamicStringList = Sequence[StrictStr] | DataBinding | FunctionCall
DynamicValue = (
    StrictStr
    | StrictInt
    | StrictFloat
    | StrictBool
    | Sequence[Any]
    | LiteralObject
    | DataBinding
    | FunctionCall
)


class Action(BuilderBaseModel):
    """Dispatches either an agent ``event`` or a renderer/agent ``function_call`` (mutually exclusive)."""

    event: ActionEvent | None = None
    function_call: FunctionCall | None = Field(
        default=None,
        serialization_alias="functionCall",
        validation_alias=AliasChoices("function_call", "functionCall"),
    )

    @model_validator(mode="after")
    def _require_exactly_one_branch(self) -> Action:
        if (self.event is None) == (self.function_call is None):
            raise ValueError(
                "Action requires exactly one of 'event' or 'function_call'."
            )
        return self


class DynamicChildList(BuilderBaseModel):
    """Repeats ``template`` for each item in the data model array at ``path``.

    During flattening, ``template`` is emitted as a sibling component and
    replaced by its allocated ``componentId`` on the wire. ``path`` may be
    absolute (``/items``) or relative to an enclosing template scope.
    """

    path: str = Field(
        validation_alias=AliasChoices("path", "data_model_path", "dataModelPath"),
    )
    template: Child = Field(
        serialization_alias="componentId",
        validation_alias=AliasChoices("template", "componentId"),
    )


ChildList: TypeAlias = Sequence[Child] | DynamicChildList

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "ActionEvent",
    "CheckRule",
    "ChildList",
    "ComponentBuilderNode",
    "DataBinding",
    "DynamicBoolean",
    "DynamicChildList",
    "DynamicNumber",
    "DynamicString",
    "DynamicStringList",
    "DynamicValue",
    "FunctionCall",
    "set_surface_extensions",
]
