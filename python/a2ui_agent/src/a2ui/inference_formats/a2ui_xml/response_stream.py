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

"""Incremental chunk-by-chunk response stream for A2UI A2UI XML."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
import re
from typing import Any, Generic, Literal, TYPE_CHECKING, TypeVar, cast

from a2ui.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from a2ui.core import A2uiError, A2uiParseError
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import (
    surface_catalog_id,
    to_message_dicts,
    to_message_models,
)
from a2ui.parser import (
    A2uiCompilationError,
    A2uiPart,
    ErrorPart,
    ResponseStream,
    StreamPart,
    TextRun,
)
from a2ui.utils import RendererState

from .compiler import A2uiXmlCompiler, _CompileContext, _normalize_identifier_key
from .scanner import (
    ElementNode,
    FenceNode,
    A2uiXmlNode,
    OPEN_A2UI_RE,
    ProseNode,
    build_surface_directive_from_a2ui_attrs,
    parse_a2ui_xml_document,
    possible_a2ui_open_start,
    scan_a2ui_block_end,
)

if TYPE_CHECKING:
    from .parser import A2uiXmlParser

PartT = TypeVar("PartT", bound=StreamPart, covariant=True)

_OUTER_TRAILING_FENCE_RE = re.compile(
    r"(?:\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n[ \t]*)?|(?:^|(?<=\s))`{1,2})\Z"
)
_OUTER_TRAILING_FENCE_PREFIX_RE = re.compile(
    r"(?:```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n[ \t]*)?|`+)\Z"
)
_OUTER_INLINE_OPEN_BACKTICK_RE = re.compile(r"(?:^|(?<=\s))`{1,2}\Z")
_OUTER_LEADING_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|\Z)")
_OUTER_LEADING_FENCE_PREFIX_RE = re.compile(
    r"^\s*(?:`{0,2}|```[a-zA-Z0-9_-]*[ \t]*\r?)\Z"
)
_OUTER_LEADING_FENCE_INLINE_RE = re.compile(
    r"^(?:\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|\Z)|`+)"
)
_OUTER_LEADING_FENCE_INLINE_PREFIX_RE = re.compile(
    r"^(?:`+|\s*`{0,2}|\s*```[a-zA-Z0-9_-]*[ \t]*\r?)\Z"
)
_TRAILING_FENCE_CLOSE_RE = re.compile(r"\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n?\Z")


def _possible_fence_start(text: str) -> int:
    match = _OUTER_TRAILING_FENCE_PREFIX_RE.search(text)
    return match.start() if match else len(text)


def _is_subtree_closed(node: A2uiXmlNode) -> bool:
    if isinstance(node, ProseNode):
        return True
    if isinstance(node, FenceNode):
        return node.closed
    if not node.closed:
        return False
    return all(_is_subtree_closed(c) for c in node.children)


class A2uiXmlResponseStream(ResponseStream[PartT], Generic[PartT]):
    """Reads a streamed A2UI XML model response and progressively emits A2UI parts."""

    def __init__(
        self,
        parser: A2uiXmlParser,
        *,
        wrapped: bool = True,
        state: RendererState | None = None,
        after_rejected_block: Literal["end", "continue"] = "end",
    ) -> None:
        self._parser = parser
        self._compiler: A2uiXmlCompiler = parser.compiler
        self._wrapped = wrapped
        self._state = state if state is not None else RendererState(parser.catalogs)
        self._continues = after_rejected_block == "continue"
        self._closed = False
        self._text = TextRun()
        self._held = ""
        self._after_block = False
        self._wrapped_in_inline_backticks = False
        self._in_block = not wrapped
        self._rejected = False
        self._block = ""
        self._header_directive = ""
        self._touched: dict[str, None] = {}
        self._initial_surfaces: frozenset[str] = frozenset(self._state.surface_ids)
        self._emitted_surfaces: set[str] = set()
        self._emitted_comps: dict[str, dict[str, dict[str, Any]]] = {}
        self._emitted_root_data: dict[str, dict[str, Any]] = {}
        self._emitted_data_updates: dict[str, int] = {}
        self._emitted_standalone_ops: int = 0
        self._last_scanned_len = 0

    def _reset_block(self, header_directive: str = "") -> None:
        self._block = ""
        self._header_directive = header_directive
        self._rejected = False
        self._touched = {}
        self._initial_surfaces = frozenset(self._state.surface_ids)
        self._emitted_surfaces = set()
        self._emitted_comps = {}
        self._emitted_root_data = {}
        self._emitted_data_updates = {}
        self._emitted_standalone_ops = 0
        self._last_scanned_len = 0

    @property
    def state(self) -> RendererState:
        return self._state

    @property
    def is_in_block(self) -> bool:
        return not self._closed and self._in_block

    @property
    def _has_progressive_emissions(self) -> bool:
        return bool(
            self._emitted_surfaces
            or self._emitted_comps
            or self._emitted_root_data
            or self._emitted_data_updates
            or self._emitted_standalone_ops
        )

    def feed(self, chunk: str) -> list[PartT]:
        if self._closed:
            raise ValueError("The response stream is closed.")
        parts: list[StreamPart] = []
        try:
            self._feed(chunk, parts)
        except BaseException as exc:
            self._fail(exc, parts)
            raise
        return cast("list[PartT]", parts)

    def close(self) -> list[PartT]:
        if self._closed:
            return []
        self._closed = True
        parts: list[StreamPart] = []
        try:
            if not self._wrapped:
                if not self._rejected:
                    self._guard_block(
                        parts, lambda: self._finish_block(parts, len(self._block))
                    )
                return cast("list[PartT]", parts)
            if self._in_block:
                if not self._rejected:
                    self._guard_block(parts, self._raise_unclosed)
                self._state.mark_checked(self._touched)
                return cast("list[PartT]", parts)
        except BaseException as exc:
            self._fail(exc, parts)
            raise

        if self._held:
            rest = self._held
            self._held = ""
            if self._after_block:
                leading_re = (
                    _OUTER_LEADING_FENCE_INLINE_RE
                    if self._wrapped_in_inline_backticks
                    else _OUTER_LEADING_FENCE_RE
                )
                rest = leading_re.sub("", rest, count=1)
                self._wrapped_in_inline_backticks = False
            self._text.emit(parts, _TRAILING_FENCE_CLOSE_RE.sub("", rest, count=1))
        return cast("list[PartT]", parts)

    @staticmethod
    def _raise_unclosed() -> None:
        raise A2uiParseError(
            f"The response ended inside an {A2UI_INFERENCE_OPEN_TAG} block, before"
            f" its {A2UI_INFERENCE_CLOSE_TAG} tag."
        )

    def _fail(self, error: BaseException, parts: list[StreamPart]) -> None:
        self._closed = True
        self._state.mark_checked(self._touched)
        if isinstance(error, A2uiError):
            setattr(
                error,
                "partial_results",
                [p for p in parts if not isinstance(p, ErrorPart)],
            )

    def _guard_block(self, parts: list[StreamPart], step: Callable[[], None]) -> None:
        try:
            step()
        except A2uiError as exc:
            if not self._continues:
                raise
            parts.append(ErrorPart(error=exc))
            self._state.mark_checked(self._touched)
            self._rejected = True

    def _feed(self, chunk: str, parts: list[StreamPart]) -> None:
        if not self._wrapped:
            self._block += chunk
            if not self._rejected:
                self._guard_block(
                    parts, lambda: self._emit_progressive(parts, len(self._block))
                )
            return

        input_str = self._held + chunk
        self._held = ""
        while input_str:
            if self._in_block:
                input_str = self._consume_block_text(parts, input_str)
                continue
            if self._after_block:
                prefix_re = (
                    _OUTER_LEADING_FENCE_INLINE_PREFIX_RE
                    if self._wrapped_in_inline_backticks
                    else _OUTER_LEADING_FENCE_PREFIX_RE
                )
                if prefix_re.match(input_str):
                    self._held = input_str
                    return
                self._after_block = False
                leading_re = (
                    _OUTER_LEADING_FENCE_INLINE_RE
                    if self._wrapped_in_inline_backticks
                    else _OUTER_LEADING_FENCE_RE
                )
                self._wrapped_in_inline_backticks = False
                input_str = leading_re.sub("", input_str, count=1)
                continue
            input_str = self._consume_outside_text(parts, input_str)

    def _consume_outside_text(self, parts: list[StreamPart], input_str: str) -> str:
        open_match = OPEN_A2UI_RE.search(input_str)
        if open_match:
            before_open = input_str[: open_match.start()]
            self._wrapped_in_inline_backticks = bool(
                _OUTER_INLINE_OPEN_BACKTICK_RE.search(before_open)
            )
            text_before = _OUTER_TRAILING_FENCE_RE.sub("", before_open, count=1)
            self._text.emit(parts, text_before)
            self._text.reset()

            raw_attrs = open_match.group("attrs") or ""
            header_dir, violations = build_surface_directive_from_a2ui_attrs(
                raw_attrs, tuned=self._parser.tuned
            )
            self._in_block = True
            self._reset_block(header_directive=header_dir)
            if violations and self._parser.strict:

                def _raise_attr_violation() -> None:
                    first = violations[0]
                    raise A2uiParseError(f"[{first.law}] {first.message}")

                self._guard_block(parts, _raise_attr_violation)
            return input_str[open_match.end() :]

        tag_start = possible_a2ui_open_start(input_str)
        hold = _possible_fence_start(input_str[:tag_start])
        self._text.emit(parts, input_str[:hold])
        self._held = input_str[hold:]
        return ""

    def _consume_block_text(self, parts: list[StreamPart], input_str: str) -> str:
        self._block += input_str
        close_start, close_end, safe_end = scan_a2ui_block_end(self._block)
        if close_start is None:
            if not self._rejected and safe_end > self._last_scanned_len:
                self._last_scanned_len = safe_end
                self._guard_block(
                    parts, lambda: self._emit_progressive(parts, safe_end)
                )
            return ""

        assert close_end is not None
        remaining = self._block[close_end:]
        if not self._rejected:
            self._guard_block(parts, lambda: self._finish_block(parts, close_start))
        self._in_block = False
        self._after_block = True
        self._reset_block()
        return remaining

    def _effective_payload(self, end: int) -> str:
        raw = self._block[:end]
        if self._header_directive:
            stripped = raw.lstrip()
            if not stripped.lower().startswith("<surface"):
                return f"{self._header_directive}\n{raw}"
        return raw

    def _emit_progressive(self, parts: list[StreamPart], end: int) -> None:
        """Progressively compiles and emits closed inner components and data blocks."""
        payload = self._effective_payload(end)
        if not payload.strip():
            return

        doc = parse_a2ui_xml_document(
            payload,
            is_final=False,
            strict=self._parser.strict,
            tuned=self._parser.tuned,
        )
        if not doc.children:
            return

        wire_ver, at_least_v10 = self._compiler._resolve_version(  # pylint: disable=protected-access
            self._parser.version
        )
        ctx = _CompileContext(
            version=wire_ver,
            at_least_v10=at_least_v10,
            path_key="@path" if at_least_v10 else "path",
            call_key="@call" if at_least_v10 else "call",
            strict=self._parser.strict,
            tuned=self._parser.tuned,
            violations=list(doc.violations),
        )

        surf_id = self._parser.surface_id
        is_update = False
        send_dm: bool | None = None
        active_nodes = doc.children

        # Handle leading `<Surface ... />` or open `<Surface ...>`
        if (
            active_nodes
            and isinstance(active_nodes[0], ElementNode)
            and self._compiler._is_reserved_directive(active_nodes[0]) == "Surface"  # pylint: disable=protected-access
        ):
            s_elem = active_nodes[0]
            unit = self._compiler._parse_surface_element(  # pylint: disable=protected-access
                s_elem, default_surface_id=surf_id, ctx=ctx
            )
            surf_id = unit.surface_id
            is_update = unit.is_update
            send_dm = unit.send_data_model
            if s_elem.self_closing:
                active_nodes = active_nodes[1:]
            elif not s_elem.closed:
                active_nodes = s_elem.children
            else:
                # Closed `<Surface>` block: wait for further surfaces or `_finish_block`
                return

        # Only progressively stream single-surface open component trees
        if any(
            isinstance(n, ElementNode)
            and self._compiler._is_reserved_directive(n)  # pylint: disable=protected-access
            in ("Surface", "DeleteSurface", "CallFunction")
            for n in active_nodes
        ):
            return

        top_flow_nodes: list[A2uiXmlNode] = []
        closed_root_data: dict[str, Any] = {}
        has_closed_data = False

        for n in active_nodes:
            if isinstance(n, ElementNode):
                d_kind = self._compiler._is_reserved_directive(n)  # pylint: disable=protected-access
                if d_kind == "DataModel":
                    if _is_subtree_closed(n):
                        entry = self._compiler._parse_data_model_element(n, ctx)  # pylint: disable=protected-access
                        if entry.pointer == "/" and isinstance(entry.value, dict):
                            closed_root_data.update(entry.value)
                            has_closed_data = True
                    continue
                if d_kind == "Extensions":
                    return
            if isinstance(n, FenceNode) and n.lang.lower() == "json":
                if n.closed:
                    info_norm = n.info.strip().lower()
                    if not info_norm or info_norm in (
                        "datamodel",
                        "data",
                        "data_model",
                    ):
                        entry = self._compiler._parse_data_model_fence(n)  # pylint: disable=protected-access
                        if entry.pointer == "/" and isinstance(entry.value, dict):
                            closed_root_data.update(entry.value)
                            has_closed_data = True
                continue
            top_flow_nodes.append(n)

        # Pre-claim explicit IDs so auto-assigned `c1`, `c2`, ... match final compile
        self._compiler._collect_explicit_ids(top_flow_nodes, ctx)  # pylint: disable=protected-access

        new_comps: list[dict[str, Any]] = []
        emitted_for_surf = self._emitted_comps.setdefault(surf_id, {})

        def _item_slot_has_child_refs(
            parent_elem: ElementNode, item_slot_hint: str | None
        ) -> bool:
            for helper in self._compiler.helpers.values():
                if parent_elem.tag not in helper.components:
                    continue
                p_list = helper.get_component_properties(parent_elem.tag)
                cand_props = [item_slot_hint] if item_slot_hint else p_list
                for p in cand_props:
                    if not p or p not in p_list:
                        continue
                    item_s = helper.resolve_item_schema(
                        helper.get_property_schema(parent_elem.tag, p)
                    )
                    if isinstance(item_s, dict) and isinstance(
                        item_s.get("properties"), dict
                    ):
                        for iv in item_s["properties"].values():
                            if isinstance(iv, dict):
                                ref = iv.get("$ref")
                                if isinstance(ref, str) and (
                                    "Child" in ref or "ComponentId" in ref
                                ):
                                    return True
            return False

        def walk_and_collect_closed(elem: ElementNode, *, is_top: bool) -> None:
            nonlocal has_closed_data
            # Reserve this element's own ID in exact compiler preorder
            if is_top and "id" not in elem.attrs:
                # Top-level element gets either "root" or "r<N>", never `c<N>`
                pass
            elif "id" not in elem.attrs:
                own_id = ctx.allocate_id()
            else:
                own_id = elem.attrs["id"]

            if not is_top and _is_subtree_closed(elem):
                comp_dict, desc = self._compiler._compile_component_node(  # pylint: disable=protected-access
                    elem, ctx, forced_id=own_id
                )
                for c in [comp_dict, *desc]:
                    if emitted_for_surf.get(c["id"]) != c:
                        new_comps.append(c)
                for lifted in ctx.lifted_data_entries:
                    if lifted.pointer == "/" and isinstance(lifted.value, dict):
                        closed_root_data.update(lifted.value)
                        has_closed_data = True
                ctx.lifted_data_entries.clear()
                return

            # Element is still open: walk its children in preorder to allocate IDs
            for child in elem.children:
                if isinstance(child, ElementNode):
                    if (
                        ctx.tuned
                        and not ctx.strict
                        and self._compiler._is_reserved_directive(child) == "DataModel"  # pylint: disable=protected-access
                    ):
                        if _is_subtree_closed(child):
                            entry = self._compiler._parse_data_model_element(child, ctx)  # pylint: disable=protected-access
                            if entry.pointer == "/" and isinstance(entry.value, dict):
                                closed_root_data.update(entry.value)
                                has_closed_data = True
                        continue

                    h_kind = self._compiler._is_child_helper_tag(child)  # pylint: disable=protected-access
                    if h_kind in ("Check", "Action", "Ref", "Call", "Extensions"):
                        continue
                    if h_kind == "Template":
                        for sub in child.children:
                            if isinstance(sub, ElementNode) and not self._compiler._is_child_helper_tag(sub):  # pylint: disable=protected-access
                                walk_and_collect_closed(sub, is_top=False)
                            elif isinstance(sub, ProseNode):
                                ctx.allocate_id()
                        continue
                    if h_kind == "Item":
                        if not ctx.tuned or _item_slot_has_child_refs(
                            elem, child.attrs.get("slot")
                        ):
                            for sub in child.children:
                                if isinstance(sub, ElementNode) and not self._compiler._is_child_helper_tag(sub):  # pylint: disable=protected-access
                                    walk_and_collect_closed(sub, is_top=False)
                                elif isinstance(sub, ProseNode):
                                    ctx.allocate_id()
                        continue

                    if ctx.tuned and not ctx.strict:
                        # Check tuned slot wrapper or morphological subtag
                        parent_helper = next(
                            (
                                h
                                for h in self._compiler.helpers.values()
                                if elem.tag in h.components
                            ),
                            None,
                        )
                        if parent_helper is not None:
                            p_props = parent_helper.get_component_properties(elem.tag)
                            s_props = [
                                p
                                for p in p_props
                                if parent_helper.get_property_type(elem.tag, p)
                                == "Child"
                            ]
                            l_props = [
                                p
                                for p in p_props
                                if parent_helper.get_property_type(elem.tag, p)
                                == "ChildList"
                            ]
                            unwrapped = self._compiler._unwrap_slot_wrapper_tag(  # pylint: disable=protected-access
                                child, elem.tag, p_props, s_props, l_props, ctx
                            )
                            if unwrapped is not None:
                                _, w_nodes = unwrapped
                                for w_n in w_nodes:
                                    if isinstance(w_n, ElementNode) and not self._compiler._is_child_helper_tag(w_n):  # pylint: disable=protected-access
                                        walk_and_collect_closed(w_n, is_top=False)
                                    elif isinstance(w_n, ProseNode):
                                        ctx.allocate_id()
                                continue
                            morph_p = self._compiler._match_morphological_item_subtag(  # pylint: disable=protected-access
                                child, elem.tag, parent_helper, p_props, ctx
                            )
                            if morph_p is not None:
                                if _item_slot_has_child_refs(elem, morph_p):
                                    for sub in child.children:
                                        if isinstance(sub, ElementNode) and not self._compiler._is_child_helper_tag(sub):  # pylint: disable=protected-access
                                            walk_and_collect_closed(sub, is_top=False)
                                        elif isinstance(sub, ProseNode):
                                            ctx.allocate_id()
                                continue
                            if not s_props and not l_props:
                                continue

                    walk_and_collect_closed(child, is_top=False)
                elif isinstance(child, FenceNode) and ctx.tuned and not ctx.strict:
                    info_norm = child.info.strip().lower()
                    if child.lang.lower() == "json" and info_norm in (
                        "datamodel",
                        "data",
                        "data_model",
                    ):
                        if child.closed:
                            entry = self._compiler._parse_data_model_fence(child)  # pylint: disable=protected-access
                            if entry.pointer == "/" and isinstance(entry.value, dict):
                                closed_root_data.update(entry.value)
                                has_closed_data = True
                    elif child.lang.lower() != "json" and not (
                        not child.lang
                        and not child.info
                        and child.content.strip().startswith(("{", "["))
                    ):
                        if child.closed:
                            _, f_comps = self._compiler._compile_flow_node(  # pylint: disable=protected-access
                                child, ctx
                            )
                            for c in f_comps:
                                if emitted_for_surf.get(c["id"]) != c:
                                    new_comps.append(c)
                        else:
                            ctx.allocate_id()
                elif isinstance(child, ProseNode):
                    # Prose inside a container allocates a synthesized leaf ID
                    comp_name = elem.tag
                    for helper in self._compiler.helpers.values():
                        if comp_name in helper.components:
                            props = helper.get_component_properties(comp_name)
                            if any(
                                helper.get_property_type(comp_name, p)
                                in ("Child", "ChildList")
                                for p in props
                            ):
                                ctx.allocate_id()
                            break

        for t_node in top_flow_nodes:
            if isinstance(t_node, ElementNode):
                walk_and_collect_closed(t_node, is_top=True)

        if ctx.strict and ctx.violations:
            first = ctx.violations[0]
            raise A2uiParseError(f"[{first.law}] {first.message}")

        already_created = (
            surf_id in self._initial_surfaces or surf_id in self._emitted_surfaces
        )
        need_data_emit = (
            has_closed_data and self._emitted_root_data.get(surf_id) != closed_root_data
        )

        if not new_comps and not need_data_emit:
            return

        out_msgs: list[dict[str, Any]] = []
        if not is_update and not already_created:
            create_body: dict[str, Any] = {"surfaceId": surf_id}
            cat_id = surface_catalog_id(self._compiler.catalogs)
            if cat_id is not None:
                create_body["catalogId"] = cat_id
            if send_dm is not None:
                create_body["sendDataModel"] = send_dm

            if at_least_v10:
                if new_comps:
                    create_body["components"] = new_comps
                if need_data_emit and closed_root_data:
                    create_body["dataModel"] = dict(closed_root_data)
                out_msgs.append({"version": wire_ver, "createSurface": create_body})
            else:
                out_msgs.append({"version": wire_ver, "createSurface": create_body})
                if new_comps:
                    out_msgs.append({
                        "version": wire_ver,
                        "updateComponents": {
                            "surfaceId": surf_id,
                            "components": new_comps,
                        },
                    })
                if need_data_emit and closed_root_data:
                    out_msgs.append({
                        "version": wire_ver,
                        "updateDataModel": {
                            "surfaceId": surf_id,
                            "path": "/",
                            "value": dict(closed_root_data),
                        },
                    })
        else:
            if new_comps:
                out_msgs.append({
                    "version": wire_ver,
                    "updateComponents": {
                        "surfaceId": surf_id,
                        "components": new_comps,
                    },
                })
            if need_data_emit and closed_root_data:
                out_msgs.append({
                    "version": wire_ver,
                    "updateDataModel": {
                        "surfaceId": surf_id,
                        "path": "/",
                        "value": dict(closed_root_data),
                    },
                })

        if not out_msgs:
            return

        with self._state.transaction():
            models = to_message_models(out_msgs)
            self._apply(models)

        if not is_update and not already_created:
            self._emitted_surfaces.add(surf_id)
        for c in new_comps:
            emitted_for_surf[c["id"]] = c
        if need_data_emit and closed_root_data:
            self._emitted_root_data[surf_id] = dict(closed_root_data)
        parts.append(A2uiPart(a2ui=models))

    def _finish_block(self, parts: list[StreamPart], end: int) -> None:
        payload = self._effective_payload(end)
        try:
            final_models = list(
                self._compiler.compile(
                    payload,
                    surface_id=self._parser.surface_id,
                    version=self._parser.version,
                    is_final=True,
                    existing_surfaces=self._initial_surfaces,
                    strict=self._parser.strict,
                )
            )
        except A2uiError:
            raise
        except Exception as exc:
            raise A2uiCompilationError(
                f"Failed to compile A2UI XML block: {exc}", payload
            ) from exc

        if not self._has_progressive_emissions:
            with self._state.transaction():
                self._apply(final_models)
                self._state.check_topology(self._touched)
            if final_models:
                parts.append(A2uiPart(a2ui=final_models))
            return

        # Diff final messages against progressively emitted state
        diff_dicts: list[dict[str, Any]] = []
        for msg in to_message_dicts(final_models):
            ver = msg.get("version")
            if "createSurface" in msg:
                cs = msg["createSurface"]
                sid = cs["surfaceId"]
                if sid not in self._emitted_surfaces:
                    diff_dicts.append(msg)
                    self._emitted_surfaces.add(sid)
                    continue
                emitted_map = self._emitted_comps.get(sid, {})
                rem_comps = [
                    c for c in cs.get("components", []) if emitted_map.get(c["id"]) != c
                ]
                if rem_comps:
                    diff_dicts.append({
                        "version": ver,
                        "updateComponents": {
                            "surfaceId": sid,
                            "components": rem_comps,
                        },
                    })
                dm = cs.get("dataModel")
                if (
                    isinstance(dm, dict)
                    and dm
                    and self._emitted_root_data.get(sid) != dm
                ):
                    diff_dicts.append({
                        "version": ver,
                        "updateDataModel": {
                            "surfaceId": sid,
                            "path": "/",
                            "value": dm,
                        },
                    })
            elif "updateComponents" in msg:
                uc = msg["updateComponents"]
                sid = uc["surfaceId"]
                emitted_map = self._emitted_comps.get(sid, {})
                rem_comps = [
                    c for c in uc.get("components", []) if emitted_map.get(c["id"]) != c
                ]
                if rem_comps:
                    diff_dicts.append({
                        "version": ver,
                        "updateComponents": {
                            "surfaceId": sid,
                            "components": rem_comps,
                        },
                    })
            elif "updateDataModel" in msg:
                udm = msg["updateDataModel"]
                sid = udm["surfaceId"]
                if udm.get("path") == "/" and self._emitted_root_data.get(
                    sid
                ) == udm.get("value"):
                    continue
                diff_dicts.append(msg)
            else:
                diff_dicts.append(msg)

        with self._state.transaction():
            diff_models = to_message_models(diff_dicts) if diff_dicts else []
            if diff_models:
                self._apply(diff_models)
            self._state.check_topology(self._touched)
        if diff_models:
            parts.append(A2uiPart(a2ui=diff_models))

    def _apply(
        self, messages: Iterable[AgentToRendererMessage | Mapping[str, Any]]
    ) -> None:
        touched = self._state.apply(messages)
        self._touched.update(dict.fromkeys(touched))
