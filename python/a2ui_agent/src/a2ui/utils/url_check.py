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

"""Checks the URLs in a payload against a URL security policy before sending."""

from __future__ import annotations

import copy
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from a2ui.core import (
    BASIC_CATALOG_URL_PROPERTIES,
    CatalogApi,
    PermissiveUrlSecurityPolicy,
    UrlCheckInfo,
    UrlContext,
    UrlContextAnnotation,
    UrlPropertyMap,
    UrlSecurityPolicy,
    apply_url_security_policy,
    redact_url,
    url_context_of,
)

_Path = tuple[str | int, ...]

# The renderer's data model rejects a list index above this (`MAX_ARRAY_INDEX`
# in its data model), so an update that uses one never reaches the surface.
_MAX_ARRAY_INDEX = 10_000


@dataclass(frozen=True)
class BlockedPayloadUrl:
    """A URL that the policy blocked, as `check_payload_urls` reports it.

    Attributes:
        message_index: Index of the message holding the URL, or the binding
            to it, in the payload.
        surface_id: The surface the URL appears on.
        property_name: The property holding the URL, as a path with `[]` for
            list items, such as `"url"`, `"items[].imageUrl"`, or
            `"theme.iconUrl"`.
        context: How the renderer uses the URL.
        redacted_url: The URL with its path, query, fragment, user info, and
            `data:` payload removed, any of which may carry data the URL was
            meant to leak. Safe to log.
        catalog_id: The catalog of the component or theme holding the URL,
            when known.
        component_id: The component holding the URL; None for the theme.
        component_type: The type of the component holding the URL, such as
            `"Image"`.
        data_path: The data model path the property is bound to, when the URL
            comes from the data model.
    """

    message_index: int
    surface_id: str
    property_name: str
    context: UrlContext
    redacted_url: str
    catalog_id: str | None = None
    component_id: str | None = None
    component_type: str | None = None
    data_path: str | None = None


@dataclass(frozen=True)
class PayloadUrlCheckResult:
    """The result of `check_payload_urls`.

    Attributes:
        messages: The messages to send. With `on_blocked="report"`, or when
            nothing is blocked, these are the payload's own message objects.
            With `on_blocked="strip"`, the messages that held a blocked URL
            are copies with each blocked value replaced by an empty string.
        blocked: Every blocked URL, in payload order. Empty when every URL
            passes.
    """

    messages: list[Any]
    blocked: list[BlockedPayloadUrl] = field(default_factory=list)


@dataclass(frozen=True)
class _PayloadComponent:
    message_index: int
    surface_id: str
    component: dict[str, Any]
    base_path: _Path


@dataclass
class _PayloadSurface:
    catalog_id: str | None = None
    data_model: Any = None


def check_payload_urls(
    catalogs: Sequence[CatalogApi],
    payload: Any,
    *,
    policy: UrlSecurityPolicy | None = None,
    on_blocked: Literal["report", "strip"] = "report",
) -> PayloadUrlCheckResult:
    """Checks the URLs in a payload against a URL security policy before sending.

    The renderer applies its own policy whatever the agent does, so the check
    is an optional, earlier line: it lets an agent log, drop, or retry a
    response from a model that was prompted into putting data into a URL,
    before the payload leaves the agent.

    Which properties hold URLs comes from the catalogs: a property marked with
    `x-a2ui-url-context` (written by `url_property`), the built-in list for the
    basic catalogs' `Image`, `Video`, and `AudioPlayer`, and the policy's
    `url_properties` map, which wins over the catalog. The basic catalogs'
    `theme.iconUrl` is checked as `media`.

    Each value is checked as the renderer resolves it:

    1. A literal string is checked as is.
    2. A data binding with an absolute path is checked against the value the
       payload's `createSurface.dataModel` and `updateDataModel` messages leave
       at that path, if any.
    3. A relative binding (inside a list template), a binding to a value the
       payload doesn't set, and a function call such as `formatString` can't
       be resolved without the renderer's state, so they are not checked here;
       the renderer checks them.

    Each component is checked against its surface's catalog, from the
    payload's `createSurface`, or, for a surface the payload only updates, the
    first catalog that defines the component's type. When `catalogs` doesn't
    hold the catalog `createSurface` names, no other catalog's schema is used:
    only the properties that the built-in list or the policy's
    `url_properties` name for that catalog ID are checked.

    Args:
        catalogs: The active catalogs.
        payload: One message, or an iterable of messages, as parsed JSON
            objects. Messages that are not v0.9 or v1.0 surface messages are
            passed through unchecked.
        policy: The policy to check URLs against: the policy the renderer is
            configured with, or a stricter one. Defaults to
            `PermissiveUrlSecurityPolicy`, which applies only the built-in
            baseline checks.
        on_blocked: What to do with a blocked URL. `"report"` lists it and
            leaves the messages as they are. `"strip"` also replaces the value
            holding it (the URL, or the binding to it) with an empty string in
            a copy of the messages. The renderer's baseline blocks an empty
            URL, so the property resolves to unset, as it would after the
            renderer blocked the URL itself, and the message still matches the
            catalog's schema.

    Returns:
        The messages to send and the blocked URLs.

    Raises:
        ValueError: If `on_blocked` is not `"report"` or `"strip"`.
    """
    if on_blocked not in ("report", "strip"):
        raise ValueError(f"on_blocked must be 'report' or 'strip', not {on_blocked!r}.")
    active_policy: UrlSecurityPolicy = policy or PermissiveUrlSecurityPolicy()
    messages = _to_message_list(payload)
    surfaces: dict[str, _PayloadSurface] = {}
    components: list[_PayloadComponent] = []
    themes: list[tuple[int, str, dict[str, Any]]] = []

    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            continue
        create = message.get("createSurface")
        if isinstance(create, dict) and isinstance(create.get("surfaceId"), str):
            surface_id = create["surfaceId"]
            surface = _PayloadSurface()
            if isinstance(create.get("catalogId"), str):
                surface.catalog_id = create["catalogId"]
            surface.data_model = create.get("dataModel")
            surfaces[surface_id] = surface
            if isinstance(create.get("theme"), dict):
                themes.append((index, surface_id, create["theme"]))
            _collect_components(
                create.get("components"),
                index,
                surface_id,
                ("createSurface", "components"),
                components,
            )
        update = message.get("updateComponents")
        if isinstance(update, dict) and isinstance(update.get("surfaceId"), str):
            _collect_components(
                update.get("components"),
                index,
                update["surfaceId"],
                ("updateComponents", "components"),
                components,
            )
        data = message.get("updateDataModel")
        if isinstance(data, dict) and isinstance(data.get("surfaceId"), str):
            surface = surfaces.setdefault(data["surfaceId"], _PayloadSurface())
            path = data.get("path")
            surface.data_model = _apply_data_update(
                surface.data_model,
                path if isinstance(path, str) else "/",
                data.get("value"),
                "value" in data,
            )

    blocked: list[BlockedPayloadUrl] = []
    strip: list[tuple[int, _Path]] = []

    def check(
        url: Any, context: UrlContext, found: BlockedPayloadUrl, path: _Path
    ) -> None:
        if not isinstance(url, str):
            return
        info = UrlCheckInfo(
            surface_id=found.surface_id,
            catalog_id=found.catalog_id,
            component_type=found.component_type,
            component_id=found.component_id,
            property_name=found.property_name,
        )
        if apply_url_security_policy(active_policy, url, context, info) is not None:
            return
        blocked.append(
            BlockedPayloadUrl(
                message_index=found.message_index,
                surface_id=found.surface_id,
                property_name=found.property_name,
                context=context,
                redacted_url=redact_url(url),
                catalog_id=found.catalog_id,
                component_id=found.component_id,
                component_type=found.component_type,
                data_path=found.data_path,
            )
        )
        strip.append((found.message_index, path))

    for index, surface_id, theme in themes:
        catalog_id = surfaces[surface_id].catalog_id
        if catalog_id is None or catalog_id not in BASIC_CATALOG_URL_PROPERTIES:
            continue
        check(
            theme.get("iconUrl"),
            "media",
            _found(index, surface_id, "theme.iconUrl", catalog_id=catalog_id),
            ("createSurface", "theme", "iconUrl"),
        )

    for entry in components:
        component_type = entry.component.get("component")
        if not isinstance(component_type, str):
            continue
        surface = surfaces.get(entry.surface_id) or _PayloadSurface()
        catalog = _find_catalog(catalogs, surface.catalog_id, component_type)
        schema: Any
        defs: Mapping[str, Any]
        if catalog is not None:
            component_catalog_id = catalog.id
            schema = catalog.resolved_component_schema(component_type)
            defs = _validation_defs(catalog)
        elif surface.catalog_id is not None and all(
            c.id != surface.catalog_id for c in catalogs
        ):
            # The surface's catalog isn't one the agent holds. Its schema is
            # unknown, so only the properties the built-in list or the
            # policy's `url_properties` name for that catalog are checked.
            component_catalog_id, schema, defs = surface.catalog_id, None, {}
        else:
            continue
        component_id = entry.component.get("id")
        overrides = _url_property_overrides(
            component_catalog_id,
            component_type,
            getattr(active_policy, "url_properties", None),
        )

        def visit(
            value: Any,
            context: UrlContext,
            path: _Path,
            *,
            entry: _PayloadComponent = entry,
            surface: _PayloadSurface = surface,
            component_catalog_id: str = component_catalog_id,
            component_type: str = component_type,
            component_id: Any = component_id,
        ) -> None:
            data_path = _absolute_binding_path(value)
            found = _found(
                entry.message_index,
                entry.surface_id,
                _property_name_of(path),
                catalog_id=component_catalog_id,
                component_type=component_type,
                component_id=component_id if isinstance(component_id, str) else None,
                data_path=data_path,
            )
            resolved = (
                value
                if data_path is None
                else _read_pointer(surface.data_model, data_path)
            )
            check(resolved, context, found, entry.base_path + path)

        _walk_component(
            defs,
            schema,
            entry.component,
            overrides,
            visit,
        )

    if on_blocked != "strip" or not strip:
        return PayloadUrlCheckResult(messages=messages, blocked=blocked)
    copies: dict[int, Any] = {}
    for index, path in strip:
        if index not in copies:
            copies[index] = copy.deepcopy(messages[index])
        _replace_at(copies[index], path, "")
    return PayloadUrlCheckResult(
        messages=[copies.get(i, m) for i, m in enumerate(messages)],
        blocked=blocked,
    )


def _found(
    message_index: int,
    surface_id: str,
    property_name: str,
    *,
    catalog_id: str | None = None,
    component_type: str | None = None,
    component_id: str | None = None,
    data_path: str | None = None,
) -> BlockedPayloadUrl:
    """Describes where a URL is, before the policy decides on it."""
    return BlockedPayloadUrl(
        message_index=message_index,
        surface_id=surface_id,
        property_name=property_name,
        context="media",
        redacted_url="",
        catalog_id=catalog_id,
        component_id=component_id,
        component_type=component_type,
        data_path=data_path,
    )


def _to_message_list(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, Iterable) and not isinstance(payload, (str, bytes, dict)):
        return list(payload)
    return [payload]


def _collect_components(
    components: Any,
    message_index: int,
    surface_id: str,
    base: _Path,
    into: list[_PayloadComponent],
) -> None:
    if not isinstance(components, list):
        return
    for list_index, component in enumerate(components):
        if isinstance(component, dict):
            into.append(
                _PayloadComponent(
                    message_index, surface_id, component, base + (list_index,)
                )
            )


def _find_catalog(
    catalogs: Sequence[CatalogApi], catalog_id: str | None, component_type: str
) -> CatalogApi | None:
    """Returns the catalog whose schema describes a component.

    A surface that names its catalog uses that catalog only; another catalog
    that happens to define the same type may mark different properties as
    URLs. Without a catalog ID (the surface was created by an earlier
    payload), the first catalog defining the type is used.
    """
    if catalog_id is not None:
        for catalog in catalogs:
            if catalog.id == catalog_id:
                return catalog if catalog.get_component(component_type) else None
        return None
    for catalog in catalogs:
        if catalog.get_component(component_type) is not None:
            return catalog
    return None


def _lookup(
    url_properties: Any, catalog_id: str, component_type: str
) -> Mapping[str, UrlContextAnnotation]:
    if not isinstance(url_properties, Mapping):
        return {}
    by_component = url_properties.get(catalog_id)
    if not isinstance(by_component, Mapping):
        return {}
    properties = by_component.get(component_type)
    return properties if isinstance(properties, Mapping) else {}


def _url_property_overrides(
    catalog_id: str, component_type: str, host: UrlPropertyMap | None
) -> tuple[Mapping[str, UrlContextAnnotation], Mapping[str, UrlContextAnnotation]]:
    """Returns the built-in and host URL properties of a component.

    Like the renderer, these mark top-level properties only. The built-in
    list applies where the schema has no mark; the host's map wins.
    """
    return (
        _lookup(BASIC_CATALOG_URL_PROPERTIES, catalog_id, component_type),
        _lookup(host, catalog_id, component_type),
    )


def _walk_component(
    defs: Mapping[str, Any],
    schema: Any,
    component: dict[str, Any],
    overrides: tuple[
        Mapping[str, UrlContextAnnotation], Mapping[str, UrlContextAnnotation]
    ],
    visit: Callable[[Any, UrlContext, _Path], None],
) -> None:
    """Calls `visit` with each value of the component that holds a URL."""
    built_in, host = overrides
    visited: set[_Path] = set()

    def visit_once(value: Any, context: UrlContext, path: _Path) -> None:
        # A property can appear in more than one `allOf` or `oneOf` branch.
        if path not in visited:
            visited.add(path)
            visit(value, context, path)

    top_level: dict[str, UrlContextAnnotation] = {}
    for name, context in built_in.items():
        if _declared_context(schema, name, defs) is None:
            top_level[name] = context
    top_level.update(host)
    for name, context in top_level.items():
        if name in component and context != "none":
            visit_once(component[name], context, (name,))
    _walk(schema, component, (), defs, set(top_level), visit_once, frozenset())


def _validation_defs(catalog: CatalogApi) -> Mapping[str, Any]:
    defs = catalog.validation_schema.get("$defs")
    return defs if isinstance(defs, Mapping) else {}


def _resolve(schema: Any, defs: Mapping[str, Any], seen: frozenset[str]) -> Any:
    ref = schema.get("$ref") if isinstance(schema, dict) else None
    if isinstance(ref, str) and ref.startswith("#/$defs/") and ref not in seen:
        return defs.get(ref[len("#/$defs/") :])
    return None


def _declared_context(
    schema: Any, name: str, defs: Mapping[str, Any]
) -> UrlContextAnnotation | None:
    """Returns the mark the schema puts on a top-level property, if any."""
    found: list[UrlContextAnnotation] = []

    def search(node: Any, seen: frozenset[str]) -> None:
        if not isinstance(node, dict) or found:
            return
        properties = node.get("properties")
        if isinstance(properties, dict) and name in properties:
            context = url_context_of(properties[name])
            if context is not None:
                found.append(context)
                return
        target = _resolve(node, defs, seen)
        if target is not None:
            search(target, seen | {node["$ref"]})
        for keyword in ("allOf", "anyOf", "oneOf"):
            branches = node.get(keyword)
            if isinstance(branches, list):
                for branch in branches:
                    search(branch, seen)

    search(schema, frozenset())
    return found[0] if found else None


def _walk(
    schema: Any,
    value: Any,
    path: _Path,
    defs: Mapping[str, Any],
    skip_top_level: set[str],
    visit: Callable[[Any, UrlContext, _Path], None],
    seen: frozenset[str],
) -> None:
    if not isinstance(schema, dict):
        return
    context = url_context_of(schema)
    if context is not None:
        if context != "none":
            visit(value, context, path)
        return
    target = _resolve(schema, defs, seen)
    if target is not None:
        _walk(target, value, path, defs, skip_top_level, visit, seen | {schema["$ref"]})
    for keyword in ("allOf", "anyOf", "oneOf"):
        branches = schema.get(keyword)
        if isinstance(branches, list):
            for branch in branches:
                _walk(branch, value, path, defs, skip_top_level, visit, seen)
    properties = schema.get("properties")
    if isinstance(properties, dict) and isinstance(value, dict):
        for name, prop in properties.items():
            if name not in value or (not path and name in skip_top_level):
                continue
            _walk(prop, value[name], path + (name,), defs, skip_top_level, visit, seen)
    items = schema.get("items")
    if isinstance(items, dict) and isinstance(value, list):
        for i, item in enumerate(value):
            _walk(items, item, path + (i,), defs, skip_top_level, visit, seen)


def _property_name_of(path: _Path) -> str:
    """Writes a path as `UrlCheckInfo.property_name` does: `items[].imageUrl`."""
    name = ""
    for segment in path:
        if isinstance(segment, int):
            name += "[]"
        else:
            name += f".{segment}" if name else segment
    return name


def _absolute_binding_path(value: Any) -> str | None:
    """Returns the absolute path of a data binding, or None.

    A binding is `{"@path": ...}` in v1.0 and `{"path": ...}` in v0.9. A
    relative path, inside a list template, returns None.
    """
    if not isinstance(value, dict) or len(value) != 1:
        return None
    path = value.get("@path", value.get("path"))
    return path if isinstance(path, str) and path.startswith("/") else None


def _pointer_segments(pointer: str) -> list[str]:
    if pointer in ("", "/"):
        return []
    return [
        s.replace("~1", "/").replace("~0", "~")
        for s in pointer.removeprefix("/").split("/")
    ]


def _is_index(segment: str) -> bool:
    return segment.isascii() and segment.isdigit()


def _read_pointer(root: Any, pointer: str) -> Any:
    current = root
    for segment in _pointer_segments(pointer):
        if isinstance(current, list) and _is_index(segment):
            index = int(segment)
            current = current[index] if index < len(current) else None
        elif isinstance(current, dict) and segment in current:
            current = current[segment]
        else:
            return None
    return current


def _set_child(container: Any, segment: str, value: Any) -> None:
    if isinstance(container, list):
        index = int(segment)
        container.extend([None] * (index + 1 - len(container)))
        container[index] = value
    else:
        container[segment] = value


def _get_child(container: Any, segment: str) -> Any:
    if isinstance(container, list):
        index = int(segment)
        return container[index] if index < len(container) else None
    return container.get(segment)


def _apply_data_update(root: Any, pointer: str, value: Any, has_value: bool) -> Any:
    """Applies an `updateDataModel` to a copy of the data model.

    A missing container on the path is created as a list when the next
    segment indexes into it, and as an object otherwise. An update with a
    list index above `_MAX_ARRAY_INDEX` is ignored, as the renderer rejects
    it, which also keeps a payload from growing a list to any size it names.
    """
    segments = _pointer_segments(pointer)
    if not segments:
        return value if has_value else None
    if any(_is_index(s) and int(s) > _MAX_ARRAY_INDEX for s in segments):
        return root
    result = copy.deepcopy(root) if isinstance(root, (dict, list)) else {}
    current = result
    for i, segment in enumerate(segments[:-1]):
        if isinstance(current, list) and not _is_index(segment):
            return result
        child = _get_child(current, segment)
        if not isinstance(child, (dict, list)):
            child = [] if _is_index(segments[i + 1]) else {}
            _set_child(current, segment, child)
        current = child
    last = segments[-1]
    if isinstance(current, list) and not _is_index(last):
        return result
    if has_value:
        _set_child(current, last, value)
    elif isinstance(current, list):
        if int(last) < len(current):
            current[int(last)] = None
    else:
        current.pop(last, None)
    return result


def _replace_at(root: Any, path: _Path, value: Any) -> None:
    current = root
    for segment in path[:-1]:
        try:
            current = current[segment]
        except (KeyError, IndexError, TypeError):
            return
    try:
        current[path[-1]] = value
    except (IndexError, TypeError):
        return
