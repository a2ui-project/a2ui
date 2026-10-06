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
import re
import sys
from typing import Any, Callable, Final, Generic, TypeAlias, cast

if sys.version_info >= (3, 13):
    from typing import TypeVar
else:
    from typing_extensions import TypeVar
from pydantic import BaseModel

from ..common.semver import is_at_least_version, parse_semver, to_protocol_version
from ..common.uax31 import (
    assert_uax31_identifier as assert_uax31_identifier,
    is_valid_uax31_identifier as is_valid_uax31_identifier,
)
from ..exceptions import A2uiCatalogError
from ..schema import ProtocolVersion
from ..schema._dynamic_types import clean_schema_node
from ..schema._json_schema import INLINE_DEF_MARKER, inline_marked_defs
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

        Raises:
            A2uiCatalogError: If `protocol_version` is missing or an identifier
                is invalid.
        """
        if not protocol_version:
            raise A2uiCatalogError("protocol_version must be provided.")
        self.catalog_id = catalog_id
        self.protocol_version = protocol_version
        self.instructions = instructions
        self.defs: dict[str, Any] = copy.deepcopy(defs) if defs else {}
        # Shared type definitions that override the built-in common types
        # definitions derived from the Pydantic schema models, for a catalog
        # that validates against a reduced or customized common types document.
        self.common_types_defs: dict[str, Any] = (
            copy.deepcopy(common_types_defs) if common_types_defs else {}
        )
        self._cached_catalog_schema: dict[str, Any] | None = None

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

    @property
    def catalog_schema(self) -> dict[str, Any]:
        """Dynamically reconstructs the unified catalog JSON Schema on the fly.

        From v0.9 on, components and functions defined by Pydantic models emit
        the specification's shape: a component composes the defs of its base
        models with `allOf`, and a function schema describes the whole call.
        The common types defs they reference, transitively, then come from the
        published common types schema with local refs. Other components and
        functions keep the flat schemas of `ComponentApi.schema` and
        `FunctionApi.schema` and the flat common types defs. System functions,
        which the runtime supplies, are not declared.
        """
        cached = getattr(self, "_cached_catalog_schema", None)
        if cached is not None:
            return copy.deepcopy(cached)
        try:
            protocol_version = to_protocol_version(self.protocol_version)
        except ValueError as e:
            raise A2uiCatalogError(str(e)) from e
        schema: dict[str, Any] = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
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
            defs["theme"] = self.theme_schema

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

        if spec_shaped:
            self._add_published_common_types(
                cleaned_schema,
                referenced_dynamics | _defs_refs(cleaned_schema),
                protocol_version,
            )
            self._cached_catalog_schema = copy.deepcopy(cleaned_schema)
            return cleaned_schema

        if referenced_dynamics:
            if "$defs" not in cleaned_schema:
                cleaned_schema["$defs"] = {}
            if referenced_dynamics & dynamic_index.names:
                referenced_dynamics.add("DataBinding")
                referenced_dynamics.add("FunctionCall")
            # Versions without common types (v0.8) fall back to v0.9, as the
            # dynamic type index does.
            common_types_version = (
                ProtocolVersion.V0_9
                if protocol_version is ProtocolVersion.V0_8
                else protocol_version
            )
            dynamic_defs = {
                **get_common_types_catalog_defs(common_types_version),
                **self.common_types_defs,
            }
            queue = deque(referenced_dynamics)
            while queue:
                curr = queue.popleft()
                if curr in dynamic_defs:
                    found_refs: set[str] = set()
                    _collect_defs_refs(dynamic_defs[curr], found_refs)
                    for target in found_refs:
                        if target not in referenced_dynamics:
                            referenced_dynamics.add(target)
                            queue.append(target)

            # The returned schema gets copies, so mutating it leaves this
            # catalog's `common_types_defs` intact.
            for dyn in sorted(referenced_dynamics):
                if dyn in dynamic_defs:
                    if dyn not in cleaned_schema["$defs"]:
                        cleaned_schema["$defs"][dyn] = copy.deepcopy(dynamic_defs[dyn])
                    elif isinstance(cleaned_schema["$defs"][dyn], dict) and isinstance(
                        dynamic_defs[dyn], dict
                    ):
                        cleaned_schema["$defs"][dyn] = {
                            **copy.deepcopy(dynamic_defs[dyn]),
                            **cleaned_schema["$defs"][dyn],
                        }

        self._cached_catalog_schema = copy.deepcopy(cleaned_schema)
        return cleaned_schema

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
        helper models of flat components) use the catalog form.
        """
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
        """Constructs a schema-only Catalog directly from raw JSON Schema.

        Args:
            catalog_schema: Raw catalog JSON Schema document.
            protocol_version: Protocol version, if not declared in the schema.
            catalog_id: Catalog identifier, if not declared in the schema.

        Returns:
            A catalog whose schema is self-contained, with every cross-document
            reference rewritten to a local ``#/$defs/...`` pointer.
        """
        catalog_id = catalog_id or catalog_schema.get("catalogId")
        if not catalog_id:
            raise A2uiCatalogError(
                "catalog_id must be provided or exist in catalog_schema."
            )

        p_ver = protocol_version or catalog_schema.get("protocolVersion")
        if not p_ver:
            raise ValueError("protocol_version must be provided.")

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
                    )
                )

        functions = []
        raw_functions = inlined_catalog_schema.get("functions", {})
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

        if isinstance(raw_functions, dict):
            for name, spec in raw_functions.items():
                if validate_identifiers and not is_valid_uax31_identifier(name):
                    raise A2uiCatalogError(
                        f"Invalid UAX #31 function identifier: '{name}'"
                    )
                spec_dict = spec if isinstance(spec, dict) else {}
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
                            return_type=spec_dict.get("returnType"),
                            schema=spec,
                            allowed_callers=spec_dict.get("allowedCallers"),
                            requires_user_activation=spec_dict.get(
                                "requiresUserActivation"
                            ),
                        )
                    )

        # `catalog_schema` merges in the built-in common types defs.
        return CatalogApi(
            catalog_id=catalog_id,
            protocol_version=p_ver,
            components=components,
            functions=functions,
            theme_schema=inlined_catalog_schema.get("theme")
            or inlined_catalog_schema.get("$defs", {}).get("theme")
            or {},
            instructions=inlined_catalog_schema.get("instructions"),
            defs=inlined_catalog_schema.get("$defs"),
        )


CatalogApi: TypeAlias = Catalog[ComponentApi, FunctionApi]
"""A catalog whose components and functions carry schemas only.

What ``Catalog.from_json`` produces, and what agents work with: they prompt and
validate against signatures but never evaluate a function. A renderer that
evaluates functions needs a catalog of ``FunctionImplementation`` instances
instead.
"""
