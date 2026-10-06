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

"""Provides dynamic common_types JSON schema generation from Pydantic models."""

from __future__ import annotations

import copy
import importlib
import json
from typing import Any, Final, NamedTuple, cast

from pydantic import TypeAdapter

from ..exceptions import A2uiCatalogError
from . import ProtocolVersion
from ._dynamic_types import (
    DynamicTypeIndex,
    build_dynamic_type_index,
    clean_schema_node,
    is_type,
)
from ._json_schema import (
    INLINE_DEF_MARKER,
    SPEC_TITLE_KEY,
    inline_marked_defs,
    resolve_ref_markers,
    spec_schema,
)


def _clean_union_root(
    schema: dict[str, Any], dynamic_index: DynamicTypeIndex
) -> dict[str, Any]:
    """Cleans a root-level union schema without collapsing it into a `$ref`.

    `clean_schema_node` rewrites dynamic value unions into a `$ref` to the
    matching dynamic def. At the root of that def this would make it reference
    itself, so only the union branches are cleaned.
    """
    union_key = "anyOf" if "anyOf" in schema else "oneOf"
    items = [
        clean_schema_node(item, dynamic_index=dynamic_index)
        for item in schema[union_key]
        if not is_type(item, "null")
    ]
    if any(is_type(item, "number") for item in items):
        items = [item for item in items if not is_type(item, "integer")]
    cleaned: dict[str, Any] = {
        k: clean_schema_node(
            v, is_properties_dict=(k == "properties"), dynamic_index=dynamic_index
        )
        for k, v in schema.items()
        if k not in ("anyOf", "oneOf", "title", SPEC_TITLE_KEY)
    }
    if SPEC_TITLE_KEY in schema:
        cleaned["title"] = schema[SPEC_TITLE_KEY]
    cleaned["oneOf"] = items
    return cleaned


_JSON_TYPE_NAMES: dict[type, str] = {
    str: "string",
    bool: "boolean",
    int: "integer",
    float: "number",
}


def _strip_const_implied_keywords(node: Any) -> Any:
    """Drops the `type` and `default` Pydantic adds next to a `const`.

    A `Literal` field emits its JSON type, and a defaulted one its default,
    both implied by the `const` itself; the specification writes only `const`.
    """
    if isinstance(node, list):
        return [_strip_const_implied_keywords(item) for item in node]
    if not isinstance(node, dict):
        return node
    stripped = {k: _strip_const_implied_keywords(v) for k, v in node.items()}
    if "const" in stripped and isinstance(stripped["const"], (str, bool, int, float)):
        const = stripped["const"]
        if stripped.get("default") == const:
            del stripped["default"]
        if stripped.get("type") == _JSON_TYPE_NAMES.get(type(const)):
            del stripped["type"]
    return stripped


def _raw_symbol_schema(
    def_name: str, symbol: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Returns the raw Pydantic JSON schema of a COMMON_TYPES_DEFS symbol.

    Returns:
        A tuple of the raw definition and the raw nested `$defs` that the
        symbol references (for example `TemplateChildList` or `ActionEvent`).
    """
    raw = resolve_ref_markers(
        TypeAdapter(symbol).json_schema(ref_template="#/$defs/{model}")
    )
    nested: dict[str, Any] = raw.pop("$defs", {})

    # A symbol whose core schema declares its own ref (e.g. `ComponentId`) is
    # emitted as a self-reference; inline the referenced definition instead.
    if raw.get("$ref") == f"#/$defs/{def_name}" and def_name in nested:
        target = nested.pop(def_name)
        raw = {**target, **{k: v for k, v in raw.items() if k != "$ref"}}
    return raw, nested


def _clean_symbol_schema(
    raw: dict[str, Any], dynamic_index: DynamicTypeIndex
) -> dict[str, Any]:
    """Cleans the raw JSON schema of a COMMON_TYPES_DEFS symbol."""
    if "anyOf" in raw or "oneOf" in raw:
        schema = _clean_union_root(raw, dynamic_index)
    else:
        schema = cast(
            dict[str, Any], clean_schema_node(raw, dynamic_index=dynamic_index)
        )

    return schema


def _inline_helper_refs(node: Any, helper_defs: dict[str, Any]) -> Any:
    """Recursively replaces `$ref`s to helper defs with the helper schema.

    Sibling keywords of the `$ref` (e.g. a `description`) are kept and take
    precedence over the helper's own keywords.
    """
    if isinstance(node, list):
        return [_inline_helper_refs(item, helper_defs) for item in node]
    if not isinstance(node, dict):
        return node

    ref = node.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        helper = helper_defs.get(ref[len("#/$defs/") :])
        if helper is not None:
            siblings = {k: v for k, v in node.items() if k != "$ref"}
            return _inline_helper_refs(
                {**copy.deepcopy(helper), **siblings}, helper_defs
            )
    return {k: _inline_helper_refs(v, helper_defs) for k, v in node.items()}


class _BuiltCommonTypes(NamedTuple):
    schema: dict[str, Any]
    catalog_defs: dict[str, Any]
    dynamic_index: DynamicTypeIndex


# Common types schemas by release line (major, minor).
_COMMON_TYPES_RELEASES: Final[dict[tuple[int, int], tuple[str, str]]] = {
    (0, 9): (
        "a2ui.core.schema.v0_9.common_types",
        "https://a2ui.org/specification/v0_9/common_types.json",
    ),
    (1, 0): (
        "a2ui.core.schema.v1_0.common_types",
        "https://a2ui.org/specification/v1_0/common_types.json",
    ),
}

# The release line that serves each protocol version. v0.9.1 publishes v0.9's
# common_types.json unchanged. v0.8 has no common types.
_RELEASE_BY_VERSION: Final[dict[ProtocolVersion, tuple[int, int]]] = {
    ProtocolVersion.V0_9: (0, 9),
    ProtocolVersion.V0_9_1: (0, 9),
    ProtocolVersion.V1_0: (1, 0),
}


def _common_types_release(
    protocol_version: ProtocolVersion, fall_back_to_oldest: bool = False
) -> tuple[int, int]:
    """Returns the common types release line that serves a protocol version.

    Args:
        protocol_version: The protocol version.
        fall_back_to_oldest: Whether a version without common types (v0.8)
            uses the oldest release line instead of raising.

    Raises:
        A2uiCatalogError: If the version has no common types and
            `fall_back_to_oldest` is false.
    """
    release = _RELEASE_BY_VERSION.get(protocol_version)
    if release is not None:
        return release
    if fall_back_to_oldest:
        return min(_COMMON_TYPES_RELEASES)
    raise A2uiCatalogError(
        "common_types schema is not available for protocol version"
        f" '{protocol_version}'."
    )


def _build_common_types_schema(release: tuple[int, int]) -> _BuiltCommonTypes:
    """Re-generates the common types JSON schema from Pydantic models for a release line.

    Returns:
        The published schema, where helper models (e.g. `TemplateChildList`)
        are inlined at their references as in the specification; the defs in
        `$ref` form, where helper models are separate defs for catalogs whose
        component schemas reference them (models of nested objects, e.g.
        `ComponentCommonMetadata`, stay inline); and the dynamic value def
        index.

    Raises:
        A2uiCatalogError: If the release's schema module defines no `COMMON_TYPES_DEFS`.
    """
    module_name, schema_id = _COMMON_TYPES_RELEASES[release]
    mod = importlib.import_module(module_name)
    defs_manifest: dict[str, Any] | None = getattr(mod, "COMMON_TYPES_DEFS", None)
    if not defs_manifest:
        raise A2uiCatalogError(
            f"Schema module '{module_name}' does not define COMMON_TYPES_DEFS."
        )

    # The published schema uses the specification's shape. Catalogs embed the
    # defs next to their own function union, so they get the flat shape the
    # models validate, as before.
    with spec_schema():
        spec_defs, spec_helpers, dynamic_index = _build_defs(defs_manifest)
    defs, helpers, _ = _build_defs(defs_manifest)

    # The specification inlines helper models (e.g. `TemplateChildList` in
    # `ChildList`), so the published schema does the same.
    spec_helpers = {
        name: {k: v for k, v in helper.items() if k != INLINE_DEF_MARKER}
        for name, helper in spec_helpers.items()
    }
    published_defs: dict[str, Any] = {
        def_name: _strip_const_implied_keywords(
            _inline_helper_refs(def_schema, spec_helpers)
        )
        for def_name, def_schema in spec_defs.items()
    }

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": schema_id,
        "title": "A2UI Common Types",
        "description": "Common type definitions used across A2UI schemas.",
        "$defs": published_defs,
    }
    return _BuiltCommonTypes(
        schema=schema,
        catalog_defs=_strip_const_implied_keywords(
            inline_marked_defs({"$defs": {**defs, **helpers}})["$defs"]
        ),
        dynamic_index=dynamic_index,
    )


def _build_defs(
    defs_manifest: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], DynamicTypeIndex]:
    """Generates the cleaned defs of a COMMON_TYPES_DEFS manifest.

    Returns:
        The defs, the helper defs they reference (e.g. `TemplateChildList`),
        and the dynamic value def index.
    """
    raw_defs: dict[str, Any] = {}
    helper_defs: dict[str, Any] = {}

    for def_name, symbol in defs_manifest.items():
        raw_defs[def_name], nested = _raw_symbol_schema(def_name, symbol)
        for nested_name, nested_def in nested.items():
            if nested_name not in defs_manifest:
                helper_defs.setdefault(nested_name, nested_def)

    # Dynamic value defs are identified by shape, so the index can be built
    # from the raw root unions before any nested union is collapsed.
    dynamic_index = build_dynamic_type_index(raw_defs)

    defs: dict[str, Any] = {
        def_name: _clean_symbol_schema(raw, dynamic_index)
        for def_name, raw in raw_defs.items()
    }
    cleaned_helpers: dict[str, Any] = {
        helper_name: clean_schema_node(helper_def, dynamic_index=dynamic_index)
        for helper_name, helper_def in helper_defs.items()
    }
    return defs, cleaned_helpers, dynamic_index


class _CachedCommonTypes(NamedTuple):
    schema: dict[str, Any]
    json: str
    catalog_defs: dict[str, Any]
    dynamic_index: DynamicTypeIndex


_SCHEMA_CACHE: dict[tuple[int, int], _CachedCommonTypes] = {}


def _get_cached_common_types(release: tuple[int, int]) -> _CachedCommonTypes:
    if release not in _SCHEMA_CACHE:
        built = _build_common_types_schema(release)
        _SCHEMA_CACHE[release] = _CachedCommonTypes(
            schema=built.schema,
            json=json.dumps(built.schema, indent=2),
            catalog_defs=built.catalog_defs,
            dynamic_index=built.dynamic_index,
        )
    return _SCHEMA_CACHE[release]


# The two dynamic type accessors below are shared with other a2ui-core modules
# (the catalog and the generic binder). They are intentionally left out of
# `__all__`, so neither `import *` nor the package facades re-export them.


def get_dynamic_type_index(protocol_version: ProtocolVersion) -> DynamicTypeIndex:
    """Returns the dynamic value def index for a protocol version.

    Versions without a common_types schema (v0.8) fall back to the v0.9
    definitions, matching the catalog's dynamic defs.
    """
    release = _common_types_release(protocol_version, fall_back_to_oldest=True)
    return _get_cached_common_types(release).dynamic_index


def get_all_dynamic_type_names() -> frozenset[str]:
    """Returns the dynamic value def names across all common_types versions."""
    return frozenset().union(*(
        _get_cached_common_types(release).dynamic_index.names
        for release in _COMMON_TYPES_RELEASES
    ))


def get_common_types_catalog_defs(protocol_version: ProtocolVersion) -> dict[str, Any]:
    """Returns the common types defs in the `$ref` form that catalogs use.

    Unlike the published schema, helper models (e.g. `TemplateChildList`) are
    separate defs referenced by `$ref`, because catalog component schemas
    generated from the same models reference them by name.

    Raises:
        A2uiCatalogError: If the protocol version has no common_types schema
            (v0.8).
    """
    return copy.deepcopy(_get_common_types_schema(protocol_version).catalog_defs)


def get_common_types_symbols(protocol_version: ProtocolVersion) -> dict[str, Any]:
    """Returns the common types defs' Python symbols by def name.

    These are the models and types the published common types schema is
    generated from, for example `Checkable` or `ComponentCommon`.

    Raises:
        A2uiCatalogError: If the protocol version does not define a common_types schema
            (e.g., version < 0.9) or is invalid.
    """
    module_name, _ = _COMMON_TYPES_RELEASES[_common_types_release(protocol_version)]
    return dict(getattr(importlib.import_module(module_name), "COMMON_TYPES_DEFS"))


def _get_common_types_schema(protocol_version: ProtocolVersion) -> _CachedCommonTypes:
    """Returns the cached common types schema for a protocol version.

    Generated dynamically from the build-time Pydantic models for the target protocol version.

    Raises:
        A2uiCatalogError: If the protocol version has no common_types schema
            (v0.8).
    """
    return _get_cached_common_types(_common_types_release(protocol_version))


def get_common_types_schema_map(protocol_version: ProtocolVersion) -> dict[str, Any]:
    """Returns the common types JSON schema as a dictionary for a protocol version.

    Args:
        protocol_version: The protocol version. Use `to_protocol_version` to
            convert a version string.

    Returns:
        A fresh copy of the schema generated from the build-time Pydantic models.

    Raises:
        A2uiCatalogError: If the protocol version has no common_types schema
            (v0.8).
    """
    return copy.deepcopy(_get_common_types_schema(protocol_version).schema)


def get_common_types_schema_json(protocol_version: ProtocolVersion) -> str:
    """Returns the common types JSON schema as a JSON string for a protocol version.

    Args:
        protocol_version: The protocol version. Use `to_protocol_version` to
            convert a version string.

    Raises:
        A2uiCatalogError: If the protocol version has no common_types schema
            (v0.8).
    """
    return _get_common_types_schema(protocol_version).json


__all__ = [
    "get_common_types_schema_json",
    "get_common_types_schema_map",
]
