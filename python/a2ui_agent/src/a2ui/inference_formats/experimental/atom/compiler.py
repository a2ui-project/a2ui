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

"""Compilation engine for A2UI Atom S-expressions.

An Atom block is a sequence of top-level forms. Each form either starts a new
message or adds to the message that the previous header started:

- `(surface "id" [:catalogId "c"] ...)` (or `createSurface`) starts a
  `createSurface`. Component trees and `(data ...)` forms that follow it, up
  to the next header, belong to it.
- `(updateComponents "id" [:catalogId "c"] ...)` starts an incremental
  `updateComponents` of an existing surface. `:catalogId` names the catalog
  that the surface was created with; it is not part of the message.
- `(updateDataModel "id" [:path "/p"] [:value v])` emits one
  `updateDataModel`.
- `(deleteSurface "id")` and `(callFunction name ...)` emit one message each.
- Component trees or `(data ...)` forms with no header before them form an
  implicit `createSurface` of the default surface; if that has data but no
  components it is emitted as a root `updateDataModel` instead.

A header may name a catalog only when there is a single catalog, and then it
must be that catalog. With several catalogs (A2UI v1.0 and later), a compiled
`createSurface` names no catalog, so the surface has no default catalog, and
every compiled component and function call carries its own `catalogId`: the
one the Atom text names, else the only catalog that defines that name.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
import json
import re
from typing import Any, Literal

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    check_dsl_catalogs,
    normalize_prompt_example_messages,
    surface_catalog_id,
    to_message_models,
)

from .sexpr import Form, Keyword, Symbol, is_keyword, is_symbol, parse_sexpr

_DATA_HEADS = ("data", "dataModel", "set!")
_SURFACE_HEADS = ("surface", "createSurface")
_RESERVED_HEADS = frozenset({
    *_DATA_HEADS,
    *_SURFACE_HEADS,
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callFunction",
    "Event",
    "event",
    "template",
    "a2ui",
    "@path",
})
# createSurface fields, other than the surface, catalog, components and data
# model, that a surface header may set, per protocol version.
_SURFACE_OPTION_KEYS_V1 = ("sendDataModel", "metadata")
_SURFACE_OPTION_KEYS_V09 = ("sendDataModel", "theme")
# Keywords that name the list a template iterates over, inside a template and
# on the component that holds it.
_TEMPLATE_PATH_KEYS = ("items", "dataset", "data", "source", "path")
_COMPONENT_TEMPLATE_PATH_KEYS = ("items", "dataset", "source", "path")
# Bare-string children are wrapped in a component whose only required property
# has one of these names. Catalog schemas do not mark a "text display"
# component, so the name is the only signal that tells `Text.text` apart from,
# for example, `Image.url`.
_TEXT_PROP_NAMES = ("text", "content", "label", "title")


@dataclass
class _Block:
    """A surface message under construction."""

    kind: str  # "create" or "update"
    surface_id: str
    explicit: bool
    components: list[dict[str, Any]] = field(default_factory=list)
    data_model: dict[str, Any] = field(default_factory=dict)
    data_updates: list[tuple[str, Any]] = field(default_factory=list)
    surface_options: dict[str, Any] = field(default_factory=dict)
    used_ids: set[str] = field(default_factory=set)

    def has_content(self) -> bool:
        return bool(self.components or self.data_model or self.data_updates)


def ref_kind(schema: Any) -> str | None:
    """Returns 'ChildList', 'Child' or 'Action' for a property schema's $ref."""
    if isinstance(schema, dict):
        ref = schema.get("$ref")
        if isinstance(ref, str):
            if "ChildList" in ref:
                return "ChildList"
            if "Child" in ref or "ComponentId" in ref:
                return "Child"
            if "Action" in ref:
                return "Action"
        for k in ("oneOf", "anyOf", "allOf"):
            subs = schema.get(k)
            if isinstance(subs, list):
                for sub in subs:
                    res = ref_kind(sub)
                    if res:
                        return res
    return None


def _head(expr: Any) -> str | None:
    """Returns the head symbol of a form or list, or None."""
    if isinstance(expr, list) and expr:
        first = expr[0]
        if isinstance(first, str) and not is_keyword(first):
            return str(first)
    return None


def _keyword_values(expr: list[Any], start: int = 1) -> dict[str, Any]:
    """Collects `:key value` pairs of a form, skipping positional items."""
    result: dict[str, Any] = {}
    i = start
    while i < len(expr):
        item = expr[i]
        if is_keyword(item):
            if i + 1 < len(expr):
                result.setdefault(item.name, expr[i + 1])
            i += 2
        else:
            i += 1
    return result


def _first_positional(items: Sequence[Any]) -> Any | None:
    """Returns the first item that is neither a keyword nor a keyword's value."""
    i = 0
    while i < len(items):
        if is_keyword(items[i]):
            i += 2
            continue
        return items[i]
    return None


def _plain(value: Any) -> Any:
    """Converts typed tokens back to plain Python values."""
    if isinstance(value, (Keyword, Symbol)):
        return str(value)
    return value


def positional_child_target(
    n_children: int,
    prop_keys: Sequence[str],
    child_list_prop: str | None,
    single_child_prop: str | None,
) -> str:
    """Returns the property that positional child components are assigned to.

    The decompiler uses the same rule to decide when it can nest children
    positionally.
    """
    if n_children == 1 and single_child_prop and "children" not in prop_keys:
        return single_child_prop
    if child_list_prop:
        return child_list_prop
    if n_children == 1 and single_child_prop:
        return single_child_prop
    return "children"


def child_props(
    helper: CatalogSchemaHelper, comp_type: str
) -> tuple[list[str], str | None, str | None]:
    """Returns (property keys, child list property, single child property).

    The child list property is the first property whose schema references
    `ChildList`, else a property named `children`. The single child property
    is the first property whose schema references `ComponentId`/`Child`, else
    a property named `child`.
    """
    prop_keys = [
        k
        for k in helper.get_component_properties(comp_type)
        if k not in ("id", "component", "catalogId")
    ]
    child_list = next(
        (k for k in prop_keys if helper.get_property_type(comp_type, k) == "ChildList"),
        "children" if "children" in prop_keys else None,
    )
    single = next(
        (k for k in prop_keys if helper.get_property_type(comp_type, k) == "Child"),
        "child" if "child" in prop_keys else None,
    )
    return prop_keys, child_list, single


class AtomCompiler:
    """Compiles Atom S-expressions into A2UI messages.

    The protocol version of the output is the catalogs' protocol version:

    - v1.0: one `createSurface` carrying `components` and `dataModel`; data
      bindings and function calls use `@path` and `@call`; components and
      function calls may carry a `catalogId`.
    - v0.9 and v0.9.1: `createSurface`, `updateComponents` and
      `updateDataModel` messages; bindings and calls use `path` and `call`;
      per-component and per-function `catalogId` and `callFunction` are
      rejected, as those versions do not define them.

    With a single catalog, `createSurface` names it and components and
    function calls without `:catalogId` use it. With several catalogs (v1.0
    only), `createSurface` names no catalog, so the surface has no default
    catalog. A component or function call then uses the catalog its
    `:catalogId` names, else the only catalog that defines its name, and the
    compiled component or call always carries that `catalogId`. A name that
    several catalogs define needs `:catalogId`.

    Attributes:
        catalogs: The active catalogs.
        version: The protocol version of the compiled messages.
    """

    def __init__(self, catalogs: Sequence[CatalogApi]):
        """Initializes an AtomCompiler instance.

        Args:
            catalogs: The catalogs to compile against.

        Raises:
            A2uiCatalogError: If no catalog is given, two catalogs share an
                ID, the catalogs target different protocol versions, there
                are several catalogs and they target a version before v1.0,
                or they target v0.8.
        """
        self._catalogs = check_dsl_catalogs(catalogs)
        self.version = to_protocol_version(self._catalogs[0].protocol_version)
        if self.version == ProtocolVersion.V0_8:
            raise A2uiCatalogError(
                "The Atom format supports catalogs for protocol v0.9, v0.9.1 and"
                " v1.0, got v0.8."
            )
        self._helpers = build_catalog_helpers(self._catalogs)
        self._surface_catalog_id = surface_catalog_id(self._catalogs)
        # The helper that unannotated components and function calls use, or
        # None when there are several catalogs and names are looked up.
        self._sole_helper: CatalogSchemaHelper | None = (
            self._helpers[self._surface_catalog_id]
            if self._surface_catalog_id is not None
            else None
        )
        self._is_v1 = self.version == ProtocolVersion.V1_0
        self._path_key = "@path" if self._is_v1 else "path"
        self._call_key = "@call" if self._is_v1 else "call"
        self._reserved_ids: set[str] = set()
        self._node_counter = 0
        self._call_counter = 0

    # ------------------------------------------------------------------
    # Catalog lookup
    # ------------------------------------------------------------------

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs, in the order the compiler received them."""
        return list(self._catalogs)

    def _helper_for(self, catalog_id: str) -> CatalogSchemaHelper:
        helper = self._helpers.get(catalog_id)
        if helper is None:
            raise ValueError(
                f"Unknown catalogId '{catalog_id}'. Available catalogs:"
                f" {list(self._helpers)}"
            )
        return helper

    def _require_v1(self, what: str) -> None:
        if not self._is_v1:
            raise ValueError(
                f"{what} requires protocol v1.0; the catalogs target"
                f" {self.version.value}."
            )

    def _catalog_by_name(
        self, kind: Literal["component", "function"], name: str
    ) -> str | None:
        """Finds the only catalog that defines a component or function name.

        Used with several catalogs, for a name written without `:catalogId`.

        Returns:
            The catalog ID, or None if no catalog defines the name.

        Raises:
            ValueError: If several catalogs define the name.
        """
        found = catalogs_defining(self._helpers, kind, name)
        if len(found) > 1:
            raise ValueError(
                f"The {kind} '{name}' is defined in several catalogs: {found}."
                f' Add :catalogId "<catalog_id>" to the {kind} to say which'
                " catalog it comes from."
            )
        return found[0] if found else None

    def _declares_arg(self, func_name: str, arg: str) -> bool:
        """Whether a catalog function named `func_name` declares `arg`."""
        return any(
            func_name in h.functions and arg in h.get_function_properties(func_name)
            for h in self._helpers.values()
        )

    def _all_names(self, kind: Literal["component", "function"]) -> list[str]:
        """The sorted component or function names that any catalog defines."""
        return sorted({
            name
            for h in self._helpers.values()
            for name in (h.components if kind == "component" else h.functions)
        })

    def _check_header_catalog(self, head: str, catalog_id: str | None) -> None:
        """Checks the catalog that a surface or update header names.

        Raises:
            ValueError: If the header names a catalog while there are several
                catalogs, or names an unknown catalog.
        """
        if catalog_id is None:
            return
        if self._sole_helper is None:
            raise ValueError(
                f"The ({head} ...) header names catalog '{catalog_id}', but a"
                " header may name a catalog only when there is a single"
                f" catalog. With several catalogs ({list(self._helpers)}) the"
                " surface has no default catalog: remove the catalog from the"
                " header, and add :catalogId to each component or function"
                " whose name several catalogs define."
            )
        self._helper_for(catalog_id)

    def _is_component_name(self, name: Any) -> bool:
        """Whether a name is a component in any active catalog."""
        if not isinstance(name, str) or is_keyword(name) or name in _RESERVED_HEADS:
            return False
        return any(name in h.components for h in self._helpers.values())

    def _is_component_form(self, expr: Any) -> bool:
        return self._is_component_name(_head(expr))

    def _is_value_form(self, expr: Any) -> bool:
        """Whether a form is a value: `(@path ...)` or a catalog function call."""
        head = _head(expr)
        if head is None or not is_symbol(expr[0]):
            return False
        return head == "@path" or any(
            head in h.functions for h in self._helpers.values()
        )

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------

    def compile(
        self, text: str, surface_id: str = "main"
    ) -> list[AgentToRendererMessage]:
        """Compiles Atom text into A2UI message models.

        Args:
            text: The Atom text to compile.
            surface_id: The surface that forms without a surface header target.

        Returns:
            The compiled messages, in the order of the forms that produced them.

        Raises:
            SyntaxError: If the text cannot be tokenized.
            ValueError: If the text uses an unknown component, function or
                catalog, a duplicate component id, or a construct that the
                target protocol version does not support.
        """
        if not isinstance(text, str):
            raise TypeError(f"Expected Atom text as str, got {type(text).__name__}.")
        cleaned = text.strip()
        if "<think>" in cleaned:
            cleaned = re.sub(
                r"<think>.*?</think>", "", cleaned, flags=re.DOTALL
            ).strip()

        raw_json = self._extract_raw_json(cleaned)
        if raw_json is not None:
            return self._normalize_raw_json_messages(raw_json, surface_id)
        if "<a2ui>" in cleaned:
            match = re.search(r"<a2ui>(.*?)(?:</a2ui>|$)", cleaned, re.DOTALL)
            if match:
                cleaned = match.group(1).strip()

        exprs = parse_sexpr(cleaned)
        if not exprs:
            raise ValueError("No valid Atom expressions found.")

        self._node_counter = 0
        self._call_counter = 0
        self._reserved_ids = set()
        self._collect_reserved_ids(exprs)

        messages: list[dict[str, Any]] = []
        block: _Block | None = None

        def flush() -> None:
            nonlocal block
            if block is not None and (block.explicit or block.has_content()):
                messages.extend(self._block_messages(block))
            block = None

        def current() -> _Block:
            nonlocal block
            if block is None:
                block = _Block(kind="create", surface_id=surface_id, explicit=False)
            return block

        for expr in exprs:
            if not isinstance(expr, list) or not expr:
                continue
            head = _head(expr)
            if head in _SURFACE_HEADS:
                flush()
                block = self._open_surface(expr, surface_id)
                self._compile_block_body(expr, block)
            elif head == "updateComponents":
                flush()
                block = self._open_update(expr, surface_id)
                self._compile_block_body(expr, block)
            elif head == "updateDataModel":
                flush()
                messages.append(self._update_data_model_message(expr, surface_id))
            elif head == "deleteSurface":
                flush()
                target = _plain(expr[1]) if len(expr) > 1 else surface_id
                messages.append(
                    self._envelope({"deleteSurface": {"surfaceId": str(target)}})
                )
            elif head == "callFunction":
                flush()
                messages.append(self._call_function_message(expr))
            elif head in _DATA_HEADS:
                self._parse_data_node(expr, current())
            else:
                self._compile_component(expr, current(), is_root=True)
        flush()
        return to_message_models(messages)

    # ------------------------------------------------------------------
    # Raw JSON fallback
    # ------------------------------------------------------------------

    def _extract_raw_json(self, cleaned: str) -> Any | None:
        """Returns parsed JSON messages if the text is JSON instead of Atom."""
        candidate: str | None = None
        if "<a2ui-json>" in cleaned:
            match = re.search(r"<a2ui-json>(.*?)</a2ui-json>", cleaned, re.DOTALL)
            if match:
                candidate = match.group(1).strip()
        elif cleaned.startswith("{") or cleaned.startswith("["):
            candidate = cleaned
        if candidate is None:
            return None
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            return None
        items = parsed if isinstance(parsed, list) else [parsed]
        if not items or not all(isinstance(item, dict) for item in items):
            return None
        return items

    def _normalize_raw_json_messages(
        self, items: list[dict[str, Any]], surface_id: str
    ) -> list[AgentToRendererMessage]:
        stamped = [
            item if "version" in item else {"version": self.version.value, **item}
            for item in items
        ]
        return normalize_prompt_example_messages(
            stamped,
            version=self.version.value,
            default_catalog_id=self._surface_catalog_id,
            default_surface_id=surface_id,
        )

    # ------------------------------------------------------------------
    # Blocks and messages
    # ------------------------------------------------------------------

    def _collect_reserved_ids(self, node: Any) -> None:
        """Records every explicit `:id` / `:functionCallId` value in the input."""
        if not isinstance(node, list):
            return
        for i, item in enumerate(node):
            if (
                is_keyword(item)
                and item.name in ("id", "functionCallId")
                and i + 1 < len(node)
                and isinstance(node[i + 1], str)
            ):
                self._reserved_ids.add(str(node[i + 1]))
            self._collect_reserved_ids(item)

    def _header_fields(
        self, expr: list[Any], default_surface_id: str
    ) -> tuple[str, str | None, dict[str, Any]]:
        """Reads the surface id, catalog id and keyword options of a header."""
        surface_id = default_surface_id
        catalog_id: str | None = None
        options: dict[str, Any] = {}
        positional = 0
        i = 1
        while i < len(expr):
            item = expr[i]
            if is_keyword(item):
                val = expr[i + 1] if i + 1 < len(expr) else None
                if item.name in ("id", "surfaceId") and isinstance(val, str):
                    surface_id = str(val)
                elif item.name == "catalogId" and isinstance(val, str):
                    catalog_id = str(val)
                else:
                    options[item.name] = val
                i += 2
                continue
            if isinstance(item, str):
                if positional == 0:
                    surface_id = str(item)
                elif positional == 1:
                    catalog_id = str(item)
                positional += 1
            i += 1
        return surface_id, catalog_id, options

    def _open_surface(self, expr: list[Any], default_surface_id: str) -> _Block:
        surface_id, catalog_id, options = self._header_fields(expr, default_surface_id)
        self._check_header_catalog(str(_head(expr)), catalog_id)
        block = _Block(kind="create", surface_id=surface_id, explicit=True)
        option_keys = (
            _SURFACE_OPTION_KEYS_V1 if self._is_v1 else _SURFACE_OPTION_KEYS_V09
        )
        for key in option_keys:
            if key in options:
                block.surface_options[key] = self._decode_literal(options[key])
        return block

    def _open_update(self, expr: list[Any], default_surface_id: str) -> _Block:
        surface_id, catalog_id, _ = self._header_fields(expr, default_surface_id)
        self._check_header_catalog("updateComponents", catalog_id)
        return _Block(kind="update", surface_id=surface_id, explicit=True)

    def _compile_block_body(self, expr: list[Any], block: _Block) -> None:
        """Compiles the components and data nested inside a header form."""
        i = 1
        while i < len(expr):
            item = expr[i]
            if is_keyword(item):
                val = expr[i + 1] if i + 1 < len(expr) else None
                if item.name == "data" and isinstance(val, list):
                    self._parse_data_node(val, block)
                elif item.name in ("root", "child", "children", "component") and (
                    isinstance(val, list)
                ):
                    trees = [val] if self._is_component_form(val) else val
                    for tree in trees:
                        if self._is_component_form(tree):
                            self._compile_component(tree, block, is_root=True)
                i += 2
                continue
            if isinstance(item, list) and item:
                if _head(item) in _DATA_HEADS:
                    self._parse_data_node(item, block)
                elif self._is_component_form(item):
                    self._compile_component(item, block, is_root=True)
            i += 1

    def _envelope(self, body: dict[str, Any]) -> dict[str, Any]:
        return {"version": self.version.value, **body}

    def _block_messages(self, block: _Block) -> list[dict[str, Any]]:
        sid = block.surface_id
        if block.kind == "update":
            out: list[dict[str, Any]] = []
            if block.components:
                out.append(
                    self._envelope({
                        "updateComponents": {
                            "surfaceId": sid,
                            "components": block.components,
                        }
                    })
                )
            for path, value in block.data_updates:
                out.append(
                    self._envelope({
                        "updateDataModel": {
                            "surfaceId": sid,
                            "path": path,
                            "value": value,
                        }
                    })
                )
            return out

        if not block.explicit and not block.components:
            return [
                self._envelope(
                    {"updateDataModel": {"surfaceId": sid, "value": block.data_model}}
                )
            ]

        create: dict[str, Any] = {"surfaceId": sid}
        if self._surface_catalog_id is not None:
            create["catalogId"] = self._surface_catalog_id
        create.update(block.surface_options)
        if self._is_v1:
            create["dataModel"] = block.data_model
            if block.components:
                create["components"] = block.components
            return [self._envelope({"createSurface": create})]

        out = [self._envelope({"createSurface": create})]
        if block.components:
            out.append(
                self._envelope({
                    "updateComponents": {
                        "surfaceId": sid,
                        "components": block.components,
                    }
                })
            )
        if block.data_model:
            out.append(
                self._envelope(
                    {"updateDataModel": {"surfaceId": sid, "value": block.data_model}}
                )
            )
        return out

    def _update_data_model_message(
        self, expr: list[Any], default_surface_id: str
    ) -> dict[str, Any]:
        """Compiles `(updateDataModel "id" [:path "/p"] [:value v])`."""
        body: dict[str, Any] = {"surfaceId": default_surface_id}
        positional: list[Any] = []
        i = 1
        while i < len(expr):
            item = expr[i]
            if is_keyword(item):
                val = expr[i + 1] if i + 1 < len(expr) else None
                if item.name in ("surfaceId", "id"):
                    body["surfaceId"] = str(val)
                elif item.name == "path":
                    body["path"] = self._data_path(val)
                elif item.name == "value":
                    body["value"] = self._decode_literal(val)
                i += 2
                continue
            positional.append(item)
            i += 1
        if positional and isinstance(positional[0], str):
            body["surfaceId"] = str(positional.pop(0))
        if (
            positional
            and is_symbol(positional[0])
            and str(positional[0]).startswith("$")
        ):
            body.setdefault("path", self._data_path(positional.pop(0)))
            if positional:
                body.setdefault("value", self._decode_literal(positional.pop(0)))
        if body.get("path") == "/":
            del body["path"]
        if self._is_v1 and "value" not in body:
            raise ValueError(
                "updateDataModel needs a :value in protocol v1.0; write :value null"
                " to delete the data at :path."
            )
        return self._envelope({"updateDataModel": body})

    def _next_call_id(self) -> str:
        while True:
            self._call_counter += 1
            call_id = f"call_{self._call_counter}"
            if call_id not in self._reserved_ids:
                return call_id

    def _call_function_message(self, expr: list[Any]) -> dict[str, Any]:
        """Compiles `(callFunction name [:catalogId c] [:functionCallId id] ...)`.

        The compiled call always names its catalog: the one `:catalogId`
        names, else the single catalog, else the only catalog that defines
        the function.
        """
        self._require_v1("callFunction")
        func_name = str(_plain(expr[1])) if len(expr) > 1 else ""
        kw = _keyword_values(expr, 2)
        skip: set[str] = set()
        catalog_id: str | None = None
        if "catalogId" in kw and not self._declares_arg(func_name, "catalogId"):
            catalog_id = str(kw["catalogId"])
            skip.add("catalogId")
        call_id: str | None = None
        if "functionCallId" in kw and not self._declares_arg(
            func_name, "functionCallId"
        ):
            call_id = str(kw["functionCallId"])
            skip.add("functionCallId")
        if catalog_id is None:
            catalog_id = self._surface_catalog_id or self._catalog_by_name(
                "function", func_name
            )
        if catalog_id is None:
            raise ValueError(
                f"Unknown function '{func_name}' is not defined in any catalog."
                f" Available functions: {self._all_names('function')}"
            )
        helper = self._helper_for(catalog_id)
        if func_name not in helper.functions:
            raise ValueError(
                f"Unknown function '{func_name}' in catalog '{catalog_id}'. Available"
                f" functions: {sorted(helper.functions)}"
            )
        args = self._function_args(expr[2:], func_name, helper, skip)
        return self._envelope({
            "callRendererFunction": {
                "functionCallId": call_id or self._next_call_id(),
                "callFunction": {
                    "catalogId": catalog_id,
                    self._call_key: func_name,
                    "args": args,
                },
            }
        })

    # ------------------------------------------------------------------
    # Data model
    # ------------------------------------------------------------------

    def _data_path(self, val: Any) -> str:
        """Turns `$/a/b`, `"/a/b"` or `a/b` into the JSON pointer `/a/b`."""
        s = str(_plain(val)) if val is not None else "/"
        if s.startswith("$"):
            s = s[1:]
        if s.startswith(":"):
            s = s[1:]
        return s if s.startswith("/") else "/" + s

    def _decode_literal(self, v: Any) -> Any:
        """Decodes a data value: `(:k v ...)` is an object, `[...]` a list."""
        if isinstance(v, Form):
            if not v:
                return {}
            if len(v) % 2 == 0 and all(
                is_keyword(v[k]) or (isinstance(v[k], str) and not is_symbol(v[k]))
                for k in range(0, len(v), 2)
            ):
                return {
                    (
                        v[k].name if is_keyword(v[k]) else str(v[k])
                    ): self._decode_literal(v[k + 1])
                    for k in range(0, len(v), 2)
                }
            return [self._decode_literal(x) for x in v]
        if isinstance(v, list):
            if v and is_keyword(v[0]) and len(v) % 2 == 0:
                return self._decode_literal(Form(v))
            items = []
            for x in v:
                if self._is_component_form(x):
                    break
                items.append(self._decode_literal(x))
            return items
        return _plain(v)

    def _data_pairs(self, expr: list[Any]) -> list[tuple[str, Any]]:
        """Reads (pointer, value) pairs from `(data $/p v ...)` or `(set! $/p v)`."""
        head = _head(expr)
        raw: list[tuple[Any, Any]] = []
        if head in ("data", "dataModel"):
            i = 1
            while i < len(expr) - 1:
                raw.append((expr[i], expr[i + 1]))
                i += 2
        elif head == "set!" and len(expr) >= 3:
            raw.append((expr[1], expr[2]))

        pairs: list[tuple[str, Any]] = []
        for k, v in raw:
            if not isinstance(k, str) or self._is_component_name(k):
                break
            if (
                isinstance(v, list)
                and v
                and isinstance(v[0], list)
                and self._is_component_form(v[0])
            ):
                break
            pairs.append((self._data_path(k), self._decode_literal(v)))
        return pairs

    def _parse_data_node(self, expr: list[Any], block: _Block) -> None:
        for path, value in self._data_pairs(expr):
            if block.kind == "update":
                block.data_updates.append((path, value))
                continue
            parts = [p for p in path.split("/") if p]
            if not parts:
                if isinstance(value, dict):
                    block.data_model.update(value)
                continue
            curr = block.data_model
            for p in parts[:-1]:
                if not isinstance(curr.get(p), dict):
                    curr[p] = {}
                curr = curr[p]
            curr[parts[-1]] = value

    def _extract_embedded_components(self, node: Any, expr: list[Any]) -> bool:
        """Moves component forms nested in a data node to the end of `expr`."""
        if isinstance(node, list) and node:
            if self._is_component_form(node):
                expr.append(node)
                return True
            to_remove = [
                sub for sub in node if self._extract_embedded_components(sub, expr)
            ]
            for sub in to_remove:
                node.remove(sub)
        return False

    # ------------------------------------------------------------------
    # Values
    # ------------------------------------------------------------------

    def _binding(self, path: str) -> dict[str, str]:
        return {self._path_key: path}

    def _binding_path(self, val: Any) -> str | None:
        if isinstance(val, dict) and len(val) == 1:
            for key in ("@path", "path"):
                if isinstance(val.get(key), str):
                    return val[key]
        return None

    def _path_of(self, val: Any) -> str | None:
        """Returns the data path a string denotes, or None for a literal.

        `$/a/b` and `$a/b` are paths whether quoted or not. A bare symbol is
        also a path when it looks like one (`/a/b` or `a/b`). A path that
        starts with `/item/` is written relative to the template item.
        """
        s = str(val)
        if s.startswith("$/"):
            path = s[1:]
        elif s.startswith("$") and len(s) > 1 and (s[1].isalpha() or s[1] == "_"):
            path = "/" + s[1:]
        elif is_symbol(val) and s.startswith("/") and len(s) > 1 and s[1].isalpha():
            path = s
        elif (
            is_symbol(val)
            and "/" in s
            and "://" not in s
            and s.split("/")[0].isidentifier()
        ):
            path = "/" + s
        else:
            return None
        if path.startswith("/item/"):
            path = path[1:]
        return path

    def _resolve_function(
        self, val: list[Any]
    ) -> tuple[str, CatalogSchemaHelper, str | None, set[str]] | None:
        """Finds the catalog of a `(name ...)` call.

        The call uses the catalog its `:catalogId` names, else the single
        catalog, else the only catalog that defines the function. With
        several catalogs the compiled call always carries its `catalogId`.

        Returns:
            (name, helper, catalogId to emit or None, keywords to skip), or
            None if the form is not a function call.

        Raises:
            ValueError: If `:catalogId` names an unknown catalog or one that
                does not define the function, or, with several catalogs, the
                call has no `:catalogId` and several catalogs define it.
        """
        if not is_symbol(val[0]):
            return None
        name = str(val[0])
        kw = _keyword_values(val)
        if "catalogId" in kw and not self._declares_arg(name, "catalogId"):
            self._require_v1("A function catalogId override")
            cat_id = str(kw["catalogId"])
            helper = self._helper_for(cat_id)
            if name not in helper.functions:
                raise ValueError(
                    f"Unknown function '{name}' in catalog '{cat_id}'. Available"
                    f" functions: {sorted(helper.functions)}"
                )
            return name, helper, cat_id, {"catalogId"}
        if self._sole_helper is not None:
            if name in self._sole_helper.functions:
                return name, self._sole_helper, None, set()
            return None
        found = self._catalog_by_name("function", name)
        if found is None:
            return None
        return name, self._helpers[found], found, set()

    def _function_args(
        self,
        items: Sequence[Any],
        fn_name: str,
        helper: CatalogSchemaHelper,
        skip: set[str],
        first_positional: int = 0,
        overflow_message: bool = False,
    ) -> dict[str, Any]:
        """Maps keyword and positional call arguments to the function's args.

        Args:
            items: The argument items after the function name.
            fn_name: The function name.
            helper: The helper of the function's catalog.
            skip: Keywords that are not function arguments.
            first_positional: The index of the function property that the
                first positional argument fills. A check whose first property
                is the implicitly bound `value` starts at 1.
            overflow_message: Whether a string positional argument past the
                last property is the check's `message`, as in a check rule.
        """
        fn_props = helper.get_function_properties(fn_name)
        args: dict[str, Any] = {}
        pos = first_positional
        i = 0
        while i < len(items):
            item = items[i]
            if is_keyword(item):
                if i + 1 < len(items) and item.name not in skip:
                    args[item.name] = self._resolve_val(items[i + 1])
                i += 2
                continue
            if pos < len(fn_props):
                key = fn_props[pos]
            elif (
                overflow_message
                and isinstance(item, str)
                and not is_symbol(item)
                and "message" not in args
            ):
                key = "message"
            else:
                key = f"arg_{pos}"
            args[key] = self._resolve_val(item)
            pos += 1
            i += 1
        return args

    def _is_binding_form(self, val: Any) -> bool:
        """Whether a value is an explicit data binding: `$/p` or `(@path ...)`."""
        if _head(val) == "@path":
            return True
        return isinstance(val, str) and self._path_of(val) is not None

    def _resolve_checks(self, val: Any, has_value: bool) -> Any:
        """Resolves a `:checks` value, binding each check's `value` implicitly.

        A check function whose first property is `value` gets the component's
        value implicitly when the component has one and the check's first
        positional argument is not a data binding. Its positional arguments
        then fill the properties after `value`, and a string past the last
        property is the rule's message, so `(regex "^[0-9]{5}$" "Bad zip")`
        means `:pattern "^[0-9]{5}$" :message "Bad zip"`.
        """
        # One check, `(fn ...)` or `(:condition ... :message ...)`, or a
        # sequence of checks, `[...]` or `((fn ...) ...)`.
        is_single = not isinstance(val, list) or (
            isinstance(val, Form)
            and (self._is_check_call(val) or not all(isinstance(x, list) for x in val))
        )
        items = [val] if is_single else list(val)
        resolved: list[Any] = []
        for chk in items:
            found = (
                self._resolve_function(chk) if isinstance(chk, Form) and chk else None
            )
            if found is None:
                resolved.append(self._resolve_val(chk))
                continue
            fn_name, helper, emit_cat, skip = found
            fn_props = helper.get_function_properties(fn_name)
            first = _first_positional(chk[1:])
            # Positional arguments skip `value` when it is bound implicitly
            # (the component has a value and no binding is passed first) or
            # explicitly with `:value`.
            skip_value = (
                bool(fn_props)
                and fn_props[0] == "value"
                and (
                    "value" in _keyword_values(chk)
                    or (
                        has_value
                        and not (first is not None and self._is_binding_form(first))
                    )
                )
            )
            call: dict[str, Any] = {
                self._call_key: fn_name,
                "args": self._function_args(
                    chk[1:],
                    fn_name,
                    helper,
                    skip,
                    first_positional=1 if skip_value else 0,
                    overflow_message="message" not in fn_props,
                ),
            }
            if emit_cat is not None:
                call["catalogId"] = emit_cat
            resolved.append(call)
        return resolved[0] if is_single else resolved

    def _is_check_call(self, val: list[Any]) -> bool:
        return bool(val) and self._resolve_function(val) is not None

    def _resolve_val(self, val: Any, is_action: bool = False) -> Any:
        """Resolves literals, data bindings, events and function calls.

        Args:
            val: The parsed value.
            is_action: Whether the value fills an Action property, in which
                case a function call is wrapped as `{"functionCall": ...}`.
        """
        if isinstance(val, dict):
            return {k: self._resolve_val(v) for k, v in val.items()}
        if isinstance(val, list):
            if not val:
                return {} if isinstance(val, Form) else []
            head = val[0]
            if is_keyword(head) or (
                isinstance(val, Form)
                and len(val) % 2 == 0
                and all(
                    is_keyword(val[k])
                    or (isinstance(val[k], str) and not is_symbol(val[k]))
                    for k in range(0, len(val), 2)
                )
            ):
                return self._resolve_object(val)
            if is_symbol(head):
                name = str(head)
                if name.lower() == "event":
                    return {"event": self._compile_event(val)}
                if name == "@path" and len(val) >= 2:
                    return self._binding(str(val[1]))
                found = self._resolve_function(val)
                if found is not None:
                    fn_name, helper, emit_cat, skip = found
                    call: dict[str, Any] = {
                        self._call_key: fn_name,
                        "args": self._function_args(val[1:], fn_name, helper, skip),
                    }
                    if emit_cat is not None:
                        call["catalogId"] = emit_cat
                    return {"functionCall": call} if is_action else call
            return [self._resolve_val(item) for item in val]
        if isinstance(val, str) and not is_keyword(val):
            path = self._path_of(val)
            if path is not None:
                return self._binding(path)
            return _plain(val)
        return _plain(val)

    def _resolve_object(self, val: list[Any]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for k in range(0, len(val) - 1, 2):
            key = val[k]
            name = key.name if is_keyword(key) else str(key)
            result[name] = self._resolve_val(val[k + 1])
        return result

    def _compile_event(self, expr: list[Any]) -> dict[str, Any]:
        """Compiles `(Event "name" [:userMessage m] [:context (...)] :k v ...)`."""
        name = ""
        rest = list(expr[1:])
        if rest and not is_keyword(rest[0]) and not isinstance(rest[0], list):
            name = str(_plain(rest.pop(0))).strip("`'\"")
        else:
            kw = _keyword_values(expr)
            for key in ("name", "action", "event"):
                if isinstance(kw.get(key), str):
                    name = str(kw[key]).strip("`'\"")
                    break
        context: dict[str, Any] = {}
        user_message: Any = None
        pos = 0
        i = 0
        while i < len(rest):
            item = rest[i]
            if is_keyword(item):
                if i + 1 >= len(rest):
                    break
                key, raw = item.name, rest[i + 1]
                i += 2
                if key == "userMessage" and self._is_v1:
                    user_message = self._resolve_val(raw)
                elif key == "context":
                    if (
                        isinstance(raw, list)
                        and raw
                        and (is_keyword(raw[0]) or isinstance(raw, Form))
                    ):
                        obj = self._resolve_val(raw)
                        if isinstance(obj, dict):
                            context.update(obj)
                    elif not isinstance(raw, list):
                        context["value"] = self._resolve_val(raw)
                else:
                    value = self._resolve_val(raw)
                    if key in ("name", "action", "event") and value == name:
                        continue
                    context[key] = value
                continue
            if isinstance(item, dict):
                context.update({k: self._resolve_val(v) for k, v in item.items()})
            else:
                key = "value" if pos == 0 else f"arg_{pos}"
                context[key] = self._resolve_val(item)
                pos += 1
            i += 1
        event: dict[str, Any] = {"name": name}
        if user_message is not None:
            event["userMessage"] = user_message
        if context:
            event["context"] = context
        return event

    # ------------------------------------------------------------------
    # Components
    # ------------------------------------------------------------------

    def _next_id(self, block: _Block) -> str:
        while True:
            candidate = f"node_{self._node_counter}"
            self._node_counter += 1
            if candidate not in block.used_ids and candidate not in self._reserved_ids:
                return candidate

    def _assign_id(self, block: _Block, explicit_id: str | None, is_root: bool) -> str:
        if explicit_id is not None:
            if explicit_id in block.used_ids:
                raise ValueError(
                    f"Duplicate component id '{explicit_id}' on surface"
                    f" '{block.surface_id}'."
                )
            comp_id = explicit_id
        elif (
            is_root
            and "root" not in block.used_ids
            and "root" not in self._reserved_ids
        ):
            comp_id = "root"
        else:
            comp_id = self._next_id(block)
        block.used_ids.add(comp_id)
        return comp_id

    def _text_component(self, helper: CatalogSchemaHelper) -> tuple[str, str] | None:
        """Finds the component that bare-string children are wrapped in.

        Candidates are components whose only required property (or only
        property) is named in `_TEXT_PROP_NAMES`. Names earlier in that list
        win, then components with fewer properties, then the name.
        """
        candidates: list[tuple[int, int, str, str]] = []
        for comp in helper.components:
            props = [
                p
                for p in helper.get_component_properties(comp)
                if p not in ("id", "component", "catalogId")
            ]
            reqs = [
                r
                for r in helper.get_component_required(comp)
                if r not in ("id", "component", "catalogId")
            ]
            prop = reqs[0] if len(reqs) == 1 else props[0] if len(props) == 1 else None
            if prop in _TEXT_PROP_NAMES:
                candidates.append(
                    (_TEXT_PROP_NAMES.index(prop), len(props), comp, prop)
                )
        if not candidates:
            return None
        _, _, comp, prop = min(candidates)
        return comp, prop

    def _auto_wrap_text_child(
        self, text: Any, block: _Block, catalog_id: str, helper: CatalogSchemaHelper
    ) -> str | None:
        """Wraps a bare-string child in a catalog's text component.

        Args:
            text: The bare string.
            block: The message being compiled.
            catalog_id: The catalog of the parent component, whose text
                component wraps the string.
            helper: The helper of that catalog.

        Returns:
            The child component id, or None if the catalog has no component a
            bare string can be wrapped in.
        """
        text_str = str(text).strip()
        if not text_str:
            return None
        if any(c.get("id") == text_str for c in block.components):
            return text_str
        info = self._text_component(helper)
        if info is None:
            return None
        comp_name, prop = info
        form = Form([Symbol(comp_name), Keyword(f":{prop}"), text_str])
        if self._sole_helper is None:
            form.extend([Keyword(":catalogId"), catalog_id])
        return self._compile_component(form, block)

    def _unknown_component_error(
        self, comp_type: str, catalog_id: str | None
    ) -> ValueError:
        """Builds the error for a component that its catalog does not define.

        Args:
            comp_type: The component name.
            catalog_id: The catalog the component was looked up in, or None
                when no catalog defines it.
        """
        if catalog_id is None:
            return ValueError(
                f"Unknown component type '{comp_type}' is not defined in any"
                " catalog. Available components are:"
                f" {self._all_names('component')}. Please replace '{comp_type}'"
                " with a valid component from the catalog schema."
            )
        helper = self._helpers[catalog_id]
        message = (
            f"Unknown component type '{comp_type}' is not defined in catalog"
            f" '{catalog_id}'. Available components in catalog are:"
            f" {sorted(helper.components)}."
        )
        others = [
            cid
            for cid, h in self._helpers.items()
            if cid != catalog_id and comp_type in h.components
        ]
        if others:
            message += (
                f" '{comp_type}' is defined in catalog '{others[0]}'; write"
                f' :catalogId "{others[0]}" to use it.'
            )
        else:
            message += (
                f" Please replace '{comp_type}' with a valid component from the"
                " catalog schema."
            )
        return ValueError(message)

    def _compile_component(
        self, expr: list[Any], block: _Block, is_root: bool = False
    ) -> str:
        """Compiles a component form (and its subtree) into the block.

        The component uses the catalog its `:catalogId` names, else the single
        catalog, else the only catalog that defines its name; with several
        catalogs the compiled component always carries its `catalogId`.

        Returns:
            The component id, or "" for a data form.

        Raises:
            ValueError: If the component's catalog does not define it, or,
                with several catalogs, it has no `:catalogId` and no catalog
                or several catalogs define it.
        """
        comp_type = str(expr[0]).strip("`'")
        if comp_type in _DATA_HEADS:
            self._parse_data_node(expr, block)
            return ""

        kw = _keyword_values(expr)
        explicit_cat = (
            str(kw["catalogId"]) if isinstance(kw.get("catalogId"), str) else None
        )
        explicit_id = str(kw["id"]) if isinstance(kw.get("id"), str) else None
        emit_cat: str | None
        if explicit_cat is not None:
            self._require_v1("A component catalogId override")
            self._helper_for(explicit_cat)
            comp_cat = emit_cat = explicit_cat
        elif self._surface_catalog_id is not None:
            comp_cat, emit_cat = self._surface_catalog_id, None
        else:
            found = self._catalog_by_name("component", comp_type)
            if found is None:
                raise self._unknown_component_error(comp_type, None)
            comp_cat = emit_cat = found
        comp_helper = self._helpers[comp_cat]
        if comp_type not in comp_helper.components:
            raise self._unknown_component_error(comp_type, comp_cat)

        comp_id = self._assign_id(block, explicit_id, is_root)
        comp: dict[str, Any] = {"id": comp_id, "component": comp_type}
        if emit_cat is not None:
            comp["catalogId"] = emit_cat

        prop_keys, child_list_prop, single_child_prop = child_props(
            comp_helper, comp_type
        )
        children: list[str] = []
        template: dict[str, Any] | None = None
        template_target: str | None = None
        items_path_var: Any = None
        pos_arg_index = 0

        def is_action_prop(key: str) -> bool:
            return (
                comp_helper.get_property_type(comp_type, key) == "Action"
                or key == "action"
            )

        def add_child_items(items: Sequence[Any], wrap_strings: bool) -> None:
            nonlocal template
            for sub in items:
                if isinstance(sub, list) and sub:
                    head = _head(sub)
                    if head in _DATA_HEADS:
                        self._parse_data_node(sub, block)
                    elif head == "template":
                        template = self._compile_template(sub, block)
                    elif self._is_component_form(sub) or (
                        isinstance(sub, Form) and is_symbol(sub[0])
                    ):
                        children.append(self._compile_component(sub, block))
                elif isinstance(sub, str) and not is_keyword(sub) and sub != "...":
                    if wrap_strings:
                        wrapped = self._auto_wrap_text_child(
                            sub, block, comp_cat, comp_helper
                        )
                        if wrapped:
                            children.append(wrapped)
                    else:
                        children.append(str(sub))

        i = 1
        while i < len(expr):
            item = expr[i]
            if is_keyword(item):
                key = item.name
                val = expr[i + 1] if i + 1 < len(expr) else None
                i += 2
                if key in ("id", "catalogId"):
                    continue
                if _head(val) == "template":
                    template = self._compile_template(val, block)
                    template_target = key if key in prop_keys else None
                elif key in _COMPONENT_TEMPLATE_PATH_KEYS and key not in prop_keys:
                    items_path_var = self._resolve_val(val)
                elif (
                    key in (child_list_prop, "children")
                    or comp_helper.get_property_type(comp_type, key) == "ChildList"
                ) and isinstance(val, list):
                    items = [val] if self._is_component_form(val) else val
                    if key == (child_list_prop or "children"):
                        add_child_items(items, wrap_strings=False)
                    else:
                        before = len(children)
                        add_child_items(items, wrap_strings=False)
                        comp[key] = children[before:]
                        del children[before:]
                elif self._is_component_form(val):
                    comp[key] = self._compile_component(val, block)
                elif isinstance(val, list) and (
                    item_schema := self._object_list_item_schema(
                        comp_helper, comp_type, key
                    )
                ):
                    comp[key] = self._compile_object_list(val, block, item_schema)
                elif key == "checks":
                    sibling_value = (
                        comp["value"]
                        if "value" in comp
                        else (self._resolve_val(kw["value"]) if "value" in kw else None)
                    )
                    resolved = self._resolve_checks(
                        val, has_value=sibling_value is not None
                    )
                    comp[key] = self._normalize_checks(resolved, sibling_value)
                else:
                    resolved = self._resolve_val(val, is_action=is_action_prop(key))
                    comp[key] = self._coerce_object_list(
                        comp_helper, comp_type, key, resolved
                    )
                continue

            if isinstance(item, list) and item:
                head = _head(item)
                first = item[0]
                if (
                    is_keyword(first)
                    and len(item) > 1
                    and (
                        first.name in ("children", "child", child_list_prop)
                        or comp_helper.get_property_type(comp_type, first.name)
                        in ("ChildList", "Child")
                    )
                ):
                    contents = item[1:]
                    if (
                        len(contents) == 1
                        and isinstance(contents[0], list)
                        and contents[0]
                        and not self._is_component_form(contents[0])
                    ):
                        contents = contents[0]
                    add_child_items(contents, wrap_strings=True)
                elif head in _DATA_HEADS:
                    self._extract_embedded_components(item, expr)
                    self._parse_data_node(item, block)
                elif head is not None and head.lower() == "event":
                    action_key = next(
                        (k for k in prop_keys if is_action_prop(k)), "action"
                    )
                    comp[action_key] = {"event": self._compile_event(item)}
                elif head == "template":
                    template = self._compile_template(item, block)
                elif self._is_component_form(item):
                    children.append(self._compile_component(item, block))
                elif (
                    not (child_list_prop or single_child_prop)
                    and pos_arg_index < len(prop_keys)
                    and self._is_value_form(item)
                ):
                    pkey = prop_keys[pos_arg_index]
                    comp[pkey] = self._resolve_val(item, is_action=is_action_prop(pkey))
                    pos_arg_index += 1
                elif isinstance(item, Form) and is_symbol(item[0]):
                    children.append(self._compile_component(item, block))
                else:
                    add_child_items(item, wrap_strings=True)
                i += 1
                continue

            if child_list_prop or single_child_prop:
                if isinstance(item, str) and not is_keyword(item) and item != "...":
                    wrapped = self._auto_wrap_text_child(
                        item, block, comp_cat, comp_helper
                    )
                    if wrapped:
                        children.append(wrapped)
            elif pos_arg_index < len(prop_keys):
                pkey = prop_keys[pos_arg_index]
                comp[pkey] = self._resolve_val(item, is_action=is_action_prop(pkey))
                pos_arg_index += 1
            i += 1

        if template is not None:
            raw_path = template.get("items_path") or items_path_var
            if raw_path is None:
                raw_path = next(
                    (
                        f"/{k}"
                        for k, v in block.data_model.items()
                        if isinstance(v, list)
                    ),
                    None,
                )
            target = template_target or child_list_prop or "children"
            comp[target] = {
                "componentId": template["componentId"],
                "path": self._normalize_path_str(raw_path),
            }
        elif children:
            target = positional_child_target(
                len(children), prop_keys, child_list_prop, single_child_prop
            )
            comp[target] = children[0] if target == single_child_prop else children

        self._finalize_component(comp, comp_type, comp_helper)
        block.components.insert(0, comp)
        return comp_id

    def _finalize_component(
        self, comp: dict[str, Any], comp_type: str, helper: CatalogSchemaHelper
    ) -> None:
        """Applies schema coercions and checks required properties."""
        for key, value in list(comp.items()):
            if key in ("id", "component", "catalogId"):
                continue
            schema = helper.get_property_schema(comp_type, key) or {}
            kind = ref_kind(schema)
            if (kind == "Child" or key == "child") and isinstance(value, list):
                if len(value) == 1:
                    comp[key] = value[0]
                elif not value:
                    del comp[key]
                continue
            if schema.get("type") in ("number", "integer") and isinstance(value, str):
                try:
                    comp[key] = float(value) if "." in value else int(value)
                except ValueError:
                    del comp[key]
                continue
            enum_vals = helper.get_property_enum(comp_type, key)
            if enum_vals and isinstance(value, str) and value not in enum_vals:
                default = schema.get("default")
                comp[key] = default if default in enum_vals else enum_vals[0]

        for req in helper.get_component_required(comp_type):
            if req in ("id", "component", "catalogId") or req in comp:
                continue
            raise ValueError(
                f"Component '{comp_type}' (id: '{comp['id']}') is missing required"
                f" property '{req}' defined by catalog schema."
            )

    def _object_list_item_schema(
        self, helper: CatalogSchemaHelper, comp_type: str, key: str
    ) -> dict[str, Any] | None:
        """Returns the item schema of an array property whose items hold a child."""
        schema = helper.get_property_schema(comp_type, key) or {}
        items = schema.get("items") if schema.get("type") == "array" else None
        if not isinstance(items, dict) or not isinstance(items.get("properties"), dict):
            return None
        if any(ref_kind(s) == "Child" for s in items["properties"].values()):
            return items
        return None

    def _compile_object_list(
        self,
        val: list[Any],
        block: _Block,
        item_schema: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Compiles a list of objects that each hold a child, such as tabs.

        Each entry is `(Head :key value ... (Child ...))`. A component value
        whose key is not an item property goes to the item's child property,
        and a string goes to the first string property not yet set.
        """
        props: dict[str, Any] = item_schema["properties"]
        child_keys = [k for k, s in props.items() if ref_kind(s) == "Child"]
        other_keys = [k for k in props if k not in child_keys]
        result: list[dict[str, Any]] = []
        for entry in val:
            if not isinstance(entry, list) or not entry:
                continue
            start = 1 if is_symbol(entry[0]) else 0
            obj: dict[str, Any] = {}

            def put_child(child_expr: Any, key: str | None = None) -> None:
                target = (
                    key if key in child_keys else (child_keys[0] if child_keys else key)
                )
                if target:
                    obj[target] = self._compile_component(child_expr, block)

            def put_value(value: Any, key: str | None = None) -> None:
                if key in props:
                    obj[key] = self._resolve_val(value)
                    return
                target = next((k for k in other_keys if k not in obj), key)
                if target:
                    obj[target] = self._resolve_val(value)

            j = start
            while j < len(entry):
                elem = entry[j]
                if is_keyword(elem):
                    v = entry[j + 1] if j + 1 < len(entry) else None
                    if self._is_component_form(v):
                        put_child(v, elem.name)
                    else:
                        put_value(v, elem.name)
                    j += 2
                    continue
                if self._is_component_form(elem):
                    put_child(elem)
                elif isinstance(elem, str):
                    put_value(elem)
                j += 1
            if obj:
                result.append(obj)
        return result

    def _coerce_object_list(
        self, helper: CatalogSchemaHelper, comp_type: str, key: str, value: Any
    ) -> Any:
        """Expands bare strings in an array of objects to the objects' fields.

        For an array property whose items require only string-valued fields
        (such as options with a label and a value), `"A"` becomes an object
        that sets each required field to `"A"`.
        """
        if not isinstance(value, list) or not any(isinstance(v, str) for v in value):
            return value
        schema = helper.get_property_schema(comp_type, key) or {}
        items = schema.get("items") if schema.get("type") == "array" else None
        if not isinstance(items, dict) or items.get("type") != "object":
            return value
        required = [r for r in items.get("required", []) if isinstance(r, str)]
        if not required:
            return value
        return [{r: v for r in required} if isinstance(v, str) else v for v in value]

    def _called_function_props(self, call: dict[str, Any]) -> list[str]:
        """Returns the declared properties of the function a compiled call names.

        The function's catalog is the call's `catalogId`, else the single
        catalog, else the only catalog that defines the function. A call whose
        function no catalog defines has no declared properties.
        """
        name = call.get(self._call_key)
        if not isinstance(name, str):
            return []
        cat_id = call.get("catalogId")
        if isinstance(cat_id, str):
            helper = self._helper_for(cat_id)
        elif self._sole_helper is not None:
            helper = self._sole_helper
        else:
            found = self._catalog_by_name("function", name)
            if found is None:
                return []
            helper = self._helpers[found]
        return helper.get_function_properties(name)

    def _normalize_checks(
        self, resolved: Any, sibling_value: Any
    ) -> list[dict[str, Any]]:
        """Turns check expressions into CheckRule objects.

        Args:
            resolved: The resolved check expressions.
            sibling_value: The component's `value`, bound to a check's `value`
                argument when the check does not pass one, or None.
        """
        items = resolved if isinstance(resolved, list) else [resolved]
        rules: list[dict[str, Any]] = []
        for chk in items:
            if not isinstance(chk, dict):
                continue
            if "condition" in chk:
                rule = dict(chk)
            else:
                cond = dict(chk)
                message: Any = None
                args = cond.get("args")
                declared = self._called_function_props(cond)
                if (
                    isinstance(args, dict)
                    and "message" in args
                    and "message" not in declared
                ):
                    args = dict(args)
                    message = args.pop("message")
                    cond["args"] = args
                rule = {"condition": cond}
                if message is not None:
                    rule["message"] = str(message)
            if "message" not in rule and not self._is_v1:
                # v0.9 CheckRule requires a message.
                rule["message"] = "Invalid input"
            cond = rule.get("condition")
            if isinstance(cond, dict) and isinstance(cond.get(self._call_key), str):
                if "value" in self._called_function_props(cond):
                    args = cond.setdefault("args", {})
                    if "value" not in args and sibling_value is not None:
                        args["value"] = sibling_value
            rules.append(rule)
        return rules

    def _normalize_path_str(self, val: Any) -> str:
        path = self._binding_path(val)
        if path is not None:
            return path
        if isinstance(val, str):
            resolved = self._path_of(val)
            if resolved is not None:
                return resolved
            return val if val.startswith("/") or val.startswith("item/") else "/" + val
        return "/items"

    def _compile_template(self, expr: list[Any], block: _Block) -> dict[str, Any]:
        """Compiles `(template [:items $/list] [:item var] (Child ...))`."""
        template_child_id = ""
        items_path: Any = None
        item_var: str | None = None
        before = {c["id"] for c in block.components}
        i = 1
        while i < len(expr):
            item = expr[i]
            if is_keyword(item) and i + 1 < len(expr):
                if item.name in _TEMPLATE_PATH_KEYS:
                    items_path = self._resolve_val(expr[i + 1])
                elif item.name in ("item", "var", "itemVar"):
                    item_var = str(_plain(expr[i + 1])).lstrip("$").strip("/")
                i += 2
                continue
            if self._is_component_form(item):
                template_child_id = self._compile_component(item, block)
            elif isinstance(item, str) and not is_keyword(item):
                item_var = str(item).lstrip("$").strip("/")
            i += 1

        if item_var and item_var != "item":
            for c in block.components:
                if c["id"] not in before:
                    self._rewrite_item_paths(c, item_var)

        result: dict[str, Any] = {"componentId": template_child_id}
        if items_path is not None:
            result["items_path"] = items_path
        return result

    def _rewrite_item_paths(self, node: Any, item_var: str) -> None:
        """Rewrites `/var/x` bindings in a template subtree to `item/x`."""
        if isinstance(node, list):
            for sub in node:
                self._rewrite_item_paths(sub, item_var)
            return
        if not isinstance(node, dict):
            return
        path = self._binding_path(node)
        if path is not None:
            for prefix in (f"/{item_var}/", f"{item_var}/"):
                if path.startswith(prefix):
                    node[next(iter(node))] = "item/" + path[len(prefix) :]
                    break
            return
        for sub in node.values():
            self._rewrite_item_paths(sub, item_var)
