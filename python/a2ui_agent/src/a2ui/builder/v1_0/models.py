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
``DataBinding``, ``Extensions``, and ``FunctionCall`` from ``a2ui.core.schema.v1_0``.
Defines ``ComponentBuilderNode``, ``Child``, ``Action``, ``DynamicChildList``, and
``ChildList`` locally for ergonomic authoring with ``@``-prefixed wire output.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import copy
from typing import Annotated, Any, ClassVar, Self, TypeAlias

from pydantic import (
    AliasChoices,
    AliasPath,
    BeforeValidator,
    Field,
    PlainSerializer,
    PydanticUndefinedAnnotation,
    SerializationInfo,
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
    Extensions as Extensions,
    FunctionCall as FunctionCall,
    LiteralObject,
)
from ..core.base_model import BuilderBaseModel
from ..core.base_node import (
    ComponentBuilderNode as CoreComponentBuilderNode,
    ComponentRef,
)
from ..core.child import emit_component, flatten_context_of, serialize_child

_UNSET_CATALOG_ID: Any = object()

# From v1.0 the `ComponentCommon` envelope mixins serialize under `@`-prefixed
# wire keys. Validation also accepts the bare keys of pre-cutover payloads.
_CATALOG_ID_SERIALIZATION_ALIAS = "@catalogId"


def _catalog_id_validation_alias() -> AliasChoices:
    return AliasChoices("@catalogId", "catalogId")


class ComponentBuilderNode(CoreComponentBuilderNode):
    """Base class for A2UI Protocol v1.0 component builders with envelope attributes.

    Custom catalog builders may bind a default ``catalogId`` once on a shared
    base class via ``class FooCatalogNode(ComponentBuilderNode, catalog_id=FOO_CID): ...``.

    The envelope attributes serialize as ``@catalogId``, ``@accessibility`` and
    ``@metadata``, and validation accepts both those keys and their bare forms.
    """

    _default_catalog_id: ClassVar[str | None] = None

    catalog_id: str | None = Field(
        default=None,
        serialization_alias=_CATALOG_ID_SERIALIZATION_ALIAS,
        validation_alias=_catalog_id_validation_alias(),
    )
    accessibility: AccessibilityAttributes | None = Field(
        default=None,
        serialization_alias="@accessibility",
        validation_alias=AliasChoices("@accessibility", "accessibility"),
    )
    extensions: Extensions | None = Field(
        default=None,
        serialization_alias="@metadata",
        validation_alias=AliasChoices(
            "extensions",
            AliasPath("@metadata", "extensions"),
            AliasPath("metadata", "extensions"),
        ),
    )

    def __init_subclass__(
        cls,
        *,
        catalog_id: str | None = _UNSET_CATALOG_ID,
        **kwargs: Any,
    ) -> None:
        super().__init_subclass__(**kwargs)
        if catalog_id is not _UNSET_CATALOG_ID:
            cls._default_catalog_id = catalog_id

    @classmethod
    def __pydantic_init_subclass__(
        cls,
        *,
        catalog_id: str | None = _UNSET_CATALOG_ID,
        **kwargs: Any,
    ) -> None:
        super().__pydantic_init_subclass__(**kwargs)
        if catalog_id is not _UNSET_CATALOG_ID:
            cls._default_catalog_id = catalog_id

        custom_wire_aliases = {
            f.alias or f.serialization_alias
            for name, f in cls.model_fields.items()
            if name not in ("catalog_id", "accessibility", "extensions")
            and (f.alias or f.serialization_alias) is not None
        }

        needs_rebuild = False

        cat_field = cls.model_fields.get("catalog_id")
        if cat_field is not None:
            new_field = copy.copy(cat_field)
            cat_changed = False

            inherited_cid = cls._default_catalog_id
            defines_own_field = (
                "catalog_id" in cls.__dict__ or "catalog_id" in cls.__annotations__
            )
            if not defines_own_field and new_field.default != inherited_cid:
                new_field.default = inherited_cid
                cat_changed = True

            if new_field.alias is None:
                expected_cat_val_alias: str | AliasChoices = (
                    _CATALOG_ID_SERIALIZATION_ALIAS
                    if "catalogId" in custom_wire_aliases
                    else _catalog_id_validation_alias()
                )
                if new_field.validation_alias is None or (
                    "catalogId" in custom_wire_aliases
                    and new_field.validation_alias != expected_cat_val_alias
                ):
                    new_field.validation_alias = expected_cat_val_alias
                    cat_changed = True
                if new_field.serialization_alias is None:
                    new_field.serialization_alias = _CATALOG_ID_SERIALIZATION_ALIAS
                    cat_changed = True

            if cat_changed:
                cls.model_fields["catalog_id"] = new_field
                needs_rebuild = True

        if "accessibility" in custom_wire_aliases:
            a11y_field = cls.model_fields.get("accessibility")
            if (
                a11y_field is not None
                and a11y_field.validation_alias != "@accessibility"
            ):
                new_a11y = copy.copy(a11y_field)
                new_a11y.validation_alias = "@accessibility"
                cls.model_fields["accessibility"] = new_a11y
                needs_rebuild = True

        if "metadata" in custom_wire_aliases or "extensions" in custom_wire_aliases:
            ext_field = cls.model_fields.get("extensions")
            choices: list[str | AliasPath] = []
            if "extensions" not in custom_wire_aliases:
                choices.append("extensions")
            choices.append(AliasPath("@metadata", "extensions"))
            if "metadata" not in custom_wire_aliases:
                choices.append(AliasPath("metadata", "extensions"))
            at_only_ext_alias: str | AliasPath | AliasChoices = (
                choices[0] if len(choices) == 1 else AliasChoices(*choices)
            )
            if (
                ext_field is not None
                and ext_field.validation_alias != at_only_ext_alias
            ):
                new_ext = copy.copy(ext_field)
                new_ext.validation_alias = at_only_ext_alias
                cls.model_fields["extensions"] = new_ext
                needs_rebuild = True

        if needs_rebuild:
            try:
                cls.model_rebuild(force=True, raise_errors=True)
            except PydanticUndefinedAnnotation:
                cls.model_rebuild(force=True, raise_errors=False)

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


def _coerce_v10_child(value: Any) -> Any:
    """Accepts builder nodes, ``{"@child": id}`` wire objects, or legacy IDs."""
    if isinstance(value, Mapping) and set(value.keys()) == {"@child"}:
        inner = value["@child"]
        if isinstance(inner, str):
            return ComponentRef(id=inner)
        return inner
    # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
    if isinstance(value, str):
        return ComponentRef(id=value)
    return value


def _serialize_v10_child(
    node: CoreComponentBuilderNode, info: SerializationInfo
) -> Any:
    """Serializes a v1.0 child slot as ``{"@child": "<id>"}`` during flattening."""
    context = flatten_context_of(info)
    if context is None:
        return node.model_dump(by_alias=True, exclude_none=True)
    return {"@child": emit_component(node, context)}


Child: TypeAlias = Annotated[
    CoreComponentBuilderNode,
    BeforeValidator(_coerce_v10_child),
    PlainSerializer(_serialize_v10_child, return_type=Any),
]
"""A v1.0 child component slot that flattens to ``{"@child": "<id>"}``."""


def _coerce_bare_child(value: Any) -> Any:
    """Accepts builder nodes or bare string IDs inside ChildList containers."""
    if isinstance(value, str):
        return ComponentRef(id=value)
    return value


_BareChild: TypeAlias = Annotated[
    CoreComponentBuilderNode,
    BeforeValidator(_coerce_bare_child),
    PlainSerializer(serialize_child, return_type=Any),
]


class Action(BuilderBaseModel):
    """Dispatches either an agent ``event`` or a renderer/agent ``function_call`` (mutually exclusive)."""

    event: ActionEvent | None = Field(
        default=None,
        serialization_alias="@action",
        # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
        validation_alias=AliasChoices("@action", "event"),
    )
    function_call: FunctionCall | None = Field(
        default=None,
        serialization_alias="@functionCall",
        # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
        validation_alias=AliasChoices("@functionCall", "functionCall"),
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
    written under ``@child`` with ``@path`` on the wire. ``path`` may be
    absolute (``/items``) or relative to an enclosing template scope.
    """

    path: str = Field(
        serialization_alias="@path",
        # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
        validation_alias=AliasChoices(
            "@path", "path", "data_model_path", "dataModelPath"
        ),
    )
    template: _BareChild = Field(
        serialization_alias="@child",
        # TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
        validation_alias=AliasChoices("@child", "componentId"),
    )


def _coerce_v10_child_list(value: Any) -> Any:
    """Unwraps ``{"@child": [...]}`` static child lists; leaves templates intact."""
    if isinstance(value, Mapping) and set(value.keys()) == {"@child"}:
        items = value["@child"]
        if isinstance(items, Sequence) and not isinstance(items, (str, bytes)):
            return list(items)
    return value


def _serialize_v10_child_list(value: Any, info: SerializationInfo) -> Any:
    """Serializes static child lists to ``{"@child": [...]}`` during flattening."""
    if isinstance(value, DynamicChildList):
        return value.model_dump(by_alias=True, exclude_none=True, context=info.context)
    context = flatten_context_of(info)
    if context is None:
        return [item.model_dump(by_alias=True, exclude_none=True) for item in value]
    return {"@child": [emit_component(item, context) for item in value]}


# TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback on input.
ChildList: TypeAlias = Annotated[
    Sequence[_BareChild] | DynamicChildList,
    BeforeValidator(_coerce_v10_child_list),
    PlainSerializer(_serialize_v10_child_list, return_type=Any),
]

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "ActionEvent",
    "CheckRule",
    "Child",
    "ChildList",
    "ComponentBuilderNode",
    "DataBinding",
    "DynamicBoolean",
    "DynamicChildList",
    "DynamicNumber",
    "DynamicString",
    "DynamicStringList",
    "DynamicValue",
    "Extensions",
    "FunctionCall",
    "set_surface_extensions",
]
