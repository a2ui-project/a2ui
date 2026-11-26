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

"""Catalog-agnostic component decision graph for local A2UI synthesis."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any

from a2ui.core import CatalogApi
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    check_mixed_catalogs,
    surface_catalog_id,
)
from a2ui.utils._experimental import experimental

from .models import ComponentKey, ComponentNodeSpec, ComponentSlot, SlotKind

_EXCLUDED_PROPERTIES = frozenset({
    "component",
    "id",
    "catalogId",
    "checks",
    "accessibility",
    "metadata",
    "@catalogId",
    "@checks",
    "@accessibility",
    "@metadata",
})


def _collect_refs(schema: Mapping[str, Any]) -> list[str]:
    """Collects `$ref` targets from `schema` and its combinator sub-schemas."""
    refs: list[str] = []
    direct_ref = schema.get("$ref")
    if isinstance(direct_ref, str):
        refs.append(direct_ref)
    for combinator in ("oneOf", "anyOf", "allOf"):
        sub_list = schema.get(combinator)
        if isinstance(sub_list, Sequence) and not isinstance(sub_list, (str, bytes)):
            for sub in sub_list:
                if isinstance(sub, Mapping):
                    refs.extend(_collect_refs(sub))
    return refs


def _ref_matches(refs: Sequence[str], suffixes: tuple[str, ...]) -> bool:
    """Returns whether any `$ref` string ends with one of `suffixes`."""
    for ref in refs:
        for suffix in suffixes:
            if ref == suffix or ref.endswith(f"/{suffix}"):
                return True
    return False


def _combinator_objects(schema: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Returns dict sub-schemas inside `oneOf` or `anyOf` combinators."""
    objs: list[Mapping[str, Any]] = []
    for combinator in ("oneOf", "anyOf"):
        sub_list = schema.get(combinator)
        if isinstance(sub_list, Sequence) and not isinstance(sub_list, (str, bytes)):
            objs.extend(sub for sub in sub_list if isinstance(sub, Mapping))
    return objs


def _is_child_list_schema(prop_schema: Mapping[str, Any], refs: Sequence[str]) -> bool:
    """Returns whether a property schema represents an A2UI `ChildList`."""
    if _ref_matches(refs, ("ChildList",)):
        return True
    for sub in _combinator_objects(prop_schema):
        props = sub.get("properties")
        if isinstance(props, Mapping) and "componentId" in props and "path" in props:
            return True
    return False


def _is_action_schema(prop_schema: Mapping[str, Any], refs: Sequence[str]) -> bool:
    """Returns whether a property schema represents an A2UI `Action`."""
    if _ref_matches(refs, ("Action",)):
        return True
    for sub in _combinator_objects(prop_schema):
        props = sub.get("properties")
        if isinstance(props, Mapping) and ("event" in props or "functionCall" in props):
            return True
    return False


def _find_label_key(
    items_props: Mapping[str, Any],
    required_keys: Any,
    child_id_key: str,
) -> str | None:
    """Selects the label/title key from an array item object schema."""
    req_set = (
        set(required_keys)
        if isinstance(required_keys, Sequence)
        and not isinstance(required_keys, (str, bytes))
        else set()
    )
    other_keys = [str(k) for k in items_props if str(k) != child_id_key]
    for key in other_keys:
        if key in req_set:
            return key
    for key in other_keys:
        sub = items_props.get(key)
        if isinstance(sub, Mapping) and (
            sub.get("type") == "string"
            or _ref_matches(_collect_refs(sub), ("DynamicString", "DataBinding"))
        ):
            return key
    return other_keys[0] if other_keys else None


def _classify_named_child_array(
    prop_name: str,
    prop_schema: Mapping[str, Any],
    is_required: bool,
) -> ComponentSlot | None:
    """Detects an array of objects containing a child `ComponentId` reference."""
    if prop_schema.get("type") != "array":
        return None
    items = prop_schema.get("items")
    if not isinstance(items, Mapping):
        return None
    items_props = items.get("properties")
    if not isinstance(items_props, Mapping):
        return None
    child_id_key: str | None = None
    for field_name, field_schema in items_props.items():
        if isinstance(field_schema, Mapping) and _ref_matches(
            _collect_refs(field_schema), ("ComponentId", "Child")
        ):
            child_id_key = str(field_name)
            break
    if child_id_key is None:
        return None
    label_key = _find_label_key(items_props, items.get("required", ()), child_id_key)
    return ComponentSlot(
        name=prop_name,
        kind=SlotKind.NAMED_CHILD_ARRAY,
        required=is_required,
        child_id_key=child_id_key,
        label_key=label_key,
        description=str(prop_schema.get("description") or ""),
    )


def _resolve_enum_values(
    helper: CatalogSchemaHelper,
    comp_name: str,
    prop_name: str,
    prop_schema: Mapping[str, Any],
) -> tuple[str, ...]:
    """Extracts static enum values for a component property if present."""
    enum_list = helper.get_property_enum(comp_name, prop_name)
    if not enum_list:
        direct_enum = prop_schema.get("enum")
        if isinstance(direct_enum, Sequence) and not isinstance(
            direct_enum, (str, bytes)
        ):
            enum_list = list(direct_enum)
    if not enum_list:
        return ()
    return tuple(str(v) for v in enum_list)


def _primitive_to_value_type(prim_type: Any) -> str | None:
    """Maps a JSON Schema primitive `type` string to a `ComponentSlot` type."""
    if prim_type == "string":
        return "string"
    if prim_type in ("number", "integer"):
        return "number"
    if prim_type == "boolean":
        return "boolean"
    if prim_type == "array":
        return "array"
    return None


def _resolve_data_value_type(
    prop_schema: Mapping[str, Any], refs: Sequence[str]
) -> str | None:
    """Determines the data value type for a bindable `DATA_VALUE` slot."""
    ref_type_pairs = (
        (("DynamicString",), "string"),
        (("DynamicNumber",), "number"),
        (("DynamicBoolean",), "boolean"),
        (("DynamicStringList",), "array"),
        (("DynamicValue",), "any"),
    )
    for suffixes, val_type in ref_type_pairs:
        if _ref_matches(refs, suffixes):
            return val_type
    if not _ref_matches(refs, ("DataBinding",)):
        return None
    direct = _primitive_to_value_type(prop_schema.get("type"))
    if direct is not None:
        return direct
    sub_types = {
        t
        for sub in _combinator_objects(prop_schema)
        for t in (_primitive_to_value_type(sub.get("type")),)
        if t is not None
    }
    if len(sub_types) > 1:
        return "any"
    if len(sub_types) == 1:
        return next(iter(sub_types))
    return "any"


def _classify_property_slot(
    helper: CatalogSchemaHelper,
    comp_name: str,
    prop_name: str,
    prop_schema: Mapping[str, Any],
    is_required: bool,
) -> ComponentSlot | None:
    """Classifies a single component property schema into a `ComponentSlot`."""
    description = str(prop_schema.get("description") or "")
    refs = _collect_refs(prop_schema)
    if _is_child_list_schema(prop_schema, refs):
        return ComponentSlot(
            name=prop_name,
            kind=SlotKind.CHILD_LIST,
            required=is_required,
            description=description,
        )
    named_array = _classify_named_child_array(prop_name, prop_schema, is_required)
    if named_array is not None:
        return named_array
    if _ref_matches(refs, ("ComponentId", "Child")):
        return ComponentSlot(
            name=prop_name,
            kind=SlotKind.CHILD,
            required=is_required,
            description=description,
        )
    if _is_action_schema(prop_schema, refs):
        return ComponentSlot(
            name=prop_name,
            kind=SlotKind.ACTION,
            required=is_required,
            description=description,
        )
    enum_values = _resolve_enum_values(helper, comp_name, prop_name, prop_schema)
    if enum_values:
        return ComponentSlot(
            name=prop_name,
            kind=SlotKind.STATIC_ENUM,
            required=is_required,
            enum_values=enum_values,
            description=description,
        )
    value_type = _resolve_data_value_type(prop_schema, refs)
    if value_type is not None:
        return ComponentSlot(
            name=prop_name,
            kind=SlotKind.DATA_VALUE,
            required=is_required,
            value_type=value_type,
            description=description,
        )
    prim_type = _primitive_to_value_type(prop_schema.get("type"))
    if prim_type in ("string", "number", "boolean"):
        return ComponentSlot(
            name=prop_name,
            kind=SlotKind.LITERAL_PRIMITIVE,
            required=is_required,
            value_type=prim_type,
            description=description,
        )
    return None


def _is_component_checkable(
    helper: CatalogSchemaHelper, comp_name: str, raw_props: Sequence[str]
) -> bool:
    """Returns whether `comp_name` supports validation `@checks`."""
    del raw_props
    return helper.is_checkable(comp_name)


def _collect_component_props_and_required(
    helper: CatalogSchemaHelper, comp_name: str
) -> tuple[list[str], set[str]]:
    """Returns `(ordered_property_names, required_property_names)` for `comp_name`."""
    required_set = set(helper.get_component_required(comp_name))
    raw_props = list(helper.get_component_properties(comp_name))
    comp_schema = helper.components.get(comp_name, {})
    if not isinstance(comp_schema, Mapping):
        return raw_props, required_set
    direct_props = comp_schema.get("properties")
    if isinstance(direct_props, Mapping):
        raw_props.extend(str(k) for k in direct_props if str(k) not in raw_props)
    direct_req = comp_schema.get("required")
    if isinstance(direct_req, Sequence) and not isinstance(direct_req, (str, bytes)):
        required_set.update(str(r) for r in direct_req)
    return raw_props, required_set


def _build_component_slots(
    helper: CatalogSchemaHelper,
    comp_name: str,
    raw_props: Sequence[str],
    required_set: set[str],
) -> tuple[ComponentSlot, ...]:
    """Classifies all bindable slots on `comp_name`."""
    slots: list[ComponentSlot] = []
    excluded = _EXCLUDED_PROPERTIES - helper.get_custom_envelope_properties(comp_name)
    for prop_name in raw_props:
        if prop_name in excluded:
            continue
        prop_schema = helper.get_property_schema(comp_name, prop_name)
        if not isinstance(prop_schema, Mapping):
            continue
        slot = _classify_property_slot(
            helper, comp_name, prop_name, prop_schema, prop_name in required_set
        )
        if slot is not None:
            slots.append(slot)
    return tuple(slots)


def _extract_allowed_list(
    helper: CatalogSchemaHelper,
    comp_name: str,
    camel_key: str,
    snake_attr: str,
) -> tuple[str, ...]:
    """Extracts `allowedParents` or `allowedChildren` from component schema or model."""
    comp_schema = helper.components.get(comp_name)
    if isinstance(comp_schema, Mapping):
        raw = comp_schema.get(camel_key)
        if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
            return tuple(str(item) for item in raw)
    cat_model = getattr(helper, "catalog_model", None)
    comp_map = getattr(cat_model, "components", None)
    if isinstance(comp_map, Mapping) and comp_name in comp_map:
        attr = getattr(comp_map[comp_name], snake_attr, None)
        if isinstance(attr, Sequence) and not isinstance(attr, (str, bytes)):
            return tuple(str(item) for item in attr)
    return ()


def _extract_component_spec(
    catalog_id: str, comp_name: str, helper: CatalogSchemaHelper
) -> ComponentNodeSpec:
    """Extracts a `ComponentNodeSpec` for `comp_name` from `helper`."""
    raw_props, required_set = _collect_component_props_and_required(helper, comp_name)
    slot_tuple = _build_component_slots(helper, comp_name, raw_props, required_set)
    container_kinds = (
        SlotKind.CHILD,
        SlotKind.CHILD_LIST,
        SlotKind.NAMED_CHILD_ARRAY,
    )
    return ComponentNodeSpec(
        name=comp_name,
        catalog_id=catalog_id,
        description=helper.get_component_description(comp_name) or "",
        slots=slot_tuple,
        supports_checks=_is_component_checkable(helper, comp_name, raw_props),
        is_container=any(s.kind in container_kinds for s in slot_tuple),
        is_multi_view_switcher=any(
            s.kind == SlotKind.NAMED_CHILD_ARRAY for s in slot_tuple
        ),
        has_action_slot=any(s.kind == SlotKind.ACTION for s in slot_tuple),
        allowed_parents=_extract_allowed_list(
            helper, comp_name, "allowedParents", "allowed_parents"
        ),
        allowed_children=_extract_allowed_list(
            helper, comp_name, "allowedChildren", "allowed_children"
        ),
    )


@experimental
class CatalogDecisionGraph:
    """Catalog-agnostic component and function decision graph.

    Attributes:
        protocol_version: Normalized A2UI protocol version string (prefixed
            with ``"v"``).
        surface_catalog_id: Default catalog ID for single-catalog surfaces, or
            None when multiple catalogs are combined.
    """

    def __init__(self, catalogs: Sequence[CatalogApi]) -> None:
        """Initializes a catalog decision graph from one or more catalogs.

        Args:
            catalogs: Validated catalogs sharing a single protocol version.
        """
        self._catalogs = check_mixed_catalogs(catalogs)
        self._helpers = build_catalog_helpers(self._catalogs)
        first_ver = self._catalogs[0].protocol_version
        raw_ver = str(first_ver.value if isinstance(first_ver, Enum) else first_ver)
        self.protocol_version: str = (
            raw_ver if raw_ver.startswith("v") else f"v{raw_ver}"
        )
        self.surface_catalog_id: str | None = surface_catalog_id(self._catalogs)

        self._components: dict[str, ComponentNodeSpec] = {}
        self._components_by_key: dict[ComponentKey, ComponentNodeSpec] = {}
        self._bare_name_counts: dict[str, int] = {}
        for catalog_id, helper in self._helpers.items():
            for comp_name in helper.components:
                spec = _extract_component_spec(catalog_id, comp_name, helper)
                self._components_by_key[(catalog_id, comp_name)] = spec
                self._bare_name_counts[comp_name] = (
                    self._bare_name_counts.get(comp_name, 0) + 1
                )
                if comp_name not in self._components:
                    self._components[comp_name] = spec

    def get_component(self, name: str | ComponentKey) -> ComponentNodeSpec | None:
        """Returns the `ComponentNodeSpec` for `name` or `(catalog_id, name)`, or None.

        Args:
            name: Bare component type name or qualified `(catalog_id, name)` key.

        Returns:
            The matching `ComponentNodeSpec`, or None if not registered.
        """
        if isinstance(name, tuple):
            return self._components_by_key.get(name)
        return self._components.get(name)

    def get_component_by_key(self, key: ComponentKey) -> ComponentNodeSpec | None:
        """Returns the `ComponentNodeSpec` for qualified `(catalog_id, name)`."""
        return self._components_by_key.get(key)

    def components_by_key(self) -> Mapping[ComponentKey, ComponentNodeSpec]:
        """Returns all registered component specs keyed by `(catalog_id, name)`."""
        return dict(self._components_by_key)

    @property
    def catalogs(self) -> tuple[CatalogApi, ...]:
        """The validated catalogs backing this decision graph."""
        return tuple(self._catalogs)

    def helpers(self) -> Mapping[str, CatalogSchemaHelper]:
        """Returns the mapping of catalog IDs to their `CatalogSchemaHelper`."""
        return dict(self._helpers)
