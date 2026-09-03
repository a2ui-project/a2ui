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

from collections.abc import Mapping, Sequence
import copy
import re
import sys
from typing import Any, Callable, Final, Generic, cast

if sys.version_info >= (3, 13):
    from typing import TypeVar
else:
    from typing_extensions import TypeVar
from pydantic import BaseModel, TypeAdapter


def _generate_dynamic_type_def(type_cls: Any) -> dict[str, Any]:
    raw_schema = TypeAdapter(type_cls).json_schema()
    if "$defs" in raw_schema:
        del raw_schema["$defs"]
    if "title" in raw_schema:
        del raw_schema["title"]
    if "description" in raw_schema:
        del raw_schema["description"]
    if "anyOf" in raw_schema:
        items = raw_schema["anyOf"]
        has_num = any(
            isinstance(it, dict) and it.get("type") == "number" for it in items
        )
        if has_num:
            items = [
                it
                for it in items
                if not (isinstance(it, dict) and it.get("type") == "integer")
            ]
        raw_schema["oneOf"] = items
        del raw_schema["anyOf"]
    return raw_schema


def _get_dynamic_types_defs() -> dict[str, Any]:
    from ..schema.common_types import (
        DataBinding,
        DynamicBoolean,
        DynamicNumber,
        DynamicString,
        FunctionCall,
    )
    from ..schema.v1_0.common_types import DynamicValue

    return {
        "ComponentId": {
            "description": (
                "The unique identifier for a component, used for both"
                " definitions and references within the same surface."
            ),
            "type": "string",
        },
        "DynamicString": _generate_dynamic_type_def(DynamicString),
        "DynamicNumber": _generate_dynamic_type_def(DynamicNumber),
        "DynamicBoolean": _generate_dynamic_type_def(DynamicBoolean),
        "DynamicValue": _generate_dynamic_type_def(DynamicValue),
        "DataBinding": _generate_dynamic_type_def(DataBinding),
        "FunctionCall": _generate_dynamic_type_def(FunctionCall),
    }


from ..exceptions import A2uiCatalogError
from .functions import (
    AllowedCallers,
    FunctionApi,
    FunctionImplementation,
    FunctionReturnType,
    create_function_implementation,
)
from .components import ComponentApi, ComponentImplementation, ModelComponentApi
from .reference_map import ComponentRefSpec, build_component_ref_map


def is_valid_uax31_identifier(name: str) -> bool:
    """Validates whether a string conforms to UAX #31 / system identifier syntax."""
    if not name:
        return False
    test_name = name[1:] if name.startswith("@") else name
    return test_name.isidentifier()


def _is_version_at_least_1_0(protocol_version: str | Any) -> bool:
    """Returns True if the protocol version is 1.0 or higher (e.g. v1.0, v1.1, v2.0)."""
    ver_str = str(protocol_version).strip().lstrip("vV").replace("_", ".")
    parts = ver_str.split(".")
    try:
        major = int(parts[0])
        return major >= 1
    except (ValueError, IndexError):
        return False


def load_preserved_type_refs() -> set[str]:
    """Dynamically loads all common type names defined in schema/common_types.py and versioned submodules."""
    import importlib
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
            raw_ver = str(ver_enum.value).lstrip("vV")
            major_minor = "_".join(raw_ver.split(".")[:2])
            mod_name = f"{schema_pkg.__name__}.v{major_minor}.common_types"
            if mod_name not in modules_to_check:
                modules_to_check.append(mod_name)

    type_refs: set[str] = set()
    for modname in modules_to_check:
        try:
            mod = importlib.import_module(modname)
            for attr in dir(mod):
                if not attr.startswith("_") and attr not in excluded:
                    type_refs.add(attr)
        except ImportError:
            pass

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


def inline_local_refs(
    node: Any, root_catalog: Mapping[str, Any], visited: set[str] | None = None
) -> Any:
    """Recursively inlines local JSON references (pointers starting with '#/') into schema objects."""
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


def _is_ref(item: Any, target_ref: str) -> bool:
    return isinstance(item, dict) and item.get("$ref") == target_ref


def _is_type(item: Any, target_type: str) -> bool:
    return isinstance(item, dict) and item.get("type") == target_type


def _clean_schema_node(
    node: Any,
    referenced_dynamics: set[str] | None = None,
    is_properties_dict: bool = False,
    is_union_container: bool = False,
) -> Any:
    """Recursively cleans auto-generated Pydantic schema attributes (titles, null types, redundant anyOf wrappers, dynamic value expansions)."""
    if referenced_dynamics is None:
        referenced_dynamics = set()

    if isinstance(node, dict):
        cleaned = {}
        for k, v in node.items():
            if k == "title" and not is_properties_dict:
                continue
            cleaned[k] = _clean_schema_node(
                v,
                referenced_dynamics=referenced_dynamics,
                is_properties_dict=(k == "properties"),
                is_union_container=(k in ("anyComponent", "anyFunction")),
            )

        if (
            "$ref" in cleaned
            and isinstance(cleaned["$ref"], str)
            and cleaned["$ref"].startswith("#/$defs/")
        ):
            ref_target = cleaned["$ref"].split("/")[-1]
            referenced_dynamics.add(ref_target)

        if "default" in cleaned and cleaned["default"] is None:
            del cleaned["default"]

        union_key = (
            "anyOf" if "anyOf" in cleaned else ("oneOf" if "oneOf" in cleaned else None)
        )
        if union_key and isinstance(cleaned[union_key], list):
            items = [
                item
                for item in cleaned[union_key]
                if not (isinstance(item, dict) and item.get("type") == "null")
            ]
            if len(items) == 1 and not is_union_container:
                single_item = items[0]
                parent_attrs = {k: v for k, v in cleaned.items() if k != union_key}
                if isinstance(single_item, dict):
                    merged = dict(single_item)
                    for k, v in parent_attrs.items():
                        if k not in merged:
                            merged[k] = v
                    return _clean_schema_node(
                        merged,
                        referenced_dynamics=referenced_dynamics,
                        is_properties_dict=False,
                    )
                else:
                    return single_item
            else:
                has_databinding = any(
                    _is_ref(it, "#/$defs/DataBinding") for it in items
                )
                has_func_call = any(_is_ref(it, "#/$defs/FunctionCall") for it in items)
                if has_databinding and has_func_call:
                    str_type = any(_is_type(it, "string") for it in items)
                    num_type = any(
                        _is_type(it, "number") or _is_type(it, "integer")
                        for it in items
                    )
                    bool_type = any(_is_type(it, "boolean") for it in items)
                    array_or_obj = any(
                        isinstance(it, dict)
                        and (
                            it.get("type") in ("array", "object")
                            or "additionalProperties" in it
                        )
                        for it in items
                    )

                    types_count = sum([str_type, num_type, bool_type, array_or_obj])

                    target_def = None
                    if types_count > 1:
                        target_def = "DynamicValue"
                    elif str_type:
                        target_def = "DynamicString"
                    elif num_type:
                        target_def = "DynamicNumber"
                    elif bool_type:
                        target_def = "DynamicBoolean"
                    else:
                        target_def = "DynamicValue"

                    if target_def:
                        referenced_dynamics.add(target_def)
                        parent_attrs = {
                            k: v for k, v in cleaned.items() if k != union_key
                        }
                        res = {"$ref": f"#/$defs/{target_def}"}
                        res.update(parent_attrs)
                        return res

                if union_key == "anyOf":
                    del cleaned["anyOf"]
                    cleaned["oneOf"] = items
                else:
                    cleaned["oneOf"] = items

        return cleaned
    elif isinstance(node, list):
        return [
            _clean_schema_node(
                item,
                referenced_dynamics=referenced_dynamics,
                is_properties_dict=False,
            )
            for item in node
        ]
    return node


TComponent = TypeVar("TComponent", bound=ComponentApi, default=Any)
TFunction = TypeVar("TFunction", bound=FunctionApi, default=Any)


class Catalog(Generic[TComponent, TFunction]):
    """A versioned set of component and function API definitions."""

    def __init__(
        self,
        catalog_id: str,
        protocol_version: str | None = None,
        components: list[TComponent] | None = None,
        functions: list[TFunction] | None = None,
        theme_schema: dict[str, Any] | None = None,
        instructions: str | None = None,
    ):
        if not protocol_version:
            raise ValueError("protocol_version must be provided.")
        self.catalog_id = catalog_id
        self.protocol_version = protocol_version
        self.instructions = instructions

        validate_identifiers = _is_version_at_least_1_0(protocol_version)

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
        """Dynamically reconstructs the unified catalog JSON Schema on the fly."""
        schema: dict[str, Any] = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "catalogId": self.catalog_id,
        }

        if self.instructions:
            schema["instructions"] = self.instructions

        defs: dict[str, Any] = {}
        if self.theme_schema:
            defs["theme"] = self.theme_schema

        if self.components:
            for comp in self.components.values():
                s = comp.schema
                if (
                    isinstance(s, dict)
                    and "$defs" in s
                    and isinstance(s["$defs"], dict)
                ):
                    for def_name, def_schema in s["$defs"].items():
                        if def_name not in defs:
                            defs[def_name] = def_schema

        if self.functions:
            for fn in self.functions.values():
                s = fn.schema
                if isinstance(s, type) and hasattr(s, "model_json_schema"):
                    s = s.model_json_schema()
                if (
                    isinstance(s, dict)
                    and "$defs" in s
                    and isinstance(s["$defs"], dict)
                ):
                    for def_name, def_schema in s["$defs"].items():
                        if def_name not in defs:
                            defs[def_name] = def_schema

        if self.components:
            comp_schemas: dict[str, Any] = {}
            for name, comp in self.components.items():
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

        if self.functions:
            fn_schemas: dict[str, Any] = {}
            for name, fn in self.functions.items():
                s = fn.schema
                if isinstance(s, type) and hasattr(s, "model_json_schema"):
                    s = s.model_json_schema()
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

        if self.functions:
            any_fn_refs = [
                {"$ref": f"#/functions/{name}"} for name in self.functions.keys()
            ]
            defs["anyFunction"] = {
                "oneOf": any_fn_refs,
            }

        if defs:
            schema["$defs"] = defs

        referenced_dynamics: set[str] = set()
        cleaned_schema = cast(
            dict[str, Any],
            _clean_schema_node(schema, referenced_dynamics=referenced_dynamics),
        )

        if referenced_dynamics:
            if "$defs" not in cleaned_schema:
                cleaned_schema["$defs"] = {}
            if any(
                d in referenced_dynamics
                for d in (
                    "DynamicString",
                    "DynamicNumber",
                    "DynamicBoolean",
                    "DynamicValue",
                )
            ):
                referenced_dynamics.add("DataBinding")
                referenced_dynamics.add("FunctionCall")
            dynamic_defs = _get_dynamic_types_defs()
            for dyn in sorted(referenced_dynamics):
                if dyn in dynamic_defs:
                    if dyn not in cleaned_schema["$defs"]:
                        cleaned_schema["$defs"][dyn] = dynamic_defs[dyn]
                    elif isinstance(cleaned_schema["$defs"][dyn], dict) and isinstance(
                        dynamic_defs[dyn], dict
                    ):
                        cleaned_schema["$defs"][dyn] = {
                            **dynamic_defs[dyn],
                            **cleaned_schema["$defs"][dyn],
                        }

        return cleaned_schema

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
    ) -> "Catalog[ComponentApi, FunctionApi]":
        """Constructs a schema-only Catalog directly from raw JSON Schema."""
        catalog_id = catalog_id or catalog_schema.get("catalogId")
        if not catalog_id:
            raise A2uiCatalogError(
                "catalog_id must be provided or exist in catalog_schema."
            )

        p_ver = protocol_version or catalog_schema.get("protocolVersion")
        if not p_ver:
            raise ValueError("protocol_version must be provided.")

        inlined_catalog_schema = inline_local_refs(catalog_schema, catalog_schema)

        components_map = inlined_catalog_schema.get("components", {})
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

        components = []
        for name, schema in components_map.items():
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
                if not permitted_func_names or name in permitted_func_names:
                    spec_dict = spec if isinstance(spec, dict) else {}
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

        cat = Catalog[ComponentApi, FunctionApi](
            catalog_id=catalog_id,
            protocol_version=p_ver,
            components=components,
            functions=functions,
            theme_schema=inlined_catalog_schema.get("theme")
            or inlined_catalog_schema.get("$defs", {}).get("theme")
            or {},
            instructions=inlined_catalog_schema.get("instructions"),
        )
        return cat
