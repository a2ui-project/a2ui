# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Internal helpers for recognizing and collapsing dynamic value schemas.

A dynamic value def is a union that accepts a `DataBinding`, a `FunctionCall`,
and literal values (e.g. `DynamicString` or `DynamicValue`). These helpers
identify such defs by shape, so no code needs to list them by name.

This module is internal to a2ui-core and is not re-exported by any facade.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from types import MappingProxyType
from typing import Any, Final, NamedTuple

from ._json_schema import KEEP_ANY_OF_MARKER, SPEC_TITLE_KEY


def is_ref(item: Any, target_def: str) -> bool:
    return isinstance(item, dict) and item.get("$ref") == f"#/$defs/{target_def}"


def is_type(item: Any, target_type: str) -> bool:
    return isinstance(item, dict) and item.get("type") == target_type


# Literal kinds that select a specific dynamic def when they are the only
# literal branch of a union. Container literals (arrays and objects) select a
# dynamic def by their full shape instead (e.g. `DynamicStringList`), and
# otherwise collapse to the catch-all dynamic def.
_SCALAR_LITERAL_KINDS: Final[frozenset[str]] = frozenset({
    "string",
    "number",
    "boolean",
})

# Keywords that annotate a schema without constraining it; literal shapes
# ignore them, so a documented branch matches an undocumented one.
_ANNOTATION_KEYWORDS: Final[frozenset[str]] = frozenset({
    "default",
    "description",
    "examples",
    "title",
    SPEC_TITLE_KEY,
})


class DynamicTypeIndex(NamedTuple):
    """Dynamic value defs derived structurally from a common_types schema.

    A dynamic def is a union that accepts a data binding, a function call, and
    one or more literal branches (e.g. `DynamicString` or `DynamicValue`).
    The mappings are read-only, since indexes are cached and shared.
    """

    names: frozenset[str]
    by_scalar_kind: Mapping[str, str]
    catch_all: str | None
    # Defs with container literal branches (e.g. `DynamicStringList`), keyed
    # by `literal_shape_key` of their union branches.
    by_literal_shape: Mapping[str, str] = MappingProxyType({})


EMPTY_DYNAMIC_INDEX: Final[DynamicTypeIndex] = DynamicTypeIndex(
    names=frozenset(), by_scalar_kind=MappingProxyType({}), catch_all=None
)


def is_function_call_branch(item: Any) -> bool:
    if is_ref(item, "FunctionCall"):
        return True
    all_of = item.get("allOf") if isinstance(item, dict) else None
    return isinstance(all_of, list) and any(
        is_ref(sub, "FunctionCall") for sub in all_of
    )


def literal_kind(item: Any) -> str:
    """Returns the JSON literal kind of a union branch (integer counts as number)."""
    if not isinstance(item, dict):
        return "unknown"
    item_type = item.get("type")
    if item_type == "integer":
        return "number"
    if isinstance(item_type, str):
        return item_type
    if "additionalProperties" in item or "properties" in item:
        return "object"
    return "unknown"


def _literal_branches(items: list[Any]) -> list[Any]:
    return [
        it
        for it in items
        if not is_ref(it, "DataBinding")
        and not is_function_call_branch(it)
        and not is_type(it, "null")
    ]


def dynamic_literal_kinds(items: list[Any]) -> frozenset[str] | None:
    """Returns the literal kinds of a dynamic union, or None if it is not dynamic.

    A union is dynamic when it has both a `DataBinding` branch and a
    `FunctionCall` branch; its remaining branches are literal values.
    """
    if not any(is_ref(it, "DataBinding") for it in items):
        return None
    if not any(is_function_call_branch(it) for it in items):
        return None
    return frozenset(literal_kind(it) for it in _literal_branches(items))


def _strip_annotations(node: Any, is_properties_dict: bool = False) -> Any:
    if isinstance(node, list):
        return [_strip_annotations(item) for item in node]
    if not isinstance(node, dict):
        return node
    return {
        k: _strip_annotations(
            v, is_properties_dict=k == "properties" and not is_properties_dict
        )
        for k, v in node.items()
        if is_properties_dict or k not in _ANNOTATION_KEYWORDS
    }


def literal_shape_key(items: list[Any]) -> str:
    """Returns a canonical key of the literal branches of a dynamic union."""
    return json.dumps(
        sorted(
            json.dumps(_strip_annotations(it), sort_keys=True)
            for it in _literal_branches(items)
        )
    )


def _union_items(schema: Any) -> list[Any] | None:
    if not isinstance(schema, dict):
        return None
    items = schema.get("oneOf", schema.get("anyOf"))
    return items if isinstance(items, list) else None


def build_dynamic_type_index(defs: dict[str, Any]) -> DynamicTypeIndex:
    """Indexes the dynamic value defs of a `$defs` map by their literal branches."""
    kinds_by_name: dict[str, frozenset[str]] = {}
    shape_by_name: dict[str, str] = {}
    for name, schema in defs.items():
        items = _union_items(schema)
        kinds = dynamic_literal_kinds(items) if items is not None else None
        if items is not None and kinds is not None:
            kinds_by_name[name] = kinds
            shape_by_name[name] = literal_shape_key(items)

    if not kinds_by_name:
        return EMPTY_DYNAMIC_INDEX

    by_scalar_kind = {
        next(iter(kinds)): name
        for name, kinds in kinds_by_name.items()
        if len(kinds) == 1 and kinds <= _SCALAR_LITERAL_KINDS
    }
    all_kinds = frozenset().union(*kinds_by_name.values())
    catch_all = next(
        (name for name, kinds in kinds_by_name.items() if kinds >= all_kinds), None
    )
    by_literal_shape = {
        shape_by_name[name]: name
        for name, kinds in kinds_by_name.items()
        if name != catch_all and not kinds <= _SCALAR_LITERAL_KINDS
    }
    return DynamicTypeIndex(
        names=frozenset(kinds_by_name),
        by_scalar_kind=MappingProxyType(by_scalar_kind),
        catch_all=catch_all,
        by_literal_shape=MappingProxyType(by_literal_shape),
    )


def resolve_dynamic_def(
    items: list[Any], dynamic_index: DynamicTypeIndex
) -> str | None:
    """Returns the dynamic def that a union collapses into, if any.

    A union without a literal branch (only a binding and a function call) is
    not a dynamic value and does not collapse. Neither does a union whose
    scalar literal branch has keywords beyond its `type` (for example
    `format`), which the dynamic def would drop.
    """
    kinds = dynamic_literal_kinds(items)
    if not kinds:
        return None
    shape_def = dynamic_index.by_literal_shape.get(literal_shape_key(items))
    if shape_def:
        return shape_def
    if any(
        literal_kind(it) in _SCALAR_LITERAL_KINDS
        and set(_strip_annotations(it)) - {"type"}
        for it in _literal_branches(items)
    ):
        return None
    if len(kinds) == 1:
        scalar_def = dynamic_index.by_scalar_kind.get(next(iter(kinds)))
        if scalar_def:
            return scalar_def
    return dynamic_index.catch_all


def clean_schema_node(
    node: Any,
    referenced_dynamics: set[str] | None = None,
    is_properties_dict: bool = False,
    is_union_container: bool = False,
    dynamic_index: DynamicTypeIndex = EMPTY_DYNAMIC_INDEX,
) -> Any:
    """Recursively cleans auto-generated Pydantic schema attributes.

    Removes titles, null types, and redundant anyOf wrappers, and collapses
    inline dynamic value unions into a `$ref` to the matching dynamic def from
    `dynamic_index`.
    """
    if referenced_dynamics is None:
        referenced_dynamics = set()

    if isinstance(node, dict):
        cleaned: dict[str, Any] = {}
        for k, v in node.items():
            if k == "title" and not is_properties_dict:
                continue
            if k == SPEC_TITLE_KEY and not is_properties_dict:
                cleaned["title"] = v
                continue
            if not is_properties_dict and k in ("const", "default", "enum", "examples"):
                cleaned[k] = v
                continue
            cleaned[k] = clean_schema_node(
                v,
                referenced_dynamics=referenced_dynamics,
                is_properties_dict=(k == "properties"),
                is_union_container=(k in ("anyComponent", "anyFunction")),
                dynamic_index=dynamic_index,
            )

        return _clean_node_keywords(
            cleaned,
            referenced_dynamics,
            is_properties_dict,
            is_union_container,
            dynamic_index,
        )
    elif isinstance(node, list):
        return [
            clean_schema_node(
                item,
                referenced_dynamics=referenced_dynamics,
                is_properties_dict=False,
                dynamic_index=dynamic_index,
            )
            for item in node
        ]
    return node


def _clean_node_keywords(
    cleaned: dict[str, Any],
    referenced_dynamics: set[str],
    is_properties_dict: bool,
    is_union_container: bool,
    dynamic_index: DynamicTypeIndex,
) -> Any:
    """Applies `clean_schema_node`'s node-level rules to a node whose children are clean."""
    if (
        "$ref" in cleaned
        and isinstance(cleaned["$ref"], str)
        and cleaned["$ref"].startswith("#/$defs/")
    ):
        ref_target = cleaned["$ref"].split("/")[-1]
        referenced_dynamics.add(ref_target)

    if "default" in cleaned and cleaned["default"] is None:
        del cleaned["default"]

    # `list[Any]` emits `items: {}`, an empty schema that accepts every item;
    # the specification omits it. Inside `properties`, `items` is a property
    # name rather than a keyword, so it is kept there.
    if not is_properties_dict and cleaned.get("items") == {}:
        del cleaned["items"]

    # A union marked with `KeepAnyOf` keeps its `anyOf` as is.
    if not is_properties_dict and cleaned.pop(KEEP_ANY_OF_MARKER, False):
        return cleaned

    union_key = (
        "anyOf" if "anyOf" in cleaned else ("oneOf" if "oneOf" in cleaned else None)
    )
    if union_key and isinstance(cleaned[union_key], list):
        items = [item for item in cleaned[union_key] if not is_type(item, "null")]
        if len(items) == 1 and not is_union_container:
            single_item = items[0]
            parent_attrs = {k: v for k, v in cleaned.items() if k != union_key}
            if isinstance(single_item, dict):
                merged = dict(single_item)
                for k, v in parent_attrs.items():
                    if k not in merged:
                        merged[k] = v
                # Both parts are already clean, so only the node-level rules
                # are applied again.
                return _clean_node_keywords(
                    merged,
                    referenced_dynamics,
                    is_properties_dict=False,
                    is_union_container=False,
                    dynamic_index=dynamic_index,
                )
            else:
                return single_item
        else:
            target_def = resolve_dynamic_def(items, dynamic_index)
            if target_def:
                referenced_dynamics.add(target_def)
                parent_attrs = {k: v for k, v in cleaned.items() if k != union_key}
                res = {"$ref": f"#/$defs/{target_def}"}
                res.update(parent_attrs)
                return res

            if union_key == "anyOf":
                del cleaned["anyOf"]
            cleaned["oneOf"] = items

    return cleaned
