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

"""Decompilation engine for A2UI Vertical inference format.

Converts structured A2UI message payloads (v0.9, v0.9.1, and v1.0) back into
clean plain-text Vertical constructor notation.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import math
from typing import Any, Literal

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import CatalogApi, is_valid_uax31_identifier
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    check_mixed_catalogs,
    coalesce_surface_messages,
    is_action_slot,
    surface_catalog_id,
)

from .compiler import (
    VerticalValidationError,
    is_child_slot,
    is_prop_action_slot,
    normalize_wire_version,
)

_RESERVED_WORDS = frozenset({"true", "false", "null", "none"})
_RESERVED_EVENT_KEYS = frozenset({"name", "userMessage", "context", "catalogId"})


def _is_bare_key(key: str) -> bool:
    return is_valid_uax31_identifier(key) and key.lower() not in _RESERVED_WORDS


def _format_string(val: str) -> str:
    escaped = (
        val.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'"{escaped}"'


def _format_number(val: int | float) -> str:
    if isinstance(val, int):
        return str(val)
    if not math.isfinite(val):
        raise VerticalValidationError(f"The number {val} has no Vertical notation.")
    return repr(val)


def _format_key(key: str) -> str:
    return key if _is_bare_key(key) else _format_string(key)


class VerticalDecompiler:
    """Decompiles structured A2UI payloads into plain-text Vertical syntax."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        version: str | None = None,
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        target_version = (
            normalize_wire_version(version)
            if version is not None
            else catalogs_protocol_version(self._catalogs)
        )
        self.version = target_version
        self.helpers = build_catalog_helpers(self._catalogs, target_version)
        self._sole_catalog_id = surface_catalog_id(self._catalogs)
        self._v1 = is_at_least_version(target_version, ProtocolVersion.V1_0)
        self._path_key = "@path" if self._v1 else "path"
        self._call_key = "@call" if self._v1 else "call"

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs in priority order."""
        return list(self._catalogs)

    def _is_data_binding(self, val: Mapping[str, Any]) -> bool:
        return set(val.keys()) == {self._path_key} and isinstance(
            val.get(self._path_key), str
        )

    def _is_function_call(self, val: Mapping[str, Any]) -> bool:
        if self._v1:
            return isinstance(val.get("@call"), str)
        return isinstance(val.get("call"), str) and (
            "args" in val or "catalogId" in val
        )

    def _resolve_for_decompile(
        self,
        kind: Literal["component", "function"],
        name: str,
        explicit_cat_id: str | None,
        surface_cat_id: str | None,
    ) -> tuple[CatalogSchemaHelper | None, str | None]:
        """Returns `(helper_or_none, disambiguating_catalog_id_or_none)`."""
        actual = explicit_cat_id or surface_cat_id or self._sole_catalog_id
        if actual is not None and actual in self.helpers:
            helper = self.helpers[actual]
            if self._sole_catalog_id is not None:
                return helper, None
            defining = catalogs_defining(self.helpers, kind, name)
            return helper, (None if defining == [actual] else actual)

        defining = catalogs_defining(self.helpers, kind, name)
        if len(defining) == 1:
            return self.helpers[defining[0]], None
        return None, explicit_cat_id

    def _format_function_call(
        self,
        fn_obj: Mapping[str, Any],
        surface_cat_id: str | None,
    ) -> str:
        fn_name = str(fn_obj[self._call_key])
        if fn_name.startswith("@"):
            raise VerticalValidationError(
                f"System function '{fn_name}' is not supported in Vertical."
            )
        explicit_cat = (
            fn_obj["catalogId"] if isinstance(fn_obj.get("catalogId"), str) else None
        )
        fn_helper, write_cat_id = self._resolve_for_decompile(
            "function", fn_name, explicit_cat, surface_cat_id
        )
        raw_args = fn_obj.get("args")
        args_map = dict(raw_args) if isinstance(raw_args, Mapping) else {}

        parts: list[str] = []
        if fn_helper is not None and fn_name in fn_helper.functions:
            ordered = fn_helper.get_function_properties(fn_name)
            seen: set[str] = set()
            for p in ordered:
                if p in args_map:
                    p_schema = fn_helper.get_function_property_schema(fn_name, p)
                    parts.append(
                        f"{p}={self._format_value(args_map[p], p_schema, fn_helper, surface_cat_id)}"
                    )
                    seen.add(p)
            for k, v in args_map.items():
                if k not in seen:
                    parts.append(
                        f"{_format_key(k)}={self._format_value(v, None, fn_helper, surface_cat_id)}"
                    )
        else:
            for k, v in args_map.items():
                parts.append(
                    f"{_format_key(k)}={self._format_value(v, None, None, surface_cat_id)}"
                )

        if write_cat_id is not None:
            parts.append(f"catalogId={_format_string(write_cat_id)}")
        return f"{fn_name}({', '.join(parts)})"

    def _format_event(
        self,
        ev: Mapping[str, Any],
        surface_cat_id: str | None,
    ) -> str:
        ev_name = str(ev.get("name", ""))
        parts = [_format_string(ev_name)]
        context = ev.get("context")
        if isinstance(context, Mapping):
            if context and all(
                isinstance(k, str) and _is_bare_key(k) and k not in _RESERVED_EVENT_KEYS
                for k in context
            ):
                for k, v in context.items():
                    parts.append(
                        f"{k}={self._format_value(v, None, None, surface_cat_id)}"
                    )
            else:
                ctx_entries = ", ".join(
                    f"{_format_key(str(k))}:"
                    f" {self._format_value(v, None, None, surface_cat_id)}"
                    for k, v in context.items()
                )
                parts.append(f"context={{{ctx_entries}}}")

        if self._v1 and "userMessage" in ev:
            parts.append(
                f"userMessage={self._format_value(ev['userMessage'], None, None, surface_cat_id)}"
            )
        return f"Event({', '.join(parts)})"

    def _format_check_rule(
        self,
        rule: Mapping[str, Any],
        sibling_value: Any,
        surface_cat_id: str | None,
    ) -> str:
        cond = rule.get("condition")
        if not isinstance(cond, Mapping) or not self._is_function_call(cond):
            return self._format_value(rule, None, None, surface_cat_id)

        fn_name = str(cond[self._call_key])
        explicit_cat = (
            cond["catalogId"] if isinstance(cond.get("catalogId"), str) else None
        )
        fn_helper, write_cat_id = self._resolve_for_decompile(
            "function", fn_name, explicit_cat, surface_cat_id
        )
        raw_args = cond.get("args")
        args_map = dict(raw_args) if isinstance(raw_args, Mapping) else {}
        fn_props = (
            fn_helper.get_function_properties(fn_name)
            if fn_helper is not None
            else list(args_map.keys())
        )

        sibling_is_binding = isinstance(
            sibling_value, Mapping
        ) and self._is_data_binding(sibling_value)
        skip_value = (
            bool(fn_props)
            and fn_props[0] == "value"
            and sibling_is_binding
            and args_map.get("value") == sibling_value
        )

        pos_parts: list[str] = []
        kw_parts: list[str] = []
        omitted_prior = False
        for idx, p in enumerate(fn_props):
            if idx == 0 and skip_value:
                continue
            if p not in args_map:
                omitted_prior = True
                continue
            p_schema = (
                fn_helper.get_function_property_schema(fn_name, p)
                if fn_helper is not None
                else None
            )
            formatted = self._format_value(
                args_map[p], p_schema, fn_helper, surface_cat_id
            )
            if (
                idx == 0
                and p == "value"
                and not (
                    isinstance(args_map[p], Mapping)
                    and self._is_data_binding(args_map[p])
                )
            ):
                kw_parts.append(f"value={formatted}")
            elif omitted_prior:
                kw_parts.append(f"{_format_key(p)}={formatted}")
            else:
                pos_parts.append(formatted)

        for k, v in args_map.items():
            if k not in fn_props:
                kw_parts.append(
                    f"{_format_key(k)}={self._format_value(v, None, fn_helper, surface_cat_id)}"
                )

        msg = rule.get("message")
        if isinstance(msg, str):
            if omitted_prior and kw_parts:
                kw_parts.append(f"message={_format_string(msg)}")
            else:
                pos_parts.append(_format_string(msg))
        if write_cat_id is not None:
            kw_parts.append(f"catalogId={_format_string(write_cat_id)}")

        all_parts = [*pos_parts, *kw_parts]
        if not all_parts:
            return f"?{fn_name}"
        return f"?{fn_name}({', '.join(all_parts)})"

    def _format_value(
        self,
        val: Any,
        schema: dict[str, Any] | None,
        helper: CatalogSchemaHelper | None,
        surface_cat_id: str | None,
        *,
        in_action_slot: bool = False,
    ) -> str:
        if val is None:
            return "null"
        if isinstance(val, bool):
            return "true" if val else "false"
        if isinstance(val, (int, float)):
            return _format_number(val)
        if isinstance(val, str):
            return _format_string(val)
        if isinstance(val, Mapping):
            if self._is_data_binding(val):
                p = str(val[self._path_key])
                if p == "/":
                    return "$/"
                return f"${p}" if p.startswith("/") else f"$/{p}"

            if (
                (in_action_slot or is_action_slot(schema))
                and set(val.keys()) == {"event"}
                and isinstance(val.get("event"), Mapping)
            ):
                return self._format_event(val["event"], surface_cat_id)

            if (
                (in_action_slot or is_action_slot(schema))
                and set(val.keys()) == {"functionCall"}
                and isinstance(val.get("functionCall"), Mapping)
                and self._is_function_call(val["functionCall"])
            ):
                return self._format_function_call(val["functionCall"], surface_cat_id)

            if self._is_function_call(val):
                return self._format_function_call(val, surface_cat_id)

            inner = ", ".join(
                f"{_format_key(str(k))}:"
                f" {self._format_value(v, helper.resolve_property_schema(schema, str(k)) if helper is not None and schema is not None else None, helper, surface_cat_id, in_action_slot=is_action_slot(helper.resolve_property_schema(schema, str(k))) if helper is not None and schema is not None else False)}"
                for k, v in val.items()
            )
            return f"{{{inner}}}"

        if isinstance(val, Sequence) and not isinstance(val, (str, bytes)):
            item_schema = (
                helper.resolve_item_schema(schema)
                if helper is not None and schema is not None
                else None
            )
            inner = ", ".join(
                self._format_value(
                    item,
                    item_schema,
                    helper,
                    surface_cat_id,
                    in_action_slot=is_action_slot(item_schema),
                )
                for item in val
            )
            return f"[{inner}]"

        return str(val)

    def _format_component(
        self, comp: Mapping[str, Any], surface_cat_id: str | None
    ) -> str:
        comp_type = str(comp.get("component", "Unknown"))
        explicit_cat = (
            comp["catalogId"] if isinstance(comp.get("catalogId"), str) else None
        )
        comp_helper, write_cat_id = self._resolve_for_decompile(
            "component", comp_type, explicit_cat, surface_cat_id
        )

        args_parts: list[str] = []
        for k, v in comp.items():
            if k in ("component", "id", "catalogId", "checks", "metadata"):
                continue
            if is_child_slot(comp_helper, comp_type, k):
                continue
            p_schema = (
                comp_helper.get_property_schema(comp_type, k)
                if comp_helper is not None and comp_type in comp_helper.components
                else None
            )
            formatted_val = self._format_value(
                v,
                p_schema,
                comp_helper,
                surface_cat_id,
                in_action_slot=is_prop_action_slot(comp_helper, comp_type, k),
            )
            args_parts.append(f"{_format_key(k)}={formatted_val}")

        checks = comp.get("checks")
        if (
            isinstance(checks, Sequence)
            and not isinstance(checks, (str, bytes))
            and checks
        ):
            sibling_val = comp.get("value")
            formatted_checks = [
                self._format_check_rule(rc, sibling_val, surface_cat_id)
                for rc in checks
                if isinstance(rc, Mapping)
            ]
            if formatted_checks:
                args_parts.append(f"checks=[{', '.join(formatted_checks)}]")

        if write_cat_id is not None:
            args_parts.append(f"catalogId={_format_string(write_cat_id)}")

        if self._v1:
            meta = comp.get("metadata")
            if isinstance(meta, Mapping) and isinstance(
                meta.get("extensions"), Mapping
            ):
                ext_str = self._format_value(
                    meta["extensions"], None, None, surface_cat_id
                )
                args_parts.append(f"extensions={ext_str}")

        return f"{comp_type}({', '.join(args_parts)})"

    def _format_renderer_call(self, msg: Mapping[str, Any], call_index: int) -> str:
        rc = msg.get("callRendererFunction")
        if not isinstance(rc, Mapping):
            return ""
        func_op = rc.get("callFunction")
        if not isinstance(func_op, Mapping) or not self._is_function_call(func_op):
            return ""
        call_str = self._format_function_call(func_op, self._sole_catalog_id)
        fn_call_id = rc.get("functionCallId")
        if (
            isinstance(fn_call_id, str)
            and fn_call_id
            and fn_call_id != f"call_{call_index}"
        ):
            sep = "" if call_str.endswith("()") else ", "
            call_str = (
                f"{call_str[:-1]}{sep}functionCallId={_format_string(fn_call_id)})"
            )
        return call_str

    def decompile(
        self,
        a2ui_payload: (
            Sequence[AgentToRendererMessage | Mapping[str, Any]]
            | AgentToRendererMessage
            | Mapping[str, Any]
        ),
    ) -> str:
        """Decompiles structured A2UI messages into plain-text Vertical statements."""
        lines: list[str] = []
        call_count = 0

        for item in coalesce_surface_messages(a2ui_payload):
            msg = item.message
            if "callRendererFunction" in msg:
                call_count += 1
                rendered = self._format_renderer_call(msg, call_count)
                if rendered:
                    lines.append(rendered)
                continue

            op = item.operation
            if op not in ("createSurface", "updateComponents"):
                continue
            body = msg.get(op)
            if not isinstance(body, Mapping):
                continue
            raw_comps = body.get("components")
            if not isinstance(raw_comps, Sequence) or isinstance(
                raw_comps, (str, bytes)
            ):
                continue

            valid_comps = [c for c in raw_comps if isinstance(c, Mapping)]
            if not valid_comps:
                continue

            comp_map = {
                str(c["id"]): c for c in valid_comps if isinstance(c.get("id"), str)
            }
            root_comp = comp_map.get("root") or valid_comps[0]
            surface_cat = (
                body.get("catalogId")
                if isinstance(body.get("catalogId"), str)
                else item.surface_catalog_id
            )
            lines.append(self._format_component(root_comp, surface_cat))

        return "\n".join(lines)

    def wrap_decompiled_blocks(self, blocks: Sequence[str]) -> str:
        """Wraps decompiled Vertical blocks inside `<a2ui>` sentinel tags."""
        joined = "\n".join(blocks).strip()
        return f"{A2UI_INFERENCE_OPEN_TAG}\n{joined}\n{A2UI_INFERENCE_CLOSE_TAG}"
