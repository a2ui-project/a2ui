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

"""Compilation engine for A2UI Express.

Tokenizes, lexes, and parses A2UI Express plain-text statements into a clean
AST, compiling it into A2UI messages for the target protocol version (v0.9,
v0.9.1 or v1.0).

The grammar for A2UI Express is defined in Express.g4.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field, replace
import json
import re
from typing import Any, Literal

from antlr4 import CommonTokenStream, InputStream

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import is_at_least_version, is_valid_uax31_identifier
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

from .constants import SurfaceOperation
from .errors import (
    ExpressDuplicateParamError,
    ExpressDuplicatePropertyError,
    ExpressForbiddenDatabindingError,
    ExpressInvalidParamError,
    ExpressParseError,
    ExpressUndefinedRootError,
    ExpressUnknownPropertyError,
    ExpressValidationError,
)
from .generated.express_lexer import ExpressLexer
from .generated.express_parser import ExpressParser
from .nodes import CallNode, CheckNode, PathNode, SkippedNode, VariableNode
from .visitor import ExpressAstVisitor, ExpressErrorListener

# Statements that the compiler handles itself rather than as catalog calls.
_SURFACE_STATEMENT = "surface"
_DELETE_SURFACE_STATEMENT = "deleteSurface"

# Reserved keyword arguments that every catalog accepts. `id=` sets a
# component's ID when it is not a valid variable name, `functionCallId=` sets
# the ID of a standalone call's `callRendererFunction`, and `sendDataModel=`
# sets the flag of the same name on `createSurface`.
_ID_KEY = "id"
_FUNCTION_CALL_ID_KEY = "functionCallId"
_SEND_DATA_MODEL_KEY = "sendDataModel"
_UPDATE_KEY = "update"

# Keyword arguments accepted by the reserved `Event(...)` signature.
_EVENT_KEYWORDS = ("userMessage", "context")


@dataclass(frozen=True)
class _ValueSlot:
    """The catalog schema declared at a value's position, with the helper that owns it."""

    schema: dict[str, Any]
    helper: CatalogSchemaHelper


def _item_slot(slot: _ValueSlot | None) -> _ValueSlot | None:
    """Descends a value slot into the items of an array.

    Returns:
        The item slot, or None when the schema is unknown at that position.
    """
    if slot is None:
        return None
    schema = slot.helper.resolve_item_schema(slot.schema)
    return _ValueSlot(schema, slot.helper) if schema else None


def _property_slot(slot: _ValueSlot | None, name: str) -> _ValueSlot | None:
    """Descends a value slot into a property of an object, whatever its name.

    Returns:
        The property's slot, or None when the schema is unknown at that position.
    """
    if slot is None:
        return None
    schema = slot.helper.resolve_property_schema(slot.schema, name)
    return _ValueSlot(schema, slot.helper) if schema else None


def _component_id(var_name: str, ast: Any, *, at_least_v10: bool = False) -> str:
    """Returns the ID of the component a variable holds.

    The ID is the variable name unless the component call sets `id=`.

    Raises:
        ExpressValidationError: If `id=` is set to something other than a
            non-empty string, or (in v1.0 and later) is not a valid UAX 31
            identifier.
    """
    kwargs = ast.kwargs if isinstance(ast, CallNode) else None
    if not kwargs or _ID_KEY not in kwargs:
        return var_name
    explicit_id = kwargs[_ID_KEY]
    if not isinstance(explicit_id, str) or not explicit_id:
        raise ExpressValidationError(
            f"Component id must be a non-empty string, got: {explicit_id!r}"
        )
    if at_least_v10 and not is_valid_uax31_identifier(explicit_id):
        raise ExpressValidationError(
            f"Component id {explicit_id!r} is not a valid UAX 31 identifier."
        )
    return explicit_id


def _strip_path_prefix(path_str: str) -> str:
    """Strips the `$` (and a following `/`) from an Express data path."""
    if path_str.startswith("$/"):
        return path_str[2:]
    if path_str.startswith("$"):
        return path_str[1:]
    return path_str


def _to_json_pointer(path_str: str) -> str:
    """Converts an Express data path such as `$/user/name` to `/user/name`.

    `$` and `$/` both name the root of the data model, `/`.
    """
    return "/" + _strip_path_prefix(path_str)


_ARRAY_INDEX_RE = re.compile(r"^(?:0|[1-9][0-9]*)$")
_MAX_ARRAY_INDEX = 10_000


def _parse_array_index(segment: str, path_str: str) -> int:
    """Parses a canonical non-negative array index segment within bounds."""
    if not _ARRAY_INDEX_RE.match(segment):
        raise ExpressValidationError(
            f"Cannot use non-numeric segment {segment!r} on an array in path"
            f" {path_str!r}."
        )
    idx = int(segment)
    if idx > _MAX_ARRAY_INDEX:
        raise ExpressValidationError(
            f"Cannot set path {path_str!r}: array index {segment!r} exceeds"
            f" maximum supported index ({_MAX_ARRAY_INDEX})."
        )
    return idx


def _step_path_container(
    current: dict[str, Any] | list[Any],
    segment: str,
    next_segment: str,
    path_str: str,
) -> dict[str, Any] | list[Any]:
    """Advances one path segment through a dict or list, auto-vivifying if needed."""
    is_next_index = bool(_ARRAY_INDEX_RE.match(next_segment))
    if isinstance(current, dict):
        existing = current.get(segment)
        if existing is None:
            child: dict[str, Any] | list[Any] = [] if is_next_index else {}
            current[segment] = child
            return child
        if isinstance(existing, (dict, list)):
            return existing
        raise ExpressValidationError(
            f"Cannot set path {path_str!r}: segment {segment!r} is a primitive value."
        )
    idx = _parse_array_index(segment, path_str)
    while len(current) <= idx:
        current.append(None)
    existing = current[idx]
    if existing is None:
        child = [] if is_next_index else {}
        current[idx] = child
        return child
    if isinstance(existing, (dict, list)):
        return existing
    raise ExpressValidationError(
        f"Cannot set path {path_str!r}: segment {segment!r} is a primitive value."
    )


def _set_nested_path(d: dict[str, Any], path_str: str, val: Any) -> None:
    """Populates a nested dictionary or list path from an Express data path.

    Args:
        d: The target dictionary to mutate.
        path_str: The data path string (e.g. "$/user/name" or "$/items/0/state").
        val: The value to set at the specified path.
    """
    clean_path = _strip_path_prefix(path_str)
    if not clean_path:
        if not isinstance(val, dict):
            raise ExpressValidationError(
                f"Cannot set root data model {path_str!r} to a non-map value."
            )
        d.clear()
        d.update(val)
        return

    keys = clean_path.split("/")
    current: dict[str, Any] | list[Any] = d
    for i, key in enumerate(keys[:-1]):
        current = _step_path_container(current, key, keys[i + 1], path_str)
    last_key = keys[-1]
    if isinstance(current, dict):
        current[last_key] = val
        return
    idx = _parse_array_index(last_key, path_str)
    while len(current) <= idx:
        current.append(None)
    current[idx] = val


def _schema_allows_databinding(schema: Any) -> bool:
    """Recursively checks if a property's schema allows a dynamic DataBinding ref.

    Args:
        schema: The JSON schema dict for the target property.

    Returns:
        True if the schema permits dynamic databinding; False otherwise.
    """
    if not isinstance(schema, dict):
        return False
    if "$ref" in schema:
        ref = schema["$ref"]
        if isinstance(ref, str) and ("DataBinding" in ref or "Dynamic" in ref):
            return True
    if "properties" in schema and (
        "path" in schema["properties"] or "@path" in schema["properties"]
    ):
        if "componentId" not in schema["properties"]:
            return True
    if "items" in schema:
        if _schema_allows_databinding(schema["items"]):
            return True
    for key in ["allOf", "oneOf", "anyOf"]:
        if key in schema and isinstance(schema[key], list):
            for sub in schema[key]:
                if _schema_allows_databinding(sub):
                    return True
    return False


def _describe_express_value(val: Any) -> str:
    """Names a parsed value for an error message in the terms the model wrote it in.

    Returns:
        A short phrase such as `a map literal` or `the number 42`, rather than
        the node's repr.
    """
    if isinstance(val, CallNode):
        return f"a call to {val.name}(...)"
    if isinstance(val, CheckNode):
        return f"a check (?{val.name})"
    if isinstance(val, VariableNode):
        return f"the variable {val.name}"
    if isinstance(val, PathNode):
        return f"the data binding ${val.path}"
    if isinstance(val, SkippedNode):
        return "'_'"
    if isinstance(val, dict):
        return "a map literal"
    if isinstance(val, list):
        return "a list"
    if val is None:
        return "null"
    if isinstance(val, bool):
        return f"the boolean {str(val).lower()}"
    if isinstance(val, (int, float)):
        return f"the number {json.dumps(val)}"
    if isinstance(val, str):
        return f"the string {json.dumps(val)}"
    return f"a {type(val).__name__}"


def _binding_path(v: Any, path_key: str) -> str | None:
    """Returns the path of a compiled data binding, or None if `v` is not one.

    `path_key` is the binding key of the target version: `@path` in v1.0 and
    later, `path` before. A plain `path` key in v1.0 is data. A child list
    template (`{"componentId": ..., "path": ...}`) is not a data binding.
    """
    if not isinstance(v, dict) or "componentId" in v:
        return None
    val = v.get(path_key)
    return val if isinstance(val, str) else None


def _resolves_to_path(node: Any, raw_symbols: dict[str, Any]) -> bool:
    """Checks whether an AST value is a `$path`, directly or through variables.

    A map literal is data even when its compiled value looks like a data
    binding, so it is not a path.
    """
    seen: set[str] = set()
    while isinstance(node, VariableNode):
        if node.name in seen or node.name not in raw_symbols:
            return False
        seen.add(node.name)
        node = raw_symbols[node.name]
    return isinstance(node, PathNode)


def _has_databinding(
    node: Any,
    raw_symbols: dict[str, Any],
    seen: frozenset[str] = frozenset(),
) -> bool:
    """Checks whether an AST value writes a data binding outside of any call.

    The check runs on the AST rather than on the compiled value, so that a map
    literal whose keys are named like a call, an event or a function call
    (`call`, `@call`, `event`, `functionCall`) is still searched. The arguments
    of calls, events and templates are not searched, since a function resolves
    its own arguments.

    Args:
        node: The AST value (node, dict, list, or primitive) to inspect.
        raw_symbols: The variables of the block, to follow references.
        seen: The variables already followed, which guards against cycles.

    Returns:
        True if a `$path` is found; False otherwise.
    """
    if isinstance(node, PathNode):
        return True
    if isinstance(node, VariableNode):
        if node.name in seen or node.name not in raw_symbols:
            return False
        return _has_databinding(raw_symbols[node.name], raw_symbols, seen | {node.name})
    if isinstance(node, dict):
        return any(_has_databinding(v, raw_symbols, seen) for v in node.values())
    if isinstance(node, list):
        return any(_has_databinding(v, raw_symbols, seen) for v in node)
    return False


def _schema_expects_option_objects(schema: Any) -> bool:
    """Checks if a property's schema expects a list of objects with label/value properties."""
    if not isinstance(schema, dict):
        return False
    if "items" in schema:
        items_schema = schema["items"]

        def has_label_value(sub: Any) -> bool:
            if not isinstance(sub, dict):
                return False
            if (
                "properties" in sub
                and "label" in sub["properties"]
                and "value" in sub["properties"]
            ):
                return True
            for k in ["allOf", "oneOf", "anyOf"]:
                if k in sub and isinstance(sub[k], list):
                    if any(has_label_value(s) for s in sub[k]):
                        return True
            return False

        return has_label_value(items_schema)
    for key in ["allOf", "oneOf", "anyOf"]:
        if key in schema and isinstance(schema[key], list):
            if any(_schema_expects_option_objects(sub) for sub in schema[key]):
                return True
    return False


_IDENT_START = r"a-zA-Z_"
_IDENT_CHARS = r"a-zA-Z0-9_"
_IDENTIFIER = r"[" + _IDENT_START + r"][" + _IDENT_CHARS + r"]*"

_SQL_COMMENT_OR_TOKEN_RE = re.compile(
    r'([rR]"""[\s\S]*?"""|[rR]"[^\r\n"]*"|"""(?:\\[\s\S]|[^\\])*?"""|"(?:\\[\s\S]|[^\\])*?"|(?:#|//)[^\r\n]*|/\*[\s\S]*?\*/)|--([^\r\n]*)'
)
_DECLARED_LHS_RE = re.compile(r"(?m)^[ \t]*(" + _IDENTIFIER + r")[ \t]*=(?!=)")
_SPLIT_LHS_RE = re.compile(
    r"(?m)^([ \t]*"
    + _IDENTIFIER
    + r")[ \t]*(\r?\n)[ \t]*(["
    + _IDENT_CHARS
    + r"]+)(?=[ \t]*=(?!=))"
)
_SPLIT_DATA_PATH_RE = re.compile(
    r"(\$[" + _IDENT_CHARS + r"/]*/)[ \t]*(\r?\n)[ \t]*([" + _IDENT_CHARS + r"/]+)"
)
_IDENT_ONLY_RE = re.compile(r"^" + _IDENTIFIER + r"$")
_ASSIGN_EQUALS_RE = re.compile(r"^[ \t]*=(?!=)")
_SPLIT_ARG_IDENT_RE = re.compile(
    r"([(\[,:=][ \t]*\r?\n?[ \t]*|[(\[,:=][ \t]*)("
    + _IDENTIFIER
    + r")[ \t]*(\r?\n)[ \t]*(["
    + _IDENT_CHARS
    + r"]+)(?=[ \t]*[,)\]}]|\s*\r?\n)"
)


def _normalize_express_source(source: str) -> str:
    """Normalizes `--` comments and line-broken tokens outside strings and comments.

    Preserves line counts so syntax error line numbers match the original source.
    """
    segments: list[tuple[bool, str]] = []
    pos = 0
    for m in _SQL_COMMENT_OR_TOKEN_RE.finditer(source):
        if m.start() > pos:
            segments.append((False, source[pos : m.start()]))
        if m.group(1) is not None:
            segments.append((True, m.group(1)))
        else:
            segments.append((True, f"//{m.group(2)}"))
        pos = m.end()
    if pos < len(source):
        segments.append((False, source[pos:]))

    depth = 0
    seg_depths: list[list[int]] = []
    for is_tok, seg in segments:
        if is_tok:
            seg_depths.append([])
            continue
        depths = []
        for ch in seg:
            depths.append(depth)
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                if depth > 0:
                    depth -= 1
        seg_depths.append(depths)

    split_p2_starts: set[tuple[int, int]] = set()
    for seg_idx, (is_tok, seg) in enumerate(segments):
        if not is_tok:
            depths = seg_depths[seg_idx]
            for sm in _SPLIT_LHS_RE.finditer(seg):
                if depths[sm.start(1)] == 0:
                    split_p2_starts.add((seg_idx, sm.start(3)))

    direct_declared: set[str] = set()
    for seg_idx, (is_tok, seg) in enumerate(segments):
        if not is_tok:
            depths = seg_depths[seg_idx]
            for dm in _DECLARED_LHS_RE.finditer(seg):
                if (
                    depths[dm.start(1)] == 0
                    and (seg_idx, dm.start(1)) not in split_p2_starts
                ):
                    direct_declared.add(dm.group(1))

    declared = set(direct_declared)
    for seg_idx, (is_tok, seg) in enumerate(segments):
        if not is_tok:
            depths = seg_depths[seg_idx]
            for sm in _SPLIT_LHS_RE.finditer(seg):
                if depths[sm.start(1)] == 0:
                    p1 = sm.group(1).strip()
                    p2 = sm.group(3)
                    if p1 not in direct_declared and p2 not in direct_declared:
                        declared.add(p1 + p2)

    out: list[str] = []
    for is_tok, seg in segments:
        if is_tok:
            out.append(seg)
            continue

        def _join_data_path(m: re.Match[str]) -> str:
            p1, nl, p2 = m.group(1), m.group(2), m.group(3)
            rest = seg[m.end() :]
            if _IDENT_ONLY_RE.match(p2) and _ASSIGN_EQUALS_RE.match(rest):
                return m.group(0)
            return f"{p1}{p2}{nl}"

        seg = _SPLIT_DATA_PATH_RE.sub(_join_data_path, seg)

        def _join_lhs(m: re.Match[str]) -> str:
            p1_raw, nl, p2 = m.group(1), m.group(2), m.group(3)
            p1 = p1_raw.strip()
            if p1 not in direct_declared and p2 not in direct_declared:
                return f"{p1_raw}{p2}{nl}"
            return m.group(0)

        seg = _SPLIT_LHS_RE.sub(_join_lhs, seg)

        def _join_arg(m: re.Match[str]) -> str:
            prefix, p1, nl, p2 = m.group(1), m.group(2), m.group(3), m.group(4)
            joined = p1 + p2
            if joined in declared and p1 not in declared and p2 not in declared:
                return f"{prefix}{joined}{nl}"
            return m.group(0)

        seg = _SPLIT_ARG_IDENT_RE.sub(_join_arg, seg)
        out.append(seg)
    return "".join(out)


def _is_check_expression(val: Any) -> bool:
    """Checks if a parsed AST value represents a validation check expression."""
    if isinstance(val, CheckNode):
        return True
    if isinstance(val, list) and val:
        return all(_is_check_expression(item) for item in val)
    return False


def _call_arg(node: CallNode, index: int, key: str) -> Any:
    """Returns a call's argument given by keyword `key` or at position `index`."""
    if key in node.kwargs:
        return node.kwargs[key]
    if len(node.args) > index:
        return node.args[index]
    return None


def _string_call_arg(
    node: CallNode, index: int, key: str, statement: str
) -> str | None:
    """Returns a string argument of a reserved statement, or None when absent.

    Raises:
        ExpressValidationError: If the argument is present but not a string.
    """
    val = _call_arg(node, index, key)
    if val is None:
        return None
    if not isinstance(val, str):
        raise ExpressValidationError(
            f"{statement}() argument '{key}' must be a string, got: {val!r}"
        )
    return val


class _CompileContext:
    """Holds mutable state for a single compiler execution thread."""

    def __init__(self, version: str):
        self.version = version
        self.at_least_v10 = is_at_least_version(version, ProtocolVersion.V1_0)
        # v1.0 spells data bindings and function calls with reserved `@` keys.
        self.path_key = "@path" if self.at_least_v10 else "path"
        self.call_key = "@call" if self.at_least_v10 else "call"
        self.extra_components: list[dict[str, Any]] = []
        self.inline_counter: int = 0
        self.call_counter: int = 0
        self.active_value_path: dict[str, Any] | None = None
        # The variables whose values are being compiled, to catch a variable
        # whose value refers back to it.
        self.resolving: set[str] = set()

    def check_catalog_override(self, target: str) -> None:
        """Rejects a per-component or per-function catalogId below v1.0.

        Raises:
            ExpressValidationError: If the target version predates v1.0, whose
                schemas only allow `catalogId` on `createSurface`.
        """
        if not self.at_least_v10:
            raise ExpressValidationError(
                f"{target} sets catalogId, but A2UI {self.version} only allows"
                " catalogId on the surface. Per-component and per-function"
                " catalogId overrides need A2UI v1.0 or later."
            )


@dataclass
class _SurfaceScope:
    """Holds symbols and data path assignments for a target surface scope.

    Attributes:
        surface_id: The surface the scope's messages target.
        has_surface_directive: Whether a `surface(...)` line opened the scope.
        send_data_model: The `sendDataModel=` argument of the `surface(...)`
            line, or None when it has none.
    """

    surface_id: str
    has_surface_directive: bool = False
    send_data_model: bool | None = None
    is_update: bool = False
    raw_symbols: dict[str, Any] = field(default_factory=dict)
    data_path_assignments: dict[str, Any] = field(default_factory=dict)


@dataclass
class _DeleteSurface:
    surface_id: str


@dataclass
class _StandaloneCall:
    node: CallNode
    scope: _SurfaceScope | None


class ExpressCompiler:
    """Compilation pipeline for A2UI Express.

    Resolves positional parameters dynamically, flattens variable references into
    an adjacency list widget tree, and constructs A2UI messages for the target
    protocol version.

    Components and function calls written without a `catalogId` are looked
    up by name across the catalogs. With a single catalog the compiled
    `createSurface` names that catalog and components and calls carry no
    `catalogId`. With several catalogs, which need A2UI v1.0 or later,
    `createSurface` names no catalog, so the surface has no default catalog,
    and every compiled component and function call carries the `catalogId` of
    the one catalog that defines its name. A name that several catalogs define
    must be written with a `catalogId=` keyword argument (or a
    `{catalogId: ...}` argument on a check), which always wins and is kept on
    the compiled message.

    Attributes:
        helpers: Mapping of catalog IDs to CatalogSchemaHelper instances.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        version: str | None = None,
    ):
        """Initializes the compiler with one or more catalogs.

        Args:
            catalogs: A sequence of Catalog instances.
            version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
                Defaults to the version that the catalogs target.

        Raises:
            A2uiCatalogError: If no catalog is given, the catalogs target
                different protocol versions, or there are several catalogs and
                they target a version before v1.0.
        """
        self._catalogs = check_mixed_catalogs(catalogs)
        self.helpers = build_catalog_helpers(self._catalogs)
        self.version = version or catalogs_protocol_version(self._catalogs)

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs, in the order the compiler received them."""
        return list(self._catalogs)

    @property
    def _is_multi_catalog(self) -> bool:
        return len(self._catalogs) > 1

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

    def _defines_component(self, name: str, catalog_id: Any) -> bool:
        """Checks whether a call names a component rather than a function.

        Args:
            name: The called name.
            catalog_id: The `catalogId` written on the call, or None when it
                has none, in which case every catalog is searched.
        """
        if isinstance(catalog_id, str) and catalog_id in self.helpers:
            return name in self.helpers[catalog_id].components
        return bool(catalogs_defining(self.helpers, "component", name))

    def _defines_function(self, name: str, catalog_id: Any) -> bool:
        """Checks whether a call names a function.

        Args:
            name: The called name.
            catalog_id: The `catalogId` written on the call, or None when it
                has none, in which case every catalog is searched. A
                `catalogId` that names no active catalog defines nothing.
        """
        if catalog_id is not None:
            if isinstance(catalog_id, str) and catalog_id in self.helpers:
                return name in self.helpers[catalog_id].functions
            return False
        return bool(catalogs_defining(self.helpers, "function", name))

    def _resolve(
        self,
        kind: Literal["component", "function"],
        name: str,
        catalog_id: Any,
        ctx: _CompileContext,
        target: str,
        label: str,
    ) -> tuple[CatalogSchemaHelper, str | None]:
        """Finds the catalog a component or function call resolves against.

        An explicit `catalogId` wins. Otherwise the name is looked up across
        all catalogs, and exactly one of them must define it.

        Args:
            kind: Whether `name` is a component or a function.
            name: The component or function name.
            catalog_id: The `catalogId` written on the component or call, or
                None when it has none.
            ctx: The active compiler execution context.
            target: A description of the component or call, for errors.
            label: What `name` is, such as "component" or "check function",
                for errors.

        Returns:
            The helper of the resolved catalog, and the `catalogId` to write on
            the compiled component or call: the explicit one, else the resolved
            catalog's ID when several catalogs are active, else None.

        Raises:
            ExpressValidationError: If `catalog_id` is not a string, names no
                active catalog, or the target version disallows it; or if the
                resolved catalog does not define `name`, no catalog defines it,
                or several catalogs define it and no `catalogId` picks one.
        """
        if catalog_id is not None:
            if not isinstance(catalog_id, str):
                raise ExpressValidationError(
                    f"{target} catalogId must be a string, got: {catalog_id!r}"
                )
            ctx.check_catalog_override(target)
            helper = self._helper_for(catalog_id)
            defined = helper.components if kind == "component" else helper.functions
            if name not in defined:
                raise ExpressValidationError(
                    f"Unknown {label} '{name}' not defined in catalog '{catalog_id}'."
                )
            return helper, catalog_id

        matches = catalogs_defining(self.helpers, kind, name)
        if len(matches) > 1:
            raise ExpressValidationError(
                f"{label.capitalize()} '{name}' is defined in several catalogs:"
                f" {matches}. Name the catalog to use with a catalogId argument."
            )
        if not matches:
            if self._is_multi_catalog:
                raise ExpressValidationError(
                    f"Unknown {label} '{name}' not defined in any catalog:"
                    f" {list(self.helpers.keys())}."
                )
            raise ExpressValidationError(
                f"Unknown {label} '{name}' not defined in catalog"
                f" '{self._catalogs[0].catalog_id}'."
            )
        resolved_id = matches[0]
        return (
            self.helpers[resolved_id],
            resolved_id if self._is_multi_catalog else None,
        )

    def _parse_statements(self, dsl_text: str, is_final: bool) -> list[Any]:
        """Strips sentinel tags and parses the DSL body into statements."""
        has_sentinels = "<a2ui>" in dsl_text
        lines = []
        inside_a2ui = not has_sentinels
        for line in dsl_text.splitlines():
            trimmed = line.strip()
            if "<a2ui>" in trimmed:
                inside_a2ui = True
                line = line.replace("<a2ui>", "")
                trimmed = line.strip()
            if "</a2ui>" in trimmed:
                inside_a2ui = False
                line = line.split("</a2ui>")[0]
                if line.strip():
                    lines.append(line)
                continue
            if inside_a2ui:
                lines.append(line)

        dsl_body = _normalize_express_source("\n".join(lines))

        input_stream = InputStream(dsl_body)
        lexer = ExpressLexer(input_stream)
        error_listener = ExpressErrorListener()
        lexer.removeErrorListeners()
        lexer.addErrorListener(error_listener)

        token_stream = CommonTokenStream(lexer)
        parser = ExpressParser(token_stream)
        parser.removeErrorListeners()
        parser.addErrorListener(error_listener)

        try:
            tree = parser.program()
            if is_final and error_listener.errors:
                err_line, col, msg, is_lexer = error_listener.errors[0]
                err = SyntaxError(f"Syntax error at line {err_line}:{col}: {msg}")
                err.lineno = err_line
                err.offset = col
                setattr(err, "_is_lexer", is_lexer)
                raise err

            visitor = ExpressAstVisitor(
                first_error_line=error_listener.errors[0][0]
                if error_listener.errors
                else None
            )
            return list(visitor.visit(tree))
        except Exception as e:
            if not is_final:
                return []
            if isinstance(e, SyntaxError) and getattr(e, "_is_lexer", False):
                raise e
            raise ExpressParseError(f"Failed to parse expression: {e}") from e

    def compile(
        self,
        dsl_text: str,
        surface_id: str = "default_surface",
        is_final: bool = True,
        version: str | None = None,
    ) -> list[AgentToRendererMessage]:
        """Compiles plain A2UI Express DSL into standard A2UI message models.

        Every statement in the block compiles, and the messages come back in
        the order their statements appear: each `surface(...)` scope,
        `deleteSurface(...)` and standalone function call is one unit.

        Args:
            dsl_text: The source A2UI Express DSL text block.
            surface_id: The surface used when the block names none.
            is_final: Whether this is the final compilation pass.
            version: Target version override ("v0.9", "v0.9.1", or "v1.0").

        Returns:
            A list of compiled AgentToRendererMessage objects.

        Raises:
            A2uiCatalogError: If there are several catalogs and the target
                version predates v1.0.
            ValueError: If the root component variable is missing or unsupported features are used.
            ExpressCompilerError: If a component property, parameter, databinding,
                catalog, or reference is invalid.
        """
        target_version = version or self.version
        ctx = _CompileContext(target_version)
        if self._is_multi_catalog and not ctx.at_least_v10:
            raise A2uiCatalogError(
                "Several catalogs need A2UI v1.0 or later, but the target version is"
                f" {target_version}."
            )
        statements = self._parse_statements(dsl_text, is_final)

        units: list[_SurfaceScope | _DeleteSurface | _StandaloneCall] = []
        current_scope: _SurfaceScope | None = None

        for stmt in statements:
            stmt_type, *stmt_args = stmt
            if stmt_type == "EXPR":
                parsed_val = stmt_args[0]
                if not isinstance(parsed_val, CallNode):
                    continue
                name = parsed_val.name
                if name == _SURFACE_STATEMENT:
                    current_scope = self._open_scope(
                        parsed_val,
                        default_surface_id=surface_id,
                    )
                    units.append(current_scope)
                elif name == _DELETE_SURFACE_STATEMENT:
                    target = _string_call_arg(parsed_val, 0, "surfaceId", name)
                    if target is None:
                        raise ExpressValidationError(
                            "deleteSurface() requires the id of the surface to delete."
                        )
                    units.append(_DeleteSurface(target))
                else:
                    units.append(_StandaloneCall(parsed_val, current_scope))
            elif stmt_type == "ASSIGN":
                var_name, parsed_val = stmt_args
                if current_scope is None:
                    current_scope = _SurfaceScope(surface_id=surface_id)
                    units.append(current_scope)
                if var_name.startswith("$"):
                    current_scope.data_path_assignments.pop(var_name, None)
                    current_scope.data_path_assignments[var_name] = parsed_val
                else:
                    current_scope.raw_symbols[var_name] = parsed_val

        if not units:
            raise ExpressUndefinedRootError("root")

        result_messages: list[dict[str, Any]] = []
        for unit in units:
            if isinstance(unit, _DeleteSurface):
                result_messages.append({
                    "version": target_version,
                    SurfaceOperation.DELETE: {"surfaceId": unit.surface_id},
                })
            elif isinstance(unit, _StandaloneCall):
                result_messages.append(self._compile_standalone_call(unit, ctx))
            else:
                result_messages.extend(self._compile_create_scope(unit, ctx))

        return to_message_models(result_messages)

    def _check_header_catalog(self, statement: str, catalog_id: str) -> None:
        """Checks the catalog that a `surface` line names.

        Only a single catalog may be named on the line, and it must be that
        catalog. With several catalogs a surface has no catalog of its own.

        Raises:
            ExpressValidationError: If there are several catalogs, or the line
                names a catalog other than the single one.
        """
        if self._is_multi_catalog:
            raise ExpressValidationError(
                f"{statement}() names catalog '{catalog_id}', but a surface names"
                " no catalog when several catalogs are active. Remove the catalog"
                " from the line and add catalogId only to components and function"
                " calls whose name several catalogs define."
            )
        self._helper_for(catalog_id)

    def _open_scope(
        self,
        node: CallNode,
        *,
        default_surface_id: str,
    ) -> _SurfaceScope:
        """Opens the scope of a `surface(...)` statement.

        The line may name the single catalog as its second argument; with
        several catalogs naming one is an error.
        """
        statement = node.name
        target_surf = (
            _string_call_arg(node, 0, "surfaceId", statement) or default_surface_id
        )
        explicit_cat = _string_call_arg(node, 1, "catalogId", statement)
        if explicit_cat is not None:
            self._check_header_catalog(statement, explicit_cat)
        send_data_model = node.kwargs.get(_SEND_DATA_MODEL_KEY)
        if send_data_model is not None and not isinstance(send_data_model, bool):
            raise ExpressValidationError(
                f"{_SEND_DATA_MODEL_KEY} must be true or false, got:"
                f" {statement}({_SEND_DATA_MODEL_KEY}={send_data_model!r})"
            )
        is_update = node.kwargs.get(_UPDATE_KEY, False)
        if is_update is not None and not isinstance(is_update, bool):
            raise ExpressValidationError(
                f"{_UPDATE_KEY} must be true or false, got:"
                f" {statement}({_UPDATE_KEY}={is_update!r})"
            )
        return _SurfaceScope(
            surface_id=target_surf,
            has_surface_directive=True,
            send_data_model=send_data_model,
            is_update=bool(is_update),
        )

    def _compile_components(
        self, scope: _SurfaceScope, ctx: _CompileContext
    ) -> list[dict[str, Any]]:
        compiled_components = []
        for var_name, ast in scope.raw_symbols.items():
            comp_dict = self._compile_ast_node(var_name, ast, scope.raw_symbols, ctx)
            if comp_dict:
                compiled_components.append(comp_dict)
                compiled_components.extend(ctx.extra_components)
                ctx.extra_components = []
        return compiled_components

    def _compile_data_value(
        self, scope: _SurfaceScope, ast_val: Any, ctx: _CompileContext
    ) -> Any:
        return self._compile_value(ast_val, scope.raw_symbols, ctx)

    def _compile_create_scope(
        self, scope: _SurfaceScope, ctx: _CompileContext
    ) -> list[dict[str, Any]]:
        """Compiles a `surface(...)` scope, or the implicit default scope."""
        compiled_components = self._compile_components(scope, ctx)
        surf_id = scope.surface_id
        is_create = not scope.is_update and any(
            c.get("id") == "root" for c in compiled_components
        )

        if not is_create:
            data_updates = []
            for path_name, ast_val in scope.data_path_assignments.items():
                pointer = _to_json_pointer(path_name)
                compiled_val = self._compile_data_value(scope, ast_val, ctx)
                if pointer == "/" and not isinstance(compiled_val, dict):
                    raise ExpressValidationError(
                        "Cannot assign a non-map value to the root data path"
                        f" '$/' (got {type(compiled_val).__name__})."
                    )
                data_updates.append({
                    "version": ctx.version,
                    SurfaceOperation.UPDATE_DATA: {
                        "surfaceId": surf_id,
                        "path": pointer,
                        "value": compiled_val,
                    },
                })
            if not compiled_components:
                if data_updates:
                    return data_updates
                raise ExpressUndefinedRootError("root")
            if not scope.has_surface_directive:
                raise ExpressUndefinedRootError("root")
            return [
                {
                    "version": ctx.version,
                    SurfaceOperation.UPDATE_COMPONENTS: {
                        "surfaceId": surf_id,
                        "components": compiled_components,
                    },
                },
                *data_updates,
            ]

        data_model: dict[str, Any] = {}
        for path_name, ast_val in scope.data_path_assignments.items():
            compiled_val = self._compile_data_value(scope, ast_val, ctx)
            _set_nested_path(data_model, path_name, compiled_val)

        create: dict[str, Any] = {"surfaceId": surf_id}
        cat_id = surface_catalog_id(self._catalogs)
        if cat_id is not None:
            create["catalogId"] = cat_id
        if scope.send_data_model is not None:
            create[_SEND_DATA_MODEL_KEY] = scope.send_data_model
        if ctx.at_least_v10:
            create["components"] = compiled_components
            if data_model:
                create["dataModel"] = data_model
            return [{"version": ctx.version, SurfaceOperation.CREATE: create}]

        messages = [
            {"version": ctx.version, SurfaceOperation.CREATE: create},
            {
                "version": ctx.version,
                SurfaceOperation.UPDATE_COMPONENTS: {
                    "surfaceId": surf_id,
                    "components": compiled_components,
                },
            },
        ]
        if data_model:
            messages.append({
                "version": ctx.version,
                SurfaceOperation.UPDATE_DATA: {
                    "surfaceId": surf_id,
                    "path": "/",
                    "value": data_model,
                },
            })
        return messages

    def _compile_standalone_call(
        self,
        unit: _StandaloneCall,
        ctx: _CompileContext,
    ) -> dict[str, Any]:
        """Compiles a standalone function call into a `callRendererFunction`.

        The function is looked up by name across the catalogs unless the call
        names a `catalogId`. The message always carries the ID of the catalog
        actually used.

        A `functionCallId=` keyword argument sets the message's
        `functionCallId`. Without one, the n-th standalone call of the block
        gets `call_<n>`.
        """
        if not ctx.at_least_v10:
            raise ExpressValidationError(
                f"Standalone function calls are not supported in A2UI {ctx.version}"
            )
        ctx.call_counter += 1
        node = unit.node
        function_call_id = f"call_{ctx.call_counter}"
        if _FUNCTION_CALL_ID_KEY in node.kwargs:
            kwargs = dict(node.kwargs)
            explicit_id = kwargs.pop(_FUNCTION_CALL_ID_KEY)
            if not isinstance(explicit_id, str) or not explicit_id:
                raise ExpressValidationError(
                    f"{_FUNCTION_CALL_ID_KEY} must be a non-empty string, got:"
                    f" {explicit_id!r}"
                )
            function_call_id = explicit_id
            node = replace(node, kwargs=kwargs)
        raw_syms = unit.scope.raw_symbols if unit.scope else {}
        compiled_val = self._compile_value(node, raw_syms, ctx)
        if not isinstance(compiled_val, dict) or ctx.call_key not in compiled_val:
            raise ExpressValidationError(
                "Standalone statement did not compile to a valid function call:"
                f" {compiled_val}"
            )
        # With several catalogs the compiled call always names its catalog.
        return {
            "version": ctx.version,
            "callRendererFunction": {
                "functionCallId": function_call_id,
                "callFunction": {
                    "catalogId": (
                        compiled_val.get("catalogId") or self._catalogs[0].catalog_id
                    ),
                    ctx.call_key: compiled_val[ctx.call_key],
                    "args": compiled_val.get("args", {}),
                },
            },
        }

    def _compile_ast_node(
        self,
        var_name: str,
        ast: Any,
        raw_symbols: dict[str, Any],
        ctx: _CompileContext,
    ) -> dict[str, Any] | None:
        """Compiles a single variable's AST node into standard component format.

        Args:
            var_name: The variable identifier, which becomes the component ID
                unless the call sets `id=`.
            ast: The parsed expression AST node.
            raw_symbols: A dictionary containing all other parsed variables.
            ctx: The active compiler execution context.

        Returns:
            The compiled component JSON dictionary, or None if it is not a component.
        """
        if not isinstance(ast, CallNode):
            return None

        comp_name = ast.name
        args = ast.args
        kwargs = dict(ast.kwargs)

        comp_cat_id = kwargs.pop("catalogId", None)
        # A variable holding a function call, an Event or a template is inlined
        # wherever it is named rather than emitted as a component. A call that
        # names its catalog is a function call when that catalog defines it as
        # a function and not as a component. Events and templates belong to no
        # catalog, so one that names a catalogId is compiled as a component and
        # rejected.
        if not self._defines_component(comp_name, comp_cat_id) and (
            (comp_name in ("Event", "_template") and comp_cat_id is None)
            or self._defines_function(comp_name, comp_cat_id)
        ):
            return None
        comp_helper, write_cat_id = self._resolve(
            "component",
            comp_name,
            comp_cat_id,
            ctx,
            f"Component '{comp_name}'",
            "component",
        )

        properties = comp_helper.get_component_properties(comp_name)
        comp_id = _component_id(var_name, ast, at_least_v10=ctx.at_least_v10)
        kwargs.pop(_ID_KEY, None)
        comp_dict: dict[str, Any] = {"id": comp_id, "component": comp_name}
        if write_cat_id is not None:
            comp_dict["catalogId"] = write_cat_id

        sibling_value_path = None
        non_check_properties = [p for p in properties if p != "checks"]
        raw_checks = []

        # Collect (prop_name, arg_val) pairs from positional and keyword args
        prop_arg_pairs = []
        pos_args = []
        for arg in args:
            if _is_check_expression(arg):
                if isinstance(arg, list):
                    raw_checks.extend(arg)
                else:
                    raw_checks.append(arg)
                continue
            pos_args.append(arg)

        required_props = set(comp_helper.get_component_required(comp_name))
        prop_idx = 0
        for arg_idx, arg in enumerate(pos_args):
            if prop_idx >= len(non_check_properties):
                raise ExpressValidationError(
                    f"{comp_name} takes at most {len(non_check_properties)}"
                    f" positional arguments ({', '.join(non_check_properties)}),"
                    f" but component '{comp_id}' passes {len(pos_args)}."
                )
            if (
                isinstance(arg, (int, float))
                and not isinstance(arg, bool)
                and not comp_helper.accepts_number(
                    comp_helper.get_property_schema(
                        comp_name, non_check_properties[prop_idx]
                    )
                )
            ):
                moved = False
                if arg_idx == len(pos_args) - 1:
                    numeric_later = [
                        later_idx
                        for later_idx in range(prop_idx + 1, len(non_check_properties))
                        if non_check_properties[later_idx] not in kwargs
                        and comp_helper.accepts_number(
                            comp_helper.get_property_schema(
                                comp_name, non_check_properties[later_idx]
                            )
                        )
                    ]
                    if len(numeric_later) == 1:
                        target_idx = numeric_later[0]
                        if all(
                            non_check_properties[idx] not in required_props
                            and bool(
                                comp_helper.get_property_enum(
                                    comp_name, non_check_properties[idx]
                                )
                            )
                            for idx in range(prop_idx, target_idx)
                        ):
                            prop_idx = target_idx
                            moved = True
                if (
                    not moved
                    and non_check_properties[prop_idx] not in required_props
                    and comp_helper.common_types_loaded
                ):
                    raise ExpressValidationError(
                        f"Positional argument {arg_idx + 1} for component"
                        f" '{comp_name}' is a number, which is not valid for"
                        f" optional property '{non_check_properties[prop_idx]}'."
                    )
            prop_arg_pairs.append((non_check_properties[prop_idx], arg))
            prop_idx += 1

        for k, v in kwargs.items():
            if _is_check_expression(v):
                if isinstance(v, list):
                    raw_checks.extend(v)
                else:
                    raw_checks.append(v)
                continue
            prop_arg_pairs.append((k, v))

        seen_properties = set()
        for prop_name, arg in prop_arg_pairs:
            if prop_name not in properties:
                raise ExpressUnknownPropertyError(comp_name, prop_name, properties)
            if prop_name in seen_properties:
                raise ExpressDuplicatePropertyError(comp_name, prop_name)
            seen_properties.add(prop_name)
            if isinstance(arg, SkippedNode):
                comp_dict[prop_name] = None
                continue

            prop_schema = comp_helper.get_property_schema(comp_name, prop_name)
            mapped_val = self._compile_value(
                arg,
                raw_symbols,
                ctx,
                is_action=is_action_slot(prop_schema),
                parent_id=comp_id,
                parent_prop=prop_name,
                slot=_ValueSlot(prop_schema, comp_helper) if prop_schema else None,
            )
            if prop_schema and not _schema_allows_databinding(prop_schema):
                if _has_databinding(arg, raw_symbols):
                    raise ExpressForbiddenDatabindingError(comp_name, prop_name)
                if isinstance(mapped_val, list) and _schema_expects_option_objects(
                    prop_schema
                ):
                    mapped_val = [
                        {"label": opt, "value": opt} if isinstance(opt, str) else opt
                        for opt in mapped_val
                    ]
            enum_vals = comp_helper.get_property_enum(comp_name, prop_name)
            if enum_vals and not isinstance(mapped_val, (dict, list)):
                if mapped_val not in enum_vals:
                    raise ExpressValidationError(
                        f"Value '{mapped_val}' is not a valid enum choice for"
                        f" property '{prop_name}' of component '{comp_name}'."
                        f" Allowed values are: {enum_vals}"
                    )
            comp_dict[prop_name] = mapped_val

            # Only a `$path` value binds the checks; a map literal shaped like
            # a binding is data.
            if prop_name == "value" and _resolves_to_path(arg, raw_symbols):
                sibling_value_path = mapped_val

        # Checks bind the component's own value implicitly.
        ctx.active_value_path = sibling_value_path
        if raw_checks:
            compiled_checks = []
            for rc in raw_checks:
                if isinstance(rc, CheckNode):
                    condition, message = self._compile_check(rc, raw_symbols, ctx)
                    compiled_checks.append({"condition": condition, "message": message})
            if compiled_checks:
                comp_dict["checks"] = compiled_checks

        ctx.active_value_path = None
        for req_prop in comp_helper.get_component_required(comp_name):
            if req_prop not in comp_dict and req_prop != "checks":
                raise ExpressValidationError(
                    f"Component '{comp_name}' missing required property '{req_prop}'."
                )
        return {k: v for k, v in comp_dict.items() if v is not None}

    def _compile_check(
        self,
        rc: CheckNode,
        raw_symbols: dict[str, Any],
        ctx: _CompileContext,
        is_action: bool = False,
    ) -> tuple[dict[str, Any], str]:
        """Compiles a `?check(...)` expression into a condition and a message.

        The check function is looked up by name across the catalogs unless an
        argument of the form `{catalogId: "..."}` names its catalog. When the check's
        first parameter is `value` and no explicit binding is passed, the
        enclosing component's bound value is passed for it. A string argument
        in a slot whose schema is not a string, or past the last parameter, is
        the rule's message.

        Returns:
            The compiled condition (a function call) and the message.

        Raises:
            ExpressValidationError: If a `{catalogId: ...}` argument has other
                keys or a null `catalogId`, or two of them name different
                catalogs.
        """
        check_name = rc.name
        explicit_args: list[Any] = []
        chk_cat_id = None
        for arg_item in rc.args:
            if isinstance(arg_item, dict) and "catalogId" in arg_item:
                other_keys = [k for k in arg_item if k != "catalogId"]
                if other_keys:
                    raise ExpressValidationError(
                        f"Unsupported key(s) in check options for '?{check_name}':"
                        f" {', '.join(other_keys)}. Only 'catalogId' is allowed."
                    )
                # `_resolve` reads None as "no catalogId", so a null one is
                # rejected here rather than ignored.
                if arg_item["catalogId"] is None:
                    raise ExpressValidationError(
                        f"Check '{check_name}' catalogId must be a string, got: None"
                    )
                if chk_cat_id is not None and chk_cat_id != arg_item["catalogId"]:
                    raise ExpressValidationError(
                        f"Check '?{check_name}' specifies conflicting catalogId values."
                    )
                chk_cat_id = arg_item["catalogId"]
                continue
            explicit_args.append(arg_item)

        chk_helper, write_cat_id = self._resolve(
            "function",
            check_name,
            chk_cat_id,
            ctx,
            f"Check '{check_name}'",
            "check function",
        )

        check_props = chk_helper.get_function_properties(check_name)
        message_val = f"{check_name.capitalize()} check failed"
        compiled_args: dict[str, Any] = {}

        is_value_injected = False
        if check_props and check_props[0] == "value":
            has_explicit_binding = explicit_args and isinstance(
                explicit_args[0], PathNode
            )
            if not has_explicit_binding and ctx.active_value_path:
                compiled_args["value"] = ctx.active_value_path
                is_value_injected = True

        start_prop_idx = 1 if is_value_injected else 0
        for c_idx, c_arg in enumerate(explicit_args):
            prop_target_idx = c_idx + start_prop_idx
            if prop_target_idx >= len(check_props):
                if isinstance(c_arg, str):
                    message_val = c_arg
                continue
            prop_name = check_props[prop_target_idx]
            prop_schema = chk_helper.get_function_property_schema(check_name, prop_name)
            if (
                isinstance(c_arg, str)
                and prop_schema
                and prop_schema.get("type") in ["integer", "number", "boolean"]
            ):
                message_val = c_arg
                break
            if isinstance(c_arg, SkippedNode):
                continue
            compiled_args[prop_name] = self._compile_value(
                c_arg, raw_symbols, ctx, is_action
            )

        condition: dict[str, Any] = {ctx.call_key: check_name}
        if write_cat_id is not None:
            condition["catalogId"] = write_cat_id
        condition["args"] = compiled_args
        return condition, message_val

    def _compile_event_call(
        self,
        val: CallNode,
        raw_symbols: dict[str, Any],
        ctx: _CompileContext,
    ) -> dict[str, Any]:
        """Compiles the reserved `Event(name, context?, userMessage=?, context=?)` signature.

        `userMessage` is a v1.0 Action field. It is rejected when targeting an
        earlier protocol version, and so is any other keyword the signature does
        not define, rather than being dropped from the compiled action.

        The event's name, message and context entries are `DynamicValue`s, not
        actions, so a function call among them stays a plain call whatever slot
        the event itself sits in.

        Raises:
            ExpressValidationError: If there are more than two positional
                arguments, `userMessage` is used before v1.0, or `userMessage`
                is neither a string nor a `$path` data binding.
            ExpressInvalidParamError: If a keyword other than `userMessage` or
                `context` is given.
            ExpressDuplicateParamError: If the context is given both
                positionally and by keyword.
        """
        fn_args = val.args
        fn_kwargs = val.kwargs

        if len(fn_args) > 2:
            raise ExpressValidationError(
                "Event accepts at most 2 positional arguments (name, context),"
                f" got {len(fn_args)}."
            )
        for key in fn_kwargs:
            if key not in _EVENT_KEYWORDS:
                raise ExpressInvalidParamError("Event", key, list(_EVENT_KEYWORDS))
        if len(fn_args) == 2 and "context" in fn_kwargs:
            raise ExpressDuplicateParamError("Event", "context")

        compiled_event_name = (
            self._compile_value(fn_args[0], raw_symbols, ctx) if fn_args else ""
        )
        event_dict: dict[str, Any] = {"name": compiled_event_name}

        if "userMessage" in fn_kwargs:
            if not ctx.at_least_v10:
                raise ExpressValidationError(
                    "Event userMessage requires protocol v1.0 or later; the"
                    f" target version {ctx.version} has no userMessage field."
                )
            # `userMessage` is a DynamicString: a string, a data binding or a
            # function call.
            user_message = self._compile_value(
                fn_kwargs["userMessage"], raw_symbols, ctx
            )
            is_binding_or_call = isinstance(user_message, dict) and (
                ctx.path_key in user_message or ctx.call_key in user_message
            )
            if not isinstance(user_message, str) and not is_binding_or_call:
                raise ExpressValidationError(
                    "Event userMessage must be a string, a $path data binding or"
                    " a function call, got"
                    f" {_describe_express_value(fn_kwargs['userMessage'])}."
                )
            event_dict["userMessage"] = user_message

        if len(fn_args) == 2:
            context_node = fn_args[1]
        elif "context" in fn_kwargs:
            context_node = fn_kwargs["context"]
        else:
            return {"event": event_dict}

        raw_context = self._compile_value(context_node, raw_symbols, ctx)
        # A context written in the DSL is kept even when it is empty.
        compiled_context: dict[str, Any] = {}
        if isinstance(raw_context, dict):
            compiled_context.update(raw_context)
        elif isinstance(raw_context, list):
            for item in raw_context:
                if isinstance(item, dict):
                    compiled_context.update(item)
        event_dict["context"] = compiled_context
        return {"event": event_dict}

    def _compile_value(
        self,
        val: Any,
        raw_symbols: dict[str, Any],
        ctx: _CompileContext,
        is_action: bool = False,
        parent_id: str | None = None,
        parent_prop: str | None = None,
        list_index: int | None = None,
        slot: _ValueSlot | None = None,
    ) -> Any:
        """Compiles an individual AST node value into valid A2UI equivalents.

        Args:
            val: The parsed AST node value.
            raw_symbols: The parsed global variable symbol table.
            ctx: The active compiler execution context.
            is_action: Whether this value lies inside a component Action field.
            parent_id: The parent component ID if compiling a component property.
            parent_prop: The parent component property name.
            list_index: The index within an array property if applicable.
            slot: The catalog schema declared at this position, when known.
                Array items and map entries resolve their own sub-schema from
                it, so an `Action` slot nested inside a list item (e.g.
                `items: [{label, action}]`) is compiled as an action too.

        Returns:
            The semantically correct A2UI JSON structure.

        Raises:
            ExpressValidationError: If `_` appears anywhere but in place of an
                argument, or a variable's value refers back to the variable.
        """
        if isinstance(val, PathNode):
            return {ctx.path_key: val.path}
        if isinstance(val, VariableNode):
            ref_name = val.name
            if ref_name not in raw_symbols:
                return ref_name
            symbol_val = raw_symbols[ref_name]
            if isinstance(symbol_val, CallNode):
                sym_cat_id = symbol_val.kwargs.get("catalogId")
                if self._defines_component(symbol_val.name, sym_cat_id):
                    return _component_id(
                        ref_name, symbol_val, at_least_v10=ctx.at_least_v10
                    )
            if ref_name in ctx.resolving:
                raise ExpressValidationError(
                    f"Variable '{ref_name}' refers to itself through its own value."
                )
            ctx.resolving.add(ref_name)
            try:
                return self._compile_value(
                    symbol_val,
                    raw_symbols,
                    ctx,
                    is_action,
                    slot=slot,
                )
            finally:
                ctx.resolving.discard(ref_name)
        if isinstance(val, CheckNode):
            condition, _ = self._compile_check(val, raw_symbols, ctx, is_action)
            return condition
        if isinstance(val, CallNode):
            return self._compile_call(
                val,
                raw_symbols,
                ctx,
                is_action,
                parent_id,
                parent_prop,
                list_index,
            )
        if isinstance(val, SkippedNode):
            raise ExpressValidationError("'_' can only stand in for an argument.")

        # A dict is always a map literal, whatever its keys are.
        if isinstance(val, dict):
            dict_res: dict[str, Any] = {}
            for k, v in val.items():
                entry_slot = _property_slot(slot, k)
                entry_is_action = is_action or (
                    entry_slot is not None and is_action_slot(entry_slot.schema)
                )
                dict_res[k] = self._compile_value(
                    v, raw_symbols, ctx, entry_is_action, slot=entry_slot
                )
            return dict_res

        if isinstance(val, list):
            # Resolved once for the list, since every item shares the schema.
            item_slot = _item_slot(slot)
            item_is_action = is_action or (
                item_slot is not None and is_action_slot(item_slot.schema)
            )
            return [
                self._compile_value(
                    item,
                    raw_symbols,
                    ctx,
                    item_is_action,
                    parent_id=parent_id,
                    parent_prop=parent_prop,
                    list_index=idx,
                    slot=item_slot,
                )
                for idx, item in enumerate(val)
            ]

        return val

    def _compile_call(
        self,
        val: CallNode,
        raw_symbols: dict[str, Any],
        ctx: _CompileContext,
        is_action: bool,
        parent_id: str | None,
        parent_prop: str | None,
        list_index: int | None,
    ) -> Any:
        """Compiles a call node: an inline component, a helper, or a function."""
        fn_name = val.name
        fn_args = val.args
        raw_kwargs = dict(val.kwargs)

        if fn_name == "_template":
            if len(fn_args) < 2:
                raise ExpressParseError(
                    "_template helper requires exactly 2 arguments: path and"
                    " templateComponent."
                )
            path_val = self._compile_value(fn_args[0], raw_symbols, ctx, is_action)
            template_path = _binding_path(path_val, ctx.path_key)
            if template_path is None:
                raise ExpressParseError(
                    "The first argument to _template must be a dynamic data"
                    f" binding path (prefixed by $), got: {fn_args[0]}"
                )
            comp_id_val = self._compile_value(fn_args[1], raw_symbols, ctx, is_action)
            # A child list template keeps the plain `path` key in every version.
            return {"path": template_path, "componentId": comp_id_val}

        if fn_name == "Event":
            return self._compile_event_call(val, raw_symbols, ctx)

        call_cat_id = raw_kwargs.pop("catalogId", None)
        if self._defines_component(fn_name, call_cat_id):
            if parent_id and parent_prop:
                if list_index is not None:
                    inline_id = f"{parent_id}_{parent_prop}_{list_index}"
                else:
                    inline_id = f"{parent_id}_{parent_prop}"
            else:
                ctx.inline_counter += 1
                inline_id = f"_inline_{ctx.inline_counter}"

            prev_extras = ctx.extra_components
            ctx.extra_components = []
            # The inline component resolves its own catalog; its children and
            # calls are each resolved on their own.
            compiled_inline = self._compile_ast_node(inline_id, val, raw_symbols, ctx)
            child_extras = ctx.extra_components
            ctx.extra_components = prev_extras
            if compiled_inline:
                ctx.extra_components.append(compiled_inline)
                ctx.extra_components.extend(child_extras)
                return compiled_inline["id"]
            return inline_id

        call_helper, write_cat_id = self._resolve(
            "function", fn_name, call_cat_id, ctx, f"Call '{fn_name}'", "function"
        )

        fn_props = call_helper.get_function_properties(fn_name)
        compiled_args = {}
        for idx, arg in enumerate(fn_args):
            if idx >= len(fn_props):
                continue
            if isinstance(arg, SkippedNode):
                continue
            val_item = self._compile_value(arg, raw_symbols, ctx, is_action)
            if val_item is not None:
                compiled_args[fn_props[idx]] = val_item

        for k, v in raw_kwargs.items():
            if k not in fn_props:
                raise ExpressInvalidParamError(fn_name, k, fn_props)
            if k in compiled_args:
                raise ExpressDuplicateParamError(fn_name, k)
            if isinstance(v, SkippedNode):
                continue
            val_item = self._compile_value(v, raw_symbols, ctx, is_action)
            if val_item is not None:
                compiled_args[k] = val_item

        res_expr: dict[str, Any] = {ctx.call_key: fn_name}
        if write_cat_id is not None:
            res_expr["catalogId"] = write_cat_id
        res_expr["args"] = compiled_args

        # Wrap in functionCall only if inside an action field
        if is_action:
            return {"functionCall": res_expr}
        return res_expr
