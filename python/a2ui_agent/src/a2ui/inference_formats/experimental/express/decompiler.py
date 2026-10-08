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

"""Decompilation engine for A2UI Express.

Writes A2UI messages (v0.9, v0.9.1 or v1.0) back into A2UI Express DSL code,
tailored for prompt tokens compression.
"""

from collections.abc import Sequence
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
    surface_catalog_id,
)
from a2ui.schema.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG
from .constants import SurfaceOperation
from .errors import ExpressValidationError

_DEFAULT_SURFACE_ID = "default_surface"
_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_NON_IDENTIFIER_CHARS_RE = re.compile(r"[^a-zA-Z0-9_]")
# Words that lex as something other than a variable name.
_RESERVED_WORDS = frozenset({"_", "true", "false", "null"})


def _is_variable_name(name: str) -> bool:
    """Checks whether a component ID can be written as an Express variable."""
    return bool(_IDENTIFIER_RE.match(name)) and name not in _RESERVED_WORDS


def _assign_variable_names(component_ids: Sequence[str]) -> dict[str, str]:
    """Maps each component ID to the variable name it is written under.

    An ID that is a valid variable name is its own variable name. Any other
    ID, such as `content-grid`, gets a derived name (`content_grid`) that no
    other ID or variable of the block uses, and the component is written with
    an `id="content-grid"` argument so that it compiles back to its ID.
    """
    names = {cid: cid for cid in component_ids if _is_variable_name(cid)}
    taken = set(names.values())
    for cid in component_ids:
        if cid in names:
            continue
        base = _NON_IDENTIFIER_CHARS_RE.sub("_", cid)
        if not base or not _is_variable_name(base):
            base = f"_{base}"
        name, suffix = base, 2
        while name in taken:
            name, suffix = f"{base}_{suffix}", suffix + 1
        names[cid] = name
        taken.add(name)
    return names


def _decompile_reference(component_id: Any, var_names: dict[str, str]) -> str:
    """Writes a reference to a component by ID.

    A component defined in the same block is referenced by its variable name.
    A component defined elsewhere, such as in an earlier turn, is referenced
    by a bare name when its ID is a valid variable name that the block does
    not define, which the compiler reads back as that ID, and by a quoted ID
    otherwise.
    """
    if not isinstance(component_id, str):
        return _decompile_string(str(component_id))
    if component_id in var_names:
        return var_names[component_id]
    if _is_variable_name(component_id) and component_id not in var_names.values():
        return component_id
    return _decompile_string(component_id)


def _flatten_data_model(data_dict: dict) -> list[tuple[str, Any]]:
    """Flattens a nested dictionary dataModel structure into JSON Pointer path segments."""
    results = []

    def recurse(current: Any, path: str):
        if isinstance(current, dict) and current:
            for k, v in current.items():
                recurse(v, f"{path}/{k}")
        else:
            results.append((path, current))

    recurse(data_dict, "")
    return results


def _is_component_reference_property(prop_schema: Any) -> bool:
    """Checks if a property schema defines a component reference (ComponentId or list of ComponentId)."""
    if not isinstance(prop_schema, dict):
        return False
    if "$ref" in prop_schema:
        ref = prop_schema["$ref"]
        if "ComponentId" in ref or "Child" in ref or "ChildList" in ref:
            return True
    if "oneOf" in prop_schema or "anyOf" in prop_schema or "allOf" in prop_schema:
        subs = (
            prop_schema.get("oneOf", [])
            + prop_schema.get("anyOf", [])
            + prop_schema.get("allOf", [])
        )
        for sub in subs:
            if _is_component_reference_property(sub):
                return True
    if prop_schema.get("type") == "array" and "items" in prop_schema:
        return _is_component_reference_property(prop_schema["items"])
    return False


def _decompile_string(val: str) -> str:
    """Formats a string literal using the cleanest/most readable representation."""
    has_newline = "\n" in val or "\r" in val
    has_tab = "\t" in val
    has_quote = '"' in val
    has_backslash = "\\" in val

    # 1. Use triple-quotes for multi-line
    if has_newline and not val.endswith('"'):
        if '"""' not in val:
            # Use raw triple quotes if there are backslashes but no tabs
            if has_backslash and not has_tab:
                return f'r"""{val}"""'
            # Otherwise standard triple quotes
            escaped = val.replace("\\", "\\\\").replace("\t", "\\t")
            return f'"""{escaped}"""'

    # 2. Use single-line raw string if it has backslashes but no quotes/tabs/newlines
    if has_backslash and not has_newline and not has_tab and not has_quote:
        return f'r"{val}"'

    # 3. Fall back to standard double-quoted string with escapes
    escaped = (
        val.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'"{escaped}"'


def _decompile_key(key: str) -> str:
    """Writes a map key bare when it is an identifier, and quoted otherwise."""
    return key if _IDENTIFIER_RE.match(key) else _decompile_string(key)


def _decompile_path(path_str: str) -> str:
    """Writes a JSON Pointer data path as an Express path (`/a/b` -> `$/a/b`)."""
    if path_str.startswith("/"):
        return f"$/{path_str[1:]}"
    return f"${path_str}"


def _has_reserved_key(val: dict, name: str) -> bool:
    """Checks for a reserved key under its v1.0 `@` name or its v0.9 plain name.

    v1.0 writes data bindings and function calls as `@path` and `@call`. Reading
    both spellings lets the decompiler accept messages of either version.
    """
    return f"@{name}" in val or name in val


def _reserved_value(val: dict, name: str) -> Any:
    """Returns a reserved key's value, preferring its v1.0 `@` name."""
    return val.get(f"@{name}", val.get(name))


def _is_renderer_call(envelope_json: dict[str, Any]) -> bool:
    """Checks whether a message is a renderer function call."""
    return (
        "callRendererFunction" in envelope_json
        or SurfaceOperation.CALL_FUNC in envelope_json
    )


def _strip_trailing_placeholders(args: list[str]) -> list[str]:
    while args and args[-1] == "_":
        args.pop()
    return args


class ExpressDecompiler:
    """Converts standard A2UI wire JSON trees back into A2UI Express syntax.

    Identifies component definitions, event trigger actions, validation logic rules,
    and dynamic child templates, maps them positional-wise, and outputs plain text.

    A component or function call without a `catalogId` belongs to its
    surface's catalog, as the protocol specifies. With a single catalog that is
    the catalog, and nothing names it. With several catalogs a `surface` line
    never names a catalog, and a component or call is written with a
    `catalogId=` argument only when looking its name up across the catalogs
    would not find its actual catalog, that is when several catalogs define
    the name.

    Attributes:
        helpers: Mapping of catalog IDs to CatalogSchemaHelper instances.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
    ):
        """Initializes the decompiler with one or more catalogs.

        Args:
            catalogs: A sequence of Catalog instances.

        Raises:
            A2uiCatalogError: If `check_mixed_catalogs` rejects the catalogs.
        """
        self._catalogs = check_mixed_catalogs(catalogs)
        self.helpers = build_catalog_helpers(self._catalogs)
        # The single catalog's ID, or None when several catalogs are active.
        self._sole_catalog_id = surface_catalog_id(self._catalogs)

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs, in the order the decompiler received them."""
        return list(self._catalogs)

    def _helper_for(self, catalog_id: str) -> CatalogSchemaHelper:
        """Returns the helper of an active catalog.

        Raises:
            ExpressValidationError: If no active catalog has that ID.
        """
        helper = self.helpers.get(catalog_id)
        if helper is None:
            raise ExpressValidationError(
                f"Unknown catalog '{catalog_id}'. Available catalogs:"
                f" {list(self.helpers.keys())}"
            )
        return helper

    def _surface_catalog(self, catalog_id: str | None) -> str | None:
        """Returns the catalog of a surface that the payload names.

        With a single catalog, a surface's catalog is that catalog, and a
        payload that names another fails.

        Args:
            catalog_id: The surface's `createSurface` catalogId, or None when
                the payload names none.

        Raises:
            ExpressValidationError: If there is a single catalog and
                `catalog_id` names another.
        """
        if self._sole_catalog_id is None:
            return catalog_id
        if catalog_id is not None:
            self._helper_for(catalog_id)
        return self._sole_catalog_id

    def _resolve(
        self,
        kind: Literal["component", "function"],
        name: str,
        catalog_id: str | None,
        surface_cat_id: str | None,
        label: str,
    ) -> tuple[CatalogSchemaHelper, str | None]:
        """Finds a component's or call's actual catalog, and whether to name it.

        Args:
            kind: Whether `name` is a component or a function.
            name: The component or function name.
            catalog_id: The `catalogId` on the component or call, if any.
            surface_cat_id: The catalog of its surface, if it has one.
            label: What `name` is, such as "component", for errors.

        Returns:
            The helper of the actual catalog, and the `catalogId` to write: the
            actual catalog when several catalogs are active and a lookup by
            name would not find exactly that catalog, else None.

        Raises:
            ExpressValidationError: If the component or call has no catalog,
                names an unknown catalog, or its catalog does not define it.
        """
        actual = catalog_id or surface_cat_id
        if actual is None:
            raise ExpressValidationError(
                f"{label.capitalize()} '{name}' names no catalogId, and its"
                " surface has no catalog."
            )
        helper = self._helper_for(actual)
        defined = helper.components if kind == "component" else helper.functions
        if name not in defined:
            raise ExpressValidationError(
                f"Unknown {label} '{name}' not defined in catalog '{actual}'."
            )
        if self._sole_catalog_id is not None:
            return helper, None
        found = catalogs_defining(self.helpers, kind, name)
        return helper, None if found == [actual] else actual

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Wraps individual decompiled A2UI Express DSL blocks within sentinel tags.

        Args:
            blocks: A list of decompiled A2UI Express DSL statement strings.

        Returns:
            The merged A2UI Express DSL string enclosed within opening and closing sentinel tags.
        """
        full_dsl = "\n".join(blocks)
        return f"{A2UI_INFERENCE_OPEN_TAG}\n{full_dsl}\n{A2UI_INFERENCE_CLOSE_TAG}"

    def decompile(
        self,
        a2ui_payload: Sequence[AgentToRendererMessage],
        use_keyword_args: bool = False,
    ) -> str:
        """Decompiles structured A2UI payload messages into clean A2UI Express lines.

        The payload is first coalesced (see `coalesce_surface_messages`). Each
        `createSurface`, `updateComponents` or `updateDataModel` becomes a
        `surface(...)` block, and deletes and renderer function calls become
        statements of their own, all in payload order.

        Args:
            a2ui_payload: Sequence of AgentToRendererMessage objects.
            use_keyword_args: Whether to format component arguments as keyword parameters (e.g., param=value).

        Returns:
            The decompiled A2UI Express DSL string.

        Raises:
            ExpressValidationError: If a message names a catalog, component or
                function that the active catalogs do not declare.
        """
        blocks = []
        call_count = 0
        for idx, item in enumerate(coalesce_surface_messages(a2ui_payload)):
            if not item.message:
                continue
            if _is_renderer_call(item.message):
                call_count += 1
                block = self._decompile_renderer_call(item.message, call_count)
            else:
                block = self._decompile_item(
                    item, use_keyword_args=use_keyword_args, is_first=idx == 0
                )
            if block:
                blocks.append(block)
        return "\n".join(blocks)

    def _surface_header(self, surface_id: str) -> str:
        """Writes a `surface` line, which names no catalog."""
        return f"surface({_decompile_string(surface_id)})"

    def _decompile_item(
        self,
        item: CoalescedMessage,
        *,
        use_keyword_args: bool,
        is_first: bool,
    ) -> str:
        envelope_json = item.message

        if SurfaceOperation.DELETE in envelope_json:
            surface_id = envelope_json[SurfaceOperation.DELETE].get("surfaceId", "")
            return f"deleteSurface({_decompile_string(surface_id)})"

        if item.is_update:
            return self._decompile_update(
                item, use_keyword_args=use_keyword_args, is_first=is_first
            )

        create_surface = envelope_json.get(SurfaceOperation.CREATE, {})
        surface_id = create_surface.get("surfaceId", "") or _DEFAULT_SURFACE_ID
        catalog_id = self._surface_catalog(
            create_surface.get("catalogId") or item.surface_catalog_id
        )

        send_data_model = create_surface.get("sendDataModel")
        dsl_lines = []
        if not (
            is_first and surface_id == _DEFAULT_SURFACE_ID and send_data_model is None
        ):
            header = self._surface_header(surface_id)
            if send_data_model is not None:
                flag = "true" if send_data_model else "false"
                header = f"{header[:-1]}, sendDataModel={flag})"
            dsl_lines.append(header)

        components = create_surface.get("components", [])

        data_model = create_surface.get("dataModel", {})
        if data_model:
            for path, val in sorted(_flatten_data_model(data_model)):
                val_str = self._decompile_value(val, {}, False, catalog_id)
                dsl_lines.append(f"${path} = {val_str}")

        dsl_lines.extend(
            self._decompile_components(components, catalog_id, use_keyword_args)
        )
        return "\n".join(dsl_lines)

    def _decompile_update(
        self, item: CoalescedMessage, *, use_keyword_args: bool, is_first: bool
    ) -> str:
        """Writes an incremental update as a `surface(...)` block.

        Components without a `catalogId` belong to the surface's catalog when
        the payload created the surface (or there is a single catalog).
        """
        op = item.operation
        body = item.message[op]
        surface_id = body.get("surfaceId", "") or _DEFAULT_SURFACE_ID
        catalog_id = self._surface_catalog(item.surface_catalog_id)
        components = (
            body.get("components", [])
            if op == SurfaceOperation.UPDATE_COMPONENTS
            else []
        )
        has_root = any(
            isinstance(c, dict) and c.get("id") == "root" for c in components
        )
        header = self._surface_header(surface_id)
        if has_root:
            header = f"{header[:-1]}, update=true)"

        dsl_lines = []
        if has_root or not (is_first and surface_id == _DEFAULT_SURFACE_ID):
            dsl_lines.append(header)

        if op == SurfaceOperation.UPDATE_COMPONENTS:
            dsl_lines.extend(
                self._decompile_components(components, catalog_id, use_keyword_args)
            )
        else:
            raw_path = body.get("path") or "/"
            value = body.get("value")
            if raw_path == "/" and isinstance(value, dict) and value:
                for rel_path, val in sorted(_flatten_data_model(value)):
                    val_str = self._decompile_value(val, {}, False, catalog_id)
                    dsl_lines.append(f"${rel_path} = {val_str}")
            else:
                val_str = self._decompile_value(value, {}, False, catalog_id)
                dsl_lines.append(f"{_decompile_path(raw_path)} = {val_str}")
        return "\n".join(dsl_lines)

    def _decompile_renderer_call(
        self, envelope_json: dict[str, Any], call_index: int
    ) -> str:
        """Writes a renderer function call as a standalone call statement.

        The call's `catalogId` is written out only when several catalogs are
        active and a lookup by name would not find that catalog. The
        `functionCallId` is written as a `functionCallId=` argument unless it
        is `call_<n>` for the n-th call of the payload, which is the ID the
        compiler generates.

        Args:
            envelope_json: The `callRendererFunction` message.
            call_index: The 1-based position of the call among the payload's
                renderer function calls.
        """
        renderer_call = envelope_json.get("callRendererFunction")
        function_call_id = None
        if isinstance(renderer_call, dict) and "callFunction" in renderer_call:
            func_op = renderer_call["callFunction"]
            function_call_id = renderer_call.get("functionCallId")
        else:
            func_op = envelope_json.get(SurfaceOperation.CALL_FUNC)
        if not isinstance(func_op, dict):
            func_op = {}
        call_repr = self._decompile_call(func_op, {}, self._sole_catalog_id)
        if function_call_id and function_call_id != f"call_{call_index}":
            id_arg = f"functionCallId={_decompile_string(function_call_id)}"
            separator = "" if call_repr.endswith("()") else ", "
            call_repr = f"{call_repr[:-1]}{separator}{id_arg})"
        return call_repr

    def _decompile_components(
        self,
        components: list[dict[str, Any]],
        surface_cat_id: str | None,
        use_keyword_args: bool,
    ) -> list[str]:
        var_names = _assign_variable_names([c["id"] for c in components])
        dsl_lines = []
        for c in components:
            comp_id = c["id"]
            var_name = var_names[comp_id]
            comp_name = c["component"]
            comp_helper, write_cat_id = self._resolve(
                "component",
                comp_name,
                c.get("catalogId"),
                surface_cat_id,
                "component",
            )

            properties = comp_helper.get_component_properties(comp_name)
            args_reprs = []

            for prop_name in properties:
                if prop_name == "checks":
                    checks_val = c.get("checks", [])
                    if not checks_val:
                        args_reprs.append("_")
                        continue
                    check_reprs = [
                        self._decompile_check(rc, c, var_names, surface_cat_id)
                        for rc in checks_val
                    ]
                    if len(check_reprs) == 1:
                        args_reprs.append(check_reprs[0])
                    else:
                        args_reprs.append(f"[{', '.join(check_reprs)}]")
                    continue

                if prop_name in c:
                    p_schema = comp_helper.get_property_schema(comp_name, prop_name)
                    val_str = self._decompile_value(
                        c[prop_name],
                        var_names,
                        _is_component_reference_property(p_schema),
                        surface_cat_id,
                    )
                    if use_keyword_args:
                        args_reprs.append(f"{prop_name}={val_str}")
                    else:
                        args_reprs.append(val_str)
                elif not use_keyword_args:
                    # Only append "_" if a later regular property has a value
                    idx = properties.index(prop_name)
                    if any(p != "checks" and p in c for p in properties[idx + 1 :]):
                        args_reprs.append("_")

            _strip_trailing_placeholders(args_reprs)

            if write_cat_id is not None:
                args_reprs.append(f"catalogId={_decompile_string(write_cat_id)}")
            if var_name != comp_id:
                args_reprs.append(f"id={_decompile_string(comp_id)}")

            dsl_lines.append(f"{var_name} = {comp_name}({', '.join(args_reprs)})")
        return dsl_lines

    def _decompile_check(
        self,
        rule: dict[str, Any],
        component: dict[str, Any],
        var_names: dict[str, str],
        surface_cat_id: str | None,
    ) -> str:
        """Writes a check rule as `?name(args..., message, {catalogId: ...})`.

        The compiler passes the component's bound `value` as the first `value`
        parameter of a check, so that argument is left implicit when it is the
        component's own binding. A message other than the compiler's default is
        written after every parameter slot, which is where the compiler reads
        it back from.
        """
        # A rule written as a bare function call, without the `condition`
        # wrapper, is read as its own condition.
        if "condition" not in rule and _has_reserved_key(rule, "call"):
            rule = {"condition": rule}
        condition = rule.get("condition", {})
        if not isinstance(condition, dict) or not _has_reserved_key(condition, "call"):
            raise ExpressValidationError(
                "Express cannot write a check whose condition is not a function"
                f" call: {condition!r}"
            )
        check_name = _reserved_value(condition, "call")
        check_args = condition.get("args", {}) or {}
        chk_helper, write_cat_id = self._resolve(
            "function",
            check_name,
            condition.get("catalogId"),
            surface_cat_id,
            "check function",
        )
        check_props = chk_helper.get_function_properties(check_name)

        component_value = component.get("value")
        start_idx = 0
        if (
            check_props
            and check_props[0] == "value"
            and isinstance(component_value, dict)
            and _has_reserved_key(component_value, "path")
            and check_args.get("value") == component_value
        ):
            start_idx = 1

        args_reprs = []
        for p in check_props[start_idx:]:
            if p in check_args:
                args_reprs.append(
                    self._decompile_value(
                        check_args[p], var_names, False, surface_cat_id
                    )
                )
            else:
                args_reprs.append("_")

        message = rule.get("message", "")
        if message and message != f"{check_name.capitalize()} check failed":
            args_reprs.append(_decompile_string(message))
        else:
            _strip_trailing_placeholders(args_reprs)

        if write_cat_id is not None:
            args_reprs.append(f"{{catalogId: {_decompile_string(write_cat_id)}}}")

        if args_reprs:
            return f"?{check_name}({', '.join(args_reprs)})"
        return f"?{check_name}"

    def _decompile_call(
        self,
        fn: dict[str, Any],
        var_names: dict[str, str],
        surface_cat_id: str | None,
    ) -> str:
        """Writes a function call as `name(args..., catalogId=...)`."""
        name = _reserved_value(fn, "call") or ""
        args = fn.get("args", {}) or {}
        fn_helper, write_cat_id = self._resolve(
            "function", name, fn.get("catalogId"), surface_cat_id, "function"
        )

        fn_props = fn_helper.get_function_properties(name)
        args_reprs = []
        for idx, p in enumerate(fn_props):
            if isinstance(args, dict):
                present, arg_val = p in args, args.get(p)
            else:
                present = idx < len(args)
                arg_val = args[idx] if present else None
            if present:
                args_reprs.append(
                    self._decompile_value(arg_val, var_names, False, surface_cat_id)
                )
            else:
                args_reprs.append("_")
        _strip_trailing_placeholders(args_reprs)

        if write_cat_id is not None:
            args_reprs.append(f"catalogId={_decompile_string(write_cat_id)}")
        return f"{name}({', '.join(args_reprs)})"

    def _decompile_value(
        self,
        val: Any,
        var_names: dict[str, str],
        is_ref: bool,
        surface_cat_id: str | None,
    ) -> str:
        """Decompiles a single value node back to A2UI Express notation.

        Args:
            val: The JSON-serialized property value structure.
            var_names: Maps the ID of each component defined in the same
                block to the variable name it is written under.
            is_ref: Whether this value is a component reference.
            surface_cat_id: The catalog of the surface, which every call
                without a `catalogId` belongs to, or None when the surface has
                no catalog.

        Returns:
            A plain-text representation of the value.
        """
        if isinstance(val, dict):
            if _has_reserved_key(val, "path"):
                path_str = _reserved_value(val, "path")
                if "componentId" in val:
                    comp_id_repr = _decompile_reference(val["componentId"], var_names)
                    return f"_template({_decompile_path(path_str)}, {comp_id_repr})"
                return _decompile_path(path_str)

            if "event" in val:
                evt = val["event"]
                name = _decompile_string(evt.get("name", ""))
                ctx = evt.get("context", {})
                ctx_reprs = [
                    f"{_decompile_key(k)}:"
                    f" {self._decompile_value(v, var_names, False, surface_cat_id)}"
                    for k, v in ctx.items()
                ]
                # An empty context is written out so that it compiles back.
                if "context" in evt:
                    return f"Event({name}, {{{', '.join(ctx_reprs)}}})"
                return f"Event({name})"

            if "functionCall" in val:
                return self._decompile_call(
                    val["functionCall"], var_names, surface_cat_id
                )

            if _has_reserved_key(val, "call"):
                return self._decompile_call(val, var_names, surface_cat_id)

            items_reprs = []
            for k, v in val.items():
                item_is_ref = is_ref or k in ("child", "componentId")
                v_repr = self._decompile_value(
                    v, var_names, item_is_ref, surface_cat_id
                )
                items_reprs.append(f"{_decompile_key(k)}: {v_repr}")
            return f"{{{', '.join(items_reprs)}}}"

        if isinstance(val, list):
            list_reprs = [
                self._decompile_value(item, var_names, is_ref, surface_cat_id)
                for item in val
            ]
            return f"[{', '.join(list_reprs)}]"

        if isinstance(val, str):
            if is_ref:
                return _decompile_reference(val, var_names)
            return _decompile_string(val)

        if isinstance(val, bool):
            return "true" if val else "false"

        if val is None:
            return "null"

        return str(val)
