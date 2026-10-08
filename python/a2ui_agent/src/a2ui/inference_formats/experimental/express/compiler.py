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
from dataclasses import dataclass, field
from typing import Any, Literal

from antlr4 import CommonTokenStream, InputStream

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    check_dsl_catalogs,
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


def _component_id(var_name: str, ast: Any) -> str:
    """Returns the ID of the component a variable holds.

    The ID is the variable name unless the component call sets `id=`.

    Raises:
        ExpressValidationError: If `id=` is set to something other than a
            non-empty string.
    """
    kwargs = ast.get("kwargs") if isinstance(ast, dict) else None
    if not isinstance(kwargs, dict) or _ID_KEY not in kwargs:
        return var_name
    explicit_id = kwargs[_ID_KEY]
    if not isinstance(explicit_id, str) or not explicit_id:
        raise ExpressValidationError(
            f"Component id must be a non-empty string, got: {explicit_id!r}"
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


def _set_nested_path(d: dict, path_str: str, val: Any) -> None:
    """Populates a nested dictionary path from a JSON pointer-like string.

    Args:
        d: The target dictionary to mutate.
        path_str: The data path string (e.g. "$/user/name").
        val: The value to set at the specified path.
    """
    clean_path = _strip_path_prefix(path_str)
    if not clean_path:
        return

    keys = clean_path.split("/")
    current = d
    for key in keys[:-1]:
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    current[keys[-1]] = val


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


def _binding_path(v: Any) -> str | None:
    """Returns the path of a compiled data binding, or None if `v` is not one.

    Accepts the v1.0 `@path` spelling and the v0.9 `path` spelling. A child list
    template (`{"componentId": ..., "path": ...}`) is not a data binding.
    """
    if not isinstance(v, dict) or "componentId" in v:
        return None
    for key in ("@path", "path"):
        if isinstance(v.get(key), str):
            return v[key]
    return None


def _has_databinding(v: Any) -> bool:
    """Recursively checks if a value structure contains a dynamic data binding.

    Args:
        v: The value (dict, list, or primitive) to inspect.

    Returns:
        True if a dynamic DataBinding is found; False otherwise.
    """
    if isinstance(v, dict):
        if any(k in v for k in ("call", "@call", "event", "functionCall")):
            return False
        if _binding_path(v) is not None:
            return True
        return any(_has_databinding(x) for x in v.values())
    if isinstance(v, list):
        return any(_has_databinding(x) for x in v)
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


def _is_check_expression(val: Any) -> bool:
    """Checks if a parsed AST value represents a validation check expression."""
    if isinstance(val, dict) and "check" in val:
        return True
    if isinstance(val, list) and val:
        return all(_is_check_expression(item) for item in val)
    return False


def _call_arg(node: dict, index: int, key: str) -> Any:
    """Returns a call's argument given by keyword `key` or at position `index`."""
    kwargs = node.get("kwargs", {})
    if isinstance(kwargs, dict) and key in kwargs:
        return kwargs[key]
    args = node.get("args", [])
    if isinstance(args, list) and len(args) > index:
        return args[index]
    return None


def _string_call_arg(node: dict, index: int, key: str, statement: str) -> str | None:
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
        self.is_v1 = is_at_least_version(version, ProtocolVersion.V1_0)
        # v1.0 spells data bindings and function calls with reserved `@` keys.
        self.path_key = "@path" if self.is_v1 else "path"
        self.call_key = "@call" if self.is_v1 else "call"
        self.extra_components: list[dict] = []
        self.inline_counter: int = 0
        self.call_counter: int = 0
        self.active_value_path: dict | None = None

    def check_catalog_override(self, target: str) -> None:
        """Rejects a per-component or per-function catalogId below v1.0.

        Raises:
            ExpressValidationError: If the target version predates v1.0, whose
                schemas only allow `catalogId` on `createSurface`.
        """
        if not self.is_v1:
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
    raw_symbols: dict[str, Any] = field(default_factory=dict)
    data_path_assignments: dict[str, Any] = field(default_factory=dict)


@dataclass
class _DeleteSurface:
    surface_id: str


@dataclass
class _StandaloneCall:
    node: dict
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
        self._catalogs = check_dsl_catalogs(catalogs)
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

    def _parse_statements(self, dsl_text: str, is_final: bool) -> list:
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

        dsl_body = "\n".join(lines)

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
                line, col, msg, is_lexer = error_listener.errors[0]
                err = SyntaxError(f"Syntax error at line {line}:{col}: {msg}")
                err.lineno = line
                err.offset = col
                err._is_lexer = is_lexer
                raise err

            visitor = ExpressAstVisitor(
                first_error_line=error_listener.errors[0][0]
                if error_listener.errors
                else None
            )
            return visitor.visit(tree)
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
        if self._is_multi_catalog and not ctx.is_v1:
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
                if not isinstance(parsed_val, dict) or "call" not in parsed_val:
                    continue
                name = parsed_val["call"]
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
        node: dict,
        *,
        default_surface_id: str,
    ) -> _SurfaceScope:
        """Opens the scope of a `surface(...)` statement.

        The line may name the single catalog as its second argument; with
        several catalogs naming one is an error.
        """
        statement = node["call"]
        target_surf = (
            _string_call_arg(node, 0, "surfaceId", statement) or default_surface_id
        )
        explicit_cat = _string_call_arg(node, 1, "catalogId", statement)
        if explicit_cat is not None:
            self._check_header_catalog(statement, explicit_cat)
        kwargs = node.get("kwargs")
        send_data_model = (
            kwargs.get(_SEND_DATA_MODEL_KEY) if isinstance(kwargs, dict) else None
        )
        if send_data_model is not None and not isinstance(send_data_model, bool):
            raise ExpressValidationError(
                f"{_SEND_DATA_MODEL_KEY} must be true or false, got:"
                f" {statement}({_SEND_DATA_MODEL_KEY}={send_data_model!r})"
            )
        return _SurfaceScope(
            surface_id=target_surf,
            has_surface_directive=True,
            send_data_model=send_data_model,
        )

    def _compile_components(
        self, scope: _SurfaceScope, ctx: _CompileContext
    ) -> list[dict]:
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
    ) -> list[dict]:
        """Compiles a `surface(...)` scope, or the implicit default scope."""
        data_model: dict[str, Any] = {}
        for path_name, ast_val in scope.data_path_assignments.items():
            _set_nested_path(
                data_model, path_name, self._compile_data_value(scope, ast_val, ctx)
            )

        compiled_components = self._compile_components(scope, ctx)
        surf_id = scope.surface_id
        if len(scope.data_path_assignments) == 1:
            only_path, only_ast = next(iter(scope.data_path_assignments.items()))
            pointer = _to_json_pointer(only_path)
            if pointer.count("/") > 1 or pointer == "/":
                data_update = {
                    "version": ctx.version,
                    SurfaceOperation.UPDATE_DATA: {
                        "surfaceId": surf_id,
                        "path": pointer,
                        "value": self._compile_data_value(scope, only_ast, ctx),
                    },
                }
            else:
                data_update = {
                    "version": ctx.version,
                    SurfaceOperation.UPDATE_DATA: {
                        "surfaceId": surf_id,
                        "path": "/",
                        "value": data_model,
                    },
                }
        else:
            data_update = {
                "version": ctx.version,
                SurfaceOperation.UPDATE_DATA: {
                    "surfaceId": surf_id,
                    "path": "/",
                    "value": data_model,
                },
            }

        if not any(c.get("id") == "root" for c in compiled_components):
            if not compiled_components:
                if scope.data_path_assignments:
                    return [data_update]
                raise ExpressUndefinedRootError("root")
            if not scope.has_surface_directive:
                raise ExpressUndefinedRootError("root")
            messages = [{
                "version": ctx.version,
                SurfaceOperation.UPDATE_COMPONENTS: {
                    "surfaceId": surf_id,
                    "components": compiled_components,
                },
            }]
            if data_model:
                messages.append(data_update)
            return messages

        create: dict[str, Any] = {"surfaceId": surf_id}
        cat_id = surface_catalog_id(self._catalogs)
        if cat_id is not None:
            create["catalogId"] = cat_id
        if scope.send_data_model is not None:
            create[_SEND_DATA_MODEL_KEY] = scope.send_data_model
        if ctx.is_v1:
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
            messages.append(data_update)
        return messages

    def _compile_standalone_call(
        self,
        unit: _StandaloneCall,
        ctx: _CompileContext,
    ) -> dict:
        """Compiles a standalone function call into a `callRendererFunction`.

        The function is looked up by name across the catalogs unless the call
        names a `catalogId`. The message always carries the ID of the catalog
        actually used.

        A `functionCallId=` keyword argument sets the message's
        `functionCallId`. Without one, the n-th standalone call of the block
        gets `call_<n>`.
        """
        if not ctx.is_v1:
            raise ExpressValidationError(
                f"Standalone function calls are not supported in A2UI {ctx.version}"
            )
        ctx.call_counter += 1
        node = unit.node
        function_call_id = f"call_{ctx.call_counter}"
        kwargs = node.get("kwargs")
        if isinstance(kwargs, dict) and _FUNCTION_CALL_ID_KEY in kwargs:
            kwargs = dict(kwargs)
            explicit_id = kwargs.pop(_FUNCTION_CALL_ID_KEY)
            if not isinstance(explicit_id, str) or not explicit_id:
                raise ExpressValidationError(
                    f"{_FUNCTION_CALL_ID_KEY} must be a non-empty string, got:"
                    f" {explicit_id!r}"
                )
            function_call_id = explicit_id
            node = {**node, "kwargs": kwargs}
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
        raw_symbols: dict,
        ctx: _CompileContext,
    ) -> dict | None:
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
        if not isinstance(ast, dict) or "call" not in ast:
            return None

        comp_name = ast["call"]
        args = ast.get("args", [])
        kwargs = dict(ast.get("kwargs", {}))

        comp_cat_id = kwargs.pop("catalogId", None)
        if comp_cat_id is None and not self._defines_component(comp_name, None):
            # A variable holding a function call, an Event or a template is
            # inlined wherever it is named rather than emitted as a component.
            if comp_name in ("Event", "_template") or catalogs_defining(
                self.helpers, "function", comp_name
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
        comp_id = _component_id(var_name, ast)
        kwargs.pop(_ID_KEY, None)
        comp_dict: dict[str, Any] = {"id": comp_id, "component": comp_name}
        if write_cat_id is not None:
            comp_dict["catalogId"] = write_cat_id

        sibling_value_path = None
        non_check_properties = [p for p in properties if p != "checks"]
        raw_checks = []

        # Collect (prop_name, arg_val) pairs from positional and keyword args
        prop_arg_pairs = []
        prop_idx = 0
        for arg in args:
            if _is_check_expression(arg):
                if isinstance(arg, list):
                    raw_checks.extend(arg)
                else:
                    raw_checks.append(arg)
                continue

            if prop_idx < len(non_check_properties):
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
            if arg == {"skipped": True}:
                comp_dict[prop_name] = None
                continue

            mapped_val = self._compile_value(
                arg,
                raw_symbols,
                ctx,
                is_action=(prop_name in ["action", "submitAction"]),
                parent_id=comp_id,
                parent_prop=prop_name,
            )
            prop_schema = comp_helper.get_property_schema(comp_name, prop_name)
            if prop_schema and not _schema_allows_databinding(prop_schema):
                if _has_databinding(mapped_val):
                    raise ExpressForbiddenDatabindingError(comp_name, prop_name)
                if isinstance(mapped_val, list) and _schema_expects_option_objects(
                    prop_schema
                ):
                    mapped_val = [
                        {"label": opt, "value": opt} if isinstance(opt, str) else opt
                        for opt in mapped_val
                    ]
            enum_vals = comp_helper.get_property_enum(comp_name, prop_name)
            if enum_vals and isinstance(mapped_val, str):
                if mapped_val not in enum_vals:
                    raise ExpressValidationError(
                        f"Value '{mapped_val}' is not a valid enum choice for"
                        f" property '{prop_name}' of component '{comp_name}'."
                        f" Allowed values are: {enum_vals}"
                    )
            comp_dict[prop_name] = mapped_val

            if prop_name == "value" and _binding_path(mapped_val) is not None:
                sibling_value_path = mapped_val

        # Checks bind the component's own value implicitly.
        ctx.active_value_path = sibling_value_path
        if raw_checks:
            compiled_checks = []
            for rc in raw_checks:
                if isinstance(rc, dict) and "check" in rc:
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
        rc: dict,
        raw_symbols: dict,
        ctx: _CompileContext,
        is_action: bool = False,
    ) -> tuple[dict, str]:
        """Compiles a `?check(...)` expression into a condition and a message.

        The check function is looked up by name across the catalogs unless an
        argument of the form `{catalogId: "..."}` names its catalog. When the check's
        first parameter is `value` and no explicit binding is passed, the
        enclosing component's bound value is passed for it. A string argument
        in a slot whose schema is not a string, or past the last parameter, is
        the rule's message.

        Returns:
            The compiled condition (a function call) and the message.
        """
        check_name = rc["check"]
        explicit_args = list(rc.get("args", []))
        chk_cat_id = rc.get("catalogId")
        if chk_cat_id is None:
            for arg_idx, arg_item in enumerate(explicit_args):
                if (
                    isinstance(arg_item, dict)
                    and set(arg_item.keys()) == {"catalogId"}
                    and isinstance(arg_item["catalogId"], str)
                ):
                    chk_cat_id = arg_item["catalogId"]
                    explicit_args.pop(arg_idx)
                    break

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
            has_explicit_binding = (
                explicit_args
                and isinstance(explicit_args[0], dict)
                and "path" in explicit_args[0]
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
            if isinstance(c_arg, dict) and c_arg.get("skipped"):
                continue
            compiled_args[prop_name] = self._compile_value(
                c_arg, raw_symbols, ctx, is_action
            )

        condition: dict[str, Any] = {ctx.call_key: check_name}
        if write_cat_id is not None:
            condition["catalogId"] = write_cat_id
        condition["args"] = compiled_args
        return condition, message_val

    def _compile_value(
        self,
        val: Any,
        raw_symbols: dict,
        ctx: _CompileContext,
        is_action: bool = False,
        parent_id: str | None = None,
        parent_prop: str | None = None,
        list_index: int | None = None,
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

        Returns:
            The semantically correct A2UI JSON structure.
        """
        if isinstance(val, dict):
            if "path" in val:
                return {ctx.path_key: val["path"]}
            if "variable" in val:
                ref_name = val["variable"]
                if ref_name not in raw_symbols:
                    return ref_name
                symbol_val = raw_symbols[ref_name]
                if isinstance(symbol_val, dict) and "call" in symbol_val:
                    sym_kwargs = symbol_val.get("kwargs", {})
                    sym_cat_id = (
                        sym_kwargs.get("catalogId")
                        if isinstance(sym_kwargs, dict)
                        else None
                    )
                    if self._defines_component(symbol_val["call"], sym_cat_id):
                        return _component_id(ref_name, symbol_val)
                return self._compile_value(
                    symbol_val,
                    raw_symbols,
                    ctx,
                    is_action,
                )
            if "check" in val:
                condition, _ = self._compile_check(val, raw_symbols, ctx, is_action)
                return condition
            if "call" in val:
                return self._compile_call(
                    val,
                    raw_symbols,
                    ctx,
                    is_action,
                    parent_id,
                    parent_prop,
                    list_index,
                )

            return {
                k: self._compile_value(v, raw_symbols, ctx, is_action)
                for k, v in val.items()
            }

        if isinstance(val, list):
            return [
                self._compile_value(
                    item,
                    raw_symbols,
                    ctx,
                    is_action,
                    parent_id=parent_id,
                    parent_prop=parent_prop,
                    list_index=idx,
                )
                for idx, item in enumerate(val)
            ]

        return val

    def _compile_call(
        self,
        val: dict,
        raw_symbols: dict,
        ctx: _CompileContext,
        is_action: bool,
        parent_id: str | None,
        parent_prop: str | None,
        list_index: int | None,
    ) -> Any:
        """Compiles a call node: an inline component, a helper, or a function."""
        fn_name = val["call"]
        fn_args = val.get("args", [])
        raw_kwargs = dict(val.get("kwargs", {}))

        if fn_name == "_template":
            if len(fn_args) < 2:
                raise ExpressParseError(
                    "_template helper requires exactly 2 arguments: path and"
                    " templateComponent."
                )
            path_val = self._compile_value(fn_args[0], raw_symbols, ctx, is_action)
            template_path = _binding_path(path_val)
            if template_path is None:
                raise ExpressParseError(
                    "The first argument to _template must be a dynamic data"
                    f" binding path (prefixed by $), got: {fn_args[0]}"
                )
            comp_id_val = self._compile_value(fn_args[1], raw_symbols, ctx, is_action)
            # A child list template keeps the plain `path` key in every version.
            return {"path": template_path, "componentId": comp_id_val}

        if fn_name == "Event":
            compiled_event_name = (
                self._compile_value(
                    fn_args[0],
                    raw_symbols,
                    ctx,
                    is_action,
                )
                if len(fn_args) > 0
                else ""
            )
            raw_context = (
                self._compile_value(
                    fn_args[1],
                    raw_symbols,
                    ctx,
                    is_action,
                )
                if len(fn_args) > 1
                else {}
            )
            compiled_context = {}
            if isinstance(raw_context, dict):
                compiled_context.update(raw_context)
            elif isinstance(raw_context, list):
                for item in raw_context:
                    if isinstance(item, dict):
                        compiled_context.update(item)
            event_dict: dict[str, Any] = {"name": compiled_event_name}
            # A context written in the DSL is kept even when it is empty.
            if compiled_context or len(fn_args) > 1:
                event_dict["context"] = compiled_context
            return {"event": event_dict}

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
            if isinstance(arg, dict) and arg.get("skipped"):
                continue
            val_item = self._compile_value(arg, raw_symbols, ctx, is_action)
            if val_item is not None:
                compiled_args[fn_props[idx]] = val_item

        for k, v in raw_kwargs.items():
            if k not in fn_props:
                raise ExpressInvalidParamError(fn_name, k, fn_props)
            if k in compiled_args:
                raise ExpressDuplicateParamError(fn_name, k)
            if v == {"skipped": True}:
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
