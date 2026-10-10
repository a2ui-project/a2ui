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
from typing import Any, Callable, Final, Generic, TypeAlias, cast
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
from ._spec_shape import SpecSchema, SpecShaper
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

# The document every unbundled common types reference points into.
_COMMON_TYPES_DOCUMENT: Final[str] = "common_types.json"

# The `$defs` that a catalog derives from its components and functions.
_UNION_DEFS: Final[tuple[str, str]] = ("anyComponent", "anyFunction")

# Top-level string metadata of a catalog document, which `Catalog` keeps as
# `schema_dialect`, `schema_id`, `title` and `description`.
_METADATA_KEYS: Final[frozenset[str]] = frozenset(
    {"$schema", "$id", "title", "description"}
)

# Top-level catalog document keys that `Catalog` models itself. Any other key
# of an authored document is kept as written.
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


@dataclass(frozen=True)
class _CatalogSource:
    """What a catalog document wrote, beyond its entries, for `to_json`.

    Attributes:
        protocol_version: The `protocolVersion` exactly as declared, or None
            if the document declares none.
        has_components: Whether the document has a `components` key.
        functions_form: `"map"` or `"list"`, as the document wrote
            `functions`, or None if it has no `functions` key.
        defs: The document's `$defs` as written, unions included, or None if
            it has no `$defs` key.
        has_theme: Whether the document has a top-level `theme` key.
        theme: The document's top-level `theme` as written.
        extras: The document's top-level keys that `Catalog` does not model.
        component_names: The components loaded from the document.
        function_names: The functions loaded from the document.
        referenced_defs: The authored `$defs` that the document's entries
            and theme reference, directly or through other `$defs`.
    """

    protocol_version: str | None
    has_components: bool
    functions_form: str | None
    defs: dict[str, Any] | None
    has_theme: bool
    theme: Any
    extras: dict[str, Any]
    component_names: frozenset[str]
    function_names: frozenset[str]
    referenced_defs: frozenset[str]


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


def _externalize_refs(node: Any, common_names: set[str]) -> Any:
    """Points local references to common types back at `common_types.json`.

    Args:
        node: A schema fragment whose references are catalog-local.
        common_names: The common types names to point outside the catalog.

    Returns:
        A copy of `node` in which each `#/$defs/X` reference to a name in
        `common_names` reads `common_types.json#/$defs/X`.
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
                result[key] = f"{_COMMON_TYPES_DOCUMENT}{value}"
            else:
                result[key] = _externalize_refs(value, common_names)
        return result
    if isinstance(node, list):
        return [_externalize_refs(item, common_names) for item in node]
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


TComponent = TypeVar("TComponent", bound=ComponentApi, default=Any, covariant=True)
TFunction = TypeVar("TFunction", bound=FunctionApi, default=Any, covariant=True)


class Catalog(Generic[TComponent, TFunction]):
    """A versioned set of component and function API definitions."""

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
        schema_dialect: str | None = None,
        schema_id: str | None = None,
        title: str | None = None,
        description: str | None = None,
    ):
        """Initializes the catalog.

        Args:
            catalog_id: The catalog's ID.
            protocol_version: The A2UI protocol version the catalog targets.
            components: The catalog's components.
            functions: The catalog's functions.
            theme_schema: The JSON schema of the catalog's theme.
            instructions: Instructions for agents that use the catalog.
            defs: Additional catalog-level `$defs`.
            common_types_defs: Shared type definitions that override the
                built-in common types definitions.
            schema_dialect: The catalog document's `$schema`. `to_json` uses
                JSON Schema 2020-12 for a catalog defined in code without one.
            schema_id: The catalog document's `$id`.
            title: The catalog document's `title`.
            description: The catalog document's `description`.

        Raises:
            A2uiCatalogError: If `protocol_version` is missing or an identifier
                is invalid.
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
        self.defs: dict[str, Any] = copy.deepcopy(defs) if defs else {}
        # Shared type definitions that override the built-in common types
        # definitions derived from the Pydantic schema models, for a catalog
        # that validates against a reduced or customized common types document.
        self.common_types_defs: dict[str, Any] = (
            copy.deepcopy(common_types_defs) if common_types_defs else {}
        )
        self._cached_catalog_schema: dict[str, Any] | None = None
        # What the authored document wrote, for a catalog loaded with
        # `from_json`; None for a catalog defined in code.
        self._source: _CatalogSource | None = None

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

        self.theme_schema = theme_schema or {}
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
        instructions, document metadata and authored document, so `to_json`
        emits what the source document wrote for everything the copy keeps.
        A transformer that changes an entry's schema must pass a new entry
        whose `source_json` is None, so `to_json` serializes the new schema
        rather than the stale authored JSON.

        Args:
            components: The copy's components. None keeps this catalog's.
            functions: The copy's functions. None keeps this catalog's.
            defs: The copy's catalog-level `$defs`. None keeps this catalog's.

        Returns:
            A schema-only catalog.
        """
        derived = CatalogApi(
            catalog_id=self.catalog_id,
            protocol_version=self.protocol_version,
            components=list(
                self.components.values() if components is None else components
            ),
            functions=list(self.functions.values() if functions is None else functions),
            theme_schema=copy.deepcopy(self.theme_schema),
            instructions=self.instructions,
            defs=dict(self.defs if defs is None else defs),
            common_types_defs=self.common_types_defs,
            schema_dialect=getattr(self, "schema_dialect", None),
            schema_id=getattr(self, "schema_id", None),
            title=getattr(self, "title", None),
            description=getattr(self, "description", None),
        )
        derived._source = getattr(self, "_source", None)
        return derived

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

        From v0.9 on, components and functions defined by Pydantic models emit
        the specification's shape: a component composes the defs of its base
        models with `allOf`, and a function schema describes the whole call.
        Other components and functions keep the flat schemas of
        `ComponentApi.schema` and `FunctionApi.schema`. The common types defs
        they reference, transitively, come from the published common types
        schema with local refs; a published def that would reference a def
        the catalog lacks (such as `FunctionCall` in a catalog without
        functions) takes its flat form. System functions, which the runtime
        supplies, are not declared.

        Raises:
            A2uiCatalogError: If the catalog's protocol version is unknown.
        """
        cached = getattr(self, "_cached_catalog_schema", None)
        if cached is not None:
            return copy.deepcopy(cached)
        cleaned_schema, referenced_dynamics, _, protocol_version = (
            self._assemble_schema()
        )

        self._add_published_common_types(
            cleaned_schema,
            referenced_dynamics | _defs_refs(cleaned_schema),
            protocol_version,
        )
        return self._finish_validation_schema(cleaned_schema, protocol_version)

    def _finish_validation_schema(
        self, schema: dict[str, Any], protocol_version: ProtocolVersion
    ) -> dict[str, Any]:
        """Applies the last canonical touches to a validation schema and caches it.

        A `protocolVersion` that the catalog document declared is emitted in
        the bare semantic version form that `catalog_definition.json`
        requires: `v0.9.1` becomes `0.9.1`. Before v1.0, each function a
        catalog document wrote is given the specification's call shape: a
        `returnType` constant, and no properties beyond those it lists, in the
        call or in its `args`. From v1.0, a function entry stays open, since
        `FunctionCall` composes it with `FunctionCommon` (`catalogId`) and
        closes the call itself.
        """
        source = getattr(self, "_source", None)
        if source is not None and source.protocol_version is not None:
            schema["protocolVersion"] = _BARE_VERSION_PREFIX.sub(
                "", source.protocol_version.strip()
            )
        if not is_at_least_version(protocol_version, ProtocolVersion.V1_0):
            for name, entry in (schema.get("functions") or {}).items():
                fn = self.functions.get(name)
                if fn is not None:
                    _close_function_call(entry, fn.return_type)
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
        try:
            protocol_version = to_protocol_version(self.protocol_version)
        except ValueError as e:
            raise A2uiCatalogError(str(e)) from e
        schema: dict[str, Any] = {
            "$schema": _JSON_SCHEMA_DIALECT,
            "catalogId": self.catalog_id,
        }

        if self.instructions:
            schema["instructions"] = self.instructions

        defs: dict[str, Any] = {}
        if self.defs:
            for def_name, def_schema in self.defs.items():
                if def_name not in ("anyComponent", "anyFunction"):
                    defs[def_name] = copy.deepcopy(def_schema)
        if self.theme_schema:
            theme = copy.deepcopy(self.theme_schema)
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
            s = comp.schema
            if isinstance(s, dict) and isinstance(s.get("$defs"), dict):
                for def_name, def_schema in s["$defs"].items():
                    if def_name not in defs:
                        defs[def_name] = def_schema

        flat_functions: dict[str, Any] = {}
        for name, fn in functions.items():
            if name in spec_functions:
                continue
            s = fn.schema
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
                s = comp.schema
                if isinstance(s, dict):
                    s = copy.deepcopy(s)
                    if getattr(comp, "source_json", None) is not None:
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
                    if getattr(functions[name], "source_json", None) is not None:
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

    def _add_published_common_types(
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

    def to_json(self) -> dict[str, Any]:
        """Returns the catalog document, with references left unbundled.

        This is the catalog as an author writes it, and what `from_json`
        reads: for a catalog loaded with `from_json`, `to_json` returns the
        loaded document. References to common types stay external
        (`common_types.json#/$defs/X`) and no common types are copied into
        `$defs`. For the self-contained schema that payloads validate
        against, use `validation_schema`.

        - Top-level metadata (`$schema`, `$id`, `title`, `description`,
          `instructions`) appears only when known. A loaded catalog emits
          `protocolVersion` exactly as its document declared it, and not at
          all if it declared none; a catalog defined in code emits its
          canonical version, such as `1.0`.
        - A component or function with `source_json` emits it unchanged. The
          others (defined in code or changed by a transformer) are
          serialized from their schema: a component has `component:
          {const: <name>}` and its `allowedParents` and `allowedChildren`,
          and a function has the call shape of the protocol version with its
          `description`, `returnType`, `allowedCallers` and
          `requiresUserActivation`. System functions, which the runtime
          supplies, are not declared.
        - `functions` keeps the list form if the loaded document used it.
        - `$defs` keeps the authored definitions, except one that the
          document's entries referenced and that nothing references any
          more. A union (`anyComponent`, `anyFunction`) that the document
          wrote is emitted as written while the catalog has the same
          entries, and is rebuilt otherwise; a loaded document without
          unions does not gain them. A catalog defined in code always emits
          rebuilt unions, both of them from v1.0 on.

        Returns:
            A new document, which the caller may mutate.

        Raises:
            A2uiCatalogError: If an entry needs serializing from its schema
                and the catalog's protocol version is unknown.
        """
        source: _CatalogSource | None = getattr(self, "_source", None)
        # The protocol reserves the `@` namespace for system functions.
        system_names = set(system_functions_for(self.protocol_version))
        functions = {
            name: fn
            for name, fn in self.functions.items()
            if getattr(fn, "source_json", None) is not None
            or not (name in system_names or name.startswith("@"))
        }
        needs_serializing = any(
            getattr(entry, "source_json", None) is None
            for entry in [*self.components.values(), *functions.values()]
        )
        serialized_components: dict[str, Any] = {}
        serialized_functions: dict[str, Any] = {}
        serialized_defs: dict[str, Any] = {}
        if needs_serializing:
            serialized_components, serialized_functions, serialized_defs = (
                self._serialize_unbundled(functions)
            )

        doc: dict[str, Any] = {}
        dialect = getattr(self, "schema_dialect", None)
        if dialect is None and source is None:
            dialect = _JSON_SCHEMA_DIALECT
        if dialect is not None:
            doc["$schema"] = dialect
        for key, attr in (("$id", "schema_id"), ("title", "title")):
            value = getattr(self, attr, None)
            if value is not None:
                doc[key] = value
        description = getattr(self, "description", None)
        if description is not None:
            doc["description"] = description
        doc["catalogId"] = self.catalog_id
        if source is not None:
            version = source.protocol_version
        else:
            version = (
                to_canonical_version(self.protocol_version) or self.protocol_version
            )
        if version is not None:
            doc["protocolVersion"] = version
        if self.instructions is not None:
            doc["instructions"] = self.instructions
        if source is not None:
            doc.update(source.extras)

        components: dict[str, Any] = {}
        for name, comp in self.components.items():
            source_json = getattr(comp, "source_json", None)
            components[name] = (
                source_json if source_json is not None else serialized_components[name]
            )
        if components or (source is not None and source.has_components):
            doc["components"] = components

        function_docs: dict[str, Any] = {}
        for name, fn in functions.items():
            source_json = getattr(fn, "source_json", None)
            function_docs[name] = (
                source_json if source_json is not None else serialized_functions[name]
            )
        functions_form = source.functions_form if source is not None else None
        if function_docs or functions_form is not None:
            if functions_form == "list":
                doc["functions"] = [
                    (
                        {"name": name, **function_docs[name]}
                        if getattr(fn, "source_json", None) is not None
                        else _function_list_entry(fn, function_docs[name])
                    )
                    for name, fn in functions.items()
                ]
            else:
                doc["functions"] = function_docs

        if source is not None and source.has_theme:
            doc["theme"] = source.theme

        defs = self._document_defs(
            doc, source, serialized_defs, list(components), list(function_docs)
        )
        if defs or (source is not None and source.defs is not None):
            doc["$defs"] = defs
        return copy.deepcopy(doc)

    def _serialize_unbundled(
        self, functions: Mapping[str, FunctionApi]
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        """Serializes the entries without `source_json`, unbundled.

        The schemas are those of `validation_schema`, before common types are
        bundled, with their references to common types pointed back at
        `common_types.json`.

        Args:
            functions: The functions `to_json` declares.

        Returns:
            The serialized components and functions without `source_json`, by
            name, and the catalog's own `$defs` they may reference.
        """
        assembled, _, _, protocol_version = self._assemble_schema()
        common_types_version = (
            ProtocolVersion.V0_9
            if protocol_version is ProtocolVersion.V0_8
            else protocol_version
        )
        common_names = {
            *get_common_types_schema_map(common_types_version)["$defs"],
            *self._common_types_defs_for(protocol_version),
        }
        assembled_defs: dict[str, Any] = assembled.get("$defs", {})
        own = {*self.defs, *(n for n in assembled_defs if n not in common_names)}
        source: _CatalogSource | None = getattr(self, "_source", None)
        if source is not None and source.defs:
            own |= set(source.defs)
        common_names -= own

        components: dict[str, Any] = {}
        assembled_components: dict[str, Any] = assembled.get("components", {})
        for name, comp in self.components.items():
            if getattr(comp, "source_json", None) is not None:
                continue
            schema = _externalize_refs(assembled_components.get(name, {}), common_names)
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
        for name, fn in functions.items():
            if getattr(fn, "source_json", None) is not None:
                continue
            schema = _externalize_refs(assembled_functions.get(name, {}), common_names)
            function_docs[name] = _function_document(fn, schema, v1)

        defs = {
            name: _externalize_refs(schema, common_names)
            for name, schema in assembled_defs.items()
            if name in own and name not in _UNION_DEFS
        }
        return components, function_docs, defs

    def _document_defs(
        self,
        doc: Mapping[str, Any],
        source: _CatalogSource | None,
        serialized_defs: Mapping[str, Any],
        component_names: list[str],
        function_names: list[str],
    ) -> dict[str, Any]:
        """Returns the `$defs` of the document `to_json` emits.

        Args:
            doc: The document so far, whose entries and theme are the roots of
                `$defs` references.
            source: What the loaded document wrote, or None for a catalog
                defined in code.
            serialized_defs: The catalog's own `$defs` that serialized entries
                may reference.
            component_names: The components the document declares.
            function_names: The functions the document declares.
        """
        roots = [
            doc.get("components"),
            doc.get("functions"),
            doc.get("theme"),
            *(source.extras.values() if source is not None else ()),
        ]
        defs: dict[str, Any] = {}
        if source is None:
            v1 = is_at_least_version(self.protocol_version, ProtocolVersion.V1_0)
            reachable = _reachable_defs(roots, serialized_defs)
            for name, schema in serialized_defs.items():
                # A v1.0 catalog document has no theme.
                if name == "theme" and v1:
                    continue
                if name in self.defs or name == "theme" or name in reachable:
                    defs[name] = schema
            if component_names or v1:
                defs["anyComponent"] = _component_union(component_names)
            if function_names or v1:
                defs["anyFunction"] = _function_union(function_names)
            return defs

        authored = source.defs or {}
        pool = {
            **serialized_defs,
            **{k: v for k, v in authored.items() if k not in _UNION_DEFS},
        }
        reachable = _reachable_defs(roots, pool)
        for name, schema in authored.items():
            if name == "anyComponent":
                same = set(component_names) == source.component_names
                defs[name] = schema if same else _component_union(component_names)
            elif name == "anyFunction":
                same = set(function_names) == source.function_names
                defs[name] = schema if same else _function_union(function_names)
            elif name not in source.referenced_defs or name in reachable:
                defs[name] = schema
        for name in sorted(reachable - set(authored)):
            defs[name] = pool[name]
        return defs

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

    @classmethod
    def from_json(
        cls,
        catalog_schema: Mapping[str, Any],
        protocol_version: str | None = None,
        catalog_id: str | None = None,
    ) -> "CatalogApi":
        """Constructs a schema-only Catalog from a catalog document.

        The catalog keeps the document as written, so `to_json` returns it
        unchanged, and resolves its references for validation, so
        `validation_schema` is self-contained.

        Args:
            catalog_schema: Raw catalog JSON Schema document.
            protocol_version: Protocol version, which takes precedence over the
                document's `protocolVersion`. If neither is given, the catalog
                targets `0.9`, the specification's default.
            catalog_id: Catalog identifier, if not declared in the schema.

        Returns:
            A schema-only catalog. Its entries carry their authored JSON in
            `source_json`.

        Raises:
            A2uiCatalogError: If the document has no catalog id or is
                malformed.
        """
        catalog_id = catalog_id or catalog_schema.get("catalogId")
        if not catalog_id:
            raise A2uiCatalogError(
                "catalog_id must be provided or exist in catalog_schema."
            )

        # The document as written, before references are localized and
        # inlined, for `to_json`.
        raw_document: dict[str, Any] = copy.deepcopy(dict(catalog_schema))
        raw_version = raw_document.get("protocolVersion")
        declared_version = raw_version if isinstance(raw_version, str) else None
        p_ver = protocol_version or declared_version or _DEFAULT_PROTOCOL_VERSION

        normalized_catalog_schema = _normalize_external_schema_refs(
            dict(catalog_schema)
        )
        inlined_catalog_schema = inline_local_refs(
            normalized_catalog_schema, normalized_catalog_schema
        )

        components_map = inlined_catalog_schema.get("components", {})
        if not isinstance(components_map, Mapping):
            raise A2uiCatalogError(
                "Catalog 'components' must be an object mapping names to schemas."
            )
        raw_components: Mapping[str, Any] = raw_document.get("components", {})
        raw_functions = dict(
            _function_entries(raw_document.get("functions"), catalog_id)
        )
        any_comp_refs = (
            inlined_catalog_schema.get("$defs", {})
            .get("anyComponent", {})
            .get("oneOf", [])
        )
        permitted_names = set()
        for item in any_comp_refs:
            if isinstance(item, dict):
                ref = item.get("$ref", "")
                if isinstance(ref, str) and ref.startswith("#/components/"):
                    permitted_names.add(ref.split("/")[-1])

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
            if (
                validate_identifiers
                and isinstance(schema, dict)
                and "properties" in schema
                and isinstance(schema["properties"], dict)
            ):
                for prop_name in schema["properties"]:
                    if not is_valid_uax31_identifier(prop_name):
                        raise A2uiCatalogError(
                            f"Invalid UAX #31 property identifier: '{prop_name}' in"
                            f" component '{name}'"
                        )

            if not permitted_names or name in permitted_names:
                allowed_parents = (
                    schema.get("allowedParents") if isinstance(schema, dict) else None
                )
                allowed_children = (
                    schema.get("allowedChildren") if isinstance(schema, dict) else None
                )
                components.append(
                    ComponentApi(
                        name,
                        schema,
                        allowed_parents=allowed_parents,
                        allowed_children=allowed_children,
                        source_json=raw_components.get(name),
                    )
                )

        functions = []
        function_entries = _function_entries(
            inlined_catalog_schema.get("functions"), catalog_id
        )
        any_func_refs = (
            inlined_catalog_schema.get("$defs", {})
            .get("anyFunction", {})
            .get("oneOf", [])
        )
        permitted_func_names = set()
        for item in any_func_refs:
            if isinstance(item, dict):
                ref = item.get("$ref", "")
                if isinstance(ref, str) and ref.startswith("#/functions/"):
                    permitted_func_names.add(ref.split("/")[-1])

        for name, spec in function_entries:
            if validate_identifiers and not is_valid_uax31_identifier(name):
                raise A2uiCatalogError(f"Invalid UAX #31 function identifier: '{name}'")
            spec_dict = spec
            props = (
                spec_dict.get("properties")
                if isinstance(spec_dict.get("properties"), dict)
                else spec_dict.get("parameters")
                if isinstance(spec_dict.get("parameters"), dict)
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
                functions.append(
                    FunctionApi(
                        name=name,
                        return_type=_declared_return_type(spec_dict),
                        schema=spec,
                        allowed_callers=spec_dict.get("allowedCallers"),
                        requires_user_activation=spec_dict.get(
                            "requiresUserActivation"
                        ),
                        source_json=raw_functions.get(name),
                    )
                )

        raw_defs = raw_document.get("$defs")
        authored_defs = (
            {k: v for k, v in raw_defs.items() if k not in _UNION_DEFS}
            if isinstance(raw_defs, Mapping)
            else {}
        )
        raw_functions_value = raw_document.get("functions")
        source = _CatalogSource(
            protocol_version=declared_version,
            has_components="components" in raw_document,
            functions_form=(
                None
                if raw_functions_value is None
                else "list"
                if isinstance(raw_functions_value, list)
                else "map"
            ),
            defs=dict(raw_defs) if isinstance(raw_defs, Mapping) else None,
            has_theme="theme" in raw_document,
            theme=raw_document.get("theme"),
            extras={
                k: v
                for k, v in raw_document.items()
                if k not in _MODELED_DOCUMENT_KEYS
                or (k in _METADATA_KEYS and not isinstance(v, str))
            },
            component_names=frozenset(c.name for c in components),
            function_names=frozenset(f.name for f in functions),
            referenced_defs=frozenset(
                _reachable_defs(
                    [
                        raw_components,
                        raw_functions_value,
                        raw_document.get("theme"),
                    ],
                    authored_defs,
                )
            ),
        )

        def _metadata(key: str) -> str | None:
            value = raw_document.get(key)
            return value if isinstance(value, str) else None

        # `validation_schema` merges in the built-in common types defs.
        catalog = CatalogApi(
            catalog_id=catalog_id,
            protocol_version=p_ver,
            components=components,
            functions=functions,
            theme_schema=inlined_catalog_schema.get("theme")
            or inlined_catalog_schema.get("$defs", {}).get("theme")
            or {},
            instructions=inlined_catalog_schema.get("instructions"),
            defs=inlined_catalog_schema.get("$defs"),
            schema_dialect=_metadata("$schema"),
            schema_id=_metadata("$id"),
            title=_metadata("title"),
            description=_metadata("description"),
        )
        catalog._source = source
        return catalog


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
        A2uiCatalogError: If `functions` is neither a map nor a list, or an
            entry is not an object or a list entry has no non-empty `name`.
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
