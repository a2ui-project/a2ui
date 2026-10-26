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

"""Decompilation engine for the A2UI Atom format.

The output is Atom text that `AtomCompiler` compiles back to the same
messages:

- `createSurface` -> `(surface "id" [:catalogId "c"])` followed by
  `(data ...)` and the component trees.
- `updateComponents` -> `(updateComponents "id" [:catalogId "c"])` followed
  by the updated component trees, each with an explicit `:id`.
- `updateDataModel` -> `(updateDataModel "id" [:path "/p"] [:value v])`.
- `deleteSurface` -> `(deleteSurface "id")`.
- `callRendererFunction` ->
  `(callFunction "name" :functionCallId "id" [:catalogId "c"] :arg v ...)`.

Strings are written as JSON strings, lists as `[...]` and objects as
`(:key value ...)`.

A component or function call uses the catalog its `catalogId` names, else its
surface's catalog (the `catalogId` of the surface's `createSurface`). With a
single catalog, a header names a surface catalog other than that catalog, and
a component or call carries `:catalogId` when its catalog is not its
surface's. With several catalogs, the compiler looks up names without
`:catalogId` across all catalogs, so a header never names a catalog, and a
component or call carries `:catalogId` only when that lookup does not find its
catalog: when several catalogs define its name.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
import json
import re
from typing import Any, Literal

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    CoalescedMessage,
    build_catalog_helpers,
    catalogs_defining,
    check_mixed_catalogs,
    coalesce_surface_messages,
)

from .compiler import child_props, positional_child_target, ref_kind

_SIMPLE_KEY = re.compile(r"[A-Za-z_][\w-]*")
_SIMPLE_ABS_PATH = re.compile(r"(/[\w-]+)+")
_ITEM_PATH = re.compile(r"item(/[\w-]+)+")
# Event context keys that the compiler treats specially when written as
# `:key value`; a context with any of them is written as `:context (...)`.
_EVENT_RESERVED_KEYS = frozenset({"userMessage", "context", "name", "action", "event"})
_SURFACE_OPTION_KEYS = ("sendDataModel", "theme", "metadata")


def _q(value: Any) -> str:
    return json.dumps(str(value), ensure_ascii=False)


class AtomDecompiler:
    """Decompiles A2UI messages into Atom S-expressions.

    Attributes:
        catalogs: The active catalogs.
    """

    def __init__(self, catalogs: Sequence[CatalogApi]):
        """Initializes an AtomDecompiler instance.

        Args:
            catalogs: The catalogs.

        Raises:
            A2uiCatalogError: If no catalog is given, two catalogs share an
                ID, the catalogs target different protocol versions, or there
                are several catalogs and they target a version before v1.0.
        """
        self._catalogs = check_mixed_catalogs(catalogs)
        self._helpers = build_catalog_helpers(self._catalogs)
        # The single catalog, or None when there are several.
        self._sole_catalog_id: str | None = (
            self._catalogs[0].catalog_id if len(self._catalogs) == 1 else None
        )

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs, in the order the decompiler received them."""
        return list(self._catalogs)

    def _surface_catalog(self, catalog_id: Any) -> str | None:
        """Returns the catalog of a surface, given its `createSurface` catalog.

        With a single catalog, a surface whose catalog is not known uses that
        catalog. With several, it has no catalog.
        """
        if isinstance(catalog_id, str) and catalog_id:
            return catalog_id
        return self._sole_catalog_id

    def _needs_catalog(
        self,
        kind: Literal["component", "function"],
        name: str,
        catalog_id: str | None,
        surface_cat: str | None,
    ) -> bool:
        """Whether a component or call must carry `:catalogId` to compile back.

        Args:
            kind: Whether `name` is a component or a function.
            name: The component or function name.
            catalog_id: The catalog the component or call uses, or None when
                it is not known.
            surface_cat: The catalog of the surface, or None.
        """
        if catalog_id is None:
            return False
        if self._sole_catalog_id is not None:
            return catalog_id != surface_cat
        return catalogs_defining(self._helpers, kind, name) != [catalog_id]

    def _header_catalog(self, surface_cat: str | None) -> str:
        """Returns the ` :catalogId "c"` part of a header, or ""."""
        if (
            self._sole_catalog_id is None
            or surface_cat is None
            or surface_cat == self._sole_catalog_id
        ):
            return ""
        return f" :catalogId {_q(surface_cat)}"

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles A2UI messages into Atom S-expression text.

        Args:
            a2ui_payload: The messages to decompile.

        Returns:
            The Atom text, one block per coalesced message.
        """
        blocks = [
            self._decompile_item(item)
            for item in coalesce_surface_messages(a2ui_payload)
        ]
        return "\n\n".join(b for b in blocks if b)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Wraps decompiled Atom blocks within `<a2ui>` sentinel tags.

        Args:
            blocks: Decompiled Atom blocks.

        Returns:
            The blocks enclosed in sentinel tags.
        """
        return "<a2ui>\n" + "\n\n".join(blocks) + "\n</a2ui>"

    # ------------------------------------------------------------------
    # Messages
    # ------------------------------------------------------------------

    def _decompile_item(self, item: CoalescedMessage) -> str:
        msg = item.message
        if "deleteSurface" in msg:
            return f"(deleteSurface {_q(msg['deleteSurface'].get('surfaceId', ''))})"
        if "callRendererFunction" in msg or "callFunction" in msg:
            return self._decompile_call(msg)
        if "updateDataModel" in msg:
            return self._decompile_update_data(msg["updateDataModel"])
        if "updateComponents" in msg:
            body = msg["updateComponents"]
            surface_cat = self._surface_catalog(item.surface_catalog_id)
            header = f"(updateComponents {_q(body.get('surfaceId', ''))}"
            header += self._header_catalog(surface_cat)
            lines = [header + ")"]
            lines.extend(
                self._decompile_components(
                    body.get("components", []), surface_cat, is_update=True
                )
            )
            return "\n".join(lines)
        if "createSurface" in msg:
            return self._decompile_create(msg["createSurface"])
        return ""

    def _decompile_call(self, msg: Mapping[str, Any]) -> str:
        crf = msg.get("callRendererFunction")
        if isinstance(crf, Mapping):
            call = crf.get("callFunction", {})
            call_id = crf.get("functionCallId")
        else:
            call = msg.get("callFunction", {})
            call_id = msg.get("functionCallId")
        name = call.get("@call", call.get("call", ""))
        parts = [f"(callFunction {_q(name)}"]
        if call_id is not None:
            parts.append(f":functionCallId {_q(call_id)}")
        # A standalone call has no surface. With a single catalog it uses that
        # catalog unless it names another.
        cat = self._surface_catalog(call.get("catalogId"))
        if self._needs_catalog("function", str(name), cat, self._sole_catalog_id):
            parts.append(f":catalogId {_q(cat)}")
        for k, v in (call.get("args") or {}).items():
            parts.append(f":{k} {self._format_val(v, cat)}")
        return " ".join(parts) + ")"

    def _decompile_update_data(self, body: Mapping[str, Any]) -> str:
        parts = [f"(updateDataModel {_q(body.get('surfaceId', ''))}"]
        if "path" in body:
            parts.append(f":path {_q(body['path'])}")
        if "value" in body:
            parts.append(f":value {self._format_literal(body['value'])}")
        return " ".join(parts) + ")"

    def _decompile_create(self, body: Mapping[str, Any]) -> str:
        surface_id = body.get("surfaceId", "")
        surface_cat = self._surface_catalog(body.get("catalogId"))
        header = f"(surface {_q(surface_id)}" + self._header_catalog(surface_cat)
        for key in _SURFACE_OPTION_KEYS:
            if key in body:
                header += f" :{key} {self._format_literal(body[key])}"
        lines = [header + ")"]
        data_model = body.get("dataModel")
        if isinstance(data_model, Mapping) and data_model:
            lines.append(self._format_data(data_model))
        lines.extend(
            self._decompile_components(
                body.get("components") or [], surface_cat, is_update=False
            )
        )
        return "\n".join(lines)

    def _format_data(self, data_model: Mapping[str, Any]) -> str:
        if all(_SIMPLE_KEY.fullmatch(str(k)) for k in data_model):
            pairs = " ".join(
                f"$/{k} {self._format_literal(v)}" for k, v in data_model.items()
            )
            return f"(data {pairs})"
        return f"(data $/ {self._format_literal(dict(data_model))})"

    # ------------------------------------------------------------------
    # Components
    # ------------------------------------------------------------------

    def _component_helper(
        self, comp: Mapping[str, Any], surface_cat: str | None
    ) -> CatalogSchemaHelper | None:
        """Returns the helper of a component's catalog, or None if not known.

        The catalog is the component's `catalogId`, else its surface's, else
        (with several catalogs) the only catalog that defines its name.
        """
        cat = comp.get("catalogId") or surface_cat
        if isinstance(cat, str):
            return self._helpers.get(cat)
        found = catalogs_defining(
            self._helpers, "component", str(comp.get("component", ""))
        )
        return self._helpers[found[0]] if len(found) == 1 else None

    def _child_kind(
        self, comp: Mapping[str, Any], key: str, surface_cat: str | None
    ) -> str | None:
        """Returns 'list', 'single' or None for a component property."""
        helper = self._component_helper(comp, surface_cat)
        comp_type = comp.get("component", "")
        if helper is not None and comp_type in helper.components:
            kind = helper.get_property_type(comp_type, key)
            if kind == "ChildList":
                return "list"
            if kind == "Child":
                return "single"
        if key == "children":
            return "list"
        if key == "child":
            return "single"
        return None

    def _referenced_ids(
        self, components: Sequence[Mapping[str, Any]], surface_cat: str | None
    ) -> set[str]:
        ids = {c.get("id") for c in components}
        refs: set[str] = set()
        for c in components:
            for k, v in c.items():
                if k in ("id", "component", "catalogId"):
                    continue
                kind = self._child_kind(c, k, surface_cat)
                if isinstance(v, Mapping) and isinstance(v.get("componentId"), str):
                    refs.add(v["componentId"])
                elif kind == "single" and isinstance(v, str) and v in ids:
                    refs.add(v)
                elif kind == "list" and isinstance(v, list):
                    refs.update(x for x in v if isinstance(x, str) and x in ids)
                elif isinstance(v, list):
                    child_keys = self._object_child_keys(c, k, surface_cat)
                    for entry in v:
                        if isinstance(entry, Mapping):
                            refs.update(
                                x
                                for ek, x in entry.items()
                                if ek in child_keys and isinstance(x, str) and x in ids
                            )
        return refs

    def _object_child_keys(
        self, comp: Mapping[str, Any], key: str, surface_cat: str | None
    ) -> set[str]:
        """Returns the child properties of an array-of-objects property's items."""
        helper = self._component_helper(comp, surface_cat)
        comp_type = comp.get("component", "")
        if helper is None or comp_type not in helper.components:
            return set()
        schema = helper.get_property_schema(comp_type, key) or {}
        items = schema.get("items") if schema.get("type") == "array" else None
        if not isinstance(items, Mapping) or not isinstance(
            items.get("properties"), Mapping
        ):
            return set()
        return {k for k, s in items["properties"].items() if ref_kind(s) == "Child"}

    def _decompile_components(
        self,
        components: Sequence[Mapping[str, Any]],
        surface_cat: str | None,
        is_update: bool,
    ) -> list[str]:
        comp_map = {c["id"]: c for c in components if isinstance(c.get("id"), str)}
        refs = self._referenced_ids(components, surface_cat)
        roots = [cid for cid in comp_map if cid not in refs]
        visited: set[str] = set()
        out: list[str] = []
        for idx, cid in enumerate(roots):
            emit_id = is_update or not (idx == 0 and cid == "root")
            out.append(self._component(cid, comp_map, 0, surface_cat, visited, emit_id))
        for cid in comp_map:
            if cid not in visited:
                out.append(
                    self._component(cid, comp_map, 0, surface_cat, visited, True)
                )
        return out

    def _component(
        self,
        comp_id: str,
        comp_map: Mapping[str, Mapping[str, Any]],
        indent: int,
        surface_cat: str | None,
        visited: set[str],
        emit_id: bool,
    ) -> str:
        visited.add(comp_id)
        comp = comp_map[comp_id]
        comp_type = str(comp.get("component", ""))
        pad = "  " * indent
        parts = [comp_type]
        if emit_id:
            parts.append(f":id {_q(comp_id)}")
        comp_cat = comp.get("catalogId") or surface_cat
        if self._needs_catalog("component", comp_type, comp_cat, surface_cat):
            parts.append(f":catalogId {_q(comp_cat)}")

        helper = self._component_helper(comp, surface_cat)
        if helper is not None and comp_type in helper.components:
            prop_keys, child_list_prop, single_child_prop = child_props(
                helper, comp_type
            )
        else:
            prop_keys, child_list_prop, single_child_prop = [], None, None

        def nestable(cid: Any) -> bool:
            return isinstance(cid, str) and cid in comp_map and cid not in visited

        def sub(cid: str) -> str:
            return self._component(
                cid, comp_map, indent + 1, surface_cat, visited, True
            )

        child_nodes: list[str] = []
        for k, v in comp.items():
            if k in ("id", "component", "catalogId"):
                continue
            kind = self._child_kind(comp, k, surface_cat)
            if (
                isinstance(v, Mapping)
                and set(v) == {"componentId", "path"}
                and nestable(v["componentId"])
            ):
                node = sub(v["componentId"])
                parts.append(
                    f":{k} (template :items {self._format_path(v['path'])}\n{node})"
                )
            elif kind == "single" and nestable(v):
                node = sub(v)
                target = positional_child_target(
                    1, prop_keys, child_list_prop, single_child_prop
                )
                if target == k:
                    child_nodes.append(node)
                else:
                    parts.append(f":{k} {node.strip()}")
            elif kind == "list" and isinstance(v, list) and v and any(map(nestable, v)):
                target = positional_child_target(
                    len(v), prop_keys, child_list_prop, single_child_prop
                )
                if target == k and all(map(nestable, v)):
                    child_nodes.extend(sub(cid) for cid in v)
                else:
                    items = [
                        sub(cid).strip() if nestable(cid) else _q(cid) for cid in v
                    ]
                    parts.append(f":{k} [{' '.join(items)}]")
            elif kind == "list" and isinstance(v, list):
                parts.append(f":{k} [{' '.join(_q(cid) for cid in v)}]")
            elif isinstance(v, list) and (
                child_keys := self._object_child_keys(comp, k, surface_cat)
            ):
                entries = " ".join(
                    self._object_entry(e, child_keys, sub, nestable, surface_cat)
                    for e in v
                )
                parts.append(f":{k} [{entries}]")
            else:
                parts.append(f":{k} {self._format_val(v, surface_cat)}")

        head = f"{pad}({' '.join(parts)}"
        if not child_nodes:
            return head + ")"
        return head + "\n" + "\n".join(child_nodes) + ")"

    def _object_entry(
        self,
        entry: Any,
        child_keys: set[str],
        sub: Callable[[str], str],
        nestable: Callable[[Any], bool],
        surface_cat: str | None,
    ) -> str:
        if not isinstance(entry, Mapping):
            return self._format_val(entry, surface_cat)
        parts = ["(item"]
        for k, v in entry.items():
            if k in child_keys and nestable(v):
                parts.append(f":{k} {sub(v).strip()}")
            else:
                parts.append(f":{k} {self._format_val(v, surface_cat)}")
        return " ".join(parts) + ")"

    # ------------------------------------------------------------------
    # Values
    # ------------------------------------------------------------------

    def _format_path(self, path: Any) -> str:
        p = str(path)
        if _SIMPLE_ABS_PATH.fullmatch(p) and not p.startswith("/item/"):
            return "$" + p
        if _ITEM_PATH.fullmatch(p):
            return "$/" + p
        return f"(@path {_q(p)})"

    def _format_key(self, key: Any) -> str:
        k = str(key)
        return f":{k}" if _SIMPLE_KEY.fullmatch(k) else _q(k)

    def _format_literal(self, val: Any) -> str:
        """Formats a data model value, without reading bindings or calls."""
        if isinstance(val, bool):
            return "true" if val else "false"
        if val is None:
            return "null"
        if isinstance(val, (int, float)):
            return json.dumps(val)
        if isinstance(val, str):
            return _q(val)
        if isinstance(val, Mapping):
            inner = " ".join(
                f"{self._format_key(k)} {self._format_literal(v)}"
                for k, v in val.items()
            )
            return f"({inner})"
        if isinstance(val, (list, tuple)):
            return "[" + " ".join(self._format_literal(v) for v in val) + "]"
        return _q(val)

    def _format_object(self, val: Mapping[str, Any], surface_cat: str | None) -> str:
        inner = " ".join(
            f"{self._format_key(k)} {self._format_val(v, surface_cat)}"
            for k, v in val.items()
        )
        return f"({inner})"

    def _format_function_call(
        self,
        call: Mapping[str, Any],
        surface_cat: str | None,
        message: Any = None,
    ) -> str:
        name = call.get("@call", call.get("call", ""))
        parts = [str(name)]
        cat = call.get("catalogId") or surface_cat
        if self._needs_catalog("function", str(name), cat, surface_cat):
            parts.append(f":catalogId {_q(cat)}")
        args = call.get("args") or {}
        if isinstance(args, Mapping):
            for k, v in args.items():
                parts.append(f":{k} {self._format_val(v, surface_cat)}")
        if message is not None:
            parts.append(f":message {_q(message)}")
        return f"({' '.join(parts)})"

    def _format_event(self, event: Mapping[str, Any], surface_cat: str | None) -> str:
        parts = [f"(Event {_q(event.get('name', ''))}"]
        if "userMessage" in event:
            parts.append(
                f":userMessage {self._format_val(event['userMessage'], surface_cat)}"
            )
        context = event.get("context") or {}
        if context:
            if any(
                k in _EVENT_RESERVED_KEYS or not _SIMPLE_KEY.fullmatch(str(k))
                for k in context
            ):
                parts.append(f":context {self._format_object(context, surface_cat)}")
            else:
                parts.extend(
                    f":{k} {self._format_val(v, surface_cat)}"
                    for k, v in context.items()
                )
        return " ".join(parts) + ")"

    def _is_call(self, val: Any) -> bool:
        return isinstance(val, Mapping) and isinstance(
            val.get("@call", val.get("call")), str
        )

    def _format_val(self, val: Any, surface_cat: str | None) -> str:
        """Formats a component property value.

        Args:
            val: The value.
            surface_cat: The surface catalog, or None when the surface has
                none. A function call without a `catalogId` uses it.
        """
        if isinstance(val, Mapping):
            if len(val) == 1 and isinstance(val.get("@path", val.get("path")), str):
                return self._format_path(val.get("@path", val.get("path")))
            if set(val) == {"event"} and isinstance(val["event"], Mapping):
                return self._format_event(val["event"], surface_cat)
            if set(val) == {"functionCall"} and self._is_call(val["functionCall"]):
                return self._format_function_call(val["functionCall"], surface_cat)
            if self._is_call(val) and set(val) <= {
                "@call",
                "call",
                "args",
                "catalogId",
            }:
                return self._format_function_call(val, surface_cat)
            if (
                "condition" in val
                and set(val) <= {"condition", "message"}
                and self._is_call(val["condition"])
                and "message" not in (val["condition"].get("args") or {})
            ):
                return self._format_function_call(
                    val["condition"], surface_cat, message=val.get("message")
                )
            return self._format_object(val, surface_cat)
        if isinstance(val, (list, tuple)):
            return "[" + " ".join(self._format_val(v, surface_cat) for v in val) + "]"
        return self._format_literal(val)
