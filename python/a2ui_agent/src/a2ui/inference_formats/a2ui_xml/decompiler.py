# Copyright 2026 Google LLC
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

"""Catalog-agnostic decompiler from A2UI wire messages to idiomatic A2UI XML."""

from __future__ import annotations

from collections.abc import Sequence
import json
import math
from typing import Any, Literal

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import (
    A2uiErrorDetail,
    A2uiValidationError,
    CatalogApi,
    is_valid_uax31_identifier,
)
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    CoalescedMessage,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    check_mixed_catalogs,
    coalesce_surface_messages,
    surface_catalog_id,
)

from .compiler import _get_effective_prop_kind, _schema_ref_kind
from .errors import A2uiXmlValidationError
from .expressions import (
    CallExpr,
    PathExpr,
    format_data_path,
    format_expr_arg,
    format_xml_attr,
    parse_data_path,
)


def _has_reserved_key(val: dict[str, Any], key: str) -> bool:
    return f"@{key}" in val or key in val


def _reserved_value(val: dict[str, Any], key: str) -> Any:
    return val.get(f"@{key}", val.get(key))


def _is_renderer_call(msg: dict[str, Any]) -> bool:
    return "callRendererFunction" in msg or "callFunction" in msg


def _indent_block(text: str, spaces: int) -> str:
    pad = " " * spaces
    return "\n".join(f"{pad}{line}" if line else "" for line in text.splitlines())


def _format_fenced_json(value: Any, *, info: str = "", indent: int = 0) -> list[str]:
    pad = " " * indent
    header = f"{pad}```json {info}".rstrip()
    dumped = json.dumps(value, indent=2, ensure_ascii=False)
    body = [f"{pad}{line}" for line in dumped.splitlines()]
    return [header, *body, f"{pad}```"]


class A2uiXmlDecompiler:
    """Converts A2UI wire messages (v0.9, v0.9.1, v1.0) into strict-valid A2UI XML."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        *,
        default_surface_id: str = "main",
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self._default_surface_id = default_surface_id
        self.helpers: dict[str, CatalogSchemaHelper] = build_catalog_helpers(
            self._catalogs
        )
        self._sole_catalog_id = surface_catalog_id(self._catalogs)
        self._v1 = is_at_least_version(
            catalogs_protocol_version(self._catalogs), ProtocolVersion.V1_0
        )
        self._path_key = "@path" if self._v1 else "path"
        self._call_key = "@call" if self._v1 else "call"

    @property
    def catalogs(self) -> list[CatalogApi]:
        """Returns a copy of the active catalogs."""
        return list(self._catalogs)

    def wrap_decompiled_blocks(self, blocks: Sequence[str]) -> str:
        """Wraps decompiled A2UI XML blocks inside ``<a2ui>...</a2ui>`` sentinel tags."""
        joined = "\n".join(b for b in blocks if b)
        return f"{A2UI_INFERENCE_OPEN_TAG}\n{joined}\n{A2UI_INFERENCE_CLOSE_TAG}"

    def decompile_blocks(
        self,
        a2ui_payload: Sequence[AgentToRendererMessage],
        *,
        preserve_ids: bool = True,
    ) -> list[str]:
        """Decompiles an A2UI payload into individual A2UI XML surface/command blocks."""
        coalesced = list(coalesce_surface_messages(a2ui_payload))
        blocks: list[str] = []
        call_count = 0
        total_units = len(coalesced)

        for idx, item in enumerate(coalesced):
            if not item.message:
                continue
            if _is_renderer_call(item.message):
                call_count += 1
                blocks.append(self._decompile_renderer_call(item.message, call_count))
            else:
                block = self._decompile_coalesced_item(
                    item,
                    is_sole_unit=(total_units == 1 and idx == 0),
                    preserve_ids=preserve_ids,
                )
                if block:
                    blocks.append(block)
        return blocks

    def decompile(
        self,
        a2ui_payload: Sequence[AgentToRendererMessage],
        *,
        preserve_ids: bool = True,
    ) -> str:
        """Decompiles an A2UI payload into a single A2UI XML document string."""
        return "\n".join(self.decompile_blocks(a2ui_payload, preserve_ids=preserve_ids))

    # ---------------------------------------------------------------------------
    # Catalog & Reference Helpers
    # ---------------------------------------------------------------------------

    def _resolve(
        self,
        kind: Literal["component", "function"],
        name: str,
        explicit_cat_id: str | None,
        surface_cat_id: str | None,
    ) -> tuple[CatalogSchemaHelper, str | None]:
        actual = explicit_cat_id or surface_cat_id
        if actual is None:
            defining = catalogs_defining(self.helpers, kind, name)
            if len(defining) == 1:
                actual = defining[0]
        if actual is None:
            raise A2uiXmlValidationError(
                f"{kind.capitalize()} {name!r} names no catalogId and cannot be"
                " resolved uniquely."
            )
        helper = self.helpers.get(actual)
        if helper is None:
            raise A2uiXmlValidationError(
                f"Unknown catalog {actual!r}. Active catalogs: {list(self.helpers)}"
            )
        pool = helper.components if kind == "component" else helper.functions
        if name not in pool:
            raise A2uiXmlValidationError(
                f"Catalog {actual!r} does not define {kind} {name!r}."
            )
        if self._sole_catalog_id is not None:
            return helper, None
        found = catalogs_defining(self.helpers, kind, name)
        return helper, (None if found == [actual] else actual)

    def _surface_catalog(self, catalog_id: str | None) -> str | None:
        if self._sole_catalog_id is None:
            return catalog_id
        if catalog_id is not None and catalog_id not in self.helpers:
            raise A2uiXmlValidationError(
                f"Unknown catalog {catalog_id!r}. Active: {list(self.helpers)}"
            )
        return self._sole_catalog_id

    def _check_v1_component_ids(self, component_ids: Sequence[str]) -> None:
        if not self._v1:
            return
        details = [
            A2uiErrorDetail(
                path=f"components.{cid}.id",
                code="invalid_identifier",
                message=f"Component id '{cid}' must be a valid UAX #31 identifier",
            )
            for cid in component_ids
            if not is_valid_uax31_identifier(cid)
        ]
        if details:
            raise A2uiValidationError(details[0].message, details=details)

    def _is_function_call_dict(self, val: dict[str, Any]) -> bool:
        if self._v1:
            return isinstance(val.get("@call"), str)
        return isinstance(val.get("call"), str) and (
            "args" in val or "catalogId" in val or "returnType" in val
        )

    def _is_data_binding_dict(self, val: dict[str, Any]) -> str | None:
        if "componentId" in val:
            return None
        if (
            self._v1
            and "@path" in val
            and isinstance(val["@path"], str)
            and len(val) == 1
        ):
            return val["@path"]
        if (
            not self._v1
            and "path" in val
            and isinstance(val["path"], str)
            and len(val) == 1
        ):
            return val["path"]
        # Also accept cross-version payloads gracefully
        for k in ("@path", "path"):
            cand = val.get(k)
            if isinstance(cand, str) and len(val) == 1:
                return cand
        return None

    # ---------------------------------------------------------------------------
    # Coalesced Item Decompilation
    # ---------------------------------------------------------------------------

    def _decompile_coalesced_item(
        self,
        item: CoalescedMessage,
        *,
        is_sole_unit: bool,
        preserve_ids: bool,
    ) -> str:
        msg = item.message
        if "deleteSurface" in msg:
            sid = msg["deleteSurface"].get("surfaceId", "")
            return f"<DeleteSurface id={format_xml_attr(sid)} />"

        if item.is_update:
            return self._decompile_update_item(
                item, is_sole_unit=is_sole_unit, preserve_ids=True
            )

        create = msg.get("createSurface", {})
        sid = create.get("surfaceId") or self._default_surface_id
        surface_cat_id = self._surface_catalog(
            create.get("catalogId") or item.surface_catalog_id
        )
        send_dm = create.get("sendDataModel")
        meta = create.get("metadata") if self._v1 else None
        ext = (
            meta.get("extensions")
            if isinstance(meta, dict) and isinstance(meta.get("extensions"), dict)
            else None
        )

        needs_surface_tag = not (
            is_sole_unit
            and sid == self._default_surface_id
            and send_dm is None
            and ext is None
        )

        inner_lines: list[str] = []
        if ext is not None:
            inner_lines.extend(_format_fenced_json(ext, info="extensions"))

        data_model = create.get("dataModel")
        if isinstance(data_model, dict) and data_model:
            inner_lines.extend(_format_fenced_json(data_model, info="dataModel"))

        components = create.get("components", [])
        comp_lines = self._decompile_component_graph(
            components,
            surface_cat_id=surface_cat_id,
            is_update=False,
            preserve_ids=preserve_ids,
        )
        inner_lines.extend(comp_lines)

        if not needs_surface_tag:
            return "\n".join(inner_lines)

        surf_attrs = [f"id={format_xml_attr(sid)}"]
        if send_dm is not None:
            surf_attrs.append(f'sendDataModel={"\"true\"" if send_dm else "\"false\""}')
        body = _indent_block("\n".join(inner_lines), 2)
        return f"<Surface {' '.join(surf_attrs)}>\n{body}\n</Surface>"

    def _decompile_update_item(
        self,
        item: CoalescedMessage,
        *,
        is_sole_unit: bool,
        preserve_ids: bool,
    ) -> str:
        op = item.operation
        if op is None:
            return ""
        body = item.message[op]
        sid = body.get("surfaceId") or self._default_surface_id
        surface_cat_id = self._surface_catalog(item.surface_catalog_id)

        inner_lines: list[str] = []
        if op == "updateComponents":
            components = body.get("components", [])
            inner_lines.extend(
                self._decompile_component_graph(
                    components,
                    surface_cat_id=surface_cat_id,
                    is_update=True,
                    preserve_ids=preserve_ids,
                )
            )
        elif op == "updateDataModel":
            raw_path = body.get("path") or "/"
            fence_lines = _format_fenced_json(body.get("value"), indent=2)
            inner_lines.append(f"<DataModel path={format_xml_attr(raw_path)}>")
            inner_lines.extend(fence_lines)
            inner_lines.append("</DataModel>")

        if is_sole_unit and op == "updateDataModel" and sid == self._default_surface_id:
            return "\n".join(inner_lines)

        indented = _indent_block("\n".join(inner_lines), 2)
        return (
            f'<Surface id={format_xml_attr(sid)} update="true">\n{indented}\n</Surface>'
        )

    def _decompile_renderer_call(
        self, envelope: dict[str, Any], call_index: int
    ) -> str:
        rc = envelope.get("callRendererFunction")
        call_id: str | None = None
        if isinstance(rc, dict) and "callFunction" in rc:
            fn_obj = rc["callFunction"]
            call_id = rc.get("functionCallId")
        else:
            fn_obj = envelope.get("callFunction", {})
        if not isinstance(fn_obj, dict):
            fn_obj = {}

        fn_name = _reserved_value(fn_obj, "call") or ""
        fn_helper, write_cat = self._resolve(
            "function", fn_name, fn_obj.get("catalogId"), self._sole_catalog_id
        )
        args = fn_obj.get("args", {}) or {}

        attrs = [f"name={format_xml_attr(fn_name)}"]
        if call_id and call_id != f"call_{call_index}":
            attrs.append(f"id={format_xml_attr(call_id)}")
        if write_cat is not None:
            attrs.append(f"catalogId={format_xml_attr(write_cat)}")

        child_fences: list[str] = []
        if isinstance(args, dict):
            for k, v in args.items():
                arg_schema = fn_helper.get_function_property_schema(fn_name, k)
                attr_str = self._try_format_inline_attr(
                    v, arg_schema, surface_cat_id=self._sole_catalog_id
                )
                if attr_str is not None:
                    attrs.append(f"{k}={format_xml_attr(attr_str)}")
                else:
                    child_fences.extend(_format_fenced_json(v, info=k, indent=2))

        if not child_fences:
            return f"<CallFunction {' '.join(attrs)} />"
        return (
            f"<CallFunction {' '.join(attrs)}>\n"
            + "\n".join(child_fences)
            + "\n</CallFunction>"
        )

    # ---------------------------------------------------------------------------
    # Component Graph -> Nested A2UI XML Tree
    # ---------------------------------------------------------------------------

    def _decompile_component_graph(
        self,
        components: list[dict[str, Any]],
        *,
        surface_cat_id: str | None,
        is_update: bool,
        preserve_ids: bool,
    ) -> list[str]:
        if not components:
            return []
        comp_ids = [c["id"] for c in components if "id" in c]
        self._check_v1_component_ids(comp_ids)

        by_id: dict[str, dict[str, Any]] = {c["id"]: c for c in components}
        ref_counts: dict[str, int] = {cid: 0 for cid in comp_ids}

        # Count references across all child properties
        for c in components:
            comp_name = c["component"]
            helper, _ = self._resolve(
                "component", comp_name, c.get("catalogId"), surface_cat_id
            )
            for prop in helper.get_component_properties(comp_name):
                if prop not in c:
                    continue
                for target_id in self._extract_child_refs(
                    helper, comp_name, prop, c[prop]
                ):
                    if target_id in ref_counts:
                        ref_counts[target_id] += 1

        emitted: set[str] = set()
        lines: list[str] = []

        if not is_update and "root" in by_id:
            # Check if all components are reachable from root
            omit_root_id = not preserve_ids and ref_counts.get("root", 0) == 0
            lines.extend(
                self._render_component(
                    by_id["root"],
                    by_id=by_id,
                    ref_counts=ref_counts,
                    emitted=emitted,
                    surface_cat_id=surface_cat_id,
                    indent=0,
                    slot_override=None,
                    force_id=not omit_root_id,
                    preserve_ids=preserve_ids,
                )
            )
            return lines

        # Partial update: emit roots of subtrees in this update batch with explicit IDs
        top_candidates = [
            cid for cid in comp_ids if ref_counts.get(cid, 0) == 0
        ] or comp_ids
        for cid in top_candidates:
            if cid in emitted:
                continue
            lines.extend(
                self._render_component(
                    by_id[cid],
                    by_id=by_id,
                    ref_counts=ref_counts,
                    emitted=emitted,
                    surface_cat_id=surface_cat_id,
                    indent=0,
                    slot_override=None,
                    force_id=True,
                    preserve_ids=preserve_ids,
                )
            )
        for cid in comp_ids:
            if cid not in emitted:
                lines.extend(
                    self._render_component(
                        by_id[cid],
                        by_id=by_id,
                        ref_counts=ref_counts,
                        emitted=emitted,
                        surface_cat_id=surface_cat_id,
                        indent=0,
                        slot_override=None,
                        force_id=True,
                        preserve_ids=preserve_ids,
                    )
                )
        return lines

    def _extract_child_refs(
        self,
        helper: CatalogSchemaHelper,
        comp_name: str,
        prop: str,
        val: Any,
    ) -> list[str]:
        kind = _get_effective_prop_kind(helper, comp_name, prop)
        if kind == "Child" and isinstance(val, str):
            return [val]
        if kind == "ChildList":
            if isinstance(val, list):
                return [x for x in val if isinstance(x, str)]
            if isinstance(val, dict) and isinstance(val.get("componentId"), str):
                return [val["componentId"]]
        prop_schema = helper.get_property_schema(comp_name, prop)
        item_schema = helper.resolve_item_schema(prop_schema)
        if isinstance(val, list) and isinstance(item_schema, dict):
            item_props = item_schema.get("properties", {})
            refs: list[str] = []
            for entry in val:
                if not isinstance(entry, dict):
                    continue
                for k, sub_s in item_props.items():
                    if k not in entry:
                        continue
                    sub_kind = _schema_ref_kind(sub_s)
                    if sub_kind == "Child" and isinstance(entry[k], str):
                        refs.append(entry[k])
                    elif sub_kind == "ChildList" and isinstance(entry[k], list):
                        refs.extend(x for x in entry[k] if isinstance(x, str))
            return refs
        return []

    def _render_component(
        self,
        comp: dict[str, Any],
        *,
        by_id: dict[str, dict[str, Any]],
        ref_counts: dict[str, int],
        emitted: set[str],
        surface_cat_id: str | None,
        indent: int,
        slot_override: str | None,
        force_id: bool,
        preserve_ids: bool,
    ) -> list[str]:
        cid = comp["id"]
        emitted.add(cid)
        comp_name = comp["component"]
        helper, write_cat = self._resolve(
            "component", comp_name, comp.get("catalogId"), surface_cat_id
        )
        properties = helper.get_component_properties(comp_name)

        child_list_props = [
            p
            for p in properties
            if _get_effective_prop_kind(helper, comp_name, p) == "ChildList"
        ]
        single_child_props = [
            p
            for p in properties
            if _get_effective_prop_kind(helper, comp_name, p) == "Child"
        ]
        default_child_prop = (
            child_list_props[0]
            if child_list_props
            else (single_child_props[0] if len(single_child_props) == 1 else None)
        )

        attrs: list[str] = []
        if force_id or preserve_ids or ref_counts.get(cid, 0) > 1:
            attrs.append(f"id={format_xml_attr(cid)}")
        if slot_override is not None:
            attrs.append(f"slot={format_xml_attr(slot_override)}")
        if write_cat is not None:
            attrs.append(f"catalogId={format_xml_attr(write_cat)}")

        body_lines: list[str] = []
        pad = " " * indent

        # Metadata extensions (v1.0)
        if self._v1:
            meta = comp.get("metadata")
            if isinstance(meta, dict) and isinstance(meta.get("extensions"), dict):
                body_lines.extend(
                    _format_fenced_json(
                        meta["extensions"], info="extensions", indent=indent + 2
                    )
                )

        for prop in properties:
            if prop == "checks":
                continue
            if prop not in comp or comp[prop] is None:
                continue
            val = comp[prop]
            prop_kind = _get_effective_prop_kind(helper, comp_name, prop)
            prop_schema = helper.get_property_schema(comp_name, prop)

            # 1. Single Child slot
            if prop_kind == "Child" and isinstance(val, str):
                child_slot_arg = None if prop == default_child_prop else prop
                if val in by_id and val not in emitted:
                    body_lines.extend(
                        self._render_component(
                            by_id[val],
                            by_id=by_id,
                            ref_counts=ref_counts,
                            emitted=emitted,
                            surface_cat_id=surface_cat_id,
                            indent=indent + 2,
                            slot_override=child_slot_arg,
                            force_id=False,
                            preserve_ids=preserve_ids,
                        )
                    )
                else:
                    attrs.append(f"{prop}={format_xml_attr(val)}")
                continue

            # 2. ChildList slot (array of IDs or template dict)
            if prop_kind == "ChildList":
                child_slot_arg = None if prop == default_child_prop else prop
                if isinstance(val, dict) and "componentId" in val and "path" in val:
                    tmpl_cid = val["componentId"]
                    tmpl_path_str = format_data_path(val["path"])
                    can_use_shorthand = (
                        prop == default_child_prop
                        and "template" not in properties
                        and tmpl_cid in by_id
                        and tmpl_cid not in emitted
                    )
                    if can_use_shorthand:
                        attrs.append(f"template={format_xml_attr(tmpl_path_str)}")
                        body_lines.extend(
                            self._render_component(
                                by_id[tmpl_cid],
                                by_id=by_id,
                                ref_counts=ref_counts,
                                emitted=emitted,
                                surface_cat_id=surface_cat_id,
                                indent=indent + 2,
                                slot_override=None,
                                force_id=False,
                                preserve_ids=preserve_ids,
                            )
                        )
                    else:
                        t_attrs = [f"path={format_xml_attr(tmpl_path_str)}"]
                        if child_slot_arg is not None:
                            t_attrs.append(f"slot={format_xml_attr(child_slot_arg)}")
                        body_lines.append(f"{pad}  <Template {' '.join(t_attrs)}>")
                        if tmpl_cid in by_id and tmpl_cid not in emitted:
                            body_lines.extend(
                                self._render_component(
                                    by_id[tmpl_cid],
                                    by_id=by_id,
                                    ref_counts=ref_counts,
                                    emitted=emitted,
                                    surface_cat_id=surface_cat_id,
                                    indent=indent + 4,
                                    slot_override=None,
                                    force_id=False,
                                    preserve_ids=preserve_ids,
                                )
                            )
                        else:
                            body_lines.append(
                                f"{pad}    <Ref id={format_xml_attr(tmpl_cid)} />"
                            )
                        body_lines.append(f"{pad}  </Template>")
                    continue

                if isinstance(val, list):
                    for child_id in val:
                        if not isinstance(child_id, str):
                            continue
                        if child_id in by_id and child_id not in emitted:
                            body_lines.extend(
                                self._render_component(
                                    by_id[child_id],
                                    by_id=by_id,
                                    ref_counts=ref_counts,
                                    emitted=emitted,
                                    surface_cat_id=surface_cat_id,
                                    indent=indent + 2,
                                    slot_override=child_slot_arg,
                                    force_id=False,
                                    preserve_ids=preserve_ids,
                                )
                            )
                        else:
                            ref_attrs = [f"id={format_xml_attr(child_id)}"]
                            if child_slot_arg is not None:
                                ref_attrs.append(
                                    f"slot={format_xml_attr(child_slot_arg)}"
                                )
                            body_lines.append(f"{pad}  <Ref {' '.join(ref_attrs)} />")
                    continue

            # 3. Action slot
            if prop_kind == "Action" and isinstance(val, dict):
                inline_act = self._try_format_inline_action(val, surface_cat_id)
                if inline_act is not None:
                    attrs.append(f"{prop}={format_xml_attr(inline_act)}")
                else:
                    body_lines.extend(
                        self._render_action_element(
                            prop,
                            val,
                            is_sole_action=(
                                sum(
                                    1
                                    for p in properties
                                    if _get_effective_prop_kind(helper, comp_name, p)
                                    == "Action"
                                )
                                == 1
                            ),
                            surface_cat_id=surface_cat_id,
                            indent=indent + 2,
                        )
                    )
                continue

            # 4. Object-array containing Child/ChildList references (e.g. Tabs.tabs)
            item_schema = helper.resolve_item_schema(prop_schema)
            if (
                isinstance(val, list)
                and isinstance(item_schema, dict)
                and isinstance(item_schema.get("properties"), dict)
                and any(
                    _schema_ref_kind(sub_s) in ("Child", "ChildList")
                    for sub_s in item_schema["properties"].values()
                )
            ):
                obj_array_count = sum(
                    1
                    for p in properties
                    if isinstance(
                        helper.resolve_item_schema(
                            helper.get_property_schema(comp_name, p)
                        ),
                        dict,
                    )
                    and "properties"
                    in (
                        helper.resolve_item_schema(
                            helper.get_property_schema(comp_name, p)
                        )
                        or {}
                    )
                )
                body_lines.extend(
                    self._render_structured_items(
                        prop,
                        val,
                        item_schema=item_schema,
                        helper=helper,
                        need_slot=(obj_array_count > 1),
                        by_id=by_id,
                        ref_counts=ref_counts,
                        emitted=emitted,
                        surface_cat_id=surface_cat_id,
                        indent=indent + 2,
                        preserve_ids=preserve_ids,
                    )
                )
                continue

            # 5. Inline scalar / DataBinding / FunctionCall attribute vs Law 4 JSON fence
            inline_str = self._try_format_inline_attr(
                val, prop_schema, surface_cat_id=surface_cat_id
            )
            if inline_str is not None:
                attrs.append(f"{prop}={format_xml_attr(inline_str)}")
            else:
                body_lines.extend(
                    _format_fenced_json(val, info=prop, indent=indent + 2)
                )

        # 6. Validation `checks`
        checks_list = comp.get("checks")
        if isinstance(checks_list, list) and checks_list:
            comp_val = comp.get("value")
            bound_val_path = (
                self._is_data_binding_dict(comp_val)
                if isinstance(comp_val, dict)
                else None
            )
            for rule in checks_list:
                if isinstance(rule, dict):
                    body_lines.extend(
                        self._render_check_element(
                            rule,
                            sibling_bound_path=bound_val_path,
                            surface_cat_id=surface_cat_id,
                            indent=indent + 2,
                        )
                    )

        attr_suffix = (" " + " ".join(attrs)) if attrs else ""
        if not body_lines:
            return [f"{pad}<{comp_name}{attr_suffix} />"]
        return [
            f"{pad}<{comp_name}{attr_suffix}>",
            *body_lines,
            f"{pad}</{comp_name}>",
        ]

    def _render_structured_items(
        self,
        prop: str,
        items: list[Any],
        *,
        item_schema: dict[str, Any],
        helper: CatalogSchemaHelper,
        need_slot: bool,
        by_id: dict[str, dict[str, Any]],
        ref_counts: dict[str, int],
        emitted: set[str],
        surface_cat_id: str | None,
        indent: int,
        preserve_ids: bool,
    ) -> list[str]:
        out: list[str] = []
        pad = " " * indent
        item_props = item_schema.get("properties", {})
        child_subprops = [
            k for k, v in item_props.items() if _schema_ref_kind(v) == "Child"
        ]
        child_list_subprops = [
            k for k, v in item_props.items() if _schema_ref_kind(v) == "ChildList"
        ]
        default_sub = (
            child_list_subprops[0]
            if child_list_subprops
            else (child_subprops[0] if len(child_subprops) == 1 else None)
        )

        for entry in items:
            if not isinstance(entry, dict):
                continue
            i_attrs: list[str] = []
            if need_slot:
                i_attrs.append(f"slot={format_xml_attr(prop)}")
            i_body: list[str] = []

            for k, v in entry.items():
                sub_schema = helper.resolve_property_schema(item_schema, k)
                sub_kind = _schema_ref_kind(sub_schema)
                sub_slot_arg = None if k == default_sub else k

                if sub_kind == "Child" and isinstance(v, str):
                    if v in by_id and v not in emitted:
                        i_body.extend(
                            self._render_component(
                                by_id[v],
                                by_id=by_id,
                                ref_counts=ref_counts,
                                emitted=emitted,
                                surface_cat_id=surface_cat_id,
                                indent=indent + 2,
                                slot_override=sub_slot_arg,
                                force_id=False,
                                preserve_ids=preserve_ids,
                            )
                        )
                    else:
                        i_attrs.append(f"{k}={format_xml_attr(v)}")
                    continue

                if sub_kind == "ChildList" and isinstance(v, list):
                    for cid in v:
                        if not isinstance(cid, str):
                            continue
                        if cid in by_id and cid not in emitted:
                            i_body.extend(
                                self._render_component(
                                    by_id[cid],
                                    by_id=by_id,
                                    ref_counts=ref_counts,
                                    emitted=emitted,
                                    surface_cat_id=surface_cat_id,
                                    indent=indent + 2,
                                    slot_override=sub_slot_arg,
                                    force_id=False,
                                    preserve_ids=preserve_ids,
                                )
                            )
                        else:
                            r_attrs = [f"id={format_xml_attr(cid)}"]
                            if sub_slot_arg is not None:
                                r_attrs.append(f"slot={format_xml_attr(sub_slot_arg)}")
                            i_body.append(f"{pad}  <Ref {' '.join(r_attrs)} />")
                    continue

                inline_v = self._try_format_inline_attr(
                    v, sub_schema, surface_cat_id=surface_cat_id
                )
                if inline_v is not None:
                    i_attrs.append(f"{k}={format_xml_attr(inline_v)}")
                else:
                    i_body.extend(_format_fenced_json(v, info=k, indent=indent + 2))

            attr_str = (" " + " ".join(i_attrs)) if i_attrs else ""
            if not i_body:
                out.append(f"{pad}<Item{attr_str} />")
            else:
                out.append(f"{pad}<Item{attr_str}>")
                out.extend(i_body)
                out.append(f"{pad}</Item>")
        return out

    def _try_format_inline_attr(
        self,
        val: Any,
        prop_schema: dict[str, Any] | None,
        *,
        surface_cat_id: str | None,
    ) -> str | None:
        """Formats scalar, ``$path``, or ``$fn(...)`` as an attribute string, or ``None`` for JSON fence."""
        if isinstance(val, dict):
            bound = self._is_data_binding_dict(val)
            if bound is not None:
                return format_data_path(bound)
            if self._is_function_call_dict(val):
                call_expr = self._dict_to_call_expr(val, surface_cat_id=surface_cat_id)
                return format_expr_arg(call_expr) if call_expr is not None else None
            return None

        if isinstance(val, list):
            return None

        if isinstance(val, bool):
            return "true" if val else "false"

        if isinstance(val, int):
            return str(val)

        if isinstance(val, float):
            if not math.isfinite(val):
                raise A2uiXmlValidationError(f"Non-finite float {val} in A2UI payload.")
            return repr(val)

        if isinstance(val, str):
            # If literal string starts with `Event(...)`, emit via JSON fence so it isn't read as an Event call
            if val.strip().startswith("Event(") and val.strip().endswith(")"):
                return None
            # Escape leading `$` if `parse_data_path` or `$fn(` would treat it as dynamic
            if val.startswith("$") and (parse_data_path(val) is not None or "(" in val):
                return r"\$" + val[1:]
            if val.startswith(r"\$"):
                return "\\" + val
            return val

        return None

    def _dict_to_call_expr(
        self, fn_dict: dict[str, Any], *, surface_cat_id: str | None
    ) -> CallExpr | None:
        fn_name = _reserved_value(fn_dict, "call")
        if not isinstance(fn_name, str) or not fn_name:
            return None
        fn_helper, write_cat = self._resolve(
            "function", fn_name, fn_dict.get("catalogId"), surface_cat_id
        )
        raw_args = fn_dict.get("args", {}) or {}
        if not isinstance(raw_args, dict):
            return None
        kwargs: dict[str, Any] = {}
        for p in fn_helper.get_function_properties(fn_name):
            if p in raw_args:
                converted = self._json_to_expr_node(
                    raw_args[p], surface_cat_id=surface_cat_id
                )
                kwargs[p] = converted
        for k, v in raw_args.items():
            if k not in kwargs:
                kwargs[k] = self._json_to_expr_node(v, surface_cat_id=surface_cat_id)
        if write_cat is not None:
            kwargs["catalogId"] = write_cat
        return CallExpr(name=fn_name, kwargs=kwargs)

    def _json_to_expr_node(self, val: Any, *, surface_cat_id: str | None) -> Any:
        if isinstance(val, dict):
            bound = self._is_data_binding_dict(val)
            if bound is not None:
                return PathExpr(bound)
            if self._is_function_call_dict(val):
                ce = self._dict_to_call_expr(val, surface_cat_id=surface_cat_id)
                if ce is not None:
                    return ce
            return {
                k: self._json_to_expr_node(v, surface_cat_id=surface_cat_id)
                for k, v in val.items()
            }
        if isinstance(val, list):
            return [
                self._json_to_expr_node(item, surface_cat_id=surface_cat_id)
                for item in val
            ]
        return val

    def _try_format_inline_action(
        self, act: dict[str, Any], surface_cat_id: str | None
    ) -> str | None:
        if isinstance(act.get("functionCall"), dict):
            ce = self._dict_to_call_expr(
                act["functionCall"], surface_cat_id=surface_cat_id
            )
            return format_expr_arg(ce) if ce is not None else None

        evt = act.get("event")
        if not isinstance(evt, dict):
            return None
        if not self._v1 and evt.get("userMessage") is not None:
            return None

        name_val = evt.get("name", "")
        has_ctx = "context" in evt
        has_msg = evt.get("userMessage") is not None

        # Bare action string shorthand when event has only a plain non-empty name
        if (
            not has_ctx
            and not has_msg
            and isinstance(name_val, str)
            and name_val
            and not name_val.startswith(("$", "{", "Event("))
            and "(" not in name_val
        ):
            return name_val

        args: list[Any] = [
            self._json_to_expr_node(name_val, surface_cat_id=surface_cat_id)
        ]
        kwargs: dict[str, Any] = {}
        if has_ctx:
            ctx_val = evt.get("context", {})
            if not isinstance(ctx_val, dict):
                return None
            # If context contains deeply nested dicts/lists, prefer `<Action>` fence
            if any(
                isinstance(v, (dict, list))
                and not self._is_data_binding_dict(v)
                and not self._is_function_call_dict(v)
                for v in ctx_val.values()
                if isinstance(v, dict)
            ):
                return None
            args.append(self._json_to_expr_node(ctx_val, surface_cat_id=surface_cat_id))
        if has_msg:
            kwargs["userMessage"] = self._json_to_expr_node(
                evt["userMessage"], surface_cat_id=surface_cat_id
            )
        return format_expr_arg(
            CallExpr(name="Event", args=tuple(args), kwargs=kwargs, is_event=True)
        )

    def _render_action_element(
        self,
        prop: str,
        act: dict[str, Any],
        *,
        is_sole_action: bool,
        surface_cat_id: str | None,
        indent: int,
    ) -> list[str]:
        pad = " " * indent
        attrs: list[str] = []
        if not is_sole_action:
            attrs.append(f"slot={format_xml_attr(prop)}")

        if isinstance(act.get("functionCall"), dict):
            fn = act["functionCall"]
            fn_name = _reserved_value(fn, "call") or ""
            _, write_cat = self._resolve(
                "function", fn_name, fn.get("catalogId"), surface_cat_id
            )
            attrs.append(f"call={format_xml_attr(fn_name)}")
            if write_cat is not None:
                attrs.append(f"catalogId={format_xml_attr(write_cat)}")
            fences = _format_fenced_json(
                fn.get("args", {}), info="args", indent=indent + 2
            )
            return [f"{pad}<Action {' '.join(attrs)}>", *fences, f"{pad}</Action>"]

        evt = act.get("event", {})
        name_str = self._try_format_inline_attr(
            evt.get("name", ""), None, surface_cat_id=surface_cat_id
        )
        attrs.append(f"name={format_xml_attr(name_str or '')}")
        if self._v1 and evt.get("userMessage") is not None:
            msg_str = self._try_format_inline_attr(
                evt["userMessage"], None, surface_cat_id=surface_cat_id
            )
            if msg_str is not None:
                attrs.append(f"userMessage={format_xml_attr(msg_str)}")
        if "context" in evt and isinstance(evt["context"], dict):
            fences = _format_fenced_json(
                evt["context"], info="context", indent=indent + 2
            )
            return [f"{pad}<Action {' '.join(attrs)}>", *fences, f"{pad}</Action>"]
        return [f"{pad}<Action {' '.join(attrs)} />"]

    def _render_check_element(
        self,
        rule: dict[str, Any],
        *,
        sibling_bound_path: str | None,
        surface_cat_id: str | None,
        indent: int,
    ) -> list[str]:
        pad = " " * indent
        cond = (
            rule.get("condition")
            if "condition" in rule
            else (rule if _has_reserved_key(rule, "call") else {})
        )
        message = rule.get("message")

        if isinstance(cond, dict) and self._is_function_call_dict(cond):
            fn_name = _reserved_value(cond, "call") or ""
            fn_helper, write_cat = self._resolve(
                "function", fn_name, cond.get("catalogId"), surface_cat_id
            )
            attrs = [f"call={format_xml_attr(fn_name)}"]
            if write_cat is not None:
                attrs.append(f"catalogId={format_xml_attr(write_cat)}")

            raw_args = cond.get("args", {}) or {}
            fences: list[str] = []
            if isinstance(raw_args, dict):
                for k, v in raw_args.items():
                    # Omit `value` when it matches the enclosing component's bound value
                    if (
                        k == "value"
                        and sibling_bound_path is not None
                        and isinstance(v, dict)
                        and self._is_data_binding_dict(v) == sibling_bound_path
                    ):
                        continue
                    arg_schema = fn_helper.get_function_property_schema(fn_name, k)
                    inline_arg = self._try_format_inline_attr(
                        v, arg_schema, surface_cat_id=surface_cat_id
                    )
                    if inline_arg is not None:
                        attrs.append(f"{k}={format_xml_attr(inline_arg)}")
                    else:
                        fences.extend(_format_fenced_json(v, info=k, indent=indent + 2))

            default_msg = f"{fn_name.capitalize()} check failed"
            if message and message != default_msg:
                attrs.append(f"message={format_xml_attr(message)}")

            if not fences:
                return [f"{pad}<Check {' '.join(attrs)} />"]
            return [f"{pad}<Check {' '.join(attrs)}>", *fences, f"{pad}</Check>"]

        # Non-call condition (e.g. v1.0 DynamicBoolean path or literal)
        expr_node = self._json_to_expr_node(cond, surface_cat_id=surface_cat_id)
        attrs = [f"condition={format_xml_attr(format_expr_arg(expr_node))}"]
        if message:
            attrs.append(f"message={format_xml_attr(message)}")
        return [f"{pad}<Check {' '.join(attrs)} />"]
