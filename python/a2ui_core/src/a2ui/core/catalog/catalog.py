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

from collections import deque
from collections.abc import Mapping, Sequence
import copy
from dataclasses import dataclass
import re
import sys
from typing import Any, Callable, Final, Generic, Literal, TypeAlias, cast
import warnings

if sys.version_info >= (3, 13):
    from typing import TypeVar
else:
    from typing_extensions import TypeVar
from pydantic import BaseModel

from ..common.semver import (
    is_at_least_version,
    parse_semver,
    to_canonical_version,
    to_protocol_version,
)
from ..common.uax31 import (
    assert_uax31_identifier as assert_uax31_identifier,
    is_valid_uax31_identifier as is_valid_uax31_identifier,
)
from ..exceptions import A2uiCatalogError
from ..schema import ProtocolVersion
from ..schema._dynamic_types import clean_schema_node
from ..schema._json_schema import (
    INLINE_DEF_MARKER,
    SPEC_TITLE_KEY,
    inline_marked_defs,
)
from ..schema.common_types_schema import (
    _strip_const_implied_keywords,
    get_common_types_catalog_defs,
    get_common_types_schema_map,
    get_dynamic_type_index,
)
from ._spec_shape import SpecSchema, SpecShaper, v08_document_schema
from .components import ComponentApi, ComponentImplementation, ModelComponentApi
from .functions import (
    AllowedCallers,
    FunctionApi,
    FunctionImplementation,
    FunctionReturnType,
    create_function_implementation,
)
from .reference_map import ComponentRefSpec, build_component_ref_map
from .system_functions import system_functions_for


def _extract_module_type_refs(modname: str, excluded: set[str]) -> set[str]:
    """Extracts non-private exported attribute names from a module.

    Args:
        modname: The fully qualified module name to import.
        excluded: Set of attribute names to exclude from extraction.

    Returns:
        A set of public attribute names extracted from the module, or an empty
        set if the module could not be imported.
    """
    import importlib

    type_refs: set[str] = set()
    try:
        mod = importlib.import_module(modname)
    except ImportError:
        return type_refs

    for attr in dir(mod):
        if not attr.startswith("_") and attr not in excluded:
            type_refs.add(attr)
    return type_refs


def load_preserved_type_refs() -> set[str]:
    """Dynamically loads common type names from schema modules."""
    import a2ui.core.schema as schema_pkg

    excluded = {
        "sys",
        "annotations",
        "Any",
        "Dict",
        "List",
        "Optional",
        "Union",
        "Tuple",
        "Set",
        "Literal",
        "Annotated",
        "BaseModel",
        "ConfigDict",
        "Field",
        "AfterValidator",
        "GetCoreSchemaHandler",
        "ValidationInfo",
        "CoreSchema",
        "PydanticUndefined",
        "field_validator",
        "TypeVar",
        "Generic",
        "Callable",
    }

    modules_to_check: list[str] = ["a2ui.core.schema.common_types"]

    protocol_version_enum = getattr(schema_pkg, "ProtocolVersion", None) or getattr(
        schema_pkg, "A2uiProtocolVersion", None
    )
    if protocol_version_enum:
        for ver_enum in protocol_version_enum:
            parsed = parse_semver(ver_enum.value)
            if parsed:
                major_minor = f"{parsed.major}_{parsed.minor}"
                mod_name = f"{schema_pkg.__name__}.v{major_minor}.common_types"
                if mod_name not in modules_to_check:
                    modules_to_check.append(mod_name)

    type_refs: set[str] = set()
    for modname in modules_to_check:
        type_refs.update(_extract_module_type_refs(modname, excluded))

    return type_refs


PRESERVED_TYPE_REFS: Final[set[str]] = load_preserved_type_refs()


def _query_json_pointer(doc: Mapping[str, Any], pointer: str) -> Any:
    """Queries a JSON Pointer string starting with '#/' against a root dictionary."""
    if not pointer.startswith("#/"):
        return None
    parts = pointer[2:].split("/")
    curr: Any = doc
    for p in parts:
        p = re.sub(r"~([01])", lambda m: "/" if m.group(1) == "1" else "~", p)
        if isinstance(curr, (dict, Mapping)):
            if p in curr:
                curr = curr[p]
            else:
                return None
        else:
            return None
    return curr


# Schema documents whose `$defs` are addressable as local definitions once a
# catalog has been loaded. `common_types.json` definitions are supplied from the
# Pydantic models in `a2ui.core.schema`, and `catalog.json` definitions live in
# the catalog document itself.
_LOCALIZABLE_REF_DOCUMENTS: Final[tuple[str, ...]] = (
    "common_types.json",
    "catalog.json",
)


def _localize_ref(ref: str) -> str:
    """Rewrites a cross-document `$defs` reference as a local pointer.

    The published specification cross-references shared types between documents,
    for example ``common_types.json#/$defs/ChildList``. Those pointers cannot be
    resolved without the specification files on disk, so they are rewritten to
    ``#/$defs/ChildList`` and satisfied from the in-memory definitions instead.

    Args:
        ref: Raw ``$ref`` string from a schema node.

    Returns:
        A local ``#/$defs/...`` pointer when the reference targets a known
        specification document, otherwise the reference unchanged.
    """
    if "#/$defs/" not in ref or ref.startswith("#/"):
        return ref
    document, _, fragment = ref.partition("#")
    if not any(document.endswith(name) for name in _LOCALIZABLE_REF_DOCUMENTS):
        return ref
    return f"#{fragment}"


def _normalize_external_schema_refs(node: Any) -> Any:
    """Recursively rewrites cross-document `$refs` into local `$defs` pointers.

    Args:
        node: Schema fragment to normalize.

    Returns:
        An equivalent fragment whose references are all catalog-local.
    """
    if isinstance(node, dict):
        normalized: dict[str, Any] = {}
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                normalized[key] = _localize_ref(value)
            else:
                normalized[key] = _normalize_external_schema_refs(value)
        return normalized
    if isinstance(node, list):
        return [_normalize_external_schema_refs(item) for item in node]
    return node


def inline_local_refs(
    node: Any, root_catalog: Mapping[str, Any], visited: set[str] | None = None
) -> Any:
    """Returns a schema node with its local references written inline.

    Each `$ref` that starts with `#/` is replaced by what it points to in
    `root_catalog`, with the keys beside the `$ref` merged over it. References
    to common types named in `PRESERVED_TYPE_REFS` stay, and so does a
    reference that a definition makes to itself.

    Args:
        node: The schema node to inline.
        root_catalog: The document that the references point into, usually the
            catalog schema that holds `node`.
        visited: The references being inlined, which callers leave out.

    Returns:
        A new node, whose leaf values are shared with `node` and
        `root_catalog`.
    """
    if visited is None:
        visited = set()

    if isinstance(node, dict):
        if (
            "$ref" in node
            and isinstance(node["$ref"], str)
            and node["$ref"].startswith("#/")
        ):
            ref_path = node["$ref"]
            ref_name = ref_path.split("/")[-1]
            if ref_name in PRESERVED_TYPE_REFS:
                return node

            if ref_path in visited:
                return node  # Prevent stack overflow on circular references

            new_visited = set(visited)
            new_visited.add(ref_path)

            resolved_node = _query_json_pointer(root_catalog, ref_path)
            if resolved_node is not None:
                resolved_node = inline_local_refs(
                    resolved_node, root_catalog, new_visited
                )
                merged = {k: v for k, v in node.items() if k != "$ref"}
                if isinstance(resolved_node, dict):
                    res = dict(resolved_node)
                    for k, v in merged.items():
                        if (
                            k in res
                            and isinstance(res[k], dict)
                            and isinstance(v, dict)
                        ):
                            res[k] = {**res[k], **v}
                        elif (
                            k in res
                            and isinstance(res[k], list)
                            and isinstance(v, list)
                        ):
                            res[k] = res[k] + [x for x in v if x not in res[k]]
                        else:
                            res[k] = v
                    return res
                return resolved_node

        return {k: inline_local_refs(v, root_catalog, visited) for k, v in node.items()}

    elif isinstance(node, list):
        return [inline_local_refs(item, root_catalog, visited) for item in node]

    return node


def _collect_defs_refs(node: Any, refs: set[str]) -> None:
    """Recursively collects local #/$defs/ reference targets."""
    if isinstance(node, dict):
        if (
            "$ref" in node
            and isinstance(node["$ref"], str)
            and node["$ref"].startswith("#/$defs/")
        ):
            target_def = node["$ref"][len("#/$defs/") :].split("/")[0]
            refs.add(target_def)
        for v in node.values():
            _collect_defs_refs(v, refs)
    elif isinstance(node, list):
        for item in node:
            _collect_defs_refs(item, refs)


def _defs_refs(node: Any) -> set[str]:
    """Returns the local `#/$defs/` reference targets in `node`."""
    refs: set[str] = set()
    _collect_defs_refs(node, refs)
    return refs


# The JSON Schema dialect of the catalogs this SDK generates.
_JSON_SCHEMA_DIALECT: Final[str] = "https://json-schema.org/draft/2020-12/schema"

# The protocol version of a catalog document that declares none, as the
# specification's `catalog_definition.json` defaults it.
_DEFAULT_PROTOCOL_VERSION: Final[str] = "0.9"

# The `v` that a declared protocol version may start with, which the bare
# semantic version form of `catalog_definition.json` omits.
_BARE_VERSION_PREFIX: Final[re.Pattern[str]] = re.compile(r"^[vV](?=\d)")

# The document every unbundled common types reference points into, unless a
# catalog names another (`Catalog.common_types_uri`).
_COMMON_TYPES_DOCUMENT: Final[str] = "common_types.json"

# The `$defs` that a catalog derives from its components and functions.
_UNION_DEFS: Final[tuple[str, str]] = ("anyComponent", "anyFunction")

# Top-level string metadata of a catalog document, which `Catalog` keeps as
# `schema_dialect`, `schema_id`, `title` and `description`.
_METADATA_KEYS: Final[frozenset[str]] = frozenset(
    {"$schema", "$id", "title", "description"}
)

# Top-level catalog document keys that `Catalog` models itself. Any other key
# of an authored document is kept in `Catalog.extras`.
_MODELED_DOCUMENT_KEYS: Final[frozenset[str]] = frozenset({
    "$schema",
    "$id",
    "title",
    "description",
    "catalogId",
    "protocolVersion",
    "instructions",
    "components",
    "functions",
    "theme",
    "$defs",
})

# Where a catalog document writes its theme (`Catalog.theme_location`): the
# top-level `theme`, v0.8's top-level `styles` (a bare map of properties), or
# `$defs.theme`.
ThemeLocation: TypeAlias = Literal["theme", "styles", "$defs"]
_THEME_LOCATIONS: Final[frozenset[str]] = frozenset({"theme", "styles", "$defs"})

# The forms of a catalog document's `functions` (`Catalog.functions_form`): a
# map of name to definition, or the list of `{name, ...}` definitions of v0.9
# inline catalogs.
FunctionsForm: TypeAlias = Literal["map", "list"]


# The default of a `Catalog` argument that the catalog derives when it is not
# given, where None is a meaningful value.
_UNSET: Final[Any] = object()

# Keywords of a function definition that only a catalog document's entry
# writes, never a schema of the function's arguments.
_FUNCTION_DEFINITION_KEYWORDS: Final[frozenset[str]] = frozenset(
    {"returnType", "parameters", "allowedCallers", "requiresUserActivation"}
)


def _is_function_definition(schema: Any) -> bool:
    """Whether a function's JSON schema is its catalog document entry.

    A function defined in code may give the schema of its arguments instead,
    which `to_json` wraps in the call shape of its protocol version. An entry
    is a call schema (`properties` has `call`, `@call` or `args`) or declares a
    keyword only entries write, such as `returnType`.
    """
    if not isinstance(schema, Mapping):
        return False
    properties = schema.get("properties")
    if isinstance(properties, Mapping) and (
        "call" in properties or "@call" in properties or "args" in properties
    ):
        return True
    return any(key in schema for key in _FUNCTION_DEFINITION_KEYWORDS)


def _is_authored_component(component: Any) -> bool:
    """Whether a component's schema is its catalog document entry.

    That is a component whose `schema` is a JSON schema rather than one a
    model generates.
    """
    return getattr(component, "model_class", None) is None and isinstance(
        getattr(component, "schema", None), dict
    )


def _is_authored_function(function: Any) -> bool:
    """Whether a function's schema is its catalog document entry.

    A function that says whether it is (`FunctionApi.is_definition`, which
    `Catalog.from_json` sets on every entry it loads) is taken at its word;
    for any other, the schema's shape decides.
    """
    schema = getattr(function, "schema", None)
    is_definition = getattr(function, "is_definition", None)
    if is_definition is not None:
        return bool(is_definition) and isinstance(schema, Mapping)
    return _is_function_definition(schema)


def _local_def_name(ref: Any) -> str | None:
    """Returns the `$defs` name that a reference into the same catalog targets.

    Accepts a local `#/$defs/X` pointer and a pointer into a `catalog.json`
    document, which a catalog uses to reference its own definitions.
    """
    if not isinstance(ref, str):
        return None
    pointer: str = ref
    if not pointer.startswith("#"):
        document = pointer.partition("#")[0]
        if not document.endswith("catalog.json"):
            return None
        pointer = str(_localize_ref(pointer))
    if not pointer.startswith("#/$defs/"):
        return None
    return pointer[len("#/$defs/") :].split("/")[0]


def _local_def_refs(node: Any) -> set[str]:
    """Returns the `$defs` names that references in `node` target."""
    refs: set[str] = set()
    if isinstance(node, dict):
        name = _local_def_name(node.get("$ref"))
        if name is not None:
            refs.add(name)
        for value in node.values():
            refs |= _local_def_refs(value)
    elif isinstance(node, list):
        for item in node:
            refs |= _local_def_refs(item)
    return refs


def _reachable_defs(roots: Sequence[Any], defs: Mapping[str, Any]) -> set[str]:
    """Returns the names in `defs` that `roots` reference, transitively."""
    reachable: set[str] = set()
    queue = deque(name for root in roots for name in _local_def_refs(root))
    while queue:
        name = queue.popleft()
        if name in defs and name not in reachable:
            reachable.add(name)
            queue.extend(_local_def_refs(defs[name]))
    return reachable


def _externalize_refs(
    node: Any, common_names: set[str], document: str = _COMMON_TYPES_DOCUMENT
) -> Any:
    """Points local references to common types back at the common types document.

    Args:
        node: A schema fragment whose references are catalog-local.
        common_names: The common types names to point outside the catalog.
        document: The common types document, such as `common_types.json`.

    Returns:
        A copy of `node` in which each `#/$defs/X` reference to a name in
        `common_names` reads `<document>#/$defs/X`.
    """
    if isinstance(node, dict):
        result: dict[str, Any] = {}
        for key, value in node.items():
            if (
                key == "$ref"
                and isinstance(value, str)
                and value.startswith("#/$defs/")
                and value[len("#/$defs/") :].split("/")[0] in common_names
            ):
                result[key] = f"{document}{value}"
            else:
                result[key] = _externalize_refs(value, common_names, document)
        return result
    if isinstance(node, list):
        return [_externalize_refs(item, common_names, document) for item in node]
    return node


# A union that admits nothing. JSON Schema requires a non-empty `oneOf`.
_EMPTY_UNION: Final[dict[str, Any]] = {"not": {}}

# Keywords whose values are data rather than subschemas.
_DATA_KEYWORDS: Final[frozenset[str]] = frozenset(
    {"const", "default", "enum", "examples"}
)


def _mark_authored_titles(node: Any, in_properties: bool = False) -> Any:
    """Marks the `title` keywords of an authored schema to survive cleaning.

    `clean_schema_node` drops `title`, which Pydantic generates for every
    model and field, but keeps the marked titles of the specification. A
    title a catalog document wrote is an annotation to keep, so it is marked
    the same way. A property named `title` is not a keyword and stays as is.
    """
    if isinstance(node, dict):
        result: dict[str, Any] = {}
        for key, value in node.items():
            if not in_properties and key in _DATA_KEYWORDS:
                result[key] = value
            elif not in_properties and key == "title" and isinstance(value, str):
                result[SPEC_TITLE_KEY] = value
            else:
                result[key] = _mark_authored_titles(
                    value, in_properties=not in_properties and key == "properties"
                )
        return result
    if isinstance(node, list):
        return [_mark_authored_titles(item) for item in node]
    return node


def _component_union(names: Sequence[str]) -> dict[str, Any]:
    if not names:
        return dict(_EMPTY_UNION)
    return {
        "oneOf": [{"$ref": f"#/components/{name}"} for name in names],
        "discriminator": {"propertyName": "component"},
    }


def _function_union(names: Sequence[str]) -> dict[str, Any]:
    if not names:
        return dict(_EMPTY_UNION)
    return {"oneOf": [{"$ref": f"#/functions/{name}"} for name in names]}


def _function_document(
    function: FunctionApi, schema: Mapping[str, Any], v1: bool
) -> dict[str, Any]:
    """Returns a function's definition in the call shape of its version.

    Args:
        function: The function.
        schema: The function's schema in `validation_schema`: a call schema,
            or for a flat function, the schema of its arguments.
        v1: Whether the catalog targets v1.0 or later, whose calls name the
            function in `@call` rather than `call`.

    Returns:
        A call schema carrying the function's metadata.
    """
    document = dict(schema)
    properties = document.get("properties")
    is_call = isinstance(properties, dict) and (
        "@call" in properties or "call" in properties
    )
    if not is_call:
        args = (
            document.get("parameters")
            if "parameters" in document and "properties" not in document
            else document
        )
        args = dict(args) if isinstance(args, Mapping) else {}
        args.setdefault("type", "object")
        document = {"type": "object"}
        if v1:
            document["properties"] = {"@call": {"const": function.name}, "args": args}
            document["required"] = ["@call", "args"]
        else:
            document["properties"] = {
                "call": {"const": function.name},
                "args": args,
                "returnType": {"const": function.return_type},
            }
            document["required"] = ["call", "args"]
            document["unevaluatedProperties"] = False
    if function.description and "description" not in document:
        document["description"] = function.description
    if v1:
        document.setdefault("returnType", function.return_type)
        if function.allowed_callers != "rendererOnly":
            document.setdefault("allowedCallers", function.allowed_callers)
        if function.requires_user_activation:
            document.setdefault("requiresUserActivation", True)
    return document


def _function_list_entry(
    function: FunctionApi, document: Mapping[str, Any]
) -> dict[str, Any]:
    """Returns a function's definition in the list form of `functions`.

    The list form, which v0.9 inline catalogs use, is
    `{name, description, parameters, returnType}`.

    Args:
        function: The function.
        document: The function's call schema, from `_function_document`.
    """
    properties = document.get("properties")
    args = properties.get("args") if isinstance(properties, dict) else None
    entry: dict[str, Any] = {"name": function.name}
    description = function.description or document.get("description")
    if description:
        entry["description"] = description
    entry["returnType"] = function.return_type
    entry["parameters"] = args if isinstance(args, dict) else {"type": "object"}
    return entry


def _closes_properties(schema: Mapping[str, Any]) -> bool:
    """Whether a schema already decides on properties it does not list."""
    return "additionalProperties" in schema or "unevaluatedProperties" in schema


def _declared_return_type(spec: Mapping[str, Any]) -> Any:
    """The return type a catalog document declares for a function, or None.

    v1.0 catalogs and the v0.9 list form declare it as a top-level
    `returnType`; the v0.9 map form, as the `const` of the call's
    `returnType` property.
    """
    if "returnType" in spec:
        return spec["returnType"]
    properties = spec.get("properties")
    if isinstance(properties, Mapping):
        return_type = properties.get("returnType")
        if isinstance(return_type, Mapping) and isinstance(
            return_type.get("const"), str
        ):
            return return_type["const"]
    return None


def _close_function_call(entry: Any, return_type: str) -> None:
    """Gives a pre-v1.0 function call schema the specification's shape, in place.

    The shape is `{type, description?, properties: {call, args, returnType},
    required: [call, args?], unevaluatedProperties: false}`, where
    `returnType` is the function's return type as a constant and `args`
    admits no arguments beyond those it lists. A schema that is not a call
    schema, or that already decides on unlisted properties, keeps that part
    as written.

    Args:
        entry: A function's schema in the validation schema.
        return_type: The function's return type.
    """
    if not isinstance(entry, dict):
        return
    properties = entry.get("properties")
    if not isinstance(properties, dict) or "call" not in properties:
        return
    properties.setdefault("returnType", {"const": return_type})
    if not _closes_properties(entry):
        entry["unevaluatedProperties"] = False
    required = entry.setdefault("required", [])
    if isinstance(required, list) and "call" not in required:
        required.insert(0, "call")
    args = properties.get("args")
    if isinstance(args, dict):
        if not _closes_properties(args) and "$ref" not in args:
            args["unevaluatedProperties"] = False
        if (
            isinstance(required, list)
            and args.get("required")
            and "args" not in required
        ):
            required.append("args")


_COMPONENT_ENVELOPE_KEYS = frozenset({"id", "component", "catalogId"})
_STANDARD_MIXIN_DEFS = frozenset({"ComponentCommon", "Checkable"})


def _normalize_function_args_closure(entry: Any) -> None:
    """Normalizes a function call's `args` object closure to `unevaluatedProperties`."""
    if not isinstance(entry, dict):
        return
    properties = entry.get("properties")
    if not isinstance(properties, dict) or (
        "call" not in properties and "@call" not in properties
    ):
        return
    args = properties.get("args")
    if isinstance(args, dict) and args.get("type") == "object" and "$ref" not in args:
        additional = args.pop("additionalProperties", None)
        if "unevaluatedProperties" not in args:
            args["unevaluatedProperties"] = (
                additional if additional is not None else False
            )


def _propagate_ref_descriptions(
    node: Any,
    standard_defs: Mapping[str, Any],
) -> None:
    """Propagates descriptions from `standard_defs` onto local `$ref` nodes without one."""
    if isinstance(node, list):
        for item in node:
            _propagate_ref_descriptions(item, standard_defs)
        return
    if not isinstance(node, dict):
        return
    ref = node.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        def_name = ref[len("#/$defs/") :].split("/")[0]
        if "description" not in node and def_name in standard_defs:
            target = standard_defs[def_name]
            if isinstance(target, Mapping) and isinstance(
                target.get("description"), str
            ):
                node["description"] = target["description"]
    for value in node.values():
        _propagate_ref_descriptions(value, standard_defs)


def _collect_allof_local_mixin_refs(
    node: Any,
    local_defs: Mapping[str, Any],
    found: set[str],
) -> None:
    """Collects local `$defs` names referenced directly inside an `allOf` list."""
    if not isinstance(node, Mapping):
        return
    all_of = node.get("allOf")
    if not isinstance(all_of, list):
        return
    for sub in all_of:
        if not isinstance(sub, Mapping):
            continue
        def_name = _local_def_name(sub.get("$ref"))
        if (
            def_name is not None
            and def_name not in _STANDARD_MIXIN_DEFS
            and def_name not in found
        ):
            found.add(def_name)
            target = local_defs.get(def_name)
            if isinstance(target, Mapping):
                _collect_allof_local_mixin_refs(target, local_defs, found)
        else:
            _collect_allof_local_mixin_refs(sub, local_defs, found)


_MERGED_COMPONENT_KEYS = frozenset({
    "type",
    "description",
    "allOf",
    "properties",
    "required",
    "unevaluatedProperties",
    "additionalProperties",
    "allowedParents",
    "allowedChildren",
})


def _collect_component_sub_schemas(
    schema: Mapping[str, Any],
    local_defs: Mapping[str, Any],
    standard_defs: Mapping[str, Any],
    visited: set[str],
    used_local_mixins: set[str],
    unmerged: list[dict[str, Any]] | None = None,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """Gathers `(mixins, local, common_inline, specific_inline)` sub-schemas of a component."""
    mixins: list[dict[str, Any]] = []
    local: list[dict[str, Any]] = []
    common_inline: list[dict[str, Any]] = []
    specific_inline: list[dict[str, Any]] = []
    all_of = schema.get("allOf")
    if isinstance(all_of, list):
        for sub in all_of:
            if not isinstance(sub, Mapping):
                continue
            ref = sub.get("$ref")
            if not isinstance(ref, str):
                sub_m, sub_l, sub_ci, sub_si = _collect_component_sub_schemas(
                    sub,
                    local_defs,
                    standard_defs,
                    visited,
                    used_local_mixins,
                    unmerged=unmerged,
                )
                mixins.extend(sub_m)
                local.extend(sub_l)
                common_inline.extend(sub_ci)
                specific_inline.extend(sub_si)
                if unmerged is not None:
                    extra = {
                        k: copy.deepcopy(v)
                        for k, v in sub.items()
                        if k not in _MERGED_COMPONENT_KEYS
                    }
                    if extra:
                        unmerged.append(extra)
                continue
            def_name = _local_def_name(ref)
            if def_name is None and "#/$defs/" in ref:
                def_name = ref.split("#/$defs/")[-1].split("/")[0]
            if (
                def_name is not None
                and def_name not in _STANDARD_MIXIN_DEFS
                and def_name in local_defs
            ):
                used_local_mixins.add(def_name)
                if ref not in visited:
                    visited.add(ref)
                    target = local_defs[def_name]
                    if isinstance(target, Mapping):
                        sub_m, sub_l, sub_ci, sub_si = _collect_component_sub_schemas(
                            target,
                            local_defs,
                            standard_defs,
                            visited,
                            used_local_mixins,
                            unmerged=unmerged,
                        )
                        mixins.extend(sub_m)
                        local.extend(sub_l)
                        local.extend(sub_ci)
                        local.extend(sub_si)
                continue
            mixin = standard_defs.get(def_name) if def_name is not None else None
            if isinstance(mixin, Mapping) and isinstance(
                mixin.get("properties"), Mapping
            ):
                piece: dict[str, Any] = {
                    "properties": copy.deepcopy(dict(mixin["properties"])),
                }
                if isinstance(mixin.get("required"), list):
                    piece["required"] = list(mixin["required"])
                mixins.append(piece)
            elif unmerged is not None:
                unmerged.append(copy.deepcopy(dict(sub)))
    if "properties" in schema or "required" in schema or "description" in schema:
        own_piece = dict(schema)
        props = own_piece.get("properties")
        if isinstance(props, Mapping) and "component" in props:
            specific_inline.append(own_piece)
        else:
            common_inline.append(own_piece)
    return mixins, local, common_inline, specific_inline


TComponent = TypeVar("TComponent", bound=ComponentApi, default=Any, covariant=True)
TFunction = TypeVar("TFunction", bound=FunctionApi, default=Any, covariant=True)


@dataclass(frozen=True)
class _ResolvedSchemas:
    """The authored schemas of a catalog with their local references resolved.

    References into other specification documents (for example
    `common_types.json#/$defs/DynamicString`) become local `#/$defs/...`
    pointers, and references to the catalog's own definitions are written
    inline, except references to common types. Entries defined by models keep
    their schemas.

    Attributes:
        components: Each component's resolved schema.
        functions: Each function's resolved schema.
        defs: The catalog's own `$defs`, resolved.
        theme: The resolved theme schema.
    """

    components: dict[str, Any]
    functions: dict[str, Any]
    defs: dict[str, Any]
    theme: dict[str, Any]


class Catalog(Generic[TComponent, TFunction]):
    """A versioned set of component and function API definitions.

    The catalog is the model of a catalog document: `from_json` reads a
    document into it, and `to_json` writes it back, so that
    `Catalog.from_json(document).to_json()` equals `document`. Each component
    and function keeps its schema as the document writes it, or the model
    that defines it in code, and the catalog keeps the document's top-level
    fields. `validation_schema` bundles the model into a self-contained JSON
    Schema.

    Treat a catalog as immutable once it is built. `to_json`,
    `validation_schema` and the resolved schemas are computed on first use
    and cached, so changing a field or entry afterwards (such as `defs`,
    `extras`, `theme_schema`, `instructions`, `union_defs`, `components` or
    `functions`) is not reflected in them. To change a catalog, build a new
    one, for example with `copy_with`.
    """

    def __init__(
        self,
        catalog_id: str,
        protocol_version: str,
        components: list[TComponent] | None = None,
        functions: list[TFunction] | None = None,
        theme_schema: dict[str, Any] | None = None,
        instructions: str | None = None,
        defs: dict[str, Any] | None = None,
        common_types_defs: dict[str, Any] | None = None,
        *,
        schema_dialect: str | None = _JSON_SCHEMA_DIALECT,
        schema_id: str | None = None,
        title: str | None = None,
        description: str | None = None,
        declared_protocol_version: str | None = _UNSET,
        declares_catalog_id: bool = True,
        declares_components: bool = False,
        common_types_uri: str = _COMMON_TYPES_DOCUMENT,
        theme_model: type[BaseModel] | None = None,
        theme_location: ThemeLocation | None = _UNSET,
        functions_form: FunctionsForm | None = None,
        union_defs: Mapping[str, Any | None] | None = None,
        extras: Mapping[str, Any] | None = None,
        _layout: "_DocumentLayout | None" = None,
    ):
        """Initializes the catalog.

        Args:
            catalog_id: The catalog's ID.
            protocol_version: The A2UI protocol version the catalog targets.
            components: The catalog's components.
            functions: The catalog's functions.
            theme_schema: The JSON schema of the catalog's theme. Defaults to
                the schema of `theme_model`.
            instructions: Instructions for agents that use the catalog.
            defs: The catalog document's own named `$defs`, as written.
                `anyComponent` and `anyFunction` are derived from the entries
                (see `union_defs`).
            common_types_defs: Shared type definitions that override the
                built-in common types definitions.
            schema_dialect: The catalog document's `$schema`, or None if it
                declares none.
            schema_id: The catalog document's `$id`.
            title: The catalog document's `title`.
            description: The catalog document's `description`.
            declared_protocol_version: The catalog document's
                `protocolVersion` as written, or None if it declares none.
                Defaults to the canonical form of `protocol_version`, such as
                `1.0`.
            declares_catalog_id: Whether the catalog document declares
                `catalogId`.
            declares_components: Whether the catalog document has a
                `components` key even without components.
            common_types_uri: The document that the catalog document's
                references to common types point into, such as
                `common_types.json`.
            theme_model: The model that defines the theme in code. `to_json`
                then derives the theme from the model rather than writing
                `theme_schema` as it is.
            theme_location: Where the catalog document writes the theme. By
                default, `$defs.theme` before v1.0 and nowhere from v1.0 on.
            functions_form: Whether the catalog document writes `functions`
                as a map or as a list of definitions, or None for a map
                written only when the catalog has functions.
            union_defs: The `anyComponent` and `anyFunction` unions the
                catalog document writes. A union mapped to None lists the
                entries (`#/components/<name>`, `#/functions/<name>`); one
                mapped to a schema is written as that schema. A union left
                out is not written. By default, a catalog writes the unions of
                the entries it has, and both from v1.0 on.
            extras: The catalog document's top-level keys that `Catalog`
                does not model, as written.

        Raises:
            A2uiCatalogError: If `protocol_version` is missing, an identifier
                is invalid or `theme_location` is unknown.
        """
        if not protocol_version:
            raise A2uiCatalogError("protocol_version must be provided.")
        self.catalog_id = catalog_id
        self.protocol_version = protocol_version
        self.instructions = instructions
        self.schema_dialect = schema_dialect
        self.schema_id = schema_id
        self.title = title
        self.description = description
        self.declared_protocol_version: str | None = (
            (to_canonical_version(protocol_version) or protocol_version)
            if declared_protocol_version is _UNSET
            else declared_protocol_version
        )
        self.declares_catalog_id = declares_catalog_id
        self.declares_components = declares_components
        self.common_types_uri = common_types_uri
        self.defs: dict[str, Any] = copy.deepcopy(defs) if defs else {}
        # Shared type definitions that override the built-in common types
        # definitions derived from the Pydantic schema models, for a catalog
        # that validates against a reduced or customized common types document.
        self.common_types_defs: dict[str, Any] = (
            copy.deepcopy(common_types_defs) if common_types_defs else {}
        )
        self.functions_form = functions_form
        self.union_defs: dict[str, Any | None] | None = (
            None
            if union_defs is None
            else {
                name: copy.deepcopy(schema) if schema is not None else None
                for name, schema in union_defs.items()
            }
        )
        self.extras: dict[str, Any] = copy.deepcopy(dict(extras)) if extras else {}
        raw_layout = _layout or _DocumentLayout()
        self._layout = _DocumentLayout(
            declares_defs=raw_layout.declares_defs,
            null_unions=frozenset(
                name
                for name in raw_layout.null_unions
                if self.union_defs is not None
                and name in self.union_defs
                and self.union_defs[name] is None
            ),
            theme_from_document=raw_layout.theme_from_document,
            defs_from_document=raw_layout.defs_from_document,
        )

        validate_identifiers = is_at_least_version(
            protocol_version, ProtocolVersion.V1_0
        )

        self.components: dict[str, TComponent] = {}
        for c in components or []:
            if validate_identifiers and not is_valid_uax31_identifier(c.name):
                raise A2uiCatalogError(
                    f"Invalid UAX #31 component identifier: '{c.name}'"
                )
            self.components[c.name] = c

        self.functions: dict[str, TFunction] = {}
        for fn in functions or []:
            if validate_identifiers and not is_valid_uax31_identifier(fn.name):
                raise A2uiCatalogError(
                    f"Invalid UAX #31 function identifier: '{fn.name}'"
                )
            self.functions[fn.name] = fn

        self.theme_model = theme_model
        if theme_schema is None and theme_model is not None:
            theme_schema = theme_model.model_json_schema()
        self.theme_schema = theme_schema or {}
        if theme_location is _UNSET:
            theme_location = (
                "$defs"
                if self.theme_schema
                and not is_at_least_version(protocol_version, ProtocolVersion.V1_0)
                else None
            )
        if theme_location is not None and theme_location not in _THEME_LOCATIONS:
            raise A2uiCatalogError(f"Unknown theme location: {theme_location!r}")
        self.theme_location: ThemeLocation | None = theme_location

        self._cached_catalog_schema: dict[str, Any] | None = None
        self._cached_document: dict[str, Any] | None = None
        self._resolved: _ResolvedSchemas | None = None
        self._component_ref_map: dict[str, ComponentRefSpec] | None = None

    @property
    def id(self) -> str:
        """Symmetrical alias for catalog_id."""
        return self.catalog_id

    def copy_with(
        self,
        *,
        components: Sequence[ComponentApi] | None = None,
        functions: Sequence[FunctionApi] | None = None,
        defs: Mapping[str, Any] | None = None,
    ) -> "CatalogApi":
        """Returns a catalog derived from this one, for catalog transformers.

        The copy keeps this catalog's id, protocol version, theme,
        instructions and document fields. An entry keeps its schema, so
        `to_json` writes each kept entry as before. A union that this catalog
        writes as an authored schema (or as `null`) is listed from the copy's entries
        instead if the copy has other entries of its kind.

        Args:
            components: The copy's components. None keeps this catalog's.
            functions: The copy's functions. None keeps this catalog's.
            defs: The copy's own `$defs`. None keeps this catalog's, except
                those that only the dropped entries referenced. Defs given
                here are treated as defined in code.

        Returns:
            A schema-only catalog.
        """
        new_components: list[ComponentApi] = list(
            self.components.values() if components is None else components
        )
        new_functions: list[FunctionApi] = list(
            self.functions.values() if functions is None else functions
        )
        union_defs = self.union_defs
        null_unions = set(self._layout.null_unions)
        if union_defs is not None:
            union_defs = dict(union_defs)
            for name, changed in (
                (
                    "anyComponent",
                    [c.name for c in new_components] != list(self.components),
                ),
                (
                    "anyFunction",
                    [f.name for f in new_functions] != list(self.functions),
                ),
            ):
                if changed and name in union_defs:
                    # An authored union (`null` included) no longer describes
                    # the copy's entries, so it is listed from them.
                    union_defs[name] = None
                    null_unions.discard(name)

        if defs is None:
            # A def that the old entries referenced and the new ones no longer
            # do goes with the entries that used it. Defs that no old entry
            # referenced stay, so they count as roots too: a def they
            # reference stays with them.
            old_reachable = _reachable_defs(self._document_roots(), self.defs)
            orphans = [
                schema
                for name, schema in self.defs.items()
                if name not in old_reachable
            ]
            new_roots = [
                *(getattr(c, "schema", None) for c in new_components),
                *(getattr(f, "schema", None) for f in new_functions),
                self.theme_schema,
                *self.extras.values(),
                # Unions the copy keeps as authored still reference defs.
                *(
                    schema
                    for schema in (union_defs or {}).values()
                    if schema is not None
                ),
                *orphans,
            ]
            new_reachable = _reachable_defs(new_roots, self.defs)
            new_defs = {
                name: schema
                for name, schema in self.defs.items()
                if name not in old_reachable or name in new_reachable
            }
        else:
            new_defs = dict(defs)

        return CatalogApi(
            catalog_id=self.catalog_id,
            protocol_version=self.protocol_version,
            components=new_components,
            functions=new_functions,
            theme_schema=copy.deepcopy(self.theme_schema),
            instructions=self.instructions,
            defs=new_defs,
            common_types_defs=self.common_types_defs,
            schema_dialect=self.schema_dialect,
            schema_id=self.schema_id,
            title=self.title,
            description=self.description,
            declared_protocol_version=self.declared_protocol_version,
            declares_catalog_id=self.declares_catalog_id,
            declares_components=self.declares_components,
            common_types_uri=self.common_types_uri,
            theme_model=self.theme_model,
            theme_location=self.theme_location,
            functions_form=self.functions_form,
            union_defs=union_defs,
            extras=self.extras,
            _layout=_DocumentLayout(
                declares_defs=self._layout.declares_defs,
                null_unions=frozenset(null_unions),
                theme_from_document=self._layout.theme_from_document,
                defs_from_document=self._layout.defs_from_document and defs is None,
            ),
        )

    def _document_roots(self) -> list[Any]:
        """The parts of the catalog document that reference its `$defs`."""
        return [
            *(getattr(c, "schema", None) for c in self.components.values()),
            *(getattr(f, "schema", None) for f in self.functions.values()),
            self.theme_schema,
            *self.extras.values(),
            *(
                schema
                for schema in (self.union_defs or {}).values()
                if schema is not None
            ),
        ]

    # ==========================================================================
    # Resolved schemas
    # ==========================================================================

    def _resolved_schemas(self) -> _ResolvedSchemas:
        """Returns the catalog's authored schemas with references resolved.

        Computed once per catalog.
        """
        cached: _ResolvedSchemas | None = getattr(self, "_resolved", None)
        if cached is not None:
            return cached
        own_defs = {
            name: schema
            for name, schema in self.defs.items()
            if name not in _UNION_DEFS
        }
        authored_theme = self.theme_model is None and bool(self.theme_schema)
        if authored_theme and self.theme_location == "$defs":
            own_defs["theme"] = self.theme_schema
        authored_components = {
            name: comp.schema
            for name, comp in self.components.items()
            if _is_authored_component(comp)
        }
        authored_functions = {
            name: fn.schema
            for name, fn in self.functions.items()
            if isinstance(fn.schema, dict)
        }
        root: dict[str, Any] = _normalize_external_schema_refs({
            "$defs": own_defs,
            "components": authored_components,
            "functions": authored_functions,
        })

        def resolve(node: Any) -> Any:
            return copy.deepcopy(
                inline_local_refs(_normalize_external_schema_refs(node), root)
            )

        components: dict[str, Any] = {}
        for name, comp in self.components.items():
            components[name] = (
                resolve(comp.schema) if name in authored_components else comp.schema
            )
        functions: dict[str, Any] = {}
        for name, fn in self.functions.items():
            functions[name] = (
                resolve(fn.schema) if name in authored_functions else fn.schema
            )
        resolved = _ResolvedSchemas(
            components=components,
            functions=functions,
            defs={
                name: resolve(schema)
                for name, schema in self.defs.items()
                if name not in _UNION_DEFS
            },
            theme=resolve(self.theme_schema) if authored_theme else self.theme_schema,
        )
        self._resolved = resolved
        return resolved

    def resolved_component_schema(self, name: str) -> Any:
        """Returns a component's schema with its references resolved.

        For a component whose schema the catalog document writes, references
        to other specification documents become local `#/$defs/...`
        pointers, which `validation_schema` defines, and references to the
        catalog's own `$defs` are written inline. A component defined by a
        model keeps its schema. The result is shared; do not mutate it.

        Args:
            name: The component's name.

        Returns:
            The schema, or None if the catalog has no such component.
        """
        return self._resolved_schemas().components.get(name)

    def resolved_function_schema(self, name: str) -> Any:
        """Returns a function's schema with its references resolved.

        See `resolved_component_schema`. The result is shared; do not mutate
        it.

        Args:
            name: The function's name.

        Returns:
            The schema, or None if the catalog has no such function.
        """
        return self._resolved_schemas().functions.get(name)

    @property
    def resolved_theme_schema(self) -> dict[str, Any]:
        """The theme schema with its references resolved.

        See `resolved_component_schema`. The result is shared; do not mutate
        it.
        """
        return self._resolved_schemas().theme

    # ==========================================================================
    # validation_schema
    # ==========================================================================

    @property
    def catalog_schema(self) -> dict[str, Any]:
        """Deprecated alias of `validation_schema`."""
        warnings.warn(
            "Catalog.catalog_schema is deprecated; use Catalog.validation_schema"
            " for the bundled validation schema or Catalog.to_json() for the"
            " catalog document.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.validation_schema

    @property
    def validation_schema(self) -> dict[str, Any]:
        """The self-contained JSON Schema that payloads validate against.

        Every reference is local: the common types the catalog references,
        transitively, are bundled into `$defs`, and `anyComponent` and
        `anyFunction` list the catalog's components and functions. For the
        catalog document itself, with external references kept, use
        `to_json`.

        Each component is flattened into a single object schema with its
        `allOf` mixins (`ComponentCommon`, `Checkable`, and local `$defs`
        mixins) merged into `properties` and `required` and the canonical
        component envelope (`id` and `component`) applied. From v0.9 on, a
        function schema describes the whole call. The common types defs the
        catalog references, transitively, come from the published common types
        schema with local refs; a published def that would reference a def
        the catalog lacks (such as `FunctionCall` in a catalog without
        functions) takes its flat form. System functions, which the runtime
        supplies, are not declared.

        Computed once per catalog; each access returns a new copy. The catalog
        must not be changed after it is built (see `Catalog`).

        Raises:
            A2uiCatalogError: If the catalog's protocol version is unknown.
        """
        cached = getattr(self, "_cached_catalog_schema", None)
        if cached is not None:
            return copy.deepcopy(cached)
        cleaned_schema, referenced_dynamics, _, protocol_version = (
            self._assemble_schema()
        )
        common_types_version = (
            ProtocolVersion.V0_9
            if protocol_version is ProtocolVersion.V0_8
            else protocol_version
        )
        published_common_defs = _normalize_external_schema_refs(
            get_common_types_schema_map(common_types_version)["$defs"]
        )
        standard_defs = {
            **get_common_types_catalog_defs(common_types_version),
            **published_common_defs,
            **self.common_types_defs,
        }
        self._flatten_validation_components(
            cleaned_schema, standard_defs, protocol_version
        )
        _propagate_ref_descriptions(cleaned_schema.get("components"), standard_defs)
        _propagate_ref_descriptions(cleaned_schema.get("functions"), standard_defs)
        _propagate_ref_descriptions(cleaned_schema.get("$defs"), standard_defs)

        self._bundle_common_types(
            cleaned_schema,
            (referenced_dynamics - _STANDARD_MIXIN_DEFS) | _defs_refs(cleaned_schema),
            protocol_version,
        )
        return self._finish_validation_schema(cleaned_schema, protocol_version)

    def _flatten_validation_components(
        self,
        schema: dict[str, Any],
        standard_defs: Mapping[str, Any],
        protocol_version: ProtocolVersion,
    ) -> None:
        """Flattens component `allOf` mixins and applies the canonical component envelope."""
        components = schema.get("components")
        if not isinstance(components, dict):
            return
        local_defs: dict[str, Any] = schema.get("$defs") or {}
        used_local_mixins: set[str] = set()
        v1 = is_at_least_version(protocol_version, ProtocolVersion.V1_0)

        for name, comp_schema in list(components.items()):
            if not isinstance(comp_schema, dict):
                continue
            comp_obj = self.components.get(name)
            authored_schema = (
                getattr(comp_obj, "schema", None) if comp_obj is not None else None
            )
            if isinstance(authored_schema, Mapping):
                _collect_allof_local_mixin_refs(
                    authored_schema, local_defs, used_local_mixins
                )
            unmerged: list[dict[str, Any]] = []
            mixins, local, common_inline, specific_inline = (
                _collect_component_sub_schemas(
                    comp_schema,
                    local_defs,
                    standard_defs,
                    set(),
                    used_local_mixins,
                    unmerged=unmerged,
                )
            )
            pieces = [*mixins, *local, *common_inline, *specific_inline]
            description: str | None = None
            raw_props: dict[str, Any] = {}
            req_set: set[str] = set()
            comp_const = name

            for piece in pieces:
                piece_desc = piece.get("description")
                if isinstance(piece_desc, str) and piece_desc:
                    description = piece_desc
                piece_props = piece.get("properties")
                if isinstance(piece_props, Mapping):
                    comp_prop = piece_props.get("component")
                    if isinstance(comp_prop, Mapping) and isinstance(
                        comp_prop.get("const"), str
                    ):
                        comp_const = comp_prop["const"]
                    for prop_name, prop_schema in piece_props.items():
                        if prop_name in _COMPONENT_ENVELOPE_KEYS:
                            continue
                        raw_props[prop_name] = copy.deepcopy(prop_schema)
                piece_req = piece.get("required")
                if isinstance(piece_req, list):
                    for req_name in piece_req:
                        if (
                            isinstance(req_name, str)
                            and req_name not in _COMPONENT_ENVELOPE_KEYS
                        ):
                            req_set.add(req_name)

            ordered_props: dict[str, Any] = {}
            for group in (specific_inline, local, common_inline, mixins):
                for piece in group:
                    piece_props = piece.get("properties")
                    if isinstance(piece_props, Mapping):
                        for prop_name in piece_props:
                            if (
                                prop_name in raw_props
                                and prop_name not in ordered_props
                            ):
                                ordered_props[prop_name] = raw_props[prop_name]
            for prop_name, prop_schema in raw_props.items():
                ordered_props.setdefault(prop_name, prop_schema)

            flattened: dict[str, Any] = {"type": "object"}
            for key, val in comp_schema.items():
                if key not in _MERGED_COMPONENT_KEYS:
                    flattened[key] = copy.deepcopy(val)
            if description is not None:
                flattened["description"] = description
            flattened["properties"] = {
                "id": {"$ref": "#/$defs/ComponentId"},
                **ordered_props,
                "component": {"const": comp_const},
            }
            flattened["required"] = ["id", *sorted(req_set), "component"]
            if unmerged:
                flattened["allOf"] = unmerged

            closure = (
                comp_schema["unevaluatedProperties"]
                if "unevaluatedProperties" in comp_schema
                else comp_schema.get("additionalProperties")
            )
            if closure is None and not v1:
                closure = False
            if closure is not None:
                flattened["unevaluatedProperties"] = closure

            allowed_parents = comp_schema.get("allowedParents") or (
                getattr(comp_obj, "allowed_parents", None)
                if comp_obj is not None
                else None
            )
            if isinstance(allowed_parents, list) and allowed_parents:
                flattened["allowedParents"] = list(allowed_parents)
            allowed_children = comp_schema.get("allowedChildren") or (
                getattr(comp_obj, "allowed_children", None)
                if comp_obj is not None
                else None
            )
            if isinstance(allowed_children, list) and allowed_children:
                flattened["allowedChildren"] = list(allowed_children)

            components[name] = flattened

        if local_defs and used_local_mixins:
            roots = [
                schema.get("components"),
                schema.get("functions"),
                local_defs.get("theme"),
            ]
            still_reachable = _reachable_defs(roots, local_defs)
            for def_name in used_local_mixins:
                if (
                    def_name in local_defs
                    and def_name not in still_reachable
                    and def_name not in _UNION_DEFS
                    and def_name != "theme"
                ):
                    del local_defs[def_name]

    def _finish_validation_schema(
        self, schema: dict[str, Any], protocol_version: ProtocolVersion
    ) -> dict[str, Any]:
        """Applies the last canonical touches to a validation schema and caches it.

        The `protocolVersion` that the catalog document declares is emitted in
        the bare semantic version form that `catalog_definition.json`
        requires: `v0.9.1` becomes `0.9.1`. Before v1.0, each function the
        catalog document writes is given the specification's call shape: a
        `returnType` constant, and no properties beyond those it lists, in the
        call or in its `args`. From v1.0, a function entry stays open, since
        `FunctionCall` composes it with `FunctionCommon` (`catalogId`) and
        closes the call itself.
        """
        declared = self.declared_protocol_version
        if isinstance(declared, str):
            schema["protocolVersion"] = _BARE_VERSION_PREFIX.sub("", declared.strip())
        v1 = is_at_least_version(protocol_version, ProtocolVersion.V1_0)
        for name, entry in (schema.get("functions") or {}).items():
            if not v1:
                fn = self.functions.get(name)
                if fn is not None:
                    _close_function_call(entry, fn.return_type)
            _normalize_function_args_closure(entry)
        self._cached_catalog_schema = copy.deepcopy(schema)
        return schema

    def _common_types_defs_for(
        self, protocol_version: ProtocolVersion
    ) -> dict[str, Any]:
        """Returns the flat common types defs, with this catalog's overrides.

        Versions without common types (v0.8) fall back to v0.9, as the dynamic
        type index does.
        """
        common_types_version = (
            ProtocolVersion.V0_9
            if protocol_version is ProtocolVersion.V0_8
            else protocol_version
        )
        return {
            **get_common_types_catalog_defs(common_types_version),
            **self.common_types_defs,
        }

    def _protocol_version_enum(self) -> ProtocolVersion:
        try:
            return to_protocol_version(self.protocol_version)
        except ValueError as e:
            raise A2uiCatalogError(str(e)) from e

    def _assemble_schema(
        self,
    ) -> tuple[dict[str, Any], set[str], bool, ProtocolVersion]:
        """Builds the catalog schema before common types are bundled into it.

        Returns:
            The schema, whose references to common types are local but whose
            `$defs` may lack them; the dynamic common types it references;
            whether any entry is specification-shaped; and the catalog's
            protocol version.

        Raises:
            A2uiCatalogError: If the catalog's protocol version is unknown.
        """
        protocol_version = self._protocol_version_enum()
        resolved = self._resolved_schemas()
        schema: dict[str, Any] = {
            "$schema": _JSON_SCHEMA_DIALECT,
            "catalogId": self.catalog_id,
        }

        if self.instructions:
            schema["instructions"] = self.instructions

        defs: dict[str, Any] = copy.deepcopy(resolved.defs)
        if resolved.theme:
            theme = copy.deepcopy(resolved.theme)
            # From v0.9, a theme that does not close itself states that it is
            # open, so renderers may add their own theme properties.
            if (
                is_at_least_version(protocol_version, ProtocolVersion.V0_9)
                and isinstance(theme, dict)
                and (theme.get("type") == "object" or "properties" in theme)
                and "additionalProperties" not in theme
                and "unevaluatedProperties" not in theme
                and "$ref" not in theme
            ):
                theme["additionalProperties"] = True
            defs["theme"] = theme

        # The runtime supplies system functions to every catalog, and the
        # common types admit their calls, so the catalog does not declare them.
        system_names = set(system_functions_for(self.protocol_version))
        functions = {
            name: fn for name, fn in self.functions.items() if name not in system_names
        }

        spec_components: dict[str, SpecSchema] = {}
        spec_functions: dict[str, SpecSchema] = {}
        if is_at_least_version(self.protocol_version, ProtocolVersion.V0_9):
            shaper = SpecShaper(protocol_version)
            for name, comp in self.components.items():
                spec = shaper.component_schema(name, getattr(comp, "model_class", None))
                if spec is not None:
                    spec_components[name] = spec
            for name, fn in functions.items():
                spec = shaper.function_schema(fn)
                if spec is not None:
                    spec_functions[name] = spec
        spec_shaped = [*spec_components.values(), *spec_functions.values()]

        # Pydantic emits defs for the models of spec-shaped fields. Common
        # types give way to the published defs; nested objects (for example
        # `TabItem`) go back inline, as the specification writes them.
        model_defs: dict[str, Any] = {}
        if spec_shaped:
            published = get_common_types_schema_map(protocol_version)["$defs"]
            for spec in spec_shaped:
                for def_name, def_schema in spec.catalog_defs.items():
                    defs.setdefault(def_name, def_schema)
            for spec in spec_shaped:
                for def_name, def_schema in spec.model_defs.items():
                    if def_name not in published and def_name not in defs:
                        model_defs.setdefault(
                            def_name, {**def_schema, INLINE_DEF_MARKER: True}
                        )

        for name, comp in self.components.items():
            if name in spec_components:
                continue
            s = resolved.components[name]
            if isinstance(s, dict) and isinstance(s.get("$defs"), dict):
                for def_name, def_schema in s["$defs"].items():
                    if def_name not in defs:
                        defs[def_name] = def_schema

        flat_functions: dict[str, Any] = {}
        for name, fn in functions.items():
            if name in spec_functions:
                continue
            s = resolved.functions[name]
            if isinstance(s, type) and hasattr(s, "model_json_schema"):
                s = s.model_json_schema()
            flat_functions[name] = s
            if isinstance(s, dict) and isinstance(s.get("$defs"), dict):
                for def_name, def_schema in s["$defs"].items():
                    if def_name not in defs:
                        defs[def_name] = def_schema

        if self.components:
            comp_schemas: dict[str, Any] = {}
            for name, comp in self.components.items():
                if name in spec_components:
                    comp_schemas[name] = _strip_const_implied_keywords(
                        spec_components[name].schema
                    )
                    continue
                s = resolved.components[name]
                if isinstance(s, dict):
                    s = copy.deepcopy(s)
                    # Only an authored schema has authored titles; a model's
                    # schema has Pydantic's.
                    if _is_authored_component(comp):
                        s = _mark_authored_titles(s)
                    if "$defs" in s:
                        del s["$defs"]
                    if "properties" in s and "component" in s["properties"]:
                        comp_const = name
                        if (
                            isinstance(s["properties"]["component"], dict)
                            and "const" in s["properties"]["component"]
                        ):
                            comp_const = s["properties"]["component"]["const"]
                        s["properties"]["component"] = {"const": comp_const}
                        if "required" not in s or not isinstance(s["required"], list):
                            s["required"] = []
                        if "component" not in s["required"]:
                            s["required"].append("component")
                    if "unevaluatedProperties" not in s:
                        if "additionalProperties" in s:
                            s["unevaluatedProperties"] = s.pop("additionalProperties")
                comp_schemas[name] = s
            schema["components"] = comp_schemas

        if functions:
            fn_schemas: dict[str, Any] = {}
            for name in functions:
                if name in spec_functions:
                    fn_schemas[name] = _strip_const_implied_keywords(
                        spec_functions[name].schema
                    )
                    continue
                s = flat_functions[name]
                if isinstance(s, dict):
                    s = copy.deepcopy(s)
                    if isinstance(functions[name].schema, dict):
                        s = _mark_authored_titles(s)
                    if "$defs" in s:
                        del s["$defs"]
                fn_schemas[name] = s
            schema["functions"] = fn_schemas

        if self.components:
            any_comp_refs = [
                {"$ref": f"#/components/{name}"} for name in self.components.keys()
            ]
            defs["anyComponent"] = {
                "oneOf": any_comp_refs,
                "discriminator": {"propertyName": "component"},
            }

        if functions:
            any_fn_refs = [{"$ref": f"#/functions/{name}"} for name in functions]
            defs["anyFunction"] = {
                "oneOf": any_fn_refs,
            }

        if defs or model_defs:
            schema["$defs"] = {**defs, **model_defs}
        # Models that stand for nested objects (e.g. `ComponentCommonMetadata`)
        # go back inline, as the specification writes them.
        schema = inline_marked_defs(schema)

        referenced_dynamics: set[str] = set()
        dynamic_index = get_dynamic_type_index(protocol_version)
        cleaned_schema = cast(
            dict[str, Any],
            clean_schema_node(
                schema,
                referenced_dynamics=referenced_dynamics,
                dynamic_index=dynamic_index,
            ),
        )

        return cleaned_schema, referenced_dynamics, bool(spec_shaped), protocol_version

    def _bundle_common_types(
        self,
        schema: dict[str, Any],
        seeds: set[str],
        protocol_version: ProtocolVersion,
    ) -> None:
        """Adds the common types defs that `seeds` reference, transitively.

        A name resolves to the catalog's own def first, then to this catalog's
        `common_types_defs`, then to the published common types schema, whose
        cross-document references become local. A published def that would
        reference a def nobody supplies (for example the function union of a
        catalog without functions) is replaced by its flat catalog form, which
        validates on its own. Names outside the published schema (for example
        helper models of flat components) use the catalog form. Versions
        without common types (v0.8) use v0.9's.
        """
        if protocol_version is ProtocolVersion.V0_8:
            protocol_version = ProtocolVersion.V0_9
        defs: dict[str, Any] = schema.setdefault("$defs", {})
        published: dict[str, Any] = _normalize_external_schema_refs(
            get_common_types_schema_map(protocol_version)["$defs"]
        )
        catalog_form = get_common_types_catalog_defs(protocol_version)
        overrides = self.common_types_defs
        # Flat component and function schemas carry Pydantic's copies of the
        # common types they use; those give way to the resolved defs.
        for name in list(defs):
            if name not in self.defs and (name in published or name in catalog_form):
                del defs[name]
        own = set(defs)

        flat: set[str] = set()
        while True:
            chosen: dict[str, Any] = {}
            queue = deque(sorted(seeds))
            while queue:
                name = queue.popleft()
                if name in own or name in chosen:
                    continue
                if name in overrides:
                    chosen[name] = overrides[name]
                elif name in published and name not in flat:
                    chosen[name] = published[name]
                elif name in catalog_form:
                    chosen[name] = catalog_form[name]
                elif name in _UNION_DEFS:
                    chosen[name] = dict(_EMPTY_UNION)
                else:
                    continue
                queue.extend(sorted(_defs_refs(chosen[name])))
            available = own | set(chosen)
            dangling = {
                name
                for name, def_schema in chosen.items()
                if name in published
                and name not in flat
                and name not in overrides
                and name in catalog_form
                and _defs_refs(def_schema) - available
            }
            if not dangling:
                break
            flat |= dangling

        # The returned schema gets copies, so mutating it leaves this
        # catalog's `common_types_defs` intact.
        for name in sorted(chosen):
            defs[name] = copy.deepcopy(chosen[name])

    # ==========================================================================
    # to_json
    # ==========================================================================

    def to_json(self) -> dict[str, Any]:
        """Returns the catalog document, with references left unbundled.

        This is the catalog as an author writes it, and what `from_json`
        reads, so that `Catalog.from_json(document).to_json()` equals
        `document` (excluding components and functions omitted from
        `anyComponent.oneOf` and `anyFunction.oneOf`, which `from_json`
        filters out). References to common types stay external
        (`common_types.json#/$defs/X`) and no common types are copied into
        `$defs`. For the self-contained schema that payloads validate
        against, use `validation_schema`. The document is assembled from the
        catalog's fields:

        - Top-level metadata: `$schema`, `$id`, `title`, `description`,
          `catalogId` (if `declares_catalog_id`), `protocolVersion` (the
          `declared_protocol_version`), `instructions`, and the `extras`,
          each only when the catalog has it.
        - `components`: a component whose schema is a JSON schema is written
          as that schema, with its `allowedParents` and `allowedChildren`.
          A component defined by a model is derived from the model in the
          shape of its protocol version.
        - `functions`, in the catalog's `functions_form`: a function whose
          schema is its catalog entry (every function `from_json` loads; see
          `FunctionApi.is_definition`) is written as that schema, with the
          function's `description`, `returnType`, `allowedCallers` and
          `requiresUserActivation`. Any other function (an args schema or
          model) is written in the call shape of its protocol version.
          System functions defined in code are not declared.
        - The theme, at its `theme_location`: `theme_schema` as it is, or
          derived from `theme_model`.
        - `$defs`: the catalog's own `defs`, the defs that model-defined
          entries compose (such as `CatalogComponentCommon`), and the
          `union_defs`.

        Entries, defs and the theme loaded by `from_json` keep their
        references exactly as written. In an entry, def or theme defined in
        code, a local reference to a common type that the document does not
        define itself points at `common_types_uri`.

        Computed once per catalog; each call returns a new copy, which the
        caller may mutate. The catalog itself must not be changed after it is
        built (see `Catalog`); use `copy_with` to derive a changed catalog.

        Returns:
            The catalog document.

        Raises:
            A2uiCatalogError: If an entry is derived from a model and the
                catalog's protocol version is unknown.
        """
        cached = getattr(self, "_cached_document", None)
        if cached is None:
            cached = self._build_document()
            self._cached_document = cached
        return copy.deepcopy(cached)

    def _build_document(self) -> dict[str, Any]:
        """Assembles the catalog document that `to_json` returns."""
        # The protocol reserves the `@` namespace for system functions.
        system_names = set(system_functions_for(self.protocol_version))
        functions = {
            name: fn
            for name, fn in self.functions.items()
            if _is_authored_function(fn)
            or not (name in system_names or name.startswith("@"))
        }
        derived = self._derive_model_entries(functions)
        common_names = derived.common_names - set(self.defs)

        doc: dict[str, Any] = {}
        if self.schema_dialect is not None:
            doc["$schema"] = self.schema_dialect
        for key, value in (
            ("$id", self.schema_id),
            ("protocolVersion", self.declared_protocol_version),
            ("title", self.title),
            ("description", self.description),
        ):
            if value is not None:
                doc[key] = value
        if self.declares_catalog_id:
            doc["catalogId"] = self.catalog_id
        if self.instructions is not None:
            doc["instructions"] = self.instructions
        doc.update(copy.deepcopy(self.extras))

        components: dict[str, Any] = {}
        for name, comp in self.components.items():
            if name in derived.components:
                components[name] = derived.components[name]
            else:
                components[name] = self._component_entry(comp, common_names)
        if components or self.declares_components:
            doc["components"] = components

        function_docs: dict[str, Any] = {}
        for name, fn in functions.items():
            if name in derived.functions:
                function_docs[name] = derived.functions[name]
            else:
                function_docs[name] = self._function_entry(fn, common_names)
        if function_docs or self.functions_form is not None:
            if self.functions_form == "list":
                doc["functions"] = [
                    (
                        {"name": name, **function_docs[name]}
                        if name not in derived.functions
                        else _function_list_entry(fn, function_docs[name])
                    )
                    for name, fn in functions.items()
                ]
            else:
                doc["functions"] = function_docs

        theme = self._theme_document(derived.theme, common_names)
        if theme is not None and self.theme_location == "theme":
            doc["theme"] = theme
        elif theme is not None and self.theme_location == "styles":
            properties = theme.get("properties") if isinstance(theme, dict) else None
            doc["styles"] = properties if isinstance(properties, dict) else theme

        defs: dict[str, Any] = {
            name: (
                copy.deepcopy(schema)
                if self._layout.defs_from_document
                else _externalize_refs(schema, common_names, self.common_types_uri)
            )
            for name, schema in self.defs.items()
            if name not in _UNION_DEFS
        }
        reachable = _reachable_defs(
            [doc.get("components"), doc.get("functions")], derived.defs
        )
        for name, schema in derived.defs.items():
            if name in reachable and name not in defs:
                defs[name] = schema
        if theme is not None and self.theme_location == "$defs":
            defs["theme"] = theme
        defs.update(self._union_documents(list(components), list(function_docs)))
        if defs or self._layout.declares_defs:
            doc["$defs"] = defs
        return doc

    def _union_documents(
        self, component_names: list[str], function_names: list[str]
    ) -> dict[str, Any]:
        """Returns the `anyComponent` and `anyFunction` unions to write."""
        if self.union_defs is None:
            v1 = is_at_least_version(self.protocol_version, ProtocolVersion.V1_0)
            unions: dict[str, Any] = {}
            if component_names or v1:
                unions["anyComponent"] = _component_union(component_names)
            if function_names or v1:
                unions["anyFunction"] = _function_union(function_names)
            return unions
        documents: dict[str, Any] = {}
        for name, schema in self.union_defs.items():
            if schema is not None or name in self._layout.null_unions:
                documents[name] = copy.deepcopy(schema)
            elif name == "anyComponent":
                documents[name] = _component_union(component_names)
            elif name == "anyFunction":
                documents[name] = _function_union(function_names)
        return documents

    def _component_entry(
        self, component: ComponentApi, common_names: set[str]
    ) -> dict[str, Any]:
        """Returns the document entry of a component whose schema is authored."""
        schema = component.schema if isinstance(component.schema, dict) else {}
        entry = (
            copy.deepcopy(schema)
            if getattr(component, "from_document", False)
            else _externalize_refs(schema, common_names, self.common_types_uri)
        )
        for key, value in (
            ("allowedParents", component.allowed_parents),
            ("allowedChildren", component.allowed_children),
        ):
            if value is not None:
                entry[key] = copy.deepcopy(value)
            elif entry.get(key) is not None:
                # A null the schema writes is kept as written.
                entry.pop(key)
        return cast(dict[str, Any], entry)

    def _function_entry(
        self, function: FunctionApi, common_names: set[str]
    ) -> dict[str, Any]:
        """Returns the document entry of a function whose schema is its entry.

        The entry is the function's schema, with the function's metadata
        written where the schema declares it, or added where it differs from
        the default.
        """
        entry: dict[str, Any] = (
            copy.deepcopy(function.schema)
            if getattr(function, "from_document", False)
            else _externalize_refs(function.schema, common_names, self.common_types_uri)
        )
        if function.description is not None:
            entry["description"] = function.description
        properties = entry.get("properties")
        call_return_type = (
            properties.get("returnType") if isinstance(properties, dict) else None
        )
        # A value is written only where it differs from the one `from_json`
        # reads from the entry, so a value the model defaults (a null or
        # odd-typed one) stays as written.
        if function.return_type != (_declared_return_type(entry) or "any"):
            if (
                "returnType" not in entry
                and isinstance(call_return_type, dict)
                and "const" in call_return_type
            ):
                call_return_type["const"] = function.return_type
            else:
                entry["returnType"] = function.return_type
        if function.allowed_callers != (entry.get("allowedCallers") or "rendererOnly"):
            entry["allowedCallers"] = function.allowed_callers
        if function.requires_user_activation != bool(
            entry.get("requiresUserActivation")
        ):
            entry["requiresUserActivation"] = function.requires_user_activation
        return entry

    def _theme_document(
        self, derived_theme: dict[str, Any] | None, common_names: set[str]
    ) -> dict[str, Any] | None:
        """Returns the theme schema to write, or None if there is none."""
        if self.theme_location is None:
            return None
        if self.theme_model is not None:
            return derived_theme
        if not self.theme_schema and self.theme_location not in ("theme", "$defs"):
            return None
        if self._layout.theme_from_document:
            return copy.deepcopy(self.theme_schema)
        return cast(
            dict[str, Any],
            _externalize_refs(self.theme_schema, common_names, self.common_types_uri),
        )

    def _derive_model_entries(
        self, functions: Mapping[str, FunctionApi]
    ) -> "_DerivedEntries":
        """Derives the document entries of model-defined entries and theme.

        The schemas are those of `validation_schema`, before common types are
        bundled, with their references to common types pointed back at
        `common_types_uri`. A v0.8 component or theme model is written in the
        v0.8 document shape, whose nested objects are inline.

        Args:
            functions: The functions `to_json` declares.

        Returns:
            The derived entries, by name, and the defs they may reference.
        """
        model_components = [
            name
            for name, comp in self.components.items()
            if not _is_authored_component(comp)
        ]
        model_functions = [
            name for name, fn in functions.items() if not _is_authored_function(fn)
        ]
        derives = bool(model_components or model_functions or self.theme_model)
        try:
            protocol_version = self._protocol_version_enum()
        except A2uiCatalogError:
            if derives:
                raise
            # Authored entries are written as they are, whatever the version.
            return _DerivedEntries({}, {}, {}, None, set(self.common_types_defs))
        common_types_version = (
            ProtocolVersion.V0_9
            if protocol_version is ProtocolVersion.V0_8
            else protocol_version
        )
        common_names = {
            *get_common_types_schema_map(common_types_version)["$defs"],
            *self._common_types_defs_for(protocol_version),
        }
        if not derives:
            return _DerivedEntries({}, {}, {}, None, common_names)

        assembled, _, _, _ = self._assemble_schema()
        assembled_defs: dict[str, Any] = assembled.get("$defs", {})
        own = {*self.defs, *(n for n in assembled_defs if n not in common_names)}
        common = common_names - own

        def unbundled(node: Any) -> Any:
            return _externalize_refs(node, common, self.common_types_uri)

        components = {}
        assembled_components: dict[str, Any] = assembled.get("components", {})
        for name in model_components:
            comp = self.components[name]
            model_class = getattr(comp, "model_class", None)
            if protocol_version is ProtocolVersion.V0_8 and model_class is not None:
                components[name] = v08_document_schema(model_class, component=True)
                continue
            schema = unbundled(assembled_components.get(name, {}))
            properties = schema.get("properties")
            if getattr(comp, "model_class", None) is not None and isinstance(
                properties, dict
            ):
                # The message envelope, not the catalog, declares a
                # component's `id`.
                properties.pop("id", None)
                if isinstance(schema.get("required"), list):
                    schema["required"] = [r for r in schema["required"] if r != "id"]
            if comp.allowed_parents is not None:
                schema.setdefault("allowedParents", list(comp.allowed_parents))
            if comp.allowed_children is not None:
                schema.setdefault("allowedChildren", list(comp.allowed_children))
            components[name] = schema

        v1 = is_at_least_version(protocol_version, ProtocolVersion.V1_0)
        function_docs: dict[str, Any] = {}
        assembled_functions: dict[str, Any] = assembled.get("functions", {})
        for name in model_functions:
            schema = unbundled(assembled_functions.get(name, {}))
            function_docs[name] = _function_document(functions[name], schema, v1)

        theme: dict[str, Any] | None = None
        if self.theme_model is not None:
            if protocol_version is ProtocolVersion.V0_8:
                theme = v08_document_schema(self.theme_model, component=False)
            elif isinstance(assembled_defs.get("theme"), dict):
                theme = unbundled(assembled_defs["theme"])
        defs = {
            name: unbundled(schema)
            for name, schema in assembled_defs.items()
            if name in own
            and name not in _UNION_DEFS
            and name != "theme"
            and name not in self.defs
        }
        return _DerivedEntries(components, function_docs, defs, theme, common_names)

    # ==========================================================================
    # Lookups
    # ==========================================================================

    def get_component(self, name: str) -> TComponent | None:
        """Directly retrieves a component by name."""
        return self.components.get(name)

    @property
    def component_ref_map(self) -> dict[str, ComponentRefSpec]:
        """Returns the pre-analyzed component reference map for all components in this catalog."""
        if not hasattr(self, "_component_ref_map") or self._component_ref_map is None:
            self._component_ref_map = build_component_ref_map(self)
        return self._component_ref_map

    def get_component_ref_spec(self, name: str) -> ComponentRefSpec | None:
        """Directly retrieves the pre-analyzed ComponentRefSpec for a component by name."""
        return self.component_ref_map.get(name)

    def get_function(self, name: str) -> TFunction | None:
        """Directly retrieves a function by name."""
        if not name:
            return None
        return (
            self.functions.get(name)
            or self.functions.get(name[0].lower() + name[1:])
            or self.functions.get(name[0].upper() + name[1:])
        )

    def get_theme_schema(self) -> dict[str, Any]:
        return self.theme_schema

    # ==========================================================================
    # from_json
    # ==========================================================================

    @classmethod
    def from_json(
        cls,
        catalog_schema: Mapping[str, Any],
        protocol_version: str | None = None,
        catalog_id: str | None = None,
    ) -> "CatalogApi":
        """Constructs a schema-only Catalog from a catalog document.

        Each component and function keeps its definition as the document
        writes it, as its `schema`, and the catalog keeps the document's
        top-level fields, so `to_json` writes the document back.
        `validation_schema` resolves the references for validation.

        Args:
            catalog_schema: Raw catalog JSON Schema document.
            protocol_version: Protocol version, which takes precedence over the
                document's `protocolVersion`. If neither is given, the catalog
                targets `0.9`, the specification's default.
            catalog_id: Catalog identifier, which takes precedence over the
                document's `catalogId` and is required if the document
                declares none (for example the published v0.8 basic catalog).
                `to_json` emits `catalogId` only if the document declared it.

        Returns:
            A schema-only catalog.

        Raises:
            A2uiCatalogError: If the document has no catalog id or is
                malformed.
        """
        catalog_id = catalog_id or catalog_schema.get("catalogId")
        if not catalog_id:
            raise A2uiCatalogError(
                "catalog_id must be provided or exist in catalog schema."
            )

        document: dict[str, Any] = copy.deepcopy(dict(catalog_schema))
        raw_version = document.get("protocolVersion")
        declared_version = raw_version if isinstance(raw_version, str) else None
        p_ver = protocol_version or declared_version or _DEFAULT_PROTOCOL_VERSION

        components_map = document.get("components", {})
        if not isinstance(components_map, Mapping):
            raise A2uiCatalogError(
                "Catalog 'components' must be an object mapping names to schemas."
            )
        raw_defs = document.get("$defs")
        defs_map: dict[str, Any] = (
            dict(raw_defs) if isinstance(raw_defs, Mapping) else {}
        )
        permitted_names = _union_member_names(
            defs_map.get("anyComponent"), "#/components/"
        )
        permitted_func_names = _union_member_names(
            defs_map.get("anyFunction"), "#/functions/"
        )

        validate_identifiers = is_at_least_version(p_ver, ProtocolVersion.V1_0)

        components = []
        for name, schema in components_map.items():
            if not isinstance(schema, Mapping):
                raise A2uiCatalogError(
                    f"Component '{name}' schema must be a JSON schema object, got"
                    f" {type(schema)}."
                )
            if validate_identifiers and not is_valid_uax31_identifier(name):
                raise A2uiCatalogError(
                    f"Invalid UAX #31 component identifier: '{name}'"
                )
            if validate_identifiers and isinstance(schema.get("properties"), Mapping):
                for prop_name in schema["properties"]:
                    if not is_valid_uax31_identifier(prop_name):
                        raise A2uiCatalogError(
                            f"Invalid UAX #31 property identifier: '{prop_name}' in"
                            f" component '{name}'"
                        )

            if not permitted_names or name in permitted_names:
                components.append(
                    ComponentApi(
                        name,
                        dict(schema),
                        allowed_parents=schema.get("allowedParents"),
                        allowed_children=schema.get("allowedChildren"),
                        from_document=True,
                    )
                )

        functions = []
        for name, spec in _function_entries(document.get("functions"), catalog_id):
            if validate_identifiers and not is_valid_uax31_identifier(name):
                raise A2uiCatalogError(f"Invalid UAX #31 function identifier: '{name}'")
            props = (
                spec.get("properties")
                if isinstance(spec.get("properties"), dict)
                else spec.get("parameters")
                if isinstance(spec.get("parameters"), dict)
                else None
            )
            if validate_identifiers and isinstance(props, dict):
                for arg_name in props:
                    if not is_valid_uax31_identifier(arg_name):
                        raise A2uiCatalogError(
                            f"Invalid UAX #31 argument identifier: '{arg_name}' in"
                            f" function '{name}'"
                        )

            if not permitted_func_names or name in permitted_func_names:
                fn_description = spec.get("description")
                functions.append(
                    FunctionApi(
                        name=name,
                        return_type=_declared_return_type(spec),
                        schema=spec,
                        allowed_callers=spec.get("allowedCallers"),
                        requires_user_activation=spec.get("requiresUserActivation"),
                        description=(
                            fn_description if isinstance(fn_description, str) else None
                        ),
                        is_definition=True,
                        from_document=True,
                    )
                )

        # The theme, in the first place a document may write it.
        theme_location: ThemeLocation | None = None
        theme_schema: dict[str, Any] = {}
        styles = document.get("styles")
        if isinstance(document.get("theme"), Mapping):
            theme_location, theme_schema = "theme", dict(document["theme"])
        elif isinstance(styles, Mapping) and styles and not _is_object_schema(styles):
            theme_location = "styles"
            theme_schema = {"type": "object", "properties": dict(styles)}
        elif isinstance(defs_map.get("theme"), Mapping):
            theme_location, theme_schema = "$defs", dict(defs_map.pop("theme"))

        # A union that lists the loaded entries is derived from them; any
        # other union is kept as written.
        union_defs: dict[str, Any | None] = {}
        null_unions: set[str] = set()
        component_union = _component_union([c.name for c in components])
        function_union = _function_union([f.name for f in functions])
        for union_name, derived_union in (
            ("anyComponent", component_union),
            ("anyFunction", function_union),
        ):
            if union_name in defs_map:
                authored = defs_map.pop(union_name)
                union_defs[union_name] = None if authored == derived_union else authored
                if authored is None:
                    null_unions.add(union_name)

        extras = {
            key: value
            for key, value in document.items()
            if key not in _MODELED_DOCUMENT_KEYS
            or (key in _METADATA_KEYS and not isinstance(value, str))
            or (key == "instructions" and not isinstance(value, str))
            or (key == "protocolVersion" and declared_version is None)
            or (key == "theme" and theme_location != "theme")
            or (key == "$defs" and not isinstance(raw_defs, Mapping))
        }
        if theme_location == "styles":
            extras.pop("styles", None)

        def _metadata(key: str) -> str | None:
            value = document.get(key)
            return value if isinstance(value, str) else None

        return CatalogApi(
            catalog_id=catalog_id,
            protocol_version=p_ver,
            components=components,
            functions=functions,
            theme_schema=theme_schema,
            instructions=_metadata("instructions"),
            defs=defs_map,
            schema_dialect=_metadata("$schema"),
            schema_id=_metadata("$id"),
            title=_metadata("title"),
            description=_metadata("description"),
            declared_protocol_version=declared_version,
            declares_catalog_id="catalogId" in document,
            declares_components="components" in document,
            theme_location=theme_location,
            functions_form=(
                None
                if "functions" not in document
                else "list"
                if isinstance(document["functions"], list)
                else "map"
            ),
            union_defs=union_defs,
            extras=extras,
            _layout=_DocumentLayout(
                declares_defs=isinstance(raw_defs, Mapping),
                null_unions=frozenset(null_unions),
                theme_from_document=theme_location is not None,
                defs_from_document=True,
            ),
        )


@dataclass(frozen=True)
class _DocumentLayout:
    """How `Catalog.from_json` records document-originated layout state for `to_json`."""

    declares_defs: bool = False
    null_unions: frozenset[str] = frozenset()
    theme_from_document: bool = False
    defs_from_document: bool = False


@dataclass(frozen=True)
class _DerivedEntries:
    """The document entries `to_json` derives from a catalog's models.

    Attributes:
        components: The model-defined components' entries, by name.
        functions: The entries of functions that are not written as their
            catalog entries, by name.
        defs: The defs the derived entries may reference, such as
            `CatalogComponentCommon`.
        theme: The theme derived from the catalog's theme model, or None.
        common_names: The names of the common types the catalog may
            reference.
    """

    components: dict[str, Any]
    functions: dict[str, Any]
    defs: dict[str, Any]
    theme: dict[str, Any] | None
    common_names: set[str]


def _is_object_schema(node: Mapping[str, Any]) -> bool:
    """Whether a theme is written as an object schema, not a bare property map."""
    return "properties" in node or "allOf" in node or node.get("type") == "object"


def _union_member_names(union: Any, prefix: str) -> set[str]:
    """The entry names that a `oneOf` union lists as `<prefix><name>` refs."""
    names: set[str] = set()
    members = union.get("oneOf") if isinstance(union, Mapping) else None
    for item in members if isinstance(members, list) else []:
        ref = item.get("$ref") if isinstance(item, Mapping) else None
        if isinstance(ref, str) and ref.startswith(prefix):
            names.add(ref.split("/")[-1])
    return names


def _function_entries(raw: Any, catalog_id: str) -> list[tuple[str, dict[str, Any]]]:
    """Returns a catalog document's functions as `(name, schema)` pairs.

    Accepts both forms of `functions`: the map of name to JSON schema used by
    published catalog documents, and the list of `{name, parameters,
    returnType}` definitions used by v0.9 inline catalogs in renderer
    capabilities. A list entry's schema is the entry without its `name`.

    Args:
        raw: The document's `functions` value.
        catalog_id: The catalog's id, for error messages.

    Returns:
        The functions in document order.

    Raises:
        A2uiCatalogError: If `functions` is neither a map nor a list, an
            entry is not an object, or a list entry has no non-empty `name`
            or repeats an earlier entry's `name`.
    """
    if raw is None:
        return []
    entries: list[tuple[str, dict[str, Any]]] = []
    if isinstance(raw, Mapping):
        for name, spec in raw.items():
            if not isinstance(spec, Mapping):
                raise A2uiCatalogError(
                    f"Catalog '{catalog_id}' function '{name}' must be a JSON"
                    f" schema object, got {type(spec).__name__}."
                )
            entries.append((name, dict(spec)))
        return entries
    if isinstance(raw, list):
        seen: set[str] = set()
        for index, entry in enumerate(raw):
            if not isinstance(entry, Mapping):
                raise A2uiCatalogError(
                    f"Catalog '{catalog_id}' function definition {index} must be an"
                    f" object, got {type(entry).__name__}."
                )
            name = entry.get("name")
            if not isinstance(name, str) or not name:
                raise A2uiCatalogError(
                    f"Catalog '{catalog_id}' function definition {index} is missing"
                    " a non-empty 'name' string."
                )
            if name in seen:
                raise A2uiCatalogError(
                    f"Catalog '{catalog_id}' function definition {index} duplicates"
                    f" the name '{name}'."
                )
            seen.add(name)
            entries.append((name, {k: v for k, v in entry.items() if k != "name"}))
        return entries
    raise A2uiCatalogError(
        f"Catalog '{catalog_id}' 'functions' must be an object or a list of"
        f" definitions, got {type(raw).__name__}."
    )


CatalogApi: TypeAlias = Catalog[ComponentApi, FunctionApi]
"""A catalog whose components and functions carry schemas only.

What ``Catalog.from_json`` produces, and what agents work with: they prompt and
validate against signatures but never evaluate a function. A renderer that
evaluates functions needs a catalog of ``FunctionImplementation`` instances
instead.
"""
