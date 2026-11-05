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

"""Catalog-agnostic compiler from A2UI XML markup to A2UI wire messages."""

from __future__ import annotations

from collections.abc import Container, Sequence
from dataclasses import dataclass, field
import json
import re
from typing import Any, Literal

from a2ui.core import CatalogApi
from a2ui.core.common import (
    is_at_least_version,
    is_valid_uax31_identifier,
    to_protocol_version,
)
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    check_mixed_catalogs,
    is_action_slot,
    surface_catalog_id,
    to_message_models,
)

from .errors import (
    A2uiXmlCompileDiagnostics,
    A2uiXmlParseError,
    A2uiXmlStrictViolation,
    A2uiXmlValidationError,
)
from .expressions import (
    CallExpr,
    CheckExpr,
    PathExpr,
    parse_attribute_value,
    parse_checks_attribute,
    parse_data_path,
    parse_expression,
    schema_accepts_type,
    schema_allows_databinding,
    to_json_pointer,
)
from .scanner import (
    ElementNode,
    FenceNode,
    A2uiXmlNode,
    ProseNode,
    parse_a2ui_xml_document,
)

_ARRAY_INDEX_RE = re.compile(r"^(?:0|[1-9][0-9]*)$")
_MAX_ARRAY_INDEX = 10_000
_STRUCTURAL_COMP_KEYS = frozenset({"component", "id", "catalogId", "checks"})

_RESERVED_COMPONENT_ATTRS = frozenset({
    "id",
    "slot",
    "catalogId",
    "template",
    "templateSlot",
})

_DROP_OPTIONAL = object()
_TIER_ENUM_RE = re.compile(r"^(?P<prefix>[a-zA-Z_-]*?)(?P<num>\d+)$")
_ACTION_HANDLER_ALIASES = frozenset({
    "onclick",
    "onpress",
    "ontap",
    "onaction",
    "onselect",
    "onsubmit",
})


def _normalize_identifier_key(name: str) -> str:
    """Normalizes tag or enum names for lenient case/kebab/prefix matching."""
    lowered = name.lower()
    for prefix in ("ui-", "ui_", "a2ui-", "a2ui_"):
        if lowered.startswith(prefix) and len(lowered) > len(prefix):
            lowered = lowered[len(prefix) :]
            break
    return re.sub(r"[-_]", "", lowered)


def _pluralize_identifier(name: str) -> list[str]:
    """Generates English plural identifier candidates for ``name``."""
    if not name:
        return []
    candidates: list[str] = [f"{name}s"]
    if len(name) >= 2 and name[-1] in ("y", "Y") and name[-2].lower() not in "aeiou":
        candidates.append(f"{name[:-1]}ies")
    if name.lower().endswith(("s", "x", "z", "ch", "sh")):
        candidates.append(f"{name}es")
    return candidates


def _singularize_stem(word: str) -> set[str]:
    """Returns normalized singular/plural stem variants for an identifier."""
    norm = _normalize_identifier_key(word)
    stems = {norm}
    if norm.endswith("ies") and len(norm) > 3:
        stems.add(f"{norm[:-3]}y")
    if norm.endswith("es") and len(norm) > 3:
        stems.add(norm[:-2])
    if norm.endswith("s") and len(norm) > 2:
        stems.add(norm[:-1])
    for suffix in ("items", "item", "options", "option", "entries", "entry"):
        if norm.endswith(suffix) and len(norm) > len(suffix):
            prefix = norm[: -len(suffix)]
            stems.add(prefix)
            stems.update({s for s in (suffix, suffix.rstrip("s")) if s})
    return stems


def _schema_ref_kind(schema: Any) -> str | None:
    """Returns ``'ChildList'``, ``'Child'``, or ``'Action'`` if referenced by ``schema``."""
    if not isinstance(schema, dict):
        return None
    ref = schema.get("$ref")
    if isinstance(ref, str):
        if "ChildList" in ref:
            return "ChildList"
        if "Child" in ref or "ComponentId" in ref:
            return "Child"
        if "Action" in ref:
            return "Action"
    for key in ("oneOf", "anyOf", "allOf"):
        subs = schema.get(key)
        if isinstance(subs, list):
            for sub in subs:
                found = _schema_ref_kind(sub)
                if found:
                    return found
    return None


def _get_effective_prop_kind(
    helper: CatalogSchemaHelper, comp_name: str, prop_name: str
) -> str | None:
    """Resolves ``'ChildList'``, ``'Child'``, or ``'Action'`` for a component property."""
    prop_schema = helper.get_property_schema(comp_name, prop_name)
    if is_action_slot(prop_schema):
        return "Action"
    prop_type = helper.get_property_type(comp_name, prop_name)
    if prop_type in ("Child", "ChildList"):
        return prop_type
    ref_kind = _schema_ref_kind(prop_schema)
    if ref_kind:
        return ref_kind
    if not helper.common_types_loaded and isinstance(prop_schema, dict):
        if prop_name == "child" and prop_schema.get("type") == "string":
            return "Child"
        if prop_name == "children" and prop_schema.get("type") == "array":
            return "ChildList"
    return None


def _schema_expects_option_objects(schema: Any) -> bool:
    """Checks whether ``schema`` expects ``Array<{label, value}>`` option items."""
    if not isinstance(schema, dict):
        return False
    items = schema.get("items")
    if isinstance(items, dict):
        props = items.get("properties")
        if isinstance(props, dict) and "label" in props and "value" in props:
            return True
    for key in ("allOf", "oneOf", "anyOf"):
        subs = schema.get(key)
        if isinstance(subs, list) and any(
            _schema_expects_option_objects(s) for s in subs
        ):
            return True
    return False


def _set_nested_data_path(
    root_map: dict[str, Any],
    pointer: str,
    val: Any,
    *,
    merge_root: bool = False,
) -> None:
    """Mutates ``root_map`` at JSON Pointer ``pointer`` (e.g. ``"/form/rep"``)."""
    clean = pointer.lstrip("/")
    if not clean:
        if not isinstance(val, dict):
            raise A2uiXmlValidationError(
                f"Root dataModel must be a JSON object, got {type(val).__name__}."
            )
        if not merge_root:
            root_map.clear()
        root_map.update(val)
        return

    segments = clean.split("/")
    cur: dict[str, Any] | list[Any] = root_map
    for idx, seg in enumerate(segments[:-1]):
        next_is_idx = bool(_ARRAY_INDEX_RE.match(segments[idx + 1]))
        if isinstance(cur, dict):
            existing = cur.get(seg)
            if existing is None:
                nxt: dict[str, Any] | list[Any] = [] if next_is_idx else {}
                cur[seg] = nxt
                cur = nxt
            elif isinstance(existing, (dict, list)):
                cur = existing
            else:
                raise A2uiXmlValidationError(
                    f"Cannot traverse through primitive segment {seg!r} in path"
                    f" {pointer!r}."
                )
        else:
            if not _ARRAY_INDEX_RE.match(seg):
                raise A2uiXmlValidationError(
                    f"Non-numeric array segment {seg!r} in path {pointer!r}."
                )
            arr_i = int(seg)
            if arr_i > _MAX_ARRAY_INDEX:
                raise A2uiXmlValidationError(f"Array index {arr_i} exceeds limit.")
            while len(cur) <= arr_i:
                cur.append(None)
            if cur[arr_i] is None:
                nxt = [] if next_is_idx else {}
                cur[arr_i] = nxt
                cur = nxt
            elif isinstance(cur[arr_i], (dict, list)):
                cur = cur[arr_i]
            else:
                raise A2uiXmlValidationError(
                    f"Cannot traverse through primitive array element {arr_i} in"
                    f" {pointer!r}."
                )

    last = segments[-1]
    if isinstance(cur, dict):
        cur[last] = val
        return
    if not _ARRAY_INDEX_RE.match(last):
        raise A2uiXmlValidationError(
            f"Non-numeric array segment {last!r} in path {pointer!r}."
        )
    arr_i = int(last)
    if arr_i > _MAX_ARRAY_INDEX:
        raise A2uiXmlValidationError(f"Array index {arr_i} exceeds limit.")
    while len(cur) <= arr_i:
        cur.append(None)
    cur[arr_i] = val


@dataclass
class _KnownSurfaceSet:
    """Tracks surface membership against an arbitrary ``Container[str]``."""

    existing: Container[str]
    added: set[str] = field(default_factory=set)
    deleted: set[str] = field(default_factory=set)

    def __contains__(self, surface_id: object) -> bool:
        if not isinstance(surface_id, str):
            return False
        if surface_id in self.added:
            return True
        if surface_id in self.deleted:
            return False
        return surface_id in self.existing

    def add(self, surface_id: str) -> None:
        self.deleted.discard(surface_id)
        self.added.add(surface_id)

    def discard(self, surface_id: str) -> None:
        self.added.discard(surface_id)
        self.deleted.add(surface_id)


@dataclass
class _DataEntry:
    """A data-model assignment collected within a surface scope."""

    pointer: str
    value: Any


@dataclass
class _SurfaceWorkUnit:
    """Tracks components, data updates, and metadata for one surface block."""

    surface_id: str
    has_explicit_surface: bool = False
    is_implicit_header: bool = False
    is_update: bool = False
    send_data_model: bool | None = None
    extensions: dict[str, Any] | None = None
    top_nodes: list[A2uiXmlNode] = field(default_factory=list)
    data_entries: list[_DataEntry] = field(default_factory=list)


@dataclass
class _CompileContext:
    """Mutable per-surface compilation state."""

    version: str
    at_least_v10: bool
    path_key: str
    call_key: str
    strict: bool
    violations: list[A2uiXmlStrictViolation]
    tuned: bool = False
    used_ids: set[str] = field(default_factory=set)
    id_counter: int = 0
    call_counter: int = 0
    active_value_binding: dict[str, Any] | None = None
    lifted_data_entries: list[_DataEntry] = field(default_factory=list)

    def allocate_id(self, preferred: str | None = None) -> str:
        if preferred is not None:
            if preferred in self.used_ids:
                raise A2uiXmlValidationError(f"Duplicate component ID {preferred!r}.")
            self.used_ids.add(preferred)
            return preferred
        while True:
            self.id_counter += 1
            candidate = f"c{self.id_counter}"
            if candidate not in self.used_ids:
                self.used_ids.add(candidate)
                return candidate


class A2uiXmlCompiler:
    """Compiles A2UI XML markup into A2UI messages across v0.9, v0.9.1, and v1.0.

    All component names, child slots, action slots, check rules, and function
    signatures are discovered dynamically from ``CatalogApi`` via
    ``CatalogSchemaHelper``.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        *,
        strict: bool = False,
        tuned: bool = False,
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self._strict = strict
        self._tuned = tuned
        self.helpers: dict[str, CatalogSchemaHelper] = build_catalog_helpers(
            self._catalogs
        )
        self._known_functions: set[str] = {
            fn for helper in self.helpers.values() for fn in helper.functions
        }

    @property
    def catalogs(self) -> list[CatalogApi]:
        """Returns a copy of the active catalogs."""
        return list(self._catalogs)

    @property
    def strict(self) -> bool:
        """Whether Six-Laws strict mode is active by default."""
        return self._strict

    @property
    def tuned(self) -> bool:
        """Whether best-of-breed tuned A2UI XML healing is active."""
        return self._tuned

    def _resolve_version(self, version: str | None) -> tuple[str, bool]:
        cat_ver = catalogs_protocol_version(self._catalogs)
        if version is not None:
            wire = to_protocol_version(version).value
        else:
            wire = cat_ver
        at_least_v10 = is_at_least_version(wire, ProtocolVersion.V1_0)
        if len(self._catalogs) > 1 and not at_least_v10:
            raise A2uiXmlValidationError(
                "Multiple catalogs require A2UI protocol v1.0 or later."
            )
        return wire, at_least_v10

    def validate_strict(
        self,
        content: str,
        *,
        surface_id: str = "main",
        version: str | None = None,
    ) -> tuple[bool, list[A2uiXmlStrictViolation]]:
        """Checks whether ``content`` compiles cleanly with zero Six-Laws violations."""
        try:
            diag = self.compile_with_diagnostics(
                content, surface_id=surface_id, version=version, strict=False
            )
            return diag.strict_valid, list(diag.strict_violations)
        except (A2uiXmlParseError, A2uiXmlValidationError) as exc:
            return False, [
                A2uiXmlStrictViolation(law="compile_error", message=str(exc))
            ]

    def compile(
        self,
        content: str,
        surface_id: str = "main",
        version: str | None = None,
        *,
        is_final: bool = True,
        existing_surfaces: Container[str] = (),
        strict: bool | None = None,
    ) -> list[AgentToRendererMessage]:
        """Compiles A2UI XML text into validated ``AgentToRendererMessage`` models."""
        diag = self.compile_with_diagnostics(
            content,
            surface_id=surface_id,
            version=version,
            is_final=is_final,
            existing_surfaces=existing_surfaces,
            strict=self._strict if strict is None else strict,
        )
        return diag.messages

    def compile_with_diagnostics(
        self,
        content: str,
        *,
        surface_id: str = "main",
        version: str | None = None,
        is_final: bool = True,
        existing_surfaces: Container[str] = (),
        strict: bool | None = None,
    ) -> A2uiXmlCompileDiagnostics:
        """Compiles A2UI XML text and returns both messages and Six-Laws diagnostics."""
        use_strict = self._strict if strict is None else strict
        wire_ver, at_least_v10 = self._resolve_version(version)
        doc = parse_a2ui_xml_document(
            content,
            is_final=is_final,
            strict=use_strict,
            tuned=self._tuned,
        )

        ctx = _CompileContext(
            version=wire_ver,
            at_least_v10=at_least_v10,
            path_key="@path" if at_least_v10 else "path",
            call_key="@call" if at_least_v10 else "call",
            strict=use_strict,
            violations=list(doc.violations),
            tuned=self._tuned,
        )

        raw_messages = self._compile_document_nodes(
            doc.children,
            default_surface_id=surface_id,
            existing_surfaces=existing_surfaces,
            ctx=ctx,
        )

        if use_strict and ctx.violations:
            first = ctx.violations[0]
            loc = f" (line {first.line})" if first.line is not None else ""
            raise A2uiXmlParseError(f"[{first.law}]{loc} {first.message}")

        return A2uiXmlCompileDiagnostics(
            messages=to_message_models(raw_messages),
            strict_violations=tuple(ctx.violations),
        )

    # ---------------------------------------------------------------------------
    # Dynamic Catalog Discovery (100% Catalog-Agnostic)
    # ---------------------------------------------------------------------------

    def _defines_exact(
        self,
        kind: Literal["component", "function"],
        name: str,
        catalog_id: str | None = None,
    ) -> bool:
        if catalog_id is not None:
            helper = self.helpers.get(catalog_id)
            if helper is None:
                return False
            pool = helper.components if kind == "component" else helper.functions
            return name in pool
        return bool(catalogs_defining(self.helpers, kind, name))

    @staticmethod
    def _has_declared_property(
        properties: list[str], raw_prop: str, *, strict: bool = False
    ) -> bool:
        if not raw_prop:
            return False
        if raw_prop in properties:
            return True
        if not strict:
            norm = _normalize_identifier_key(raw_prop)
            return any(_normalize_identifier_key(p) == norm for p in properties)
        return False

    def _element_declares_property(
        self, elem: ElementNode, raw_prop: str, *, strict: bool = False
    ) -> bool:
        if not raw_prop:
            return False
        cat_id = elem.attrs.get("catalogId")
        helpers_iter = (
            [self.helpers[cat_id]]
            if cat_id and cat_id in self.helpers
            else list(self.helpers.values())
        )
        for helper in helpers_iter:
            if elem.tag in helper.components:
                props = helper.get_component_properties(elem.tag)
                if self._has_declared_property(props, raw_prop, strict=strict):
                    return True
            elif not strict:
                tag_norm = _normalize_identifier_key(elem.tag)
                for cand in helper.components:
                    if _normalize_identifier_key(cand) == tag_norm:
                        props = helper.get_component_properties(cand)
                        if self._has_declared_property(props, raw_prop, strict=strict):
                            return True
        return False

    def _extract_parent_slot(
        self, child: A2uiXmlNode, *, strict: bool = False
    ) -> str | None:
        if not isinstance(child, ElementNode):
            return None
        if self._element_declares_property(child, "slot", strict=strict):
            return child.attrs.get("parentSlot")
        return child.attrs.get("slot")

    def _resolve_catalog_entry(
        self,
        kind: Literal["component", "function"],
        raw_name: str,
        explicit_catalog_id: str | None,
        ctx: _CompileContext,
        *,
        line: int | None = None,
    ) -> tuple[str, CatalogSchemaHelper, str | None]:
        """Resolves ``(canonical_name, helper, write_catalog_id)`` across active catalogs."""
        if explicit_catalog_id is not None:
            if not ctx.at_least_v10:
                raise A2uiXmlValidationError(
                    "A2UI v0.9 only allows catalogId on the surface. Per-component"
                    " and per-function catalogId requires A2UI v1.0+."
                )
            helper = self.helpers.get(explicit_catalog_id)
            if helper is None:
                raise A2uiXmlValidationError(
                    f"Unknown catalogId {explicit_catalog_id!r} for {kind}"
                    f" {raw_name!r}. Active catalogs: {list(self.helpers)}"
                )
            pool = helper.components if kind == "component" else helper.functions
            if raw_name in pool:
                return raw_name, helper, explicit_catalog_id
            if not ctx.strict:
                target_norm = _normalize_identifier_key(raw_name)
                matches = [
                    cand
                    for cand in pool
                    if _normalize_identifier_key(cand) == target_norm
                ]
                if len(matches) == 1:
                    ctx.violations.append(
                        A2uiXmlStrictViolation(
                            law="law3_name_normalization",
                            message=(
                                f"Normalized {kind} {raw_name!r} to {matches[0]!r}."
                            ),
                            line=line,
                        )
                    )
                    return matches[0], helper, explicit_catalog_id
            raise A2uiXmlValidationError(
                f"Catalog {explicit_catalog_id!r} does not define {kind} {raw_name!r}."
            )

        exact_cats = catalogs_defining(self.helpers, kind, raw_name)
        if len(exact_cats) == 1:
            cat_id = exact_cats[0]
            write_cat = cat_id if len(self._catalogs) > 1 else None
            return raw_name, self.helpers[cat_id], write_cat
        if len(exact_cats) > 1:
            raise A2uiXmlValidationError(
                f"Ambiguous {kind} {raw_name!r} is defined in multiple catalogs"
                f' ({exact_cats}); specify catalogId="...".'
            )

        if not ctx.strict:
            target_norm = _normalize_identifier_key(raw_name)
            lenient_hits: list[tuple[str, str]] = []
            for cat_id, helper in self.helpers.items():
                pool = helper.components if kind == "component" else helper.functions
                for cand in pool:
                    if _normalize_identifier_key(cand) == target_norm:
                        lenient_hits.append((cat_id, cand))
            if len(lenient_hits) == 1:
                cat_id, canonical = lenient_hits[0]
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="law3_name_normalization",
                        message=f"Normalized {kind} {raw_name!r} to {canonical!r}.",
                        line=line,
                    )
                )
                write_cat = cat_id if len(self._catalogs) > 1 else None
                return canonical, self.helpers[cat_id], write_cat
            if len(lenient_hits) > 1:
                raise A2uiXmlValidationError(
                    f"Ambiguous {kind} {raw_name!r} matches multiple catalog entries:"
                    f" {lenient_hits}."
                )

        available = sorted({
            item
            for h in self.helpers.values()
            for item in (h.components if kind == "component" else h.functions)
        })
        raise A2uiXmlValidationError(
            f"Unknown {kind} {raw_name!r}. Available {kind}s: {available}"
        )

    def _find_layout_list_container(
        self,
    ) -> tuple[str, str, CatalogSchemaHelper, str | None] | None:
        """Dynamically discovers a vertical/default ``ChildList`` container component."""
        best: tuple[int, str, str, CatalogSchemaHelper, str | None] | None = None
        for cat_id, helper in self.helpers.items():
            write_cat = cat_id if len(self._catalogs) > 1 else None
            for comp_name in helper.components:
                props = helper.get_component_properties(comp_name)
                reqs = (
                    set(helper.get_component_required(comp_name))
                    - _STRUCTURAL_COMP_KEYS
                )
                list_props = [
                    p
                    for p in props
                    if _get_effective_prop_kind(helper, comp_name, p) == "ChildList"
                ]
                if not list_props:
                    continue
                child_list_prop = list_props[0]
                if reqs - {child_list_prop}:
                    continue
                # Score purely from schema descriptions/enums without hardcoding names
                desc = (helper.get_component_description(comp_name) or "").lower()
                score = 1
                if (
                    "vertical" in desc
                    and "arranges its children horizontally" not in desc
                ):
                    score = 3
                elif "horizontally" not in desc:
                    score = 2
                if best is None or score > best[0]:
                    best = (score, comp_name, child_list_prop, helper, write_cat)
        if best is None:
            return None
        return best[1], best[2], best[3], best[4]

    def _find_text_leaf_component(
        self,
    ) -> tuple[str, str, CatalogSchemaHelper, str | None] | None:
        """Dynamically discovers a single-string text leaf component for Law 3 prose."""
        best: tuple[int, str, str, CatalogSchemaHelper, str | None] | None = None
        for cat_id, helper in self.helpers.items():
            write_cat = cat_id if len(self._catalogs) > 1 else None
            for comp_name in helper.components:
                props = helper.get_component_properties(comp_name)
                if any(
                    _get_effective_prop_kind(helper, comp_name, p) is not None
                    for p in props
                ):
                    continue
                reqs = [
                    p
                    for p in helper.get_component_required(comp_name)
                    if p not in _STRUCTURAL_COMP_KEYS
                ]
                if len(reqs) != 1:
                    continue
                req_prop = reqs[0]
                p_schema = helper.get_property_schema(comp_name, req_prop)
                if helper.get_property_enum(comp_name, req_prop):
                    continue
                if not schema_accepts_type(p_schema, "string") or schema_accepts_type(
                    p_schema, "boolean"
                ):
                    continue
                prop_desc = (
                    p_schema.get("description", "")
                    if isinstance(p_schema, dict)
                    else ""
                ).lower()
                score = 1
                if "url" not in prop_desc and "uri" not in prop_desc:
                    score = 3
                if self._tuned:
                    comp_desc = (
                        helper.get_component_description(comp_name) or ""
                    ).lower()
                    prop_low = req_prop.lower()
                    name_low = comp_name.lower()
                    if prop_low in (
                        "text",
                        "markdown",
                        "content",
                        "body",
                        "paragraph",
                    ):
                        score += 10
                    if any(
                        kw in comp_desc or kw in prop_desc
                        for kw in (
                            "markdown",
                            "typography",
                            "paragraph",
                            "body copy",
                            "heading",
                            "text content",
                        )
                    ):
                        score += 6
                    if "text" in name_low:
                        score += 4
                    if prop_low in (
                        "icon",
                        "glyph",
                        "symbol",
                        "src",
                        "url",
                        "href",
                        "image",
                        "alt",
                    ):
                        score -= 15
                    if any(
                        kw in comp_desc or kw in prop_desc
                        for kw in (
                            "icon",
                            "glyph",
                            "symbol",
                            "image",
                            "audio",
                            "video",
                        )
                    ):
                        score -= 10
                if best is None or score > best[0]:
                    best = (score, comp_name, req_prop, helper, write_cat)
        if best is None:
            return None
        return best[1], best[2], best[3], best[4]

    def _find_divider_component(
        self,
    ) -> tuple[str, CatalogSchemaHelper, str | None] | None:
        """Dynamically discovers a zero-required-arg leaf divider component."""
        if not self._tuned:
            for cat_id, helper in self.helpers.items():
                write_cat = cat_id if len(self._catalogs) > 1 else None
                for comp_name in helper.components:
                    props = helper.get_component_properties(comp_name)
                    if any(
                        _get_effective_prop_kind(helper, comp_name, p) is not None
                        for p in props
                    ):
                        continue
                    reqs = [
                        p
                        for p in helper.get_component_required(comp_name)
                        if p not in _STRUCTURAL_COMP_KEYS
                    ]
                    if not reqs:
                        return comp_name, helper, write_cat
            return None

        best: tuple[int, str, CatalogSchemaHelper, str | None] | None = None
        for cat_id, helper in self.helpers.items():
            write_cat = cat_id if len(self._catalogs) > 1 else None
            for comp_name in helper.components:
                props = helper.get_component_properties(comp_name)
                if any(
                    _get_effective_prop_kind(helper, comp_name, p) is not None
                    for p in props
                ):
                    continue
                reqs = [
                    p
                    for p in helper.get_component_required(comp_name)
                    if p not in _STRUCTURAL_COMP_KEYS
                ]
                if reqs:
                    continue
                comp_desc = (helper.get_component_description(comp_name) or "").lower()
                name_low = comp_name.lower()
                score = 1
                if any(
                    kw in comp_desc or kw in name_low
                    for kw in (
                        "divider",
                        "separator",
                        "horizontal rule",
                        "thematic",
                    )
                ):
                    score += 20
                if any(
                    k in props for k in ("axis", "vertical", "orientation", "inset")
                ):
                    score += 5
                if helper.is_checkable(comp_name) or "checks" in props:
                    score -= 20
                if any(
                    k in props
                    for k in (
                        "checked",
                        "value",
                        "selected",
                        "options",
                        "label",
                        "placeholder",
                        "indeterminate",
                        "mode",
                    )
                ):
                    score -= 15
                if any(
                    kw in comp_desc
                    for kw in (
                        "checkbox",
                        "toggle",
                        "radio",
                        "spinner",
                        "progress",
                        "input",
                        "selection control",
                    )
                ):
                    score -= 15
                if best is None or score > best[0]:
                    best = (score, comp_name, helper, write_cat)
        if best is None:
            return None
        return best[1], best[2], best[3]

    # ---------------------------------------------------------------------------
    # Top-Level Document & Surface Scope Compilation
    # ---------------------------------------------------------------------------

    def _is_reserved_directive(self, elem: ElementNode) -> str | None:
        """Returns normalized directive kind if ``elem`` is a built-in A2UI XML directive."""
        cat_id = elem.attrs.get("catalogId")
        if self._defines_exact("component", elem.tag, cat_id):
            return None
        lower = _normalize_identifier_key(elem.tag)
        if lower == "surface":
            return "Surface"
        if lower == "datamodel":
            return "DataModel"
        if lower == "deletesurface":
            return "DeleteSurface"
        if lower in ("callfunction", "callrendererfunction"):
            return "CallFunction"
        if lower == "extensions":
            return "Extensions"
        return None

    def _compile_document_nodes(
        self,
        nodes: list[A2uiXmlNode],
        *,
        default_surface_id: str,
        existing_surfaces: Container[str],
        ctx: _CompileContext,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        current_unit: _SurfaceWorkUnit | None = None
        known_surfaces = _KnownSurfaceSet(existing_surfaces)

        has_standalone_ops = any(
            isinstance(n, ElementNode)
            and self._is_reserved_directive(n) in ("DeleteSurface", "CallFunction")
            for n in nodes
        )

        def flush_current() -> None:
            nonlocal current_unit
            if current_unit is None:
                return
            if (
                ctx.tuned
                and not ctx.strict
                and current_unit.is_implicit_header
                and not current_unit.top_nodes
                and not current_unit.data_entries
                and not current_unit.is_update
                and current_unit.send_data_model is None
                and (has_standalone_ops or bool(messages))
            ):
                current_unit = None
                return
            if (
                current_unit.top_nodes
                or current_unit.data_entries
                or current_unit.has_explicit_surface
            ):
                emitted = self._compile_surface_unit(
                    current_unit, known_surfaces=known_surfaces, ctx=ctx
                )
                messages.extend(emitted)
            current_unit = None

        def ensure_unit() -> _SurfaceWorkUnit:
            nonlocal current_unit
            if current_unit is None:
                current_unit = _SurfaceWorkUnit(surface_id=default_surface_id)
            return current_unit

        for node in nodes:
            if isinstance(node, ElementNode):
                directive = self._is_reserved_directive(node)
                if directive == "DeleteSurface":
                    flush_current()
                    del_id = (
                        node.attrs.get("id")
                        or node.attrs.get("surface")
                        or node.attrs.get("surfaceId")
                    )
                    if not del_id:
                        raise A2uiXmlValidationError(
                            f'<DeleteSurface> on line {node.line} requires an id="..."'
                            " attribute."
                        )
                    known_surfaces.discard(del_id)
                    messages.append(
                        {"version": ctx.version, "deleteSurface": {"surfaceId": del_id}}
                    )
                    continue

                if directive == "CallFunction":
                    flush_current()
                    messages.append(self._compile_standalone_call(node, ctx))
                    continue

                if directive == "Surface":
                    flush_current()
                    unit = self._parse_surface_element(
                        node, default_surface_id=default_surface_id, ctx=ctx
                    )
                    if node.self_closing or not node.children:
                        current_unit = unit
                    else:
                        # Wrapping `<Surface ...>...</Surface>`
                        sub_msgs = self._compile_wrapped_surface(
                            unit,
                            node.children,
                            known_surfaces=known_surfaces,
                            ctx=ctx,
                        )
                        messages.extend(sub_msgs)
                    continue

                if directive == "DataModel":
                    unit = ensure_unit()
                    unit.data_entries.append(self._parse_data_model_element(node, ctx))
                    continue

                if directive == "Extensions":
                    unit = ensure_unit()
                    unit.extensions = self._parse_extensions_element(node, ctx)
                    continue

            if isinstance(node, FenceNode):
                info_norm = node.info.strip().lower()
                if node.lang.lower() == "json" and (
                    not info_norm
                    or info_norm in ("datamodel", "data", "data_model")
                    or node.info.strip().startswith(("/", "$"))
                ):
                    unit = ensure_unit()
                    unit.data_entries.append(self._parse_data_model_fence(node))
                    continue
                if node.lang.lower() == "json" and info_norm == "extensions":
                    unit = ensure_unit()
                    unit.extensions = self._parse_extensions_json(
                        node.content, line=node.line, ctx=ctx
                    )
                    continue

            unit = ensure_unit()
            unit.top_nodes.append(node)

        flush_current()
        return messages

    def _parse_bool_flag(
        self, raw: str | None, attr_name: str, line: int, ctx: _CompileContext
    ) -> bool:
        if raw is None:
            return False
        candidate = raw
        if (
            ctx.tuned
            and not ctx.strict
            and len(candidate.strip()) >= 2
            and candidate.strip().startswith("{")
            and candidate.strip().endswith("}")
        ):
            inner = candidate.strip()[1:-1].strip()
            if inner.lower() in ("true", "false"):
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="law5_double_quotes",
                        message=f"JSX brace boolean {attr_name}={raw!r} unwrapped.",
                        line=line,
                    )
                )
                candidate = inner
        if candidate == "true":
            return True
        if candidate == "false":
            return False
        if not ctx.strict and candidate.lower() in ("true", "false"):
            ctx.violations.append(
                A2uiXmlStrictViolation(
                    law="law5_bool_case",
                    message=f"Boolean {attr_name}={raw!r} normalized to lowercase.",
                    line=line,
                )
            )
            return candidate.lower() == "true"
        raise A2uiXmlValidationError(
            f"Attribute {attr_name!r} on line {line} must be 'true' or 'false',"
            f" got {raw!r}."
        )

    def _parse_surface_element(
        self,
        node: ElementNode,
        *,
        default_surface_id: str,
        ctx: _CompileContext,
    ) -> _SurfaceWorkUnit:
        surf_id = (
            node.attrs.get("id")
            or node.attrs.get("surface")
            or node.attrs.get("surfaceId")
            or default_surface_id
        )
        is_update = self._parse_bool_flag(
            node.attrs.get("update"), "update", node.line, ctx
        )
        send_dm: bool | None = None
        if "sendDataModel" in node.attrs:
            send_dm = self._parse_bool_flag(
                node.attrs.get("sendDataModel"), "sendDataModel", node.line, ctx
            )
        if "catalogId" in node.attrs:
            surf_cat = node.attrs["catalogId"]
            if len(self._catalogs) > 1:
                raise A2uiXmlValidationError(
                    "Surface cannot specify catalogId when multiple catalogs are"
                    " active; specify catalogId per component or function instead."
                )
            if surf_cat not in self.helpers:
                raise A2uiXmlValidationError(
                    f"Unknown catalogId {surf_cat!r} on <Surface> (line"
                    f" {node.line}). Active catalogs: {list(self.helpers)}"
                )
        extra_data_entries: list[_DataEntry] = []
        for k, raw_val in node.attrs.items():
            if k in (
                "id",
                "surface",
                "surfaceId",
                "update",
                "sendDataModel",
                "catalogId",
            ):
                continue
            if (
                ctx.tuned
                and not ctx.strict
                and _normalize_identifier_key(k) == "datamodel"
            ):
                parsed_dm = self._parse_inline_datamodel_attr(
                    raw_val, line=node.line, ctx=ctx
                )
                if parsed_dm is not None:
                    extra_data_entries.append(_DataEntry(pointer="/", value=parsed_dm))
                    continue
            if ctx.tuned and not ctx.strict:
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="unknown_optional_attr_dropped",
                        message=f"Dropped unknown attribute {k!r} on <Surface>.",
                        line=node.line,
                    )
                )
                continue
            raise A2uiXmlValidationError(
                f"Unsupported attribute {k!r} on <Surface> (line {node.line})."
            )
        return _SurfaceWorkUnit(
            surface_id=surf_id,
            has_explicit_surface=True,
            is_implicit_header=bool(node.self_closing and not node.children),
            is_update=is_update,
            send_data_model=send_dm,
            data_entries=extra_data_entries,
        )

    def _parse_inline_datamodel_attr(
        self, raw_val: str, *, line: int, ctx: _CompileContext
    ) -> dict[str, Any] | None:
        """Parses a ``dataModel='{...}'`` attribute into a surface data object."""
        stripped = raw_val.strip()
        if len(stripped) >= 2 and stripped.startswith("{") and stripped.endswith("}"):
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                inner = stripped[1:-1].strip()
                try:
                    parsed = json.loads(inner) if inner.startswith("{") else None
                except json.JSONDecodeError:
                    parsed = None
            if isinstance(parsed, dict):
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="law4_datamodel_attr",
                        message=(
                            "Healed inline dataModel attribute into surface dataModel."
                        ),
                        line=line,
                    )
                )
                return parsed
        return None

    def _compile_wrapped_surface(
        self,
        unit: _SurfaceWorkUnit,
        children: list[A2uiXmlNode],
        *,
        known_surfaces: _KnownSurfaceSet,
        ctx: _CompileContext,
    ) -> list[dict[str, Any]]:
        extra_msgs: list[dict[str, Any]] = []
        for child in children:
            if isinstance(child, ElementNode):
                directive = self._is_reserved_directive(child)
                if directive == "DataModel":
                    unit.data_entries.append(self._parse_data_model_element(child, ctx))
                    continue
                if directive == "Extensions":
                    unit.extensions = self._parse_extensions_element(child, ctx)
                    continue
                if directive == "DeleteSurface":
                    del_id = (
                        child.attrs.get("id")
                        or child.attrs.get("surface")
                        or child.attrs.get("surfaceId")
                        or unit.surface_id
                    )
                    known_surfaces.discard(del_id)
                    extra_msgs.append(
                        {"version": ctx.version, "deleteSurface": {"surfaceId": del_id}}
                    )
                    continue
                if directive == "CallFunction":
                    extra_msgs.append(self._compile_standalone_call(child, ctx))
                    continue
            elif isinstance(child, FenceNode) and child.lang.lower() == "json":
                info_norm = child.info.strip().lower()
                if (
                    not info_norm
                    or info_norm in ("datamodel", "data", "data_model")
                    or child.info.strip().startswith(("/", "$"))
                ):
                    unit.data_entries.append(self._parse_data_model_fence(child))
                    continue
                if info_norm == "extensions":
                    unit.extensions = self._parse_extensions_json(
                        child.content, line=child.line, ctx=ctx
                    )
                    continue
            unit.top_nodes.append(child)

        surface_msgs = self._compile_surface_unit(
            unit, known_surfaces=known_surfaces, ctx=ctx
        )
        return [*surface_msgs, *extra_msgs]

    def _parse_data_model_element(
        self, node: ElementNode, ctx: _CompileContext
    ) -> _DataEntry:
        raw_path = node.attrs.get("path", "/")
        pointer = to_json_pointer(raw_path)
        fences = [c for c in node.children if isinstance(c, FenceNode)]
        if fences:
            try:
                value = json.loads(fences[0].content)
            except json.JSONDecodeError as exc:
                raise A2uiXmlParseError(
                    f"Invalid JSON inside <DataModel> fence on line {fences[0].line}:"
                    f" {exc}"
                ) from exc
            return _DataEntry(pointer=pointer, value=value)

        if "value" in node.attrs:
            raw_val = node.attrs["value"]
            stripped = raw_val.strip()
            if stripped in ("true", "false", "null") or stripped.startswith(("[", "{")):
                try:
                    return _DataEntry(pointer=pointer, value=json.loads(stripped))
                except json.JSONDecodeError:
                    pass
            try:
                if re.match(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$", stripped):
                    num_val: int | float = (
                        float(stripped)
                        if any(c in stripped for c in ".eE")
                        else int(stripped)
                    )
                    return _DataEntry(pointer=pointer, value=num_val)
            except ValueError:
                pass
            return _DataEntry(pointer=pointer, value=raw_val)

        prose_parts = [
            c.text for c in node.children if isinstance(c, ProseNode) and c.text
        ]
        if prose_parts:
            joined = "\n".join(prose_parts)
            if not ctx.strict:
                try:
                    ctx.violations.append(
                        A2uiXmlStrictViolation(
                            law="law4_fence_safety",
                            message="Wrap JSON inside <DataModel> in a ```json fence.",
                            line=node.line,
                        )
                    )
                    return _DataEntry(pointer=pointer, value=json.loads(joined))
                except json.JSONDecodeError as exc:
                    raise A2uiXmlParseError(
                        f"Invalid JSON in <DataModel> on line {node.line}: {exc}"
                    ) from exc
        raise A2uiXmlParseError(
            f"<DataModel> on line {node.line} requires a ```json fenced block or"
            ' value="..." attribute.'
        )

    def _parse_data_model_fence(self, fence: FenceNode) -> _DataEntry:
        info = fence.info.strip()
        if info and info.lower() not in ("datamodel", "data", "data_model"):
            pointer = to_json_pointer(info)
        else:
            pointer = "/"
        try:
            val = json.loads(fence.content)
        except json.JSONDecodeError as exc:
            raise A2uiXmlParseError(
                f"Invalid JSON in dataModel fence on line {fence.line}: {exc}"
            ) from exc
        return _DataEntry(pointer=pointer, value=val)

    def _parse_extensions_element(
        self, node: ElementNode, ctx: _CompileContext
    ) -> dict[str, Any]:
        fences = [c for c in node.children if isinstance(c, FenceNode)]
        if not fences:
            raise A2uiXmlParseError(
                f"<Extensions> on line {node.line} requires a ```json fenced block."
            )
        return self._parse_extensions_json(fences[0].content, line=node.line, ctx=ctx)

    def _parse_extensions_json(
        self, raw_json: str, *, line: int, ctx: _CompileContext
    ) -> dict[str, Any]:
        if not ctx.at_least_v10:
            raise A2uiXmlValidationError(
                f"Extensions require A2UI v1.0 or later (target is {ctx.version})."
            )
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise A2uiXmlParseError(
                f"Invalid JSON in extensions block on line {line}: {exc}"
            ) from exc
        if not isinstance(parsed, dict):
            raise A2uiXmlValidationError("Extensions payload must be a JSON object.")
        for key in parsed:
            if not isinstance(key, str) or not is_valid_uax31_identifier(key):
                raise A2uiXmlValidationError(
                    f"Extension key {key!r} is not a valid UAX #31 identifier."
                )
        return parsed

    def _compile_surface_unit(
        self,
        unit: _SurfaceWorkUnit,
        *,
        known_surfaces: _KnownSurfaceSet,
        ctx: _CompileContext,
    ) -> list[dict[str, Any]]:
        ctx.used_ids.clear()
        ctx.id_counter = 0
        ctx.lifted_data_entries.clear()

        # Pre-claim all explicit component IDs in this surface scope
        self._collect_explicit_ids(unit.top_nodes, ctx)

        compiled_components: list[dict[str, Any]] = []
        top_ids: list[str] = []

        has_explicit_root = "root" in ctx.used_ids
        is_surface_already_created = unit.surface_id in known_surfaces
        should_create = not unit.is_update and (
            has_explicit_root
            or (not is_surface_already_created and bool(unit.top_nodes))
        )

        if (
            should_create
            and not has_explicit_root
            and len(unit.top_nodes) == 1
            and isinstance(unit.top_nodes[0], ElementNode)
            and "id" not in unit.top_nodes[0].attrs
        ):
            # Law 1: single top-level component becomes `id="root"` directly
            root_id = ctx.allocate_id("root")
            root_comp, descendants = self._compile_component_node(
                unit.top_nodes[0], ctx, forced_id=root_id
            )
            compiled_components.append(root_comp)
            compiled_components.extend(descendants)
            top_ids.append(root_id)
        else:
            top_idx = 0
            for node in unit.top_nodes:
                if isinstance(node, ElementNode) and "id" not in node.attrs:
                    while True:
                        top_idx += 1
                        cand_top = f"r{top_idx}"
                        if cand_top not in ctx.used_ids:
                            ctx.used_ids.add(cand_top)
                            break
                    t_comp, t_desc = self._compile_component_node(
                        node, ctx, forced_id=cand_top
                    )
                    top_ids.append(cand_top)
                    compiled_components.append(t_comp)
                    compiled_components.extend(t_desc)
                else:
                    cid, comps = self._compile_flow_node(node, ctx)
                    if cid is not None:
                        top_ids.append(cid)
                        compiled_components.extend(comps)

            # Law 1: multiple top-level items (or prose/single item with non-root id)
            # synthesize an implicit root container when creating a surface.
            if (
                should_create
                and top_ids
                and not any(c.get("id") == "root" for c in compiled_components)
            ):
                container_info = self._find_layout_list_container()
                if container_info is None:
                    raise A2uiXmlValidationError(
                        "Multiple top-level components require a catalog layout"
                        " container with a ChildList property to synthesize 'root'."
                    )
                cont_name, list_prop, _, write_cat = container_info
                root_id = ctx.allocate_id("root")
                synth_root: dict[str, Any] = {
                    "id": root_id,
                    "component": cont_name,
                    list_prop: top_ids,
                }
                if write_cat is not None:
                    synth_root["catalogId"] = write_cat
                compiled_components.insert(0, synth_root)

        all_data_entries = [*unit.data_entries, *ctx.lifted_data_entries]

        if not should_create:
            if unit.extensions is not None:
                raise A2uiXmlValidationError(
                    "Surface update cannot specify createSurface extensions."
                )
            out_msgs: list[dict[str, Any]] = []
            if compiled_components:
                out_msgs.append({
                    "version": ctx.version,
                    "updateComponents": {
                        "surfaceId": unit.surface_id,
                        "components": compiled_components,
                    },
                })
            for entry in all_data_entries:
                if entry.pointer == "/" and not isinstance(entry.value, dict):
                    raise A2uiXmlValidationError(
                        "Root dataModel update at '/' must be a JSON object."
                    )
                out_msgs.append({
                    "version": ctx.version,
                    "updateDataModel": {
                        "surfaceId": unit.surface_id,
                        "path": entry.pointer,
                        "value": entry.value,
                    },
                })
            if not out_msgs:
                raise A2uiXmlValidationError(
                    f"Surface {unit.surface_id!r} block contains no components or data"
                    " updates."
                )
            return out_msgs

        if not compiled_components or not any(
            c.get("id") == "root" for c in compiled_components
        ):
            raise A2uiXmlValidationError(
                f"Surface {unit.surface_id!r} creation requires at least one root"
                " component."
            )

        known_surfaces.add(unit.surface_id)
        merged_data: dict[str, Any] = {}
        for entry in all_data_entries:
            _set_nested_data_path(
                merged_data,
                entry.pointer,
                entry.value,
                merge_root=ctx.tuned and not ctx.strict,
            )

        create_body: dict[str, Any] = {"surfaceId": unit.surface_id}
        cat_id = surface_catalog_id(self._catalogs)
        if cat_id is not None:
            create_body["catalogId"] = cat_id
        if unit.send_data_model is not None:
            create_body["sendDataModel"] = unit.send_data_model
        if unit.extensions is not None:
            create_body["metadata"] = {"extensions": unit.extensions}

        if ctx.at_least_v10:
            create_body["components"] = compiled_components
            if merged_data:
                create_body["dataModel"] = merged_data
            return [{"version": ctx.version, "createSurface": create_body}]

        pre_v10_msgs: list[dict[str, Any]] = [
            {"version": ctx.version, "createSurface": create_body},
            {
                "version": ctx.version,
                "updateComponents": {
                    "surfaceId": unit.surface_id,
                    "components": compiled_components,
                },
            },
        ]
        if merged_data:
            pre_v10_msgs.append({
                "version": ctx.version,
                "updateDataModel": {
                    "surfaceId": unit.surface_id,
                    "path": "/",
                    "value": merged_data,
                },
            })
        return pre_v10_msgs

    def _collect_explicit_ids(
        self, nodes: list[A2uiXmlNode], ctx: _CompileContext
    ) -> None:
        """Pre-registers all explicit component ``id="..."`` attributes in a scope."""
        for node in nodes:
            if not isinstance(node, ElementNode):
                continue
            lower = _normalize_identifier_key(node.tag)
            if lower in (
                "check",
                "action",
                "ref",
                "datamodel",
                "deletesurface",
                "callfunction",
                "callrendererfunction",
                "extensions",
                "call",
            ) and not self._defines_exact(
                "component", node.tag, node.attrs.get("catalogId")
            ):
                continue
            if lower in ("template", "item") and not self._defines_exact(
                "component", node.tag, node.attrs.get("catalogId")
            ):
                self._collect_explicit_ids(node.children, ctx)
                continue
            explicit_id = node.attrs.get("id")
            if explicit_id is not None:
                if not explicit_id:
                    raise A2uiXmlValidationError(
                        f"Component <{node.tag}> on line {node.line} has empty id."
                    )
                if ctx.at_least_v10 and not is_valid_uax31_identifier(explicit_id):
                    raise A2uiXmlValidationError(
                        f"Component id {explicit_id!r} on line {node.line} is not a"
                        " valid UAX #31 identifier."
                    )
                if explicit_id in ctx.used_ids:
                    raise A2uiXmlValidationError(
                        f"Duplicate component ID {explicit_id!r} on line {node.line}."
                    )
                ctx.used_ids.add(explicit_id)
            self._collect_explicit_ids(node.children, ctx)

    # ---------------------------------------------------------------------------
    # Component, Prose, Slot, Action, Check, and Standalone Call Compilation
    # ---------------------------------------------------------------------------

    def _compile_flow_node(
        self, node: A2uiXmlNode, ctx: _CompileContext
    ) -> tuple[str | None, list[dict[str, Any]]]:
        """Compiles a component element or Markdown prose/divider node."""
        if isinstance(node, ElementNode):
            comp, descendants = self._compile_component_node(node, ctx)
            return comp["id"], [comp, *descendants]
        if isinstance(node, ProseNode):
            if node.kind == "divider":
                div_info = self._find_divider_component()
                if div_info is None:
                    raise A2uiXmlValidationError(
                        f"Thematic break '---' on line {node.line} has no matching"
                        " zero-arg divider component in the active catalog."
                    )
                div_name, _, write_cat = div_info
                cid = ctx.allocate_id()
                comp_dict: dict[str, Any] = {"id": cid, "component": div_name}
                if write_cat is not None:
                    comp_dict["catalogId"] = write_cat
                return cid, [comp_dict]

            leaf_info = self._find_text_leaf_component()
            if leaf_info is None:
                raise A2uiXmlValidationError(
                    f"Prose text {node.text!r} on line {node.line} has no matching text"
                    " leaf component in the active catalog."
                )
            leaf_name, text_prop, _, write_cat = leaf_info
            cid = ctx.allocate_id()
            comp_dict = {"id": cid, "component": leaf_name, text_prop: node.text}
            if write_cat is not None:
                comp_dict["catalogId"] = write_cat
            return cid, [comp_dict]
        if ctx.tuned and isinstance(node, FenceNode) and node.lang.lower() != "json":
            leaf_info = self._find_text_leaf_component()
            if leaf_info is not None:
                leaf_name, text_prop, _, write_cat = leaf_info
                header = f"{node.lang} {node.info}".strip()
                md_code = f"```{header}\n{node.content}\n```"
                cid = ctx.allocate_id()
                comp_dict = {"id": cid, "component": leaf_name, text_prop: md_code}
                if write_cat is not None:
                    comp_dict["catalogId"] = write_cat
                return cid, [comp_dict]
        raise A2uiXmlValidationError(
            f"Unexpected fenced block '{node.lang} {node.info}' on line {node.line}."
        )

    def _is_child_helper_tag(self, elem: ElementNode) -> str | None:
        """Identifies child helper directives inside a component element."""
        cat_id = elem.attrs.get("catalogId")
        if self._defines_exact("component", elem.tag, cat_id):
            return None
        norm = _normalize_identifier_key(elem.tag)
        if norm == "check":
            return "Check"
        if norm == "action":
            return "Action"
        if norm == "template":
            return "Template"
        if norm == "item":
            return "Item"
        if norm == "ref":
            return "Ref"
        if norm == "call":
            return "Call"
        if norm == "extensions":
            return "Extensions"
        return None

    def _try_resolve_plural_component(
        self,
        elem: ElementNode,
        explicit_cat: str | None,
        ctx: _CompileContext,
    ) -> tuple[str, CatalogSchemaHelper, str | None, ElementNode] | None:
        """Resolves a singular tag like ``<MaterialChip>`` to its plural catalog component."""
        for plural_cand in _pluralize_identifier(elem.tag):
            saved_len = len(ctx.violations)
            try:
                p_comp, p_helper, p_cat = self._resolve_catalog_entry(
                    "component",
                    plural_cand,
                    explicit_cat,
                    ctx,
                    line=elem.line,
                )
            except A2uiXmlValidationError:
                del ctx.violations[saved_len:]
                continue
            del ctx.violations[saved_len:]

            p_props = p_helper.get_component_properties(p_comp)
            obj_arr_props: list[str] = []
            for p in p_props:
                p_schema = p_helper.get_property_schema(p_comp, p)
                item_s = p_helper.resolve_item_schema(p_schema)
                if isinstance(item_s, dict) and (
                    item_s.get("type") == "object" or "properties" in item_s
                ):
                    obj_arr_props.append(p)

            has_collection_attr = any(
                _normalize_identifier_key(k) == _normalize_identifier_key(ap)
                for k in elem.attrs
                for ap in obj_arr_props
            )
            has_structured_child = any(
                isinstance(c, (ElementNode, FenceNode)) for c in elem.children
            )
            if has_collection_attr or has_structured_child or len(obj_arr_props) != 1:
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="law3_name_normalization",
                        message=(
                            f"Normalized singular component {elem.tag!r} to {p_comp!r}."
                        ),
                        line=elem.line,
                    )
                )
                return p_comp, p_helper, p_cat, elem

            # Wrap standalone singular item tag into `<PluralComp><Item .../></PluralComp>`
            outer_attrs: dict[str, str] = {}
            item_attrs: dict[str, str] = {}
            for k, v in elem.attrs.items():
                if k in ("id", "slot", "catalogId"):
                    outer_attrs[k] = v
                else:
                    item_attrs[k] = v
            synth_item = ElementNode(
                tag="Item",
                attrs=item_attrs,
                children=list(elem.children),
                line=elem.line,
                self_closing=elem.self_closing,
            )
            wrapped_elem = ElementNode(
                tag=p_comp,
                attrs=outer_attrs,
                children=[synth_item],
                line=elem.line,
                self_closing=False,
            )
            ctx.violations.append(
                A2uiXmlStrictViolation(
                    law="law3_singular_component_wrapped",
                    message=(
                        f"Wrapped standalone singular <{elem.tag}> into"
                        f" <{p_comp}><Item .../></{p_comp}>."
                    ),
                    line=elem.line,
                )
            )
            return p_comp, p_helper, p_cat, wrapped_elem
        return None

    def _unwrap_slot_wrapper_tag(
        self,
        child: ElementNode,
        comp_name: str,
        properties: list[str],
        single_child_props: list[str],
        child_list_props: list[str],
        ctx: _CompileContext,
    ) -> tuple[str, list[A2uiXmlNode]] | None:
        """Unwraps ``<Child slot="trigger">...</Child>`` or ``<Trigger>...</Trigger>`` wrappers."""
        cat_id = child.attrs.get("catalogId")
        if self._defines_exact("component", child.tag, cat_id):
            return None
        # Do not intercept real catalog components (even case-insensitively)
        saved_len = len(ctx.violations)
        try:
            self._resolve_catalog_entry(
                "component", child.tag, cat_id, ctx, line=child.line
            )
            del ctx.violations[saved_len:]
            return None
        except A2uiXmlValidationError:
            del ctx.violations[saved_len:]

        norm_tag = _normalize_identifier_key(child.tag)
        all_child_slots = [*single_child_props, *child_list_props]
        if not all_child_slots or not child.children:
            return None

        if norm_tag in ("child", "slot"):
            raw_slot = (
                child.attrs.get("slot")
                or child.attrs.get("name")
                or child.attrs.get("prop")
            )
            if raw_slot:
                matches = [
                    p
                    for p in all_child_slots
                    if _normalize_identifier_key(p)
                    == _normalize_identifier_key(raw_slot)
                ]
                if len(matches) == 1:
                    ctx.violations.append(
                        A2uiXmlStrictViolation(
                            law="law3_slot_wrapper_tag",
                            message=(
                                f"Unwrapped <{child.tag} slot={raw_slot!r}> wrapper"
                                f" inside <{comp_name}>."
                            ),
                            line=child.line,
                        )
                    )
                    return matches[0], child.children
            return None

        # Tag itself named after a child slot (e.g. `<Trigger><Button .../></Trigger>`)
        slot_matches = [
            p for p in all_child_slots if _normalize_identifier_key(p) == norm_tag
        ]
        if len(slot_matches) == 1 and not child.attrs:
            ctx.violations.append(
                A2uiXmlStrictViolation(
                    law="law3_slot_wrapper_tag",
                    message=(
                        f"Unwrapped slot tag <{child.tag}> -> slot={slot_matches[0]!r}"
                        f" inside <{comp_name}>."
                    ),
                    line=child.line,
                )
            )
            return slot_matches[0], child.children
        return None

    def _match_morphological_item_subtag(
        self,
        child: ElementNode,
        comp_name: str,
        helper: CatalogSchemaHelper,
        properties: list[str],
        ctx: _CompileContext,
    ) -> str | None:
        """Matches a non-catalog subtag (e.g. ``<MaterialChip>``, ``<Tab>``, ``<MaterialTableColumn>``) to a structured object-array property on ``comp_name``."""
        cat_id = child.attrs.get("catalogId")
        saved_len = len(ctx.violations)
        try:
            self._resolve_catalog_entry(
                "component", child.tag, cat_id, ctx, line=child.line
            )
            del ctx.violations[saved_len:]
            return None
        except A2uiXmlValidationError:
            del ctx.violations[saved_len:]

        obj_array_props: list[str] = []
        for p in properties:
            p_schema = helper.get_property_schema(comp_name, p)
            item_schema = helper.resolve_item_schema(p_schema)
            if isinstance(item_schema, dict) and (
                item_schema.get("type") == "object" or "properties" in item_schema
            ):
                obj_array_props.append(p)
        if not obj_array_props:
            return None

        explicit_slot = child.attrs.get("slot")
        if explicit_slot:
            slot_hits = [
                p
                for p in obj_array_props
                if _normalize_identifier_key(p)
                == _normalize_identifier_key(explicit_slot)
            ]
            if len(slot_hits) == 1:
                return slot_hits[0]

        child_norm = _normalize_identifier_key(child.tag)
        comp_norm = _normalize_identifier_key(comp_name)

        # Strip common vendor/component prefix (e.g. `MaterialTableColumn` inside `MaterialTable` -> `column`)
        stripped_child = child_norm
        if child_norm.startswith(comp_norm) and len(child_norm) > len(comp_norm):
            stripped_child = child_norm[len(comp_norm) :]
        else:
            # Shared prefix with parent (e.g. `MaterialOption` inside `MaterialSelect` -> `option`)
            common_len = 0
            for ch_a, ch_b in zip(comp_norm, child_norm):
                if ch_a == ch_b:
                    common_len += 1
                else:
                    break
            if common_len >= 4 and len(child_norm) > common_len:
                stripped_child = child_norm[common_len:]

        child_stems = _singularize_stem(child.tag) | _singularize_stem(stripped_child)
        parent_stems = _singularize_stem(comp_name)

        if len(obj_array_props) == 1:
            prop = obj_array_props[0]
            prop_stems = _singularize_stem(prop)
            if (
                (child_stems & prop_stems)
                or (child_stems & parent_stems)
                or stripped_child in ("item", "option", "entry", "row", "choice")
            ):
                return prop
            # Also match if all non-slot attributes belong to the single object-array's item schema
            item_s = (
                helper.resolve_item_schema(helper.get_property_schema(comp_name, prop))
                or {}
            )
            i_props = (
                set(item_s.get("properties", {})) if isinstance(item_s, dict) else set()
            )
            c_attrs = {k for k in child.attrs if k != "slot"}
            if i_props and c_attrs and c_attrs.issubset(i_props):
                return prop
            return None

        # Multiple object-array properties (e.g. `columns` + `data`/`rows` on a table)
        best_matches: list[str] = []
        for prop in obj_array_props:
            prop_stems = _singularize_stem(prop)
            if child_stems & prop_stems:
                best_matches.append(prop)
            elif stripped_child in ("row", "record", "entry") and prop.lower() in (
                "data",
                "rows",
                "records",
                "items",
            ):
                best_matches.append(prop)
        if len(best_matches) == 1:
            return best_matches[0]
        return None

    def _try_convert_leaf_child_to_item(
        self,
        child: ElementNode,
        comp_name: str,
        helper: CatalogSchemaHelper,
        properties: list[str],
        ctx: _CompileContext,
    ) -> tuple[str, dict[str, Any]] | None:
        """Converts a leaf text component nested inside a slot-less object-array parent into an item."""
        obj_array_props: list[tuple[str, dict[str, Any]]] = []
        for p in properties:
            item_s = helper.resolve_item_schema(
                helper.get_property_schema(comp_name, p)
            )
            if isinstance(item_s, dict) and isinstance(item_s.get("properties"), dict):
                obj_array_props.append((p, item_s))
        if len(obj_array_props) != 1:
            return None
        arr_prop, item_schema = obj_array_props[0]
        item_props = item_schema.get("properties", {})
        if any(
            _schema_ref_kind(v) in ("Child", "ChildList") for v in item_props.values()
        ):
            return None
        reqs = [
            rk
            for rk in item_schema.get("required") or []
            if rk in item_props and schema_accepts_type(item_props[rk], "string")
        ]
        if len(reqs) != 1:
            return None
        req_str_key = reqs[0]
        text_val: str | None = None
        for ak in ("text", "label", "headline", "title", "value"):
            if ak in child.attrs and child.attrs[ak]:
                text_val = child.attrs[ak]
                break
        if (
            text_val is None
            and child.children
            and all(isinstance(gc, ProseNode) for gc in child.children)
        ):
            text_val = "\n".join(
                gc.text for gc in child.children if isinstance(gc, ProseNode)
            )
        if not text_val:
            return None
        ctx.violations.append(
            A2uiXmlStrictViolation(
                law="law3_leaf_child_to_item",
                message=(
                    f"Converted leaf child <{child.tag}> inside <{comp_name}> into"
                    f" <Item {req_str_key}=...>."
                ),
                line=child.line,
            )
        )
        return arr_prop, {req_str_key: text_val}

    def _compile_component_node(
        self,
        elem: ElementNode,
        ctx: _CompileContext,
        *,
        forced_id: str | None = None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        explicit_cat = elem.attrs.get("catalogId")
        try:
            comp_name, helper, write_cat = self._resolve_catalog_entry(
                "component", elem.tag, explicit_cat, ctx, line=elem.line
            )
        except A2uiXmlValidationError:
            if ctx.tuned and not ctx.strict:
                plural_res = self._try_resolve_plural_component(elem, explicit_cat, ctx)
                if plural_res is not None:
                    comp_name, helper, write_cat, elem = plural_res
                else:
                    raise
            else:
                raise
        properties = helper.get_component_properties(comp_name)
        is_checkable = helper.is_checkable(comp_name) or "checks" in properties

        if forced_id is not None:
            comp_id = forced_id
        elif "id" in elem.attrs:
            comp_id = elem.attrs["id"]
        else:
            comp_id = ctx.allocate_id()

        comp_dict: dict[str, Any] = {"id": comp_id, "component": comp_name}
        if write_cat is not None:
            comp_dict["catalogId"] = write_cat

        descendants: list[dict[str, Any]] = []
        raw_checks: list[CheckExpr | ElementNode] = []
        slot_children: dict[str, list[str]] = {}
        slot_items: dict[str, list[dict[str, Any]]] = {}
        sibling_value_binding: dict[str, Any] | None = None
        bound_path_props: dict[str, dict[str, Any]] = {}
        empty_array_placeholder_props: set[str] = set()

        # Classify child/action properties of this component
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
        action_props = [
            p
            for p in properties
            if _get_effective_prop_kind(helper, comp_name, p) == "Action"
        ]

        default_child_prop: str | None = None
        if child_list_props:
            default_child_prop = child_list_props[0]
        elif len(single_child_props) == 1:
            default_child_prop = single_child_props[0]

        # 1. Process XML attributes on `<Comp ...>`
        template_path_attr = (
            elem.attrs.get("template") if "template" not in properties else None
        )
        template_slot_attr = (
            elem.attrs.get("templateSlot") if "templateSlot" not in properties else None
        )

        for attr_key, attr_raw in elem.attrs.items():
            if attr_key in ("id", "catalogId"):
                continue
            if attr_key == "slot" and "slot" not in properties:
                continue
            if attr_key == "parentSlot" and "parentSlot" not in properties:
                continue
            if attr_key == "template" and "template" not in properties:
                continue
            if attr_key == "templateSlot" and "templateSlot" not in properties:
                continue
            if attr_key == "checks" and is_checkable:
                raw_checks.extend(parse_checks_attribute(attr_raw))
                continue
            if attr_key == "extensions" and "extensions" not in properties:
                ext_map = self._parse_extensions_json(attr_raw, line=elem.line, ctx=ctx)
                comp_dict["metadata"] = {"extensions": ext_map}
                continue
            if (
                ctx.tuned
                and not ctx.strict
                and _normalize_identifier_key(attr_key) == "datamodel"
                and not self._has_declared_property(
                    properties, attr_key, strict=ctx.strict
                )
            ):
                parsed_dm = self._parse_inline_datamodel_attr(
                    attr_raw, line=elem.line, ctx=ctx
                )
                if parsed_dm is not None:
                    ctx.lifted_data_entries.append(
                        _DataEntry(pointer="/", value=parsed_dm)
                    )
                continue

            if (
                ctx.tuned
                and not ctx.strict
                and _normalize_identifier_key(attr_key) in _ACTION_HANDLER_ALIASES
                and attr_key not in properties
                and len(action_props) == 1
                and action_props[0] not in elem.attrs
            ):
                resolved_prop = action_props[0]
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="prop_name_normalization",
                        message=(
                            f"Mapped action alias {attr_key!r} -> {resolved_prop!r}"
                            f" on <{comp_name}>."
                        ),
                        line=elem.line,
                    )
                )
            else:
                try:
                    resolved_prop = self._resolve_property_name(
                        comp_name, attr_key, properties, line=elem.line, ctx=ctx
                    )
                except A2uiXmlValidationError:
                    if ctx.tuned and not ctx.strict:
                        ctx.violations.append(
                            A2uiXmlStrictViolation(
                                law="unknown_optional_attr_dropped",
                                message=(
                                    f"Dropped unknown optional attribute {attr_key!r}"
                                    f" on <{comp_name}>."
                                ),
                                line=elem.line,
                            )
                        )
                        continue
                    raise

            prop_schema = helper.get_property_schema(comp_name, resolved_prop)
            prop_kind = _get_effective_prop_kind(helper, comp_name, resolved_prop)

            if prop_kind == "Child":
                if not attr_raw:
                    raise A2uiXmlValidationError(
                        f"Child reference attribute {resolved_prop!r} on <{comp_name}>"
                        " cannot be empty."
                    )
                comp_dict[resolved_prop] = attr_raw
                continue

            if (
                ctx.tuned
                and not ctx.strict
                and attr_raw == ""
                and schema_accepts_type(prop_schema, "array")
                and not schema_accepts_type(prop_schema, "string")
            ):
                comp_dict[resolved_prop] = []
                empty_array_placeholder_props.add(resolved_prop)
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="law5_lenient_value",
                        message=(
                            f'Coerced empty array attribute {resolved_prop}="" to []'
                            f" on <{comp_name}>."
                        ),
                        line=elem.line,
                    )
                )
                continue

            parsed_val, used_lenient = parse_attribute_value(
                attr_raw,
                prop_schema,
                helper,
                is_action=(prop_kind == "Action"),
                known_functions=self._known_functions,
                strict=ctx.strict,
                tuned=ctx.tuned,
            )
            if used_lenient:
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="law5_lenient_value",
                        message=(
                            "Recovered non-canonical attribute syntax on"
                            f" <{comp_name} {resolved_prop}=...>."
                        ),
                        line=elem.line,
                    )
                )

            if (
                prop_schema
                and not schema_allows_databinding(prop_schema)
                and prop_kind != "Action"
                and isinstance(parsed_val, PathExpr)
            ):
                raise A2uiXmlValidationError(
                    f"Property {resolved_prop!r} of component {comp_name!r} is static"
                    f" and cannot bind data path {attr_raw!r}."
                )

            compiled_val = self._compile_expr_value(
                parsed_val,
                ctx,
                is_action=(prop_kind == "Action"),
                prop_schema=prop_schema,
                helper=helper,
                comp_name=comp_name,
                prop_name=resolved_prop,
                line=elem.line,
            )
            if compiled_val is _DROP_OPTIONAL:
                continue
            comp_dict[resolved_prop] = compiled_val
            if isinstance(parsed_val, PathExpr) and isinstance(compiled_val, dict):
                bound_path_props[resolved_prop] = compiled_val
                if resolved_prop == "value":
                    sibling_value_binding = compiled_val

        if ctx.tuned and sibling_value_binding is None and bound_path_props:
            for bp_name, bp_val in bound_path_props.items():
                if _normalize_identifier_key(bp_name) not in (
                    "label",
                    "placeholder",
                    "title",
                    "arialabel",
                    "supportingtext",
                    "helpertext",
                    "caption",
                    "text",
                ):
                    sibling_value_binding = bp_val
                    break

        # 2. Process nested children of `<Comp>`
        prose_chunks: list[ProseNode] = []
        has_non_prose_child = any(not isinstance(c, ProseNode) for c in elem.children)

        for child in elem.children:
            if isinstance(child, ProseNode) and child.kind == "prose":
                # Check if this leaf component owns a primary string property directly
                primary_str_prop = self._primary_direct_string_prop(
                    comp_name,
                    helper,
                    properties,
                    comp_dict,
                    tuned=ctx.tuned and not ctx.strict,
                )
                if primary_str_prop is not None and not has_non_prose_child:
                    prose_chunks.append(child)
                    continue
                if (
                    ctx.tuned
                    and not ctx.strict
                    and not has_non_prose_child
                    and default_child_prop is None
                    and not single_child_props
                ):
                    # Leaf component already set its primary string via attribute (e.g. `<MaterialIcon icon="warning">warning</MaterialIcon>`)
                    ctx.violations.append(
                        A2uiXmlStrictViolation(
                            law="law3_leaf_body_text",
                            message=(
                                f"Ignored redundant inner text on leaf <{comp_name}>"
                                " (attribute already provided)."
                            ),
                            line=child.line,
                        )
                    )
                    continue

            if isinstance(child, FenceNode):
                is_code_prose_fence = (
                    ctx.tuned
                    and not ctx.strict
                    and default_child_prop is not None
                    and child.lang.lower() != "json"
                    and not (
                        not child.lang
                        and not child.info
                        and child.content.strip().startswith(("{", "["))
                    )
                )
                if not is_code_prose_fence:
                    self._apply_component_fence(
                        comp_name, helper, properties, comp_dict, child, ctx
                    )
                    continue

            if isinstance(child, ElementNode):
                if (
                    ctx.tuned
                    and not ctx.strict
                    and self._is_reserved_directive(child) == "DataModel"
                    and not self._has_declared_property(
                        properties, "dataModel", strict=ctx.strict
                    )
                ):
                    ctx.lifted_data_entries.append(
                        self._parse_data_model_element(child, ctx)
                    )
                    ctx.violations.append(
                        A2uiXmlStrictViolation(
                            law="law4_nested_datamodel",
                            message=(
                                f"Lifted nested <DataModel> inside <{comp_name}> to"
                                " surface dataModel."
                            ),
                            line=child.line,
                        )
                    )
                    continue

                helper_kind = self._is_child_helper_tag(child)
                if helper_kind == "Check":
                    if not is_checkable:
                        raise A2uiXmlValidationError(
                            f"Component <{comp_name}> on line {elem.line} does not"
                            " support validation checks."
                        )
                    raw_checks.append(child)
                    continue
                if helper_kind == "Action":
                    target_act_prop = child.attrs.get("slot") or (
                        action_props[0] if len(action_props) == 1 else None
                    )
                    if target_act_prop is None:
                        raise A2uiXmlValidationError(
                            f"<Action> inside <{comp_name}> on line {child.line} must"
                            ' specify slot="..." (available action properties:'
                            f" {action_props})."
                        )
                    target_act_prop = self._resolve_property_name(
                        comp_name, target_act_prop, properties, line=child.line, ctx=ctx
                    )
                    comp_dict[target_act_prop] = self._compile_action_element(
                        child, ctx
                    )
                    continue
                if helper_kind == "Call":
                    target_call_prop = child.attrs.get("prop") or child.attrs.get(
                        "slot"
                    )
                    if not target_call_prop:
                        raise A2uiXmlValidationError(
                            f"<Call> inside <{comp_name}> on line {child.line} requires"
                            ' prop="...".'
                        )
                    target_call_prop = self._resolve_property_name(
                        comp_name,
                        target_call_prop,
                        properties,
                        line=child.line,
                        ctx=ctx,
                    )
                    target_is_act = target_call_prop in action_props
                    comp_dict[target_call_prop] = self._compile_call_element(
                        child, ctx, is_action=target_is_act
                    )
                    continue
                if helper_kind == "Extensions":
                    comp_dict["metadata"] = {
                        "extensions": self._parse_extensions_element(child, ctx)
                    }
                    continue
                if helper_kind == "Template":
                    tmpl_slot = child.attrs.get("slot") or default_child_prop
                    if tmpl_slot is None or tmpl_slot not in child_list_props:
                        raise A2uiXmlValidationError(
                            f"<Template> inside <{comp_name}> on line {child.line} must"
                            " target a ChildList property (available:"
                            f" {child_list_props})."
                        )
                    tmpl_obj, tmpl_desc = self._compile_template_element(child, ctx)
                    comp_dict[tmpl_slot] = tmpl_obj
                    descendants.extend(tmpl_desc)
                    continue
                if helper_kind == "Item":
                    item_prop, item_obj, item_desc = self._compile_item_element(
                        comp_name,
                        helper,
                        properties,
                        child,
                        ctx,
                        existing_slot_items=slot_items,
                    )
                    slot_items.setdefault(item_prop, []).append(item_obj)
                    descendants.extend(item_desc)
                    continue
                if helper_kind == "Ref":
                    ref_id = child.attrs.get("id")
                    if not ref_id:
                        raise A2uiXmlValidationError(
                            f'<Ref> on line {child.line} requires id="...".'
                        )
                    target_slot = child.attrs.get("slot") or default_child_prop
                    if target_slot is None:
                        raise A2uiXmlValidationError(
                            f"<Ref> inside <{comp_name}> on line {child.line} must"
                            ' specify slot="...".'
                        )
                    target_slot = self._resolve_property_name(
                        comp_name, target_slot, properties, line=child.line, ctx=ctx
                    )
                    slot_children.setdefault(target_slot, []).append(ref_id)
                    continue

                if ctx.tuned and not ctx.strict:
                    unwrapped = self._unwrap_slot_wrapper_tag(
                        child,
                        comp_name,
                        properties,
                        single_child_props,
                        child_list_props,
                        ctx,
                    )
                    if unwrapped is not None:
                        w_slot, w_nodes = unwrapped
                        for w_node in w_nodes:
                            if (
                                isinstance(w_node, ElementNode)
                                and self._is_child_helper_tag(w_node) == "Ref"
                            ):
                                ref_id = w_node.attrs.get("id")
                                if ref_id:
                                    slot_children.setdefault(w_slot, []).append(ref_id)
                                continue
                            w_cid, w_comps = self._compile_flow_node(w_node, ctx)
                            if w_cid is not None:
                                slot_children.setdefault(w_slot, []).append(w_cid)
                                descendants.extend(w_comps)
                        continue

                    morph_prop = self._match_morphological_item_subtag(
                        child, comp_name, helper, properties, ctx
                    )
                    if morph_prop is not None:
                        ctx.violations.append(
                            A2uiXmlStrictViolation(
                                law="law3_subtag_to_item",
                                message=(
                                    f"Healed subtag <{child.tag}> to <Item"
                                    f" slot={morph_prop!r}> inside <{comp_name}>."
                                ),
                                line=child.line,
                            )
                        )
                        item_prop, item_obj, item_desc = self._compile_item_element(
                            comp_name,
                            helper,
                            properties,
                            child,
                            ctx,
                            forced_target_prop=morph_prop,
                            existing_slot_items=slot_items,
                        )
                        slot_items.setdefault(item_prop, []).append(item_obj)
                        descendants.extend(item_desc)
                        continue

                    if default_child_prop is None and not single_child_props:
                        leaf_item = self._try_convert_leaf_child_to_item(
                            child, comp_name, helper, properties, ctx
                        )
                        if leaf_item is not None:
                            li_prop, li_obj = leaf_item
                            slot_items.setdefault(li_prop, []).append(li_obj)
                            continue

            # Regular nested UI component or prose/divider node
            explicit_slot = self._extract_parent_slot(child, strict=ctx.strict)
            target_slot = explicit_slot or default_child_prop
            if target_slot is None:
                if single_child_props:
                    raise A2uiXmlValidationError(
                        f"Child inside <{comp_name}> on line {elem.line} must specify"
                        f' slot="..." because <{comp_name}> has multiple child'
                        f" slots: {single_child_props}."
                    )
                raise A2uiXmlValidationError(
                    f"Component <{comp_name}> on line {elem.line} does not accept"
                    " nested child components."
                )
            target_slot = self._resolve_property_name(
                comp_name, target_slot, properties, line=elem.line, ctx=ctx
            )
            cid, child_comps = self._compile_flow_node(child, ctx)
            if cid is not None:
                slot_children.setdefault(target_slot, []).append(cid)
                descendants.extend(child_comps)

        if prose_chunks:
            was_required_str = self._primary_direct_string_prop(
                comp_name, helper, properties, comp_dict, tuned=False
            )
            primary_str_prop = was_required_str or self._primary_direct_string_prop(
                comp_name,
                helper,
                properties,
                comp_dict,
                tuned=ctx.tuned and not ctx.strict,
            )
            if primary_str_prop is not None:
                if was_required_str is None:
                    ctx.violations.append(
                        A2uiXmlStrictViolation(
                            law="law3_leaf_body_text",
                            message=(
                                f"Mapped inner text of <{comp_name}> onto optional"
                                f" property {primary_str_prop!r}."
                            ),
                            line=elem.line,
                        )
                    )
                comp_dict[primary_str_prop] = "\n".join(p.text for p in prose_chunks)

        # 3. Finalize structured `<Item>` arrays
        for item_prop, items_list in slot_items.items():
            if (
                item_prop in comp_dict
                and item_prop not in empty_array_placeholder_props
            ):
                raise A2uiXmlValidationError(
                    f"Duplicate definition of property {item_prop!r} on <{comp_name}>."
                )
            comp_dict[item_prop] = items_list

        # 4. Finalize `template="$/path"` shorthand or regular `slot_children`
        if template_path_attr is not None:
            t_slot = template_slot_attr or (
                child_list_props[0] if child_list_props else None
            )
            if t_slot is None or t_slot not in child_list_props:
                raise A2uiXmlValidationError(
                    f"Attribute template={template_path_attr!r} on <{comp_name}>"
                    " requires a ChildList property."
                )
            t_children = slot_children.pop(t_slot, [])
            if len(t_children) != 1:
                if len(t_children) > 1 and not ctx.strict:
                    container_info = self._find_layout_list_container()
                    if container_info is not None:
                        c_name, c_prop, _, c_cat = container_info
                        wrap_id = ctx.allocate_id()
                        wrap_comp: dict[str, Any] = {
                            "id": wrap_id,
                            "component": c_name,
                            c_prop: t_children,
                        }
                        if c_cat is not None:
                            wrap_comp["catalogId"] = c_cat
                        descendants.insert(0, wrap_comp)
                        t_children = [wrap_id]
                        ctx.violations.append(
                            A2uiXmlStrictViolation(
                                law="template_multi_child_wrap",
                                message=(
                                    f"Wrapped {len(wrap_comp[c_prop])} template"
                                    f" children into <{c_name}>."
                                ),
                                line=elem.line,
                            )
                        )
                if len(t_children) != 1:
                    raise A2uiXmlValidationError(
                        f"Template on <{comp_name}> requires exactly 1 template child"
                        f" component, got {len(t_children)}."
                    )
            parsed_t_path = parse_data_path(template_path_attr)
            if parsed_t_path is None:
                if template_path_attr.startswith("/"):
                    parsed_t_path = PathExpr(template_path_attr)
                else:
                    raise A2uiXmlValidationError(
                        f"Template path on <{comp_name}> must start with '$' (e.g."
                        f' "$/items"), got {template_path_attr!r}.'
                    )
            comp_dict[t_slot] = {
                "path": parsed_t_path.path,
                "componentId": t_children[0],
            }

        for slot_prop, child_ids in slot_children.items():
            prop_kind = _get_effective_prop_kind(helper, comp_name, slot_prop)
            if prop_kind == "ChildList":
                comp_dict[slot_prop] = child_ids
            elif prop_kind == "Child":
                if len(child_ids) == 1:
                    comp_dict[slot_prop] = child_ids[0]
                else:
                    if ctx.strict:
                        raise A2uiXmlValidationError(
                            f"Property {slot_prop!r} of <{comp_name}> accepts a single"
                            f" child component, but {len(child_ids)} children were"
                            " nested."
                        )
                    container_info = self._find_layout_list_container()
                    if container_info is None:
                        raise A2uiXmlValidationError(
                            f"Property {slot_prop!r} of <{comp_name}> accepts only 1"
                            " child."
                        )
                    c_name, c_prop, _, c_cat = container_info
                    wrap_id = ctx.allocate_id()
                    wrap_comp = {
                        "id": wrap_id,
                        "component": c_name,
                        c_prop: child_ids,
                    }
                    if c_cat is not None:
                        wrap_comp["catalogId"] = c_cat
                    descendants.insert(0, wrap_comp)
                    comp_dict[slot_prop] = wrap_id
                    ctx.violations.append(
                        A2uiXmlStrictViolation(
                            law="single_child_auto_wrap",
                            message=(
                                f"Auto-wrapped {len(child_ids)} children inside"
                                f" <{comp_name}>.{slot_prop} using <{c_name}>."
                            ),
                            line=elem.line,
                        )
                    )
            else:
                raise A2uiXmlValidationError(
                    f"Property {slot_prop!r} of <{comp_name}> is not a Child or"
                    " ChildList slot."
                )

        # 5. Compile validation `checks`
        if raw_checks:
            prev_binding = ctx.active_value_binding
            ctx.active_value_binding = sibling_value_binding
            try:
                comp_dict["checks"] = [
                    self._compile_check_rule(rc, ctx) for rc in raw_checks
                ]
            finally:
                ctx.active_value_binding = prev_binding

        # 6. Validate required properties
        for req_prop in helper.get_component_required(comp_name):
            if req_prop not in _STRUCTURAL_COMP_KEYS and req_prop not in comp_dict:
                raise A2uiXmlValidationError(
                    f"Component <{comp_name}> (id={comp_id!r}, line {elem.line}) is"
                    f" missing required property {req_prop!r}."
                )

        return comp_dict, descendants

    def _primary_direct_string_prop(
        self,
        comp_name: str,
        helper: CatalogSchemaHelper,
        properties: list[str],
        comp_dict: dict[str, Any],
        *,
        tuned: bool = False,
    ) -> str | None:
        """Finds a component's unset primary string property when it has no child slots."""
        if any(
            _get_effective_prop_kind(helper, comp_name, p) in ("Child", "ChildList")
            for p in properties
        ):
            return None
        reqs = [
            p
            for p in helper.get_component_required(comp_name)
            if p not in _STRUCTURAL_COMP_KEYS and p not in comp_dict
        ]
        for prop in reqs:
            p_schema = helper.get_property_schema(comp_name, prop)
            if schema_accepts_type(p_schema, "string") and not helper.get_property_enum(
                comp_name, prop
            ):
                return prop
        if not tuned:
            return None
        # Do not hijack structured object-array containers (like `<MaterialChips>`)
        for p in properties:
            item_s = helper.resolve_item_schema(
                helper.get_property_schema(comp_name, p)
            )
            if isinstance(item_s, dict) and (
                item_s.get("type") == "object" or "properties" in item_s
            ):
                return None
        non_label_props = {
            "href",
            "url",
            "src",
            "leadingicon",
            "trailingicon",
            "icon",
            "arialabel",
            "arialabelledby",
            "tooltip",
            "placeholder",
            "color",
            "appearance",
            "variant",
        }
        preferred_order = ("label", "text", "content", "title", "headline", "caption")
        opt_str_props: list[str] = []
        for prop in properties:
            if (
                prop in _STRUCTURAL_COMP_KEYS
                or prop in comp_dict
                or _get_effective_prop_kind(helper, comp_name, prop) is not None
                or _normalize_identifier_key(prop) in non_label_props
            ):
                continue
            p_schema = helper.get_property_schema(comp_name, prop)
            if (
                schema_accepts_type(p_schema, "string")
                and not schema_accepts_type(p_schema, "number")
                and not schema_accepts_type(p_schema, "boolean")
                and not helper.get_property_enum(comp_name, prop)
            ):
                opt_str_props.append(prop)
        for pref in preferred_order:
            for cand in opt_str_props:
                if cand.lower() == pref:
                    return cand
        if len(opt_str_props) == 1:
            return opt_str_props[0]
        return None

    def _resolve_property_name(
        self,
        comp_name: str,
        raw_prop: str,
        properties: list[str],
        *,
        line: int,
        ctx: _CompileContext,
    ) -> str:
        if raw_prop in properties:
            return raw_prop
        if not ctx.strict:
            target_norm = _normalize_identifier_key(raw_prop)
            matches = [
                p for p in properties if _normalize_identifier_key(p) == target_norm
            ]
            if len(matches) == 1:
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="prop_name_normalization",
                        message=(
                            f"Normalized attribute {raw_prop!r} -> {matches[0]!r} on"
                            f" <{comp_name}>."
                        ),
                        line=line,
                    )
                )
                return matches[0]
        raise A2uiXmlValidationError(
            f"Unknown property {raw_prop!r} on component <{comp_name}> (line"
            f" {line}). Allowed properties: {properties}"
        )

    def _apply_component_fence(
        self,
        comp_name: str,
        helper: CatalogSchemaHelper,
        properties: list[str],
        comp_dict: dict[str, Any],
        fence: FenceNode,
        ctx: _CompileContext,
    ) -> None:
        """Applies a child ```` ```json [propName] ```` block to ``comp_dict``."""
        info = fence.info.strip()
        if info.lower() == "extensions" and "extensions" not in properties:
            comp_dict["metadata"] = {
                "extensions": self._parse_extensions_json(
                    fence.content, line=fence.line, ctx=ctx
                )
            }
            return
        if (
            ctx.tuned
            and not ctx.strict
            and fence.lang.lower() == "json"
            and info.lower() in ("datamodel", "data", "data_model")
            and not self._has_declared_property(properties, info, strict=ctx.strict)
        ):
            ctx.lifted_data_entries.append(self._parse_data_model_fence(fence))
            ctx.violations.append(
                A2uiXmlStrictViolation(
                    law="law4_nested_datamodel",
                    message=(
                        f"Lifted nested ```json {info} fence inside <{comp_name}> to"
                        " surface dataModel."
                    ),
                    line=fence.line,
                )
            )
            return

        target_prop: str | None = None
        if info:
            if info == "checks" and (
                helper.is_checkable(comp_name) or "checks" in properties
            ):
                target_prop = "checks"
            else:
                target_prop = self._resolve_property_name(
                    comp_name, info, properties, line=fence.line, ctx=ctx
                )
        else:
            # Infer single complex object/array property on component
            complex_candidates: list[str] = []
            for p in properties:
                if (
                    p == "checks"
                    or p in comp_dict
                    or _get_effective_prop_kind(helper, comp_name, p)
                    in ("Child", "ChildList")
                ):
                    continue
                p_schema = helper.get_property_schema(comp_name, p)
                if isinstance(p_schema, dict) and (
                    p_schema.get("type") in ("object", "array")
                    or schema_accepts_type(p_schema, "array")
                ):
                    complex_candidates.append(p)
            if len(complex_candidates) == 1:
                target_prop = complex_candidates[0]
            else:
                raise A2uiXmlValidationError(
                    f"Fenced JSON block inside <{comp_name}> on line {fence.line} must"
                    " name its target property (e.g. ```json propName)."
                )

        prop_schema = helper.get_property_schema(comp_name, target_prop)
        try:
            parsed_json = json.loads(fence.content)
        except json.JSONDecodeError as exc:
            raw_stripped = fence.content.strip()
            if (
                ctx.tuned
                and not ctx.strict
                and raw_stripped.startswith("$")
                and (prop_schema is None or schema_allows_databinding(prop_schema))
            ):
                parsed_expr, _ = parse_attribute_value(
                    raw_stripped,
                    prop_schema,
                    helper,
                    is_action=(
                        _get_effective_prop_kind(helper, comp_name, target_prop)
                        == "Action"
                    ),
                    known_functions=self._known_functions,
                    strict=ctx.strict,
                    tuned=ctx.tuned,
                )
                compiled_expr = self._compile_expr_value(
                    parsed_expr,
                    ctx,
                    is_action=(
                        _get_effective_prop_kind(helper, comp_name, target_prop)
                        == "Action"
                    ),
                    prop_schema=prop_schema,
                    helper=helper,
                    comp_name=comp_name,
                    prop_name=target_prop,
                    line=fence.line,
                )
                if compiled_expr is not _DROP_OPTIONAL:
                    comp_dict[target_prop] = compiled_expr
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="law4_expr_in_fence",
                        message=(
                            f"Recovered expression {raw_stripped!r} inside ```json"
                            f" {target_prop} fence on <{comp_name}>."
                        ),
                        line=fence.line,
                    )
                )
                return
            raise A2uiXmlParseError(
                f"Invalid JSON in ```json {target_prop} fence on line {fence.line}:"
                f" {exc}"
            ) from exc

        if (
            isinstance(parsed_json, list)
            and prop_schema
            and _schema_expects_option_objects(prop_schema)
        ):
            parsed_json = [
                {"label": item, "value": item} if isinstance(item, str) else item
                for item in parsed_json
            ]
        stamped = self._stamp_json_calls(parsed_json, ctx)
        if ctx.tuned and not ctx.strict and prop_schema is not None:
            stamped = self._sanitize_schema_value(
                stamped,
                prop_schema,
                helper,
                ctx,
                owner=f"{comp_name}.{target_prop}",
                line=fence.line,
            )
        comp_dict[target_prop] = stamped

    def _stamp_json_calls(self, val: Any, ctx: _CompileContext) -> Any:
        """Ensures function calls inside raw JSON blocks carry ``catalogId`` in multi-catalog mode."""
        if isinstance(val, dict):
            out = {k: self._stamp_json_calls(v, ctx) for k, v in val.items()}
            call_name = out.get(ctx.call_key)
            if (
                len(self._catalogs) > 1
                and isinstance(call_name, str)
                and "catalogId" not in out
                and ("args" in out or ctx.at_least_v10)
            ):
                _, _, write_cat = self._resolve_catalog_entry(
                    "function", call_name, None, ctx
                )
                if write_cat is not None:
                    out["catalogId"] = write_cat
            return out
        if isinstance(val, list):
            return [self._stamp_json_calls(item, ctx) for item in val]
        return val

    def _compile_template_element(
        self, elem: ElementNode, ctx: _CompileContext
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        raw_path = elem.attrs.get("path")
        if not raw_path:
            raise A2uiXmlValidationError(
                f'<Template> on line {elem.line} requires path="$/...".'
            )
        parsed_path = parse_data_path(raw_path)
        if parsed_path is None:
            if raw_path.startswith("/"):
                parsed_path = PathExpr(raw_path)
            else:
                raise A2uiXmlValidationError(
                    f"<Template> path on line {elem.line} must be a '$' data binding,"
                    f" got {raw_path!r}."
                )
        child_ids: list[str] = []
        descendants: list[dict[str, Any]] = []
        for child in elem.children:
            if (
                isinstance(child, ElementNode)
                and self._is_child_helper_tag(child) == "Ref"
            ):
                ref_id = child.attrs.get("id")
                if not ref_id:
                    raise A2uiXmlValidationError(
                        f"<Ref> inside <Template> on line {child.line} requires"
                        ' id="...".'
                    )
                child_ids.append(ref_id)
                continue
            cid, comps = self._compile_flow_node(child, ctx)
            if cid is not None:
                child_ids.append(cid)
                descendants.extend(comps)
        if len(child_ids) != 1:
            raise A2uiXmlValidationError(
                f"<Template> on line {elem.line} must contain exactly 1 child"
                f" component, got {len(child_ids)}."
            )
        return {"path": parsed_path.path, "componentId": child_ids[0]}, descendants

    def _compile_item_element(
        self,
        comp_name: str,
        helper: CatalogSchemaHelper,
        properties: list[str],
        elem: ElementNode,
        ctx: _CompileContext,
        *,
        forced_target_prop: str | None = None,
        existing_slot_items: dict[str, list[dict[str, Any]]] | None = None,
    ) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
        """Compiles ``<Item ...>`` into an entry for an object-array property."""
        explicit_slot = elem.attrs.get("slot")
        if forced_target_prop is not None:
            target_prop = forced_target_prop
        elif explicit_slot:
            target_prop = self._resolve_property_name(
                comp_name, explicit_slot, properties, line=elem.line, ctx=ctx
            )
        else:
            obj_array_props: list[str] = []
            structured_props: list[str] = []
            for p in properties:
                p_schema = helper.get_property_schema(comp_name, p)
                item_schema = helper.resolve_item_schema(p_schema)
                if isinstance(item_schema, dict) and (
                    item_schema.get("type") == "object" or "properties" in item_schema
                ):
                    obj_array_props.append(p)
                    if isinstance(item_schema.get("properties"), dict):
                        structured_props.append(p)
            if len(obj_array_props) == 1:
                target_prop = obj_array_props[0]
            elif len(structured_props) == 1:
                target_prop = structured_props[0]
            else:
                attr_keys = {k for k in elem.attrs if k != "slot"}
                matching = [
                    p
                    for p in structured_props
                    if attr_keys
                    and attr_keys.issubset(
                        set(
                            (
                                helper.resolve_item_schema(
                                    helper.get_property_schema(comp_name, p)
                                )
                                or {}
                            ).get("properties", {})
                        )
                    )
                ]
                if len(matching) == 1:
                    target_prop = matching[0]
                else:
                    raise A2uiXmlValidationError(
                        f"<Item> inside <{comp_name}> on line {elem.line} must specify"
                        f' slot="..." (candidates: {obj_array_props}).'
                    )

        prop_schema = helper.get_property_schema(comp_name, target_prop)
        item_schema = helper.resolve_item_schema(prop_schema) or {}
        item_props = (
            item_schema.get("properties", {}) if isinstance(item_schema, dict) else {}
        )
        item_required_set = set(
            item_schema.get("required", []) if isinstance(item_schema, dict) else []
        )

        child_subprops = [
            k for k, v in item_props.items() if _schema_ref_kind(v) == "Child"
        ]
        child_list_subprops = [
            k for k, v in item_props.items() if _schema_ref_kind(v) == "ChildList"
        ]
        nested_obj_subprops: dict[str, dict[str, Any]] = {}
        for k, v in item_props.items():
            if _schema_ref_kind(v) is None and isinstance(v, dict):
                obj_branch = self._extract_object_branch(v)
                if obj_branch is not None:
                    nested_obj_subprops[k] = obj_branch

        default_sub_slot = (
            child_list_subprops[0]
            if child_list_subprops
            else (child_subprops[0] if len(child_subprops) == 1 else None)
        )

        item_obj: dict[str, Any] = {}
        descendants: list[dict[str, Any]] = []
        sub_children: dict[str, list[str]] = {}

        disallow_extra_item_props = (
            bool(item_props) and item_schema.get("additionalProperties") is False
        )
        item_prop_list = list(item_props)

        for k, raw_v in elem.attrs.items():
            if k == "slot":
                continue
            if disallow_extra_item_props:
                try:
                    resolved_k = self._resolve_property_name(
                        f"{comp_name}.{target_prop}",
                        k,
                        item_prop_list,
                        line=elem.line,
                        ctx=ctx,
                    )
                except A2uiXmlValidationError:
                    if ctx.tuned and not ctx.strict:
                        # Decompose camelCase nested object shorthand (e.g. `leadingIcon="storage"` -> `leading.icon`)
                        decomposed = self._try_decompose_nested_obj_attr(
                            k,
                            raw_v,
                            nested_obj_subprops,
                            helper,
                            ctx,
                            owner=f"{comp_name}.{target_prop}",
                            line=elem.line,
                        )
                        if decomposed is not None:
                            obj_k, sub_k, sub_val = decomposed
                            existing_nested = item_obj.get(obj_k)
                            if not isinstance(existing_nested, dict):
                                existing_nested = {}
                                item_obj[obj_k] = existing_nested
                            existing_nested[sub_k] = sub_val
                            continue
                        ctx.violations.append(
                            A2uiXmlStrictViolation(
                                law="unknown_optional_attr_dropped",
                                message=(
                                    f"Dropped unknown optional attribute {k!r} on"
                                    f" <Item> for <{comp_name}>.{target_prop}."
                                ),
                                line=elem.line,
                            )
                        )
                        continue
                    raise
            else:
                resolved_k = k

            sub_schema = helper.resolve_property_schema(item_schema, resolved_k)
            sub_kind = _schema_ref_kind(sub_schema)
            if sub_kind == "Child":
                item_obj[resolved_k] = raw_v
                continue
            parsed_v, _ = parse_attribute_value(
                raw_v,
                sub_schema,
                helper,
                is_action=(sub_kind == "Action" or is_action_slot(sub_schema)),
                known_functions=self._known_functions,
                strict=ctx.strict,
                tuned=ctx.tuned,
            )
            compiled_sub = self._compile_expr_value(
                parsed_v,
                ctx,
                is_action=(sub_kind == "Action" or is_action_slot(sub_schema)),
                prop_schema=sub_schema,
                helper=helper,
                comp_name=f"{comp_name}.{target_prop}",
                prop_name=resolved_k,
                is_required=(resolved_k in item_required_set),
                line=elem.line,
            )
            if compiled_sub is not _DROP_OPTIONAL:
                item_obj[resolved_k] = compiled_sub

        item_prose_chunks: list[str] = []
        positional_cell_texts: list[str] = []

        for child in elem.children:
            if isinstance(child, FenceNode):
                f_key = child.info.strip()
                if not f_key:
                    if (
                        ctx.tuned
                        and not ctx.strict
                        and not item_props
                        and item_schema.get("type") == "object"
                    ):
                        try:
                            raw_map = json.loads(child.content)
                        except json.JSONDecodeError as exc:
                            raise A2uiXmlParseError(
                                "Invalid JSON inside <Item> fence on line"
                                f" {child.line}: {exc}"
                            ) from exc
                        if isinstance(raw_map, dict):
                            item_obj.update(self._stamp_json_calls(raw_map, ctx))
                            continue
                    raise A2uiXmlValidationError(
                        f"Fenced JSON inside <Item> on line {child.line} requires a"
                        " property name."
                    )
                if disallow_extra_item_props:
                    try:
                        f_key = self._resolve_property_name(
                            f"{comp_name}.{target_prop}",
                            f_key,
                            item_prop_list,
                            line=child.line,
                            ctx=ctx,
                        )
                    except A2uiXmlValidationError:
                        if ctx.tuned and not ctx.strict:
                            ctx.violations.append(
                                A2uiXmlStrictViolation(
                                    law="unknown_optional_attr_dropped",
                                    message=(
                                        f"Dropped unknown fenced property {f_key!r}"
                                        " inside <Item> for"
                                        f" <{comp_name}>.{target_prop}."
                                    ),
                                    line=child.line,
                                )
                            )
                            continue
                        raise
                f_sub_schema = helper.resolve_property_schema(item_schema, f_key)
                try:
                    f_parsed = json.loads(child.content)
                except json.JSONDecodeError as exc:
                    raw_f = child.content.strip()
                    if (
                        ctx.tuned
                        and not ctx.strict
                        and raw_f.startswith("$")
                        and (
                            f_sub_schema is None
                            or schema_allows_databinding(f_sub_schema)
                        )
                    ):
                        p_expr, _ = parse_attribute_value(
                            raw_f,
                            f_sub_schema,
                            helper,
                            known_functions=self._known_functions,
                            strict=ctx.strict,
                            tuned=ctx.tuned,
                        )
                        c_expr = self._compile_expr_value(
                            p_expr,
                            ctx,
                            prop_schema=f_sub_schema,
                            helper=helper,
                            comp_name=f"{comp_name}.{target_prop}",
                            prop_name=f_key,
                            is_required=(f_key in item_required_set),
                            line=child.line,
                        )
                        if c_expr is not _DROP_OPTIONAL:
                            item_obj[f_key] = c_expr
                        ctx.violations.append(
                            A2uiXmlStrictViolation(
                                law="law4_expr_in_fence",
                                message=(
                                    f"Recovered expression {raw_f!r} inside <Item>"
                                    f" {f_key} fence."
                                ),
                                line=child.line,
                            )
                        )
                        continue
                    raise A2uiXmlParseError(
                        f"Invalid JSON inside <Item> fence on line {child.line}: {exc}"
                    ) from exc

                stamped_f = self._stamp_json_calls(f_parsed, ctx)
                if ctx.tuned and not ctx.strict and f_sub_schema is not None:
                    stamped_f = self._sanitize_schema_value(
                        stamped_f,
                        f_sub_schema,
                        helper,
                        ctx,
                        owner=f"{comp_name}.{target_prop}.{f_key}",
                        line=child.line,
                    )
                item_obj[f_key] = stamped_f
                continue

            if (
                ctx.tuned
                and not ctx.strict
                and isinstance(child, ProseNode)
                and child.kind == "prose"
                and default_sub_slot is None
                and not child_subprops
            ):
                item_prose_chunks.append(child.text)
                continue

            if ctx.tuned and not ctx.strict and isinstance(child, ElementNode):
                # 1. Nested object sub-property inside `<Item>` (e.g. `<MaterialIcon slot="leading" icon="..." />`)
                nested_hit = self._try_extract_nested_object_child_in_item(
                    child,
                    nested_obj_subprops,
                    item_obj,
                    helper,
                    ctx,
                    owner=f"{comp_name}.{target_prop}",
                )
                if nested_hit is not None:
                    obj_slot_key, nested_dict = nested_hit
                    item_obj[obj_slot_key] = nested_dict
                    continue

                # 2. Positional cell subtags inside free-form row items (e.g. `<MaterialTableRow><MaterialTableCell>Dev</MaterialTableCell></MaterialTableRow>`)
                if (
                    not item_props
                    and item_schema.get("type") == "object"
                    and all(isinstance(gc, ProseNode) for gc in child.children)
                ):
                    prose_txts = [
                        gc.text for gc in child.children if isinstance(gc, ProseNode)
                    ]
                    cell_text = (
                        "\n".join(prose_txts)
                        if prose_txts
                        else (
                            child.attrs.get("text")
                            or child.attrs.get("value")
                            or child.attrs.get("label")
                            or ""
                        )
                    )
                    key_attr = (
                        child.attrs.get("field")
                        or child.attrs.get("key")
                        or child.attrs.get("column")
                    )
                    if key_attr:
                        item_obj[key_attr] = cell_text
                    else:
                        positional_cell_texts.append(cell_text)
                    continue

                # 3. Slot wrapper inside `<Item>` (e.g. `<Child slot="body">...</Child>`)
                unwrapped_item = self._unwrap_slot_wrapper_tag(
                    child,
                    f"{comp_name}.{target_prop}",
                    item_prop_list,
                    child_subprops,
                    child_list_subprops,
                    ctx,
                )
                if unwrapped_item is not None:
                    uw_slot, uw_nodes = unwrapped_item
                    for uw_n in uw_nodes:
                        uw_cid, uw_comps = self._compile_flow_node(uw_n, ctx)
                        if uw_cid is not None:
                            sub_children.setdefault(uw_slot, []).append(uw_cid)
                            descendants.extend(uw_comps)
                    continue

            explicit_sub_slot = self._extract_parent_slot(child, strict=ctx.strict)
            sub_slot = explicit_sub_slot or default_sub_slot
            if sub_slot is None:
                raise A2uiXmlValidationError(
                    f"Nested element inside <Item> on line {elem.line} has no target"
                    " child property."
                )
            if disallow_extra_item_props:
                sub_slot = self._resolve_property_name(
                    f"{comp_name}.{target_prop}",
                    sub_slot,
                    item_prop_list,
                    line=elem.line,
                    ctx=ctx,
                )
            if (
                isinstance(child, ElementNode)
                and self._is_child_helper_tag(child) == "Ref"
            ):
                ref_id = child.attrs.get("id")
                if not ref_id:
                    raise A2uiXmlValidationError(
                        f'<Ref> inside <Item> on line {child.line} requires id="...".'
                    )
                sub_children.setdefault(sub_slot, []).append(ref_id)
                continue
            cid, child_comps = self._compile_flow_node(child, ctx)
            if cid is not None:
                sub_children.setdefault(sub_slot, []).append(cid)
                descendants.extend(child_comps)

        if ctx.tuned and not ctx.strict:
            if positional_cell_texts and existing_slot_items:
                col_fields: list[str] = []
                for sib_items in existing_slot_items.values():
                    if sib_items and all(
                        isinstance(it.get("field"), str) for it in sib_items
                    ):
                        col_fields = [str(it["field"]) for it in sib_items]
                        break
                for idx, c_txt in enumerate(positional_cell_texts):
                    col_k = (
                        col_fields[idx] if idx < len(col_fields) else f"col{idx + 1}"
                    )
                    item_obj.setdefault(col_k, c_txt)

            if item_prose_chunks:
                prose_str = "\n".join(item_prose_chunks)
                target_str_field: str | None = None
                for req_k in item_schema.get("required", []):
                    if req_k not in item_obj:
                        rk_schema = helper.resolve_property_schema(item_schema, req_k)
                        if schema_accepts_type(
                            rk_schema, "string"
                        ) and not self._schema_enum_values(rk_schema):
                            target_str_field = req_k
                            break
                if target_str_field is None:
                    for opt_k in ("label", "headline", "title", "text", "header"):
                        if opt_k in item_props and opt_k not in item_obj:
                            target_str_field = opt_k
                            break
                if target_str_field is not None:
                    item_obj[target_str_field] = prose_str
                    ctx.violations.append(
                        A2uiXmlStrictViolation(
                            law="law3_leaf_body_text",
                            message=(
                                f"Mapped inner text of <{elem.tag}> onto"
                                f" {target_str_field!r}."
                            ),
                            line=elem.line,
                        )
                    )

        for s_key, c_ids in sub_children.items():
            if s_key in child_list_subprops:
                item_obj[s_key] = c_ids
            elif len(c_ids) == 1:
                item_obj[s_key] = c_ids[0]
            else:
                container_info = self._find_layout_list_container()
                if ctx.strict or container_info is None:
                    raise A2uiXmlValidationError(
                        f"Item property {s_key!r} expects a single child component, got"
                        f" {len(c_ids)}."
                    )
                c_name, c_prop, _, c_cat = container_info
                wrap_id = ctx.allocate_id()
                wrap_comp: dict[str, Any] = {
                    "id": wrap_id,
                    "component": c_name,
                    c_prop: c_ids,
                }
                if c_cat is not None:
                    wrap_comp["catalogId"] = c_cat
                descendants.insert(0, wrap_comp)
                item_obj[s_key] = wrap_id
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="single_child_auto_wrap",
                        message=f"Auto-wrapped {len(c_ids)} children in <Item>.",
                        line=elem.line,
                    )
                )

        if ctx.tuned and not ctx.strict:
            missing_reqs = [
                rk for rk in item_schema.get("required", []) if rk not in item_obj
            ]
            if len(missing_reqs) == 1:
                m_req = missing_reqs[0]
                m_schema = helper.resolve_property_schema(item_schema, m_req)
                if schema_accepts_type(
                    m_schema, "string"
                ) and not self._schema_enum_values(m_schema):
                    fallback_str: str | None = None
                    for donor_k in (
                        "value",
                        "label",
                        "header",
                        "field",
                        "title",
                        "headline",
                    ):
                        dv = item_obj.get(donor_k)
                        if isinstance(dv, str) and dv:
                            fallback_str = dv
                            break
                    if fallback_str is None:
                        str_vals = [
                            v for v in item_obj.values() if isinstance(v, str) and v
                        ]
                        if len(str_vals) == 1:
                            fallback_str = str_vals[0]
                    if fallback_str is not None:
                        item_obj[m_req] = fallback_str
                        ctx.violations.append(
                            A2uiXmlStrictViolation(
                                law="item_required_string_backfill",
                                message=(
                                    "Backfilled missing required string field"
                                    f" {m_req!r} on <Item> for"
                                    f" <{comp_name}>.{target_prop}."
                                ),
                                line=elem.line,
                            )
                        )

        for req_k in item_schema.get("required", []):
            if req_k not in item_obj:
                raise A2uiXmlValidationError(
                    f"<Item> for <{comp_name}>.{target_prop} on line {elem.line} is"
                    f" missing required field {req_k!r}."
                )

        return target_prop, item_obj, descendants

    def _try_decompose_nested_obj_attr(
        self,
        attr_key: str,
        raw_v: str,
        nested_obj_subprops: dict[str, dict[str, Any]],
        helper: CatalogSchemaHelper,
        ctx: _CompileContext,
        *,
        owner: str,
        line: int,
    ) -> tuple[str, str, Any] | None:
        """Maps camelCase ``leadingIcon="..."`` onto nested object ``leading.icon``."""
        norm_attr = _normalize_identifier_key(attr_key)
        for obj_k, obj_schema in nested_obj_subprops.items():
            norm_obj = _normalize_identifier_key(obj_k)
            if not norm_attr.startswith(norm_obj) or len(norm_attr) <= len(norm_obj):
                continue
            rem = norm_attr[len(norm_obj) :]
            obj_props = obj_schema.get("properties", {})
            if not isinstance(obj_props, dict):
                continue
            sub_matches = [
                sk for sk in obj_props if _normalize_identifier_key(sk) == rem
            ]
            if len(sub_matches) == 1:
                sub_k = sub_matches[0]
                sub_s = obj_props.get(sub_k)
                parsed_v, _ = parse_attribute_value(
                    raw_v,
                    sub_s if isinstance(sub_s, dict) else None,
                    helper,
                    is_action=is_action_slot(sub_s),
                    known_functions=self._known_functions,
                    strict=ctx.strict,
                    tuned=ctx.tuned,
                )
                compiled_v = self._compile_expr_value(
                    parsed_v,
                    ctx,
                    is_action=is_action_slot(sub_s),
                    prop_schema=sub_s if isinstance(sub_s, dict) else None,
                    helper=helper,
                    comp_name=f"{owner}.{obj_k}",
                    prop_name=sub_k,
                    is_required=(sub_k in (obj_schema.get("required") or [])),
                    line=line,
                )
                if compiled_v is _DROP_OPTIONAL:
                    return None
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="prop_name_normalization",
                        message=f"Mapped {attr_key!r} -> {obj_k}.{sub_k} on {owner}.",
                        line=line,
                    )
                )
                return obj_k, sub_k, compiled_v
        return None

    def _try_extract_nested_object_child_in_item(
        self,
        child: ElementNode,
        nested_obj_subprops: dict[str, dict[str, Any]],
        item_obj: dict[str, Any],
        helper: CatalogSchemaHelper,
        ctx: _CompileContext,
        *,
        owner: str,
    ) -> tuple[str, dict[str, Any]] | None:
        """Converts ``<MaterialIcon slot="leading" icon="..." />`` inside ``<Item>`` into a nested object."""
        if not nested_obj_subprops:
            return None
        explicit_slot = child.attrs.get("slot")
        target_obj_key: str | None = None
        if explicit_slot:
            hits = [
                ok
                for ok in nested_obj_subprops
                if _normalize_identifier_key(ok)
                == _normalize_identifier_key(explicit_slot)
            ]
            if len(hits) == 1:
                target_obj_key = hits[0]
        else:
            # Tag named directly after nested object property (e.g. `<Leading icon="..." />`)
            tag_hits = [
                ok
                for ok in nested_obj_subprops
                if _normalize_identifier_key(ok) == _normalize_identifier_key(child.tag)
            ]
            if len(tag_hits) == 1:
                target_obj_key = tag_hits[0]
            else:
                cand_attrs = {
                    _normalize_identifier_key(k)
                    for k in child.attrs
                    if k not in ("slot", "id", "catalogId")
                }
                if cand_attrs:
                    for ok, osch in nested_obj_subprops.items():
                        if ok in item_obj:
                            continue
                        oprops = osch.get("properties", {})
                        if isinstance(oprops, dict) and (
                            cand_attrs
                            & {_normalize_identifier_key(pk) for pk in oprops}
                        ):
                            target_obj_key = ok
                            break
        if target_obj_key is None:
            return None

        obj_schema = nested_obj_subprops[target_obj_key]
        obj_props = obj_schema.get("properties", {})
        if not isinstance(obj_props, dict):
            return None
        disallow_extra = obj_schema.get("additionalProperties") is False
        req_set = set(obj_schema.get("required") or [])
        extracted: dict[str, Any] = {}
        for ck, cr in child.attrs.items():
            if ck in ("slot", "id", "catalogId"):
                continue
            matched_pk: str | None = None
            if ck in obj_props:
                matched_pk = ck
            else:
                norm_ck = _normalize_identifier_key(ck)
                p_hits = [
                    pk for pk in obj_props if _normalize_identifier_key(pk) == norm_ck
                ]
                if len(p_hits) == 1:
                    matched_pk = p_hits[0]
                elif norm_ck in ("name", "symbol") and "icon" in obj_props:
                    matched_pk = "icon"
                elif norm_ck == "label" and "text" in obj_props:
                    matched_pk = "text"
            if matched_pk is None:
                if disallow_extra:
                    continue
                matched_pk = ck
            sub_s = obj_props.get(matched_pk)
            parsed_v, _ = parse_attribute_value(
                cr,
                sub_s if isinstance(sub_s, dict) else None,
                helper,
                is_action=is_action_slot(sub_s),
                known_functions=self._known_functions,
                strict=ctx.strict,
                tuned=ctx.tuned,
            )
            compiled_v = self._compile_expr_value(
                parsed_v,
                ctx,
                is_action=is_action_slot(sub_s),
                prop_schema=sub_s if isinstance(sub_s, dict) else None,
                helper=helper,
                comp_name=f"{owner}.{target_obj_key}",
                prop_name=matched_pk,
                is_required=(matched_pk in req_set),
                line=child.line,
            )
            if compiled_v is not _DROP_OPTIONAL:
                extracted[matched_pk] = compiled_v

        if not extracted and child.children:
            prose_parts = [
                gc.text for gc in child.children if isinstance(gc, ProseNode)
            ]
            if prose_parts and "text" in obj_props:
                extracted["text"] = "\n".join(prose_parts)
        if not extracted:
            return None
        ctx.violations.append(
            A2uiXmlStrictViolation(
                law="law4_nested_object_element",
                message=(
                    f"Converted child <{child.tag}> inside <Item> into"
                    f" {owner}.{target_obj_key} object."
                ),
                line=child.line,
            )
        )
        return target_obj_key, extracted

    def _compile_action_element(
        self, elem: ElementNode, ctx: _CompileContext
    ) -> dict[str, Any]:
        """Compiles ``<Action name="..." ...>`` or ``<Action call="..." ...>``."""
        if "call" in elem.attrs:
            return self._compile_call_element(elem, ctx, is_action=True)

        event_name_raw = elem.attrs.get("name") or elem.attrs.get("event")
        if not event_name_raw:
            raise A2uiXmlValidationError(
                f'<Action> on line {elem.line} requires name="..." or call="...".'
            )
        parsed_name, _ = parse_attribute_value(
            event_name_raw,
            None,
            None,
            known_functions=self._known_functions,
            strict=ctx.strict,
            tuned=ctx.tuned,
        )
        event_dict: dict[str, Any] = {
            "name": self._compile_expr_value(parsed_name, ctx, line=elem.line)
        }

        if "userMessage" in elem.attrs:
            if not ctx.at_least_v10:
                raise A2uiXmlValidationError(
                    "Action userMessage requires A2UI v1.0 or later (target is"
                    f" {ctx.version})."
                )
            parsed_msg, _ = parse_attribute_value(
                elem.attrs["userMessage"],
                None,
                None,
                known_functions=self._known_functions,
                strict=ctx.strict,
                tuned=ctx.tuned,
            )
            event_dict["userMessage"] = self._compile_expr_value(
                parsed_msg, ctx, line=elem.line
            )

        context_map: dict[str, Any] = {}
        has_context = False
        for k, v in elem.attrs.items():
            if k in ("slot", "name", "event", "userMessage"):
                continue
            has_context = True
            parsed_v, _ = parse_attribute_value(
                v,
                None,
                None,
                known_functions=self._known_functions,
                strict=ctx.strict,
                tuned=ctx.tuned,
            )
            context_map[k] = self._compile_expr_value(parsed_v, ctx, line=elem.line)

        for child in elem.children:
            if isinstance(child, FenceNode):
                has_context = True
                try:
                    f_ctx = json.loads(child.content)
                except json.JSONDecodeError as exc:
                    raise A2uiXmlParseError(
                        f"Invalid JSON in <Action> context fence on line {child.line}:"
                        f" {exc}"
                    ) from exc
                if not isinstance(f_ctx, dict):
                    raise A2uiXmlValidationError(
                        "<Action> context fence must be an object."
                    )
                context_map.update(self._stamp_json_calls(f_ctx, ctx))

        if has_context:
            event_dict["context"] = context_map
        return {"event": event_dict}

    def _compile_call_element(
        self, elem: ElementNode, ctx: _CompileContext, *, is_action: bool
    ) -> dict[str, Any]:
        fn_raw = elem.attrs.get("call") or elem.attrs.get("name")
        if not fn_raw:
            raise A2uiXmlValidationError(
                f'<{elem.tag}> on line {elem.line} requires name="..." or call="...".'
            )
        explicit_cat = elem.attrs.get("catalogId")
        fn_name, fn_helper, write_cat = self._resolve_catalog_entry(
            "function", fn_raw, explicit_cat, ctx, line=elem.line
        )
        fn_props = fn_helper.get_function_properties(fn_name)
        fn_req_set = set(fn_helper.get_function_required(fn_name))
        compiled_args: dict[str, Any] = {}

        for child in elem.children:
            if isinstance(child, FenceNode):
                try:
                    f_args = json.loads(child.content)
                except json.JSONDecodeError as exc:
                    raise A2uiXmlParseError(
                        f"Invalid JSON in <{elem.tag}> args fence on line {child.line}:"
                        f" {exc}"
                    ) from exc
                if isinstance(f_args, dict):
                    info_key = child.info.strip()
                    if info_key and info_key != "args" and info_key in fn_props:
                        compiled_args[info_key] = self._stamp_json_calls(f_args, ctx)
                    else:
                        compiled_args.update(self._stamp_json_calls(f_args, ctx))
                else:
                    info_key = child.info.strip()
                    if not info_key or info_key not in fn_props:
                        raise A2uiXmlValidationError(
                            f"Array/primitive fence inside <{elem.tag}> must name a"
                            f" valid parameter of {fn_name} ({fn_props})."
                        )
                    compiled_args[info_key] = self._stamp_json_calls(f_args, ctx)

        for k, raw_v in elem.attrs.items():
            if k in (
                "prop",
                "slot",
                "call",
                "name",
                "id",
                "functionCallId",
                "catalogId",
            ):
                continue
            if k not in fn_props:
                if ctx.tuned and not ctx.strict:
                    continue
                raise A2uiXmlValidationError(
                    f"Unknown parameter {k!r} for function {fn_name!r} on line"
                    f" {elem.line}. Allowed: {fn_props}"
                )
            arg_schema = fn_helper.get_function_property_schema(fn_name, k)
            parsed_v, _ = parse_attribute_value(
                raw_v,
                arg_schema,
                fn_helper,
                known_functions=self._known_functions,
                strict=ctx.strict,
                tuned=ctx.tuned,
            )
            compiled_arg = self._compile_expr_value(
                parsed_v,
                ctx,
                prop_schema=arg_schema,
                helper=fn_helper,
                comp_name=fn_name,
                prop_name=k,
                is_required=(k in fn_req_set),
                line=elem.line,
            )
            if compiled_arg is not _DROP_OPTIONAL:
                compiled_args[k] = compiled_arg

        res: dict[str, Any] = {ctx.call_key: fn_name}
        if write_cat is not None:
            res["catalogId"] = write_cat
        res["args"] = compiled_args
        return {"functionCall": res} if is_action else res

    def _compile_standalone_call(
        self, elem: ElementNode, ctx: _CompileContext
    ) -> dict[str, Any]:
        if not ctx.at_least_v10:
            raise A2uiXmlValidationError(
                f"Standalone <CallFunction> is not supported in A2UI {ctx.version}."
            )
        ctx.call_counter += 1
        call_id = (
            elem.attrs.get("id")
            or elem.attrs.get("functionCallId")
            or f"call_{ctx.call_counter}"
        )
        if not call_id:
            raise A2uiXmlValidationError("<CallFunction> id cannot be empty.")

        compiled_fn = self._compile_call_element(elem, ctx, is_action=False)
        resolved_cat = compiled_fn.get("catalogId")
        if resolved_cat is None:
            fn_name = compiled_fn[ctx.call_key]
            defining = catalogs_defining(self.helpers, "function", fn_name)
            resolved_cat = defining[0] if defining else self._catalogs[0].catalog_id

        return {
            "version": ctx.version,
            "callRendererFunction": {
                "functionCallId": call_id,
                "callFunction": {
                    "catalogId": resolved_cat,
                    ctx.call_key: compiled_fn[ctx.call_key],
                    "args": compiled_fn.get("args", {}),
                },
            },
        }

    def _compile_check_rule(
        self, item: CheckExpr | ElementNode, ctx: _CompileContext
    ) -> dict[str, Any]:
        """Compiles either a ``<Check ... />`` element or a ``?check(...)`` expression."""
        if isinstance(item, ElementNode):
            message = item.attrs.get("message")
            if "condition" in item.attrs and "call" not in item.attrs:
                raw_cond = item.attrs["condition"].strip()
                expr = parse_expression(raw_cond)
                compiled_cond = self._compile_expr_value(expr, ctx, line=item.line)
                return {
                    "condition": compiled_cond,
                    "message": message or "Validation check failed",
                }

            fn_raw = item.attrs.get("call") or item.attrs.get("name")
            if not fn_raw:
                raise A2uiXmlValidationError(
                    f'<Check> on line {item.line} requires call="..." or'
                    ' condition="...".'
                )
            explicit_cat = item.attrs.get("catalogId")
            fn_name, fn_helper, write_cat = self._resolve_catalog_entry(
                "function", fn_raw, explicit_cat, ctx, line=item.line
            )
            fn_props = fn_helper.get_function_properties(fn_name)
            fn_req_set = set(fn_helper.get_function_required(fn_name))
            compiled_args: dict[str, Any] = {}

            for child in item.children:
                if isinstance(child, FenceNode):
                    try:
                        f_val = json.loads(child.content)
                    except json.JSONDecodeError as exc:
                        raise A2uiXmlParseError(
                            f"Invalid JSON in <Check> fence on line {child.line}: {exc}"
                        ) from exc
                    info_key = child.info.strip()
                    if isinstance(f_val, dict) and (not info_key or info_key == "args"):
                        compiled_args.update(self._stamp_json_calls(f_val, ctx))
                    elif info_key in fn_props:
                        compiled_args[info_key] = self._stamp_json_calls(f_val, ctx)
                    else:
                        raise A2uiXmlValidationError(
                            f"Fence inside <Check call={fn_name!r}> must name a valid"
                            f" argument ({fn_props})."
                        )

            for k, raw_v in item.attrs.items():
                if k in ("call", "name", "message", "catalogId"):
                    continue
                if k not in fn_props:
                    if ctx.tuned and not ctx.strict:
                        continue
                    raise A2uiXmlValidationError(
                        f"Unknown argument {k!r} on <Check call={fn_name!r}> (line"
                        f" {item.line}). Allowed: {fn_props}"
                    )
                arg_schema = fn_helper.get_function_property_schema(fn_name, k)
                parsed_v, _ = parse_attribute_value(
                    raw_v,
                    arg_schema,
                    fn_helper,
                    known_functions=self._known_functions,
                    strict=ctx.strict,
                    tuned=ctx.tuned,
                )
                compiled_arg = self._compile_expr_value(
                    parsed_v,
                    ctx,
                    prop_schema=arg_schema,
                    helper=fn_helper,
                    comp_name=fn_name,
                    prop_name=k,
                    is_required=(k in fn_req_set),
                    line=item.line,
                )
                if compiled_arg is not _DROP_OPTIONAL:
                    compiled_args[k] = compiled_arg

            if (
                "value" in fn_props
                and "value" not in compiled_args
                and ctx.active_value_binding is not None
            ):
                compiled_args["value"] = ctx.active_value_binding

            condition: dict[str, Any] = {ctx.call_key: fn_name}
            if write_cat is not None:
                condition["catalogId"] = write_cat
            condition["args"] = compiled_args
            return {
                "condition": condition,
                "message": message or f"{fn_name.capitalize()} check failed",
            }

        # Inline `?checkName(...)` expression
        explicit_cat = item.kwargs.get("catalogId")
        fn_name, fn_helper, write_cat = self._resolve_catalog_entry(
            "function", item.name, explicit_cat, ctx
        )
        fn_props = fn_helper.get_function_properties(fn_name)
        message_val = item.kwargs.get("message", f"{fn_name.capitalize()} check failed")
        compiled_args = {}

        value_injected = False
        if fn_props and fn_props[0] == "value":
            has_explicit_val = "value" in item.kwargs or (
                item.args and isinstance(item.args[0], PathExpr)
            )
            if not has_explicit_val and ctx.active_value_binding is not None:
                compiled_args["value"] = ctx.active_value_binding
                value_injected = True

        start_idx = 1 if value_injected else 0
        for idx, pos_arg in enumerate(item.args):
            target_idx = idx + start_idx
            if target_idx >= len(fn_props):
                if isinstance(pos_arg, str):
                    message_val = pos_arg
                continue
            p_name = fn_props[target_idx]
            p_schema = fn_helper.get_function_property_schema(fn_name, p_name)
            if (
                isinstance(pos_arg, str)
                and isinstance(p_schema, dict)
                and p_schema.get("type") in ("integer", "number", "boolean")
            ):
                message_val = pos_arg
                break
            if pos_arg is not None:
                compiled_args[p_name] = self._compile_expr_value(pos_arg, ctx)

        for k, v in item.kwargs.items():
            if k in ("catalogId", "message"):
                continue
            if k not in fn_props:
                if ctx.tuned and not ctx.strict:
                    continue
                raise A2uiXmlValidationError(
                    f"Unknown argument {k!r} in ?{fn_name}(...). Allowed: {fn_props}"
                )
            if v is not None:
                compiled_args[k] = self._compile_expr_value(v, ctx)

        condition = {ctx.call_key: fn_name}
        if write_cat is not None:
            condition["catalogId"] = write_cat
        condition["args"] = compiled_args
        return {"condition": condition, "message": message_val}

    def _schema_enum_values(self, schema: Any) -> list[Any] | None:
        """Finds an ``enum`` list in ``schema`` or its combinator sub-schemas."""
        if not isinstance(schema, dict):
            return None
        enum_list = schema.get("enum")
        if isinstance(enum_list, list):
            return enum_list
        for comb in ("oneOf", "anyOf", "allOf"):
            subs = schema.get(comb)
            if isinstance(subs, list):
                for sub in subs:
                    found = self._schema_enum_values(sub)
                    if found:
                        return found
        return None

    def _extract_object_branch(self, schema: Any) -> dict[str, Any] | None:
        """Finds a concrete ``{"type": "object", "properties": ...}`` branch in ``schema``."""
        if not isinstance(schema, dict):
            return None
        if isinstance(schema.get("properties"), dict) and "path" not in schema.get(
            "properties", {}
        ):
            return schema
        for comb in ("oneOf", "anyOf", "allOf"):
            subs = schema.get(comb)
            if isinstance(subs, list):
                for sub in subs:
                    found = self._extract_object_branch(sub)
                    if found is not None:
                        return found
        return None

    def _heal_enum_value(
        self,
        val: Any,
        enum_vals: list[Any],
        ctx: _CompileContext,
        *,
        owner_label: str,
        prop_name: str,
        is_required: bool,
        line: int | None,
    ) -> Any:
        """Validates or cures ``val`` against ``enum_vals``."""
        if val in enum_vals:
            return val
        if isinstance(val, str) and not ctx.strict:
            norm = _normalize_identifier_key(val)
            matches = [
                ev
                for ev in enum_vals
                if isinstance(ev, str) and _normalize_identifier_key(ev) == norm
            ]
            if len(matches) == 1:
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="enum_normalization",
                        message=(
                            f"Normalized enum value {val!r} -> {matches[0]!r} for"
                            f" <{owner_label} {prop_name}=...>."
                        ),
                        line=line,
                    )
                )
                return matches[0]

            if ctx.tuned:
                m_tier = _TIER_ENUM_RE.match(val.strip())
                if m_tier:
                    prefix_low = m_tier.group("prefix").lower()
                    target_num = int(m_tier.group("num"))
                    tiered: list[tuple[int, str]] = []
                    for ev in enum_vals:
                        if not isinstance(ev, str):
                            continue
                        m_ev = _TIER_ENUM_RE.match(ev)
                        if m_ev and m_ev.group("prefix").lower() == prefix_low:
                            tiered.append((int(m_ev.group("num")), ev))
                    if tiered:
                        _, clamped = min(
                            tiered, key=lambda pair: abs(pair[0] - target_num)
                        )
                        ctx.violations.append(
                            A2uiXmlStrictViolation(
                                law="enum_tier_clamp",
                                message=(
                                    f"Clamped numbered enum {val!r} -> {clamped!r}"
                                    f" for <{owner_label} {prop_name}=...>."
                                ),
                                line=line,
                            )
                        )
                        return clamped

        if ctx.tuned and not ctx.strict and not is_required:
            ctx.violations.append(
                A2uiXmlStrictViolation(
                    law="enum_invalid_optional_dropped",
                    message=(
                        f"Dropped invalid optional enum value {val!r} for"
                        f" <{owner_label} {prop_name}=...> (allowed: {enum_vals})."
                    ),
                    line=line,
                )
            )
            return _DROP_OPTIONAL

        raise A2uiXmlValidationError(
            f"Invalid value {val!r} for {prop_name!r} on <{owner_label}>."
            f" Allowed values: {enum_vals}"
        )

    def _coerce_scalar_to_object_schema(
        self,
        val: str,
        prop_schema: dict[str, Any],
        ctx: _CompileContext,
        *,
        owner_label: str,
        prop_name: str,
        line: int | None,
    ) -> dict[str, Any] | None:
        """Coerces a scalar string onto a structured object schema when unambiguous."""
        if schema_accepts_type(prop_schema, "string"):
            return None
        obj_branch = self._extract_object_branch(prop_schema)
        if obj_branch is None:
            return None
        obj_props = obj_branch.get("properties")
        if not isinstance(obj_props, dict) or not obj_props:
            return None

        # 1. `{<enum_field>, <string_field>}` 2-property pattern (matching `express_tuned`)
        if len(obj_props) == 2:
            enum_field: str | None = None
            enum_list: list[Any] | None = None
            str_field: str | None = None
            for pk, ps in obj_props.items():
                evs = self._schema_enum_values(ps)
                if evs:
                    enum_field = pk
                    enum_list = evs
                elif schema_accepts_type(ps, "string"):
                    str_field = pk
            if enum_field is not None and enum_list and str_field is not None:
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="scalar_to_nested_object",
                        message=(
                            f"Coerced scalar string {val!r} to"
                            f" {{{enum_field}: {enum_list[0]!r}, {str_field}: ...}}"
                            f" on <{owner_label} {prop_name}=...>."
                        ),
                        line=line,
                    )
                )
                return {enum_field: enum_list[0], str_field: val}

        # 2. ISO date `"YYYY-MM-DD..."` -> `{year, month, day}` integer object
        if set(obj_props) == {"year", "month", "day"}:
            m_date = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", val.strip())
            if m_date:
                ctx.violations.append(
                    A2uiXmlStrictViolation(
                        law="scalar_to_nested_object",
                        message=(
                            f"Parsed ISO date string {val!r} into {{year, month, day}}"
                            f" on <{owner_label} {prop_name}=...>."
                        ),
                        line=line,
                    )
                )
                return {
                    "year": int(m_date.group(1)),
                    "month": int(m_date.group(2)),
                    "day": int(m_date.group(3)),
                }

        # 3. General single-field string wrapper (e.g. `leading="gpp_maybe"` -> `{"icon": "gpp_maybe"}`)
        reqs = [
            rk
            for rk in obj_branch.get("required") or []
            if rk in obj_props and schema_accepts_type(obj_props[rk], "string")
        ]
        chosen_k: str | None = None
        if len(reqs) == 1 and len(obj_branch.get("required") or []) == 1:
            chosen_k = reqs[0]
        elif not obj_branch.get("required"):
            str_cands = [
                pk
                for pk, ps in obj_props.items()
                if schema_accepts_type(ps, "string")
                and not self._schema_enum_values(ps)
            ]
            if (
                "icon" in str_cands
                and "text" in str_cands
                and re.match(r"^[a-z0-9_]+$", val.strip())
            ):
                chosen_k = "icon"
            elif "text" in str_cands:
                chosen_k = "text"
            elif "icon" in str_cands:
                chosen_k = "icon"
            elif len(str_cands) == 1:
                chosen_k = str_cands[0]
        if chosen_k is not None:
            ctx.violations.append(
                A2uiXmlStrictViolation(
                    law="scalar_to_nested_object",
                    message=(
                        f"Wrapped scalar {val!r} into {{{chosen_k}: ...}} on"
                        f" <{owner_label} {prop_name}=...>."
                    ),
                    line=line,
                )
            )
            return {chosen_k: val}
        return None

    def _sanitize_schema_value(
        self,
        val: Any,
        schema: dict[str, Any],
        helper: CatalogSchemaHelper | None,
        ctx: _CompileContext,
        *,
        owner: str,
        line: int | None,
    ) -> Any:
        """Recursively sanitizes JSON dicts/lists against ``schema`` when ``ctx.tuned`` is True."""
        if isinstance(val, list):
            item_s = (
                helper.resolve_item_schema(schema)
                if helper is not None
                else schema.get("items")
            )
            if isinstance(item_s, dict):
                return [
                    self._sanitize_schema_value(
                        it, item_s, helper, ctx, owner=f"{owner}[]", line=line
                    )
                    for it in val
                ]
            return val

        if isinstance(val, dict):
            # Leave A2UI DataBinding / FunctionCall / Action envelopes untouched
            if (
                ctx.path_key in val
                or ctx.call_key in val
                or "event" in val
                or "functionCall" in val
            ):
                return val
            obj_branch = self._extract_object_branch(schema)
            if obj_branch is None:
                return val
            obj_props = obj_branch.get("properties")
            if not isinstance(obj_props, dict) or not obj_props:
                return val
            disallow_extra = obj_branch.get("additionalProperties") is False
            req_set = set(obj_branch.get("required") or [])
            clean: dict[str, Any] = {}
            for k, v in val.items():
                target_k: str | None = None
                if k in obj_props:
                    target_k = k
                else:
                    norm_k = _normalize_identifier_key(k)
                    hits = [
                        pk
                        for pk in obj_props
                        if _normalize_identifier_key(pk) == norm_k
                    ]
                    if len(hits) == 1:
                        target_k = hits[0]
                if target_k is None:
                    if disallow_extra:
                        ctx.violations.append(
                            A2uiXmlStrictViolation(
                                law="unknown_optional_attr_dropped",
                                message=(
                                    f"Dropped unknown property {k!r} on {owner}"
                                    " (additionalProperties: false)."
                                ),
                                line=line,
                            )
                        )
                        continue
                    clean[k] = v
                    continue

                sub_s = obj_props.get(target_k)
                if isinstance(sub_s, dict):
                    evs = self._schema_enum_values(sub_s)
                    if evs and not isinstance(v, (dict, list)):
                        healed_ev = self._heal_enum_value(
                            v,
                            evs,
                            ctx,
                            owner_label=owner,
                            prop_name=target_k,
                            is_required=(target_k in req_set),
                            line=line,
                        )
                        if healed_ev is _DROP_OPTIONAL:
                            continue
                        clean[target_k] = healed_ev
                        continue
                    clean[target_k] = self._sanitize_schema_value(
                        v,
                        sub_s,
                        helper,
                        ctx,
                        owner=f"{owner}.{target_k}",
                        line=line,
                    )
                else:
                    clean[target_k] = v
            return clean

        return val

    def _compile_expr_value(
        self,
        val: Any,
        ctx: _CompileContext,
        *,
        is_action: bool = False,
        prop_schema: dict[str, Any] | None = None,
        helper: CatalogSchemaHelper | None = None,
        comp_name: str | None = None,
        prop_name: str | None = None,
        is_required: bool | None = None,
        line: int | None = None,
    ) -> Any:
        """Compiles a parsed expression/primitive node into its A2UI JSON representation."""
        if isinstance(val, PathExpr):
            return {ctx.path_key: val.path}

        if isinstance(val, CheckExpr):
            return self._compile_check_rule(val, ctx)["condition"]

        if isinstance(val, CallExpr):
            if val.is_event or val.name == "Event":
                return self._compile_event_expr(val, ctx, line=line)
            return self._compile_function_expr(val, ctx, is_action=is_action, line=line)

        if isinstance(val, dict):
            compiled_dict = {
                k: self._compile_expr_value(v, ctx, line=line) for k, v in val.items()
            }
            if ctx.tuned and not ctx.strict and prop_schema is not None:
                return self._sanitize_schema_value(
                    compiled_dict,
                    prop_schema,
                    helper,
                    ctx,
                    owner=f"{comp_name or 'Object'}.{prop_name or ''}",
                    line=line,
                )
            return compiled_dict

        if isinstance(val, list):
            compiled_list = [
                self._compile_expr_value(item, ctx, line=line) for item in val
            ]
            if prop_schema and _schema_expects_option_objects(prop_schema):
                compiled_list = [
                    {"label": opt, "value": opt} if isinstance(opt, str) else opt
                    for opt in compiled_list
                ]
            if ctx.tuned and not ctx.strict and prop_schema is not None:
                return self._sanitize_schema_value(
                    compiled_list,
                    prop_schema,
                    helper,
                    ctx,
                    owner=f"{comp_name or 'Array'}.{prop_name or ''}",
                    line=line,
                )
            return compiled_list

        if (
            ctx.tuned
            and not ctx.strict
            and isinstance(val, str)
            and prop_schema is not None
            and not is_action
        ):
            coerced_obj = self._coerce_scalar_to_object_schema(
                val,
                prop_schema,
                ctx,
                owner_label=comp_name or "Object",
                prop_name=prop_name or "value",
                line=line,
            )
            if coerced_obj is not None:
                return coerced_obj

        # Validate enum constraints when value is a primitive literal
        enum_vals: list[Any] | None = None
        if (
            helper is not None
            and comp_name is not None
            and prop_name is not None
            and comp_name in helper.components
        ):
            enum_vals = helper.get_property_enum(comp_name, prop_name)
        elif ctx.tuned and prop_schema is not None:
            enum_vals = self._schema_enum_values(prop_schema)

        if enum_vals:
            effective_req = (
                is_required
                if is_required is not None
                else (
                    prop_name in helper.get_component_required(comp_name)
                    if (
                        helper is not None
                        and comp_name is not None
                        and prop_name is not None
                        and comp_name in helper.components
                    )
                    else True
                )
            )
            return self._heal_enum_value(
                val,
                enum_vals,
                ctx,
                owner_label=comp_name or "Component",
                prop_name=prop_name or "value",
                is_required=effective_req,
                line=line,
            )

        return val

    def _compile_event_expr(
        self, expr: CallExpr, ctx: _CompileContext, *, line: int | None = None
    ) -> dict[str, Any]:
        if not expr.args and "name" not in expr.kwargs:
            raise A2uiXmlValidationError("Event(...) requires an event name argument.")
        if len(expr.args) > 2:
            raise A2uiXmlValidationError(
                "Event(...) accepts at most 2 positional arguments (name, context),"
                f" got {len(expr.args)}."
            )
        if expr.args and "name" in expr.kwargs:
            raise A2uiXmlValidationError("Duplicate 'name' argument in Event(...).")

        allowed_kwargs = {"name", "context", "userMessage"}
        for k in expr.kwargs:
            if k not in allowed_kwargs:
                allowed_desc = "context, userMessage" if ctx.at_least_v10 else "context"
                raise A2uiXmlValidationError(
                    f"Unknown keyword argument {k!r} in Event(...). Allowed:"
                    f" {allowed_desc}."
                )

        event_name = (
            self._compile_expr_value(expr.args[0], ctx, line=line)
            if expr.args
            else self._compile_expr_value(expr.kwargs["name"], ctx, line=line)
        )
        event_dict: dict[str, Any] = {"name": event_name}

        if "userMessage" in expr.kwargs:
            if not ctx.at_least_v10:
                raise A2uiXmlValidationError(
                    "Event userMessage requires A2UI v1.0 or later (target is"
                    f" {ctx.version})."
                )
            user_msg = self._compile_expr_value(
                expr.kwargs["userMessage"], ctx, line=line
            )
            is_valid_msg = isinstance(user_msg, str) or (
                isinstance(user_msg, dict)
                and (ctx.path_key in user_msg or ctx.call_key in user_msg)
            )
            if not is_valid_msg:
                raise A2uiXmlValidationError(
                    "Event userMessage must be a string, $path binding, or function"
                    " call."
                )
            event_dict["userMessage"] = user_msg

        context_obj: dict[str, Any] = {}
        has_ctx = False
        if len(expr.args) == 2:
            has_ctx = True
            pos_ctx = self._compile_expr_value(expr.args[1], ctx, line=line)
            if not isinstance(pos_ctx, dict):
                raise A2uiXmlValidationError(
                    "Event second positional argument must be a map."
                )
            context_obj.update(pos_ctx)

        if "context" in expr.kwargs:
            if len(expr.args) == 2:
                raise A2uiXmlValidationError(
                    "Duplicate 'context' argument in Event(...)."
                )
            has_ctx = True
            kw_ctx = self._compile_expr_value(expr.kwargs["context"], ctx, line=line)
            if not isinstance(kw_ctx, dict):
                raise A2uiXmlValidationError("Event context=... must be a map.")
            context_obj.update(kw_ctx)

        if has_ctx:
            event_dict["context"] = context_obj
        return {"event": event_dict}

    def _compile_function_expr(
        self,
        expr: CallExpr,
        ctx: _CompileContext,
        *,
        is_action: bool,
        line: int | None = None,
    ) -> dict[str, Any]:
        explicit_cat = expr.kwargs.get("catalogId")
        fn_name, fn_helper, write_cat = self._resolve_catalog_entry(
            "function", expr.name, explicit_cat, ctx, line=line
        )
        fn_props = fn_helper.get_function_properties(fn_name)
        compiled_args: dict[str, Any] = {}

        for idx, pos_arg in enumerate(expr.args):
            if idx >= len(fn_props):
                raise A2uiXmlValidationError(
                    f"Function {fn_name!r} accepts at most {len(fn_props)} arguments"
                    f" ({fn_props}), got {len(expr.args)}."
                )
            if pos_arg is not None:
                compiled_args[fn_props[idx]] = self._compile_expr_value(
                    pos_arg, ctx, line=line
                )

        for k, v in expr.kwargs.items():
            if k == "catalogId":
                continue
            if k not in fn_props:
                raise A2uiXmlValidationError(
                    f"Unknown argument {k!r} for function {fn_name!r}. Allowed:"
                    f" {fn_props}"
                )
            if k in compiled_args:
                raise A2uiXmlValidationError(
                    f"Duplicate argument {k!r} in call to {fn_name!r}."
                )
            if v is not None:
                compiled_args[k] = self._compile_expr_value(v, ctx, line=line)

        res: dict[str, Any] = {ctx.call_key: fn_name}
        if write_cat is not None:
            res["catalogId"] = write_cat
        res["args"] = compiled_args
        return {"functionCall": res} if is_action else res
