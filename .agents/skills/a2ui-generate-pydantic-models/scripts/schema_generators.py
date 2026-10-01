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

"""Pydantic v2 code generators for protocol schema files across A2UI versions."""

import json
import re
from typing import Any
from engine import PYTHON_TYPE_KEY, PydanticCodegen, python_literal
from utils import (
    FILE_HEADER,
    ensure_v_prefix,
    extract_class_names,
    extract_exported_symbols,
    find_common_refs,
    get_base_common_class_names,
    get_base_common_symbols,
    is_dynamic_def,
    is_function_call_branch,
    is_modern_terminology,
    to_pascal_case,
    to_snake_case,
    topological_sort_defs,
    version_to_underscore,
)


# Python type expressions for the `ChildList` union branches, in spec `oneOf` order:
# a static list of component IDs, then a data-bound template.
_CHILD_LIST_BRANCHES: tuple[str, str] = ("list[ComponentId]", "TemplateChildList")


def _describe_type_expr(expr: str, description: Any) -> str:
    """Wraps a type expression so its JSON schema carries a spec description."""
    if not isinstance(description, str) or not description:
        return expr
    return f"Annotated[{expr}, Field(description={description!r})]"


def _common_types_manifest_entry(
    name: str, spec: dict[str, Any], class_names: set[str]
) -> str:
    """Returns the Python expression registered for a def in COMMON_TYPES_DEFS.

    Classes already carry their spec description as a docstring, so they are
    registered as-is. Type aliases (for example `ComponentId`, `CallId`, `Child`,
    `ChildList`, and the `Dynamic*` unions) cannot hold a docstring, so they are
    wrapped in `Annotated[..., Field(description=...)]` using the spec text. This
    lets the runtime JSON schema generator treat every entry uniformly.
    """
    if name in class_names:
        return name

    expr = name
    union_items = spec.get("oneOf")
    if name == "ChildList" and isinstance(union_items, list) and union_items:
        static_branch = _describe_type_expr(
            _CHILD_LIST_BRANCHES[0], union_items[0].get("description")
        )
        expr = " | ".join((static_branch, *_CHILD_LIST_BRANCHES[1:]))
    return _describe_type_expr(expr, spec.get("description"))


# JSON schema keywords that model fields cannot produce: composition, keywords
# that replace Pydantic's own, and annotations such as the specification's
# `returnType`. The model declares them with `SchemaKeywords`.
_SPEC_KEYWORDS: tuple[str, ...] = (
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "unevaluatedProperties",
    "patternProperties",
    "title",
    "allowedParents",
    "returnType",
)

# Keywords a model def may use: those its fields and config produce, and the
# spec keywords it declares (`_check_model_keywords` narrows the composition
# keywords further).
_MODEL_KEYWORDS = frozenset({
    "type",
    "description",
    "properties",
    "required",
    "additionalProperties",
    *_SPEC_KEYWORDS,
})

# Defs that generated catalog components subclass (see `catalog_generators`).
# Components inherit the model config and must stay closed, so these defs
# forbid extra keys even where the spec leaves them open.
_SUBCLASSED_DEFS = frozenset({"ComponentCommon"})

# The base of every generated common types model, which enforces the null and
# required `oneOf` rules of the specification (see `schema/common_types.py`).
_SPEC_BASE_MODEL = "SpecBaseModel"

# The Unicode identifier pattern (UAX #31), which Python's `re` cannot compile.
_IDENTIFIER_KEY_PATTERN = r"^[\p{XID_Start}_][\p{XID_Continue}]*$"

# Reserved single-`@` directive key pattern forbidden on literal objects.
_SINGLE_AT_KEY_PATTERN = "^@([^@]|$)"

# The cross-document reference to the catalog's function union.
_CATALOG_FUNCTIONS_REF_SUFFIX = "catalog.json#/$defs/anyFunction"


def _import_sort_key(name: str) -> tuple[int, str]:
    """Orders imported names as isort does: constants, classes, then functions."""
    if name.isupper():
        return (0, name)
    return (1 if name[0].isupper() else 2, name)


class _ExtraImports:
    """Imports that generated helpers need, rendered only when used."""

    def __init__(self) -> None:
        self.helpers: set[str] = set()
        self.type_alias_type = False

    def render(self) -> str:
        lines = []
        if self.type_alias_type:
            lines.append("from typing_extensions import TypeAliasType")
        if self.helpers:
            names = sorted(self.helpers, key=_import_sort_key)
            line = f"from .._json_schema import {', '.join(names)}"
            if len(line) > 88:
                body = "".join(f"    {name},\n" for name in names)
                line = f"from .._json_schema import (\n{body})"
            lines.append(line)
        return "\n".join(lines)


_STRICT_SCALAR_TYPES: dict[str, str] = {
    "string": "StrictStr",
    "number": "StrictFloat | StrictInt",
    "integer": "StrictInt",
    "boolean": "StrictBool",
}


def _strict_literal_type(branch: dict[str, Any]) -> str:
    """Maps a literal JSON schema branch of a dynamic def to a strict Python type.

    Raises:
        ValueError: If the branch has a shape or keyword that the type would
            not enforce, rather than generating a looser type.
    """
    branch_type = branch.get("type")
    allowed_keys = {"type", "description"}
    if branch_type == "array":
        allowed_keys.add("items")
    elif branch_type == "object":
        allowed_keys.add("additionalProperties")
    unsupported = set(branch) - allowed_keys
    if unsupported or not isinstance(branch_type, str):
        raise ValueError(f"Unsupported literal branch in a dynamic def: {branch}")

    if branch_type in _STRICT_SCALAR_TYPES:
        return _STRICT_SCALAR_TYPES[branch_type]
    if branch_type == "array":
        items = branch.get("items")
        if items is None:
            return "list[Any]"
        if not isinstance(items, dict):
            raise ValueError(f"Unsupported array items in a dynamic def: {items}")
        return f"list[{_strict_literal_type(items)}]"
    if branch_type == "object" and branch.get("additionalProperties", True) is True:
        return "dict[str, Any]"
    raise ValueError(f"Unsupported literal branch in a dynamic def: {branch}")


_FUNCTION_CALL_REF = {"$ref": "#/$defs/FunctionCall"}


def _function_call_branch_return_type(def_name: str, branch: Any) -> str | None:
    """Returns the `returnType` that a dynamic def's function-call branch requires.

    The branch is either a plain `FunctionCall` reference, which constrains
    nothing, or exactly `{"allOf": [<FunctionCall ref>, {"properties":
    {"returnType": {"const": <string>}}}]}`, which `ReturnType` reproduces.

    Raises:
        ValueError: If the branch has any other shape, whose constraints the
            generated type would drop.
    """
    if branch == _FUNCTION_CALL_REF:
        return None
    unsupported = ValueError(f"Unsupported FunctionCall branch in {def_name}: {branch}")
    all_of = branch.get("allOf") if isinstance(branch, dict) else None
    if not (
        isinstance(branch, dict)
        and set(branch) == {"allOf"}
        and isinstance(all_of, list)
        and len(all_of) == 2
        and all_of[0] == _FUNCTION_CALL_REF
        and isinstance(all_of[1], dict)
        and set(all_of[1]) == {"properties"}
    ):
        raise unsupported
    props = all_of[1]["properties"]
    return_type = props.get("returnType") if isinstance(props, dict) else None
    if not (
        set(props) == {"returnType"}
        and isinstance(return_type, dict)
        and set(return_type) == {"const"}
        and isinstance(return_type["const"], str)
    ):
        raise unsupported
    return return_type["const"]


def _local_def_name(ref: Any) -> str | None:
    """Returns the def name of a local `#/$defs/` reference."""
    if isinstance(ref, str) and ref.startswith("#/$defs/"):
        return ref[len("#/$defs/") :]
    return None


def _schema_allows_null(
    schema: Any, defs: dict[str, Any], seen: frozenset[str] = frozenset()
) -> bool:
    """Returns whether a JSON schema accepts `null`.

    Unknown or unsupported keywords count as accepting `null`, so callers only
    reject `null` where the schema certainly does.
    """
    if not isinstance(schema, dict):
        return schema is not False
    if "const" in schema and schema["const"] is not None:
        return False
    if "enum" in schema and None not in schema["enum"]:
        return False
    schema_type = schema.get("type")
    if schema_type is not None:
        types = schema_type if isinstance(schema_type, list) else [schema_type]
        if "null" not in types:
            return False
    def_name = _local_def_name(schema.get("$ref"))
    if def_name is not None and def_name in defs and def_name not in seen:
        if not _schema_allows_null(defs[def_name], defs, seen | {def_name}):
            return False
    for union_key in ("oneOf", "anyOf"):
        branches = schema.get(union_key)
        if isinstance(branches, list) and not any(
            _schema_allows_null(b, defs, seen) for b in branches
        ):
            return False
    all_of = schema.get("allOf")
    if isinstance(all_of, list) and not all(
        _schema_allows_null(b, defs, seen) for b in all_of
    ):
        return False
    return True


def _not_clause_forbidden_keys(name: str, not_clause: Any) -> set[str]:
    """Returns the keys that a `not` clause forbids on its own.

    Only `{"required": [key]}` and an `anyOf` of those are supported: each
    forbids one key, which a key check enforces exactly. Other shapes, such
    as `{"required": [a, b]}` (forbids having both), would need other checks.

    Raises:
        ValueError: If the clause has any other shape.
    """
    unsupported = ValueError(f"Unsupported `not` clause in {name}: {not_clause}")
    if isinstance(not_clause, dict) and set(not_clause) == {"required"}:
        groups = [not_clause]
    elif isinstance(not_clause, dict) and set(not_clause) == {"anyOf"}:
        groups = not_clause["anyOf"]
    else:
        raise unsupported
    if not isinstance(groups, list) or not groups:
        raise unsupported
    keys: set[str] = set()
    for group in groups:
        if not (isinstance(group, dict) and set(group) == {"required"}):
            raise unsupported
        required = group["required"]
        if not (isinstance(required, list) and len(required) == 1):
            raise unsupported
        keys.add(required[0])
    return keys


def _literal_object_forbids_single_at(name: str, branch: dict[str, Any]) -> bool:
    """Returns whether `branch` forbids single-`@` keys via `propertyNames`.

    Raises:
        ValueError: If `branch` uses keywords or a `propertyNames` shape that
            the validator would not enforce.
    """
    if not ({"type", "not"} <= set(branch) <= {"type", "not", "propertyNames"}):
        raise ValueError(f"Unsupported literal object in {name}: {branch}")
    if "propertyNames" not in branch:
        return False
    if branch["propertyNames"] != {"not": {"pattern": _SINGLE_AT_KEY_PATTERN}}:
        raise ValueError(f"Unsupported literal object in {name}: {branch}")
    return True


def _literal_object_validator_code(
    name: str, branch: dict[str, Any], schema_annotation: str
) -> str:
    """Emits the `LiteralObject` type that rejects keys its `not` clause forbids.

    Args:
        name: The union that the literal object belongs to, for error messages.
        branch: The union's `{"type": "object", "not": ...}` branch.
        schema_annotation: An annotation that shapes the type's JSON schema.
    """
    forbids_single_at = _literal_object_forbids_single_at(name, branch)
    forbidden_keys = _not_clause_forbidden_keys(name, branch["not"])
    forbidden_set_repr = (
        "{" + ", ".join(python_literal(k) for k in sorted(forbidden_keys)) + "}"
    )
    single_at_check = (
        f"""
    for k in v.keys():
        if k.startswith("@") and not k.startswith("@@"):
            raise ValueError(
                f"Object in {name} cannot contain unrecognized reserved directive: '{{k}}'"
            )"""
        if forbids_single_at
        else ""
    )
    annotations = [
        "dict[str, Any]",
        "AfterValidator(_validate_literal_object)",
        schema_annotation,
    ]
    return f"""def _validate_literal_object(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError("Expected a dictionary object")
    forbidden = {forbidden_set_repr}
    found = forbidden.intersection(v.keys())
    if found:
        raise ValueError(
            f"Object in {name} cannot contain forbidden properties: {{', '.join(sorted(found))}}"
        ){single_at_check}
    return v

LiteralObject = Annotated[{", ".join(annotations)}]"""


_REJECT_NULL_VALUES_CODE = """def _reject_null_values(value: dict[str, Any]) -> dict[str, Any]:
    nulls = sorted(key for key, item in value.items() if item is None)
    if nulls:
        raise ValueError(f"Values must not be null: {nulls}")
    return value"""


def _wrapper_union_branches(spec: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Returns the branches of a union of single-property wrapper objects.

    Each branch must be a closed object with exactly one property, which it
    requires (for example `Action`'s `{"event": ...}` and
    `{"functionCall": ...}`). Each branch becomes a wrapper model.

    Returns:
        The wrapped property name and the branch, for each branch, or an empty
        list if the def is not such a union.
    """
    branches = spec.get("oneOf")
    if not isinstance(branches, list) or not branches:
        return []
    result = []
    for branch in branches:
        props = branch.get("properties") if isinstance(branch, dict) else None
        if not (
            isinstance(props, dict)
            and len(props) == 1
            and branch.get("type") == "object"
            and branch.get("required") == list(props)
            and branch.get("additionalProperties") is False
        ):
            return []
        result.append((next(iter(props)), branch))
    return result


def generate_common_types(
    version: str,
    common_data: dict[str, Any],
) -> str:
    """Generates common_types.py content dynamically from $defs."""
    codegen = PydanticCodegen(version)
    codegen.allow_inline = False
    # Common types are the protocol's shared vocabulary; a shape the
    # generator cannot express must fail generation, not loosen validation.
    codegen.strict = True
    defs = common_data.get("$defs", {})

    base_symbols = get_base_common_symbols()
    # Dynamic value unions are regenerated per version so their FunctionCall
    # branch binds to the versioned FunctionCall model.
    versioned_symbols = {"ComponentCommon", "DataBinding", "FunctionCall"} | {
        name for name, spec in defs.items() if is_dynamic_def(spec)
    }
    # Any class/type defined in base common_types.py is imported and not repeated in versioned folders
    imports_from_common = [
        s
        for s in base_symbols
        if s not in versioned_symbols
        or (s in versioned_symbols and s not in defs)
        or (
            s == "ComponentCommon"
            and (
                "ComponentCommon" not in defs
                or defs["ComponentCommon"].get("properties", {}).keys() <= {"id"}
            )
        )
        or (
            s == "DataBinding"
            and (
                "DataBinding" not in defs
                or set(defs["DataBinding"].get("properties", {})) == {"path"}
            )
        )
    ]
    imports_from_common.sort()
    import_list_str = "\n".join(f"    {name}," for name in imports_from_common)

    codegen.schema_defaults = True
    # `Surface` declares its `component` const as an ordinary property.
    codegen.skip_component_property = False
    # A required const, such as `IndexSystemFunction.call`, must be present.
    codegen.required_const_default = False

    def _header(
        extra_imports: str = "", extra_typing: frozenset[str] = frozenset()
    ) -> str:
        extra = f"{extra_imports}\n" if extra_imports else ""
        typing_names = {"Annotated", "Any", "Callable", "Final", "Literal", "Union"}
        typing_list = ", ".join(
            sorted(typing_names | extra_typing, key=_import_sort_key)
        )
        return (
            f"{FILE_HEADER}\nfrom typing import {typing_list}\n"
            "from pydantic import (\n    AfterValidator,\n"
            "    BaseModel,\n    Field,\n    ConfigDict,\n    StrictBool,\n"
            "    StrictFloat,\n    StrictInt,\n    StrictStr,\n"
            "    model_serializer,\n)\n"
            f"{extra}from ..common_types import (\n{import_list_str}\n)"
        )

    common_blocks = [_header()]

    # Extra imports the generated helpers need, collected while compiling.
    imports = _ExtraImports()
    # Union aliases that JSON schemas reference by name (see `schema_ref`).
    schema_ref_aliases: dict[str, str] = {}
    # Module-level `JsonSchemaAs` constants, by name, with their schema types
    # and the models whose fields use them.
    schema_as_constants: dict[str, tuple[str, str]] = {}

    # Names of generated symbols other than the defs themselves (helper
    # models, wrapper models, `LiteralObject`), which must not collide with a
    # def, a base symbol or each other.
    claimed_names: set[str] = set()
    # Strict references may target a def or a claimed helper model.
    known_local_refs = set(defs)
    codegen.known_local_refs = known_local_refs

    def _claim_name(name: str) -> None:
        if name in defs or name in base_symbols or name in claimed_names:
            raise ValueError(f"Generated name {name} collides with another symbol")
        claimed_names.add(name)
        known_local_refs.add(name)

    def _is_model_def(def_name: str) -> bool:
        return def_name in get_base_common_class_names() or (
            "properties" in defs.get(def_name, {})
        )

    def _local_ref_name(ref: str) -> str | None:
        return ref.split("#/$defs/", 1)[1] if ref.startswith("#/$defs/") else None

    def _schema_only_type_expr(node: dict[str, Any], field_root: bool = False) -> str:
        """Returns a Python type whose JSON schema is `node` (for `JsonSchemaAs`).

        Raises:
            ValueError: If `node` has keywords that the type cannot express.
        """
        if "$ref" in node:
            ref_name = _local_ref_name(node["$ref"])
            if ref_name is None or len(node) != 1:
                raise ValueError(f"Unsupported $ref in a field schema: {node}")
            if _is_model_def(ref_name):
                return ref_name
            # A union alias is inlined by Pydantic unless it is a named alias.
            imports.type_alias_type = True
            return schema_ref_aliases.setdefault(ref_name, f"_{ref_name}Ref")

        union_keys = [key for key in ("anyOf", "oneOf") if key in node]
        if len(union_keys) > 1 or (
            union_keys and set(node) - {*union_keys, "description"}
        ):
            raise ValueError(f"Unsupported union in a field schema: {node}")
        for union_key in union_keys:
            members = ", ".join(_schema_only_type_expr(b) for b in node[union_key])
            expr = f"Union[{members}]"
            if union_key == "anyOf":
                imports.helpers.add("KeepAnyOf")
                expr = f"Annotated[{expr}, KeepAnyOf()]"
            return expr

        # Only open objects and maps are expressible; anything else would get
        # an empty (accept-all) schema.
        if node.get("type") != "object" or set(node) - {
            "type",
            "description",
            "additionalProperties",
        }:
            raise ValueError(f"Unsupported field schema: {node}")
        add_props = node.get("additionalProperties", True)
        if isinstance(add_props, dict):
            expr = f"dict[str, {_schema_only_type_expr(add_props)}]"
        elif add_props is True:
            imports.helpers.add("OpenObject")
            expr = "OpenObject"
        else:
            raise ValueError(f"Unsupported field schema: {node}")
        # A field's own description is set on the field itself.
        return (
            expr if field_root else _describe_type_expr(expr, node.get("description"))
        )

    def _render_schema_code(node: Any) -> str:
        """Renders a spec fragment as Python code whose `$ref`s are markers.

        A reference to a model def becomes `def_ref(...)`, and one to the
        catalog's function union becomes `catalog_functions()`; the schema
        builder resolves both. An `anyOf` is marked to be kept, since the
        cleaner otherwise rewrites it to `oneOf`.
        """
        if isinstance(node, list):
            return "[" + ", ".join(_render_schema_code(item) for item in node) + "]"
        if not isinstance(node, dict):
            return python_literal(node)
        if isinstance(node.get("$ref"), str):
            ref = node["$ref"]
            if len(node) != 1:
                raise ValueError(f"Unsupported $ref with sibling keywords: {node}")
            ref_name = _local_ref_name(ref)
            if ref_name is not None and ref_name in defs:
                imports.helpers.add("def_ref")
                return f"def_ref({python_literal(ref_name)})"
            if ref.endswith(_CATALOG_FUNCTIONS_REF_SUFFIX):
                imports.helpers.add("catalog_functions")
                return "catalog_functions()"
            raise ValueError(f"Unsupported $ref in a composition: {ref}")
        items = [
            f"{python_literal(k)}: {_render_schema_code(v)}" for k, v in node.items()
        ]
        if "anyOf" in node:
            imports.helpers.add("KEEP_ANY_OF_MARKER")
            items.append("KEEP_ANY_OF_MARKER: True")
        return "{" + ", ".join(items) + "}"

    def _render_keywords_code(
        keywords: dict[str, Any], extra_items: tuple[str, ...] = ()
    ) -> str:
        """Renders a def's top-level keywords, carrying `title` as a spec title."""
        items = list(extra_items)
        for key, value in keywords.items():
            if key == "title":
                imports.helpers.add("SPEC_TITLE_KEY")
                items.append(f"SPEC_TITLE_KEY: {_render_schema_code(value)}")
            else:
                items.append(f"{python_literal(key)}: {_render_schema_code(value)}")
        return "{" + ", ".join(items) + "}"

    def _is_catalog_functions_one_of(spec: dict[str, Any]) -> bool:
        """Returns whether the spec's `oneOf` only selects a catalog function."""
        branches = spec.get("oneOf")
        return (
            isinstance(branches, list)
            and bool(branches)
            and all(
                isinstance(b, dict)
                and set(b) == {"$ref"}
                and str(b["$ref"]).endswith(_CATALOG_FUNCTIONS_REF_SUFFIX)
                for b in branches
            )
        )

    def _is_required_one_of(spec: dict[str, Any]) -> bool:
        """Returns whether the spec's `oneOf` selects between required fields."""
        branches = spec.get("oneOf")
        return (
            isinstance(branches, list)
            and bool(branches)
            and all(isinstance(b, dict) and set(b) == {"required"} for b in branches)
        )

    def _check_model_keywords(name: str, spec: dict[str, Any]) -> None:
        """Raises if a model def uses keywords that nothing would enforce.

        The model validates its fields; `SpecBaseModel` validates a `oneOf`
        of required fields; the catalog validates the
        function a `oneOf` of catalog functions selects. Other composition
        next to `properties` would only be published, so it is rejected, as
        is any keyword outside `_MODEL_KEYWORDS` (for example `default` or
        `minProperties`), and a required property the model does not declare.
        """
        unsupported = sorted(set(spec) - _MODEL_KEYWORDS)
        unsupported += [
            key for key in ("allOf", "anyOf", "not", "patternProperties") if key in spec
        ]
        if spec.get("type", "object") != "object":
            unsupported.append("type")
        if "oneOf" in spec and not (
            _is_required_one_of(spec) or _is_catalog_functions_one_of(spec)
        ):
            unsupported.append("oneOf")
        if spec.get("unevaluatedProperties", False) is not False:
            unsupported.append("unevaluatedProperties")
        if isinstance(spec.get("additionalProperties"), dict):
            unsupported.append("additionalProperties")
        if unsupported:
            raise ValueError(
                f"Unsupported keywords next to properties in {name}: {unsupported}"
            )
        properties = spec.get("properties", {})
        required = spec.get("required", [])
        one_of_required = [
            prop
            for branch in (spec.get("oneOf", []) if _is_required_one_of(spec) else [])
            for prop in branch["required"]
        ]
        declared = set(properties) if isinstance(properties, dict) else set()
        undeclared = sorted((set(required) | set(one_of_required)) - declared)
        if undeclared:
            raise ValueError(f"{name} requires undeclared properties: {undeclared}")

    def _schema_keywords_code(
        name: str, spec: dict[str, Any], inline: bool = False
    ) -> str:
        """Returns the `json_schema_extra` of a model, for keywords its fields lack.

        When the spec declares properties, the model derives them and declares
        the spec's other keywords (see `_SPEC_KEYWORDS`) with `SchemaKeywords`.
        Models forbid extra keys, so Pydantic emits `additionalProperties:
        false`; where the spec leaves it out, it is dropped. Catalogs get the
        same schema, except when a keyword references the catalog's function
        union: that keyword is only published (`spec_only`), and catalogs keep
        the flat model schema.

        Otherwise the spec is pure composition, and the published schema is
        the spec (`replace`), with `$ref`s written as `def_ref` markers.

        `SpecBaseModel` validates a declared `oneOf` of required properties.
        An inline helper model also carries `INLINE_DEF_MARKER`.

        Returns:
            The expression, or an empty string if the model needs none.

        Raises:
            ValueError: If the spec uses keywords that nothing would enforce.
        """
        args: list[str] = []
        if "properties" in spec:
            _check_model_keywords(name, spec)
            keywords = {k: spec[k] for k in _SPEC_KEYWORDS if k in spec}
            if "additionalProperties" not in spec:
                args.append('drop=("additionalProperties",)')
            if _is_catalog_functions_one_of(spec):
                args.append("spec_only=True")
        else:
            if not any(key in spec for key in ("allOf", "anyOf", "oneOf")):
                raise ValueError(f"Unsupported object def without properties: {name}")
            # The description is the model's docstring.
            keywords = {k: v for k, v in spec.items() if k != "description"}
            args += ["spec_only=True", "replace=True"]
        extra_items: tuple[str, ...] = ()
        if inline:
            imports.helpers.add("INLINE_DEF_MARKER")
            extra_items = ("INLINE_DEF_MARKER: True",)
            if not keywords and not args:
                return "{INLINE_DEF_MARKER: True}"
        if not keywords and not args:
            return ""
        if keywords or extra_items:
            args.insert(0, _render_keywords_code(keywords, extra_items))
        imports.helpers.add("SchemaKeywords")
        return f"SchemaKeywords({', '.join(args)})"

    def _with_schema_keywords(model_code: str, keywords_code: str) -> str:
        """Adds a `json_schema_extra` to the model config of `model_code`."""
        if not keywords_code:
            return model_code
        return model_code.replace(
            "model_config = ConfigDict(",
            f"model_config = ConfigDict(json_schema_extra={keywords_code}, ",
            1,
        )

    def _compile_model(
        name: str,
        spec: dict[str, Any],
        inline: bool = False,
        helper_prefix: str | None = None,
        inline_helpers: bool = True,
    ) -> None:
        """Compiles an object def into a model, with helper models for nested objects.

        A nested object property with its own properties becomes a helper model
        named after its parent (or `helper_prefix`) and property, for example
        `ComponentCommonMetadata`. Helper models carry `INLINE_DEF_MARKER`
        unless `inline_helpers` is unset, so schemas put them back inline at
        their references, as the specification does.

        A def that the spec leaves open (no `additionalProperties` and no
        `unevaluatedProperties: false`) allows extra keys, unless generated
        catalog components subclass it (`_SUBCLASSED_DEFS`).

        Raises:
            ValueError: If the def uses keywords that nothing would enforce, or
                a helper model name collides with another symbol.
        """
        if "properties" in spec:
            _check_model_keywords(name, spec)
        model_props: dict[str, Any] = {}
        for prop_name, prop in spec.get("properties", {}).items():
            if (
                isinstance(prop, dict)
                and prop.get("type") == "object"
                and "properties" in prop
            ):
                helper_name = f"{helper_prefix or name}{to_pascal_case(prop_name)}"
                _claim_name(helper_name)
                _compile_model(helper_name, prop, inline=inline_helpers)
                ref: dict[str, Any] = {"$ref": f"#/$defs/{helper_name}"}
                if "description" in prop:
                    ref["description"] = prop["description"]
                prop = ref
            model_props[prop_name] = prop
        model_spec = {**spec, "properties": model_props}
        open_in_spec = (
            "additionalProperties" not in spec
            and spec.get("unevaluatedProperties") is not False
        )
        if open_in_spec and name not in _SUBCLASSED_DEFS:
            model_spec["additionalProperties"] = True
        model_code = codegen.compile_object_def(
            name, model_spec, base_class=_SPEC_BASE_MODEL
        )
        common_blocks.append(
            _with_schema_keywords(
                model_code, _schema_keywords_code(name, spec, inline)
            ).rstrip()
        )

    def _pattern_keyed_object_code(name: str, spec: dict[str, Any]) -> str:
        """Emits a named object type whose keys must match `patternProperties`.

        Only the Unicode identifier pattern with unconstrained values is
        supported, which is what the specification uses (`Extensions`). The
        pattern is published as is, in catalogs too; the SDK's JSON schema
        validator supports its `\\p{...}` classes.
        """
        patterns = spec["patternProperties"]
        if (
            set(patterns) != {_IDENTIFIER_KEY_PATTERN}
            or patterns[_IDENTIFIER_KEY_PATTERN] != {}
            or spec.get("additionalProperties") is not False
        ):
            raise ValueError(f"Unsupported patternProperties in {name}: {patterns}")
        imports.type_alias_type = True
        imports.helpers |= {"SchemaKeywords", "OpenObject", "is_identifier_key"}
        validator = f"_validate_{to_snake_case(name)}_keys"
        keywords = {
            "patternProperties": patterns,
            "additionalProperties": False,
        }
        return (
            f"def {validator}(value: dict[str, Any]) -> dict[str, Any]:\n"
            "    invalid = sorted(key for key in value if not is_identifier_key(key))\n"
            "    if invalid:\n"
            "        raise ValueError(\n"
            f'            f"{name} keys must be Unicode identifiers: {{invalid}}"\n'
            "        )\n"
            "    return value\n\n\n"
            f"{name} = TypeAliasType(\n"
            f"    {python_literal(name)},\n"
            "    Annotated[\n"
            "        OpenObject,\n"
            f"        AfterValidator({validator}),\n"
            f"        SchemaKeywords({_render_schema_code(keywords)}),\n"
            "    ],\n"
            ")"
        )

    def _check_def_keywords(name: str, spec: dict[str, Any], allowed: set[str]) -> None:
        unsupported = set(spec) - allowed
        if unsupported:
            raise ValueError(f"Unsupported keywords in {name}: {sorted(unsupported)}")

    # Dynamic compilation from $defs:
    processed: set[str] = set(imports_from_common)

    def _compile_wrapper_union(
        name: str, spec: dict[str, Any], branches: list[tuple[str, dict[str, Any]]]
    ) -> None:
        """Compiles a union of single-property wrapper objects (e.g. `Action`).

        Each branch becomes a model named `<Name><Property>Wrapper`, and a
        nested object it wraps becomes a model named `<Name><Property>`, for
        example `ActionEventWrapper` and `ActionEvent`. These are separate defs
        in catalogs, which reference them.

        Raises:
            ValueError: If the def has keywords next to its `oneOf`, or a
                generated name collides with another symbol.
        """
        _check_def_keywords(name, spec, {"description", "oneOf"})
        members = []
        for prop_name, branch in branches:
            wrapper_name = f"{name}{to_pascal_case(prop_name)}Wrapper"
            _claim_name(wrapper_name)
            _compile_model(
                wrapper_name, branch, helper_prefix=name, inline_helpers=False
            )
            members.append(wrapper_name)
        # A named alias, so a field's JSON schema references the def by name
        # as the specification does, instead of inlining the union.
        imports.type_alias_type = True
        common_blocks.append(
            f"{name} = TypeAliasType({python_literal(name)}, {' | '.join(members)})"
        )

    def _compile_function_call(spec: dict[str, Any]) -> None:
        """Compiles `FunctionCall` into a flat model.

        The model is flattened so any function call validates without the
        catalog. The spec's composition keywords are declared with
        `SchemaKeywords` and its precise `args` shape with `JsonSchemaAs`
        instead. A spec that
        composes `FunctionCall` with `allOf` (v1.0) takes its envelope
        properties from the def its `allOf` references.

        Raises:
            ValueError: If the spec has no properties and its `allOf` does not
                reference exactly one def that declares `call`.
        """
        if "properties" in spec:
            fn_props = dict(spec["properties"])
            required = spec.get("required", [])
            if "args" in fn_props:
                args_spec = dict(fn_props["args"])
                schema_as_constants["_FUNCTION_CALL_ARGS_SCHEMA"] = (
                    _schema_only_type_expr(args_spec, field_root=True),
                    "FunctionCall",
                )
                validators = ""
                # Validation stays `dict[str, Any]`, so values the spec
                # rejects as null are rejected explicitly.
                if not _schema_allows_null(
                    args_spec.get("additionalProperties", True), defs
                ):
                    if "_reject_null_values" not in processed:
                        common_blocks.append(_REJECT_NULL_VALUES_CODE)
                        processed.add("_reject_null_values")
                    validators = "AfterValidator(_reject_null_values), "
                args_spec[PYTHON_TYPE_KEY] = (
                    f"Annotated[dict[str, Any], {validators}_FUNCTION_CALL_ARGS_SCHEMA]"
                )
                imports.helpers.add("JsonSchemaAs")
                fn_props["args"] = args_spec
        else:
            base_refs = [
                sub
                for sub in spec.get("allOf", [])
                if isinstance(sub, dict) and "$ref" in sub
            ]
            base_name = (
                _local_def_name(base_refs[0]["$ref"])
                if len(base_refs) == 1 and set(base_refs[0]) == {"$ref"}
                else None
            )
            base_spec = defs.get(base_name) if base_name else None
            base_props = base_spec.get("properties") if base_spec else None
            call_key = (
                next((k for k in ("@call", "call") if k in base_props), None)
                if isinstance(base_props, dict)
                else None
            )
            if not isinstance(base_props, dict) or call_key is None:
                raise ValueError(
                    "FunctionCall must declare properties or reference, through"
                    f" `allOf`, one def that declares `call` or `@call`: {spec}"
                )
            assert base_spec is not None
            fn_props = {call_key: base_props[call_key]}
            # Each catalog function declares its own `args`, so the flat model
            # accepts any arguments object; the catalog validates its shape.
            fn_props["args"] = base_props.get(
                "args",
                {"type": "object", "description": "Arguments passed to the function."},
            )
            fn_props.update({k: v for k, v in base_props.items() if k not in fn_props})
            required = base_spec.get("required", [])
        fn_spec: dict[str, Any] = {"properties": fn_props, "required": required}
        if "description" in spec:
            fn_spec = {"description": spec["description"], **fn_spec}
        fn_code = codegen.compile_object_def(
            "FunctionCall", fn_spec, base_class=_SPEC_BASE_MODEL
        )
        if version_to_underscore(version) in ("v0_9", "v0_9_1") and (
            "returnType" in fn_props or "return_type" in fn_props
        ):
            serializer_method = (
                "\n    # Hand-maintained: omit an inferred return type from"
                ' serialized calls.\n    @model_serializer(mode="wrap")\n   '
                " def _serialize_model(self, handler: Any) -> Any:\n        d ="
                " handler(self)\n        if isinstance(d, dict) and"
                ' "return_type" not in self.model_fields_set:\n           '
                ' d.pop("returnType", None)\n            d.pop("return_type",'
                " None)\n        return d\n"
            )
            fn_code = fn_code.rstrip() + serializer_method
        common_blocks.append(
            _with_schema_keywords(
                fn_code, _schema_keywords_code("FunctionCall", spec)
            ).rstrip()
        )

    def _compile_dynamic_def(name: str, spec: dict[str, Any]) -> None:
        """Compiles a dynamic value union, keeping the spec's branch order.

        Raises:
            ValueError: If a branch has a shape whose constraints the union
                would drop.
        """
        _check_def_keywords(name, spec, {"description", "oneOf"})
        members: list[str] = []
        for branch in spec["oneOf"]:
            if not isinstance(branch, dict):
                raise ValueError(f"Unsupported branch in {name}: {branch}")
            if branch == {"$ref": "#/$defs/DataBinding"}:
                member = "DataBinding"
            elif is_function_call_branch(branch):
                expected_rt = _function_call_branch_return_type(name, branch)
                if expected_rt is None:
                    member = "FunctionCall"
                else:
                    imports.helpers.add("ReturnType")
                    member = (
                        "Annotated[FunctionCall,"
                        f" ReturnType({python_literal(expected_rt)})]"
                    )
            elif branch.get("type") == "object" and "not" in branch:
                # The `not` clause keeps the branch exclusive of bindings and
                # function calls, which catalogs rely on too. The type is
                # emitted once; a second def needing one fails generation.
                _claim_name("LiteralObject")
                imports.helpers.add("SchemaKeywords")
                branch_keywords = {k: v for k, v in branch.items() if k != "type"}
                keywords_code = _render_schema_code(branch_keywords)
                common_blocks.append(
                    _literal_object_validator_code(
                        name,
                        branch,
                        f"SchemaKeywords({keywords_code},"
                        ' drop=("additionalProperties",))',
                    )
                )
                member = "LiteralObject"
            else:
                member = _strict_literal_type(branch)
            if member in members:
                raise ValueError(f"Duplicate {member} branch in {name}: {spec}")
            members.append(member)
        common_blocks.append(f"{name} = {' | '.join(members)}")

    def _compile_def(name: str, spec: dict[str, Any]) -> None:
        if name in processed:
            return

        wrapper_branches = _wrapper_union_branches(spec)
        if wrapper_branches:
            _compile_wrapper_union(name, spec, wrapper_branches)
            processed.add(name)
            return

        if name == "FunctionCall":
            _compile_function_call(spec)
            processed.add(name)
            return

        if is_dynamic_def(spec):
            _compile_dynamic_def(name, spec)
            processed.add(name)
            return

        union_items = spec.get("oneOf") or spec.get("anyOf") or []
        if any(isinstance(it, dict) and "not" in it for it in union_items):
            # Only dynamic value defs support a `not` branch, which
            # `LiteralObject` enforces and publishes.
            raise ValueError(f"Unsupported `not` branch in {name}: {spec}")

        # A primitive def is a named alias, so references to it stay `$ref`s.
        primitive_types = {
            "string": "str",
            "number": "float",
            "integer": "int",
            "boolean": "bool",
        }
        if "patternProperties" in spec and "properties" not in spec:
            common_blocks.append(_pattern_keyed_object_code(name, spec))
        elif "properties" in spec or spec.get("type") == "object":
            _compile_model(name, spec)
        elif "oneOf" in spec or "anyOf" in spec or "allOf" in spec:
            common_blocks.append(codegen.compile_union_def(name, spec))
        elif "enum" in spec:
            _check_def_keywords(name, spec, {"type", "description", "enum"})
            enum_vals = [python_literal(v) for v in spec["enum"]]
            common_blocks.append(f"{name} = Literal[{', '.join(enum_vals)}]")
        elif "$ref" in spec:
            mapped = codegen.map_json_type_to_python("", spec)
            common_blocks.append(f"{name} = {mapped}")
        elif spec.get("type") in primitive_types:
            # Constraints such as `pattern` or `minLength` would be dropped.
            _check_def_keywords(name, spec, {"type", "description"})
            imports.type_alias_type = True
            py_type = primitive_types[spec["type"]]
            common_blocks.append(
                f"{name} = TypeAliasType({python_literal(name)}, {py_type})"
            )
        elif spec.get("type") == "array":
            _check_def_keywords(name, spec, {"type", "description", "items"})
            item_type = (
                codegen.map_json_type_to_python("", spec.get("items", {}))
                if "items" in spec
                else "Any"
            )
            common_blocks.append(f"{name} = list[{item_type}]")
        else:
            raise ValueError(f"Unsupported def {name}: {spec}")

        processed.add(name)

    # Dynamic topological ordering:
    sorted_def_keys = topological_sort_defs(defs)
    for key in sorted_def_keys:
        _compile_def(key, defs[key])

    # Named aliases are emitted after every def, since they wrap unions (e.g.
    # `DynamicValue`) that may be defined after the models that use them.
    # Pydantic emits a named alias as a `$ref` instead of inlining the union.
    # Type checkers only accept a `TypeAliasType` named like its variable, so
    # they see a plain alias instead.
    for alias_target, alias_name in sorted(schema_ref_aliases.items()):
        common_blocks.append(
            "if TYPE_CHECKING:\n"
            f"    {alias_name}: TypeAlias = {alias_target}\n"
            "else:\n"
            f"    {alias_name} = TypeAliasType({python_literal(alias_target)},"
            f" {alias_target})"
        )
    # Schema-only annotations follow the aliases they use. Each is a single
    # module-level instance, which its recursion guard relies on.
    for const_name, (schema_type_expr, _) in schema_as_constants.items():
        common_blocks.append(f"{const_name} = JsonSchemaAs({schema_type_expr})")
    # Models that use those constants were defined before them, so they are
    # completed here rather than on first use, which subclasses in other
    # modules cannot trigger.
    for owner in sorted({owner for _, owner in schema_as_constants.values()}):
        common_blocks.append(f"{owner}.model_rebuild()")

    class_names = get_base_common_class_names() | extract_class_names(
        "\n\n".join(common_blocks[1:])
    )
    defs_manifest_lines = [
        f"    {python_literal(key)}:"
        f" {_common_types_manifest_entry(key, spec, class_names)},"
        for key, spec in defs.items()
    ]
    manifest_code = (
        "COMMON_TYPES_DEFS: Final[dict[str, Any]] = {\n"
        + "\n".join(defs_manifest_lines)
        + "\n}"
    )
    common_blocks.append(manifest_code)

    common_blocks[0] = _header(
        imports.render(),
        frozenset({"TYPE_CHECKING", "TypeAlias"})
        if schema_ref_aliases
        else frozenset(),
    )

    full_code = "\n\n\n".join(b.strip() for b in common_blocks if b.strip()) + "\n"
    exported_symbols = extract_exported_symbols(full_code)
    all_exports = sorted(list(dict.fromkeys(imports_from_common + exported_symbols)))
    all_list = ",\n".join(f'    "{s}"' for s in all_exports)
    return f"{full_code}\n__all__ = [\n{all_list},\n]\n"


_NESTED_MODEL_KEYWORDS = frozenset({
    "type",
    "description",
    "properties",
    "required",
    "additionalProperties",
})


def _render_a2r_schema_code(node: Any, imports: _ExtraImports) -> str:
    """Renders a JSON schema fragment as Python code, turning `$ref`s into `def_ref`."""
    if isinstance(node, list):
        return (
            "["
            + ", ".join(_render_a2r_schema_code(item, imports) for item in node)
            + "]"
        )
    if not isinstance(node, dict):
        return python_literal(node)
    if isinstance(node.get("$ref"), str) and len(node) == 1:
        imports.helpers.add("def_ref")
        return f"def_ref({python_literal(node['$ref'])})"
    items = [
        f"{python_literal(k)}: {_render_a2r_schema_code(v, imports)}"
        for k, v in node.items()
    ]
    return "{" + ", ".join(items) + "}"


def _a2r_object_schema_extra(
    spec: dict[str, Any],
    *,
    inline: bool = False,
    imports: _ExtraImports | None = None,
) -> str | None:
    """Returns the `json_schema_extra` expression for an agent_to_renderer object model."""
    if imports is None:
        return None
    props = spec.get("properties", {})
    required = spec.get("required", [])
    default_required = [p for p in props if p in required]
    needs_required = bool(required) and list(required) != default_required

    if inline and needs_required:
        imports.helpers.update({"INLINE_DEF_MARKER", "SchemaKeywords"})
        req_lit = python_literal(list(required))
        return f"SchemaKeywords({{'required': {req_lit}, INLINE_DEF_MARKER: True}})"
    if inline:
        imports.helpers.add("INLINE_DEF_MARKER")
        return "{INLINE_DEF_MARKER: True}"
    if needs_required:
        imports.helpers.add("SchemaKeywords")
        return f"SchemaKeywords({{'required': {python_literal(list(required))}}})"
    return None


def _prepare_a2r_property(
    prop_name: str,
    prop: Any,
    codegen: PydanticCodegen,
    imports: _ExtraImports | None,
) -> Any:
    """Annotates a property schema with `PYTHON_TYPE_KEY` for spec-only keywords."""
    if not isinstance(prop, dict) or imports is None:
        return prop
    prop = dict(prop)
    ref = prop.get("$ref")
    if isinstance(ref, str) and ref.startswith("catalog.json#/"):
        imports.helpers.update({"SchemaKeywords", "def_ref"})
        prop[PYTHON_TYPE_KEY] = (
            f"Annotated[Any, SchemaKeywords(def_ref({python_literal(ref)}),"
            " replace=True)]"
        )
        return prop
    if prop.get("type") == "array":
        items = prop.get("items")
        min_items = prop.pop("minItems", None)
        has_catalog_items = (
            isinstance(items, dict)
            and isinstance(items.get("$ref"), str)
            and items["$ref"].startswith("catalog.json#/")
        )
        if has_catalog_items:
            imports.helpers.update({"SchemaKeywords", "def_ref"})
            item_ref = items["$ref"]
            item_type = (
                "Annotated[dict[str, Any],"
                f" SchemaKeywords(def_ref({python_literal(item_ref)}), replace=True)]"
            )
            py_type = f"list[{item_type}]"
        else:
            py_type = codegen.map_json_type_to_python(prop_name, prop)
        if min_items is not None:
            imports.helpers.add("SchemaKeywords")
            py_type = (
                f"Annotated[{py_type},"
                f" SchemaKeywords({{'minItems': {python_literal(min_items)}}})]"
            )
            prop[PYTHON_TYPE_KEY] = py_type
        elif has_catalog_items:
            prop[PYTHON_TYPE_KEY] = py_type
        return prop
    if "type" not in prop and "additionalProperties" in prop:
        imports.helpers.add("SchemaKeywords")
        add_props = python_literal(prop["additionalProperties"])
        prop[PYTHON_TYPE_KEY] = (
            f"Annotated[Any, SchemaKeywords({{'additionalProperties': {add_props}}})]"
        )
        return prop
    return prop


def _extract_nested_models(
    codegen: PydanticCodegen,
    parent_name: str,
    schema: dict[str, Any],
    blocks: list[str],
    taken_names: set[str],
    imports: _ExtraImports | None = None,
) -> dict[str, Any]:
    """Compiles nested object properties of a payload into helper models.

    A property that is an object with its own properties becomes a model named
    `<Parent><Property>` (for example `CreateSurfaceMetadata`), and an array
    whose items are an object with properties becomes `<Parent><Property>Item`,
    appended to `blocks` before its parent, and the returned schema references it.

    Raises:
        ValueError: If a helper name is taken, or a nested object uses
            keywords that its model would not enforce.
    """
    props = schema.get("properties")
    if not isinstance(props, dict):
        return schema
    new_props: dict[str, Any] = {}
    for prop_name, prop in props.items():
        if (
            isinstance(prop, dict)
            and prop.get("type") == "object"
            and "properties" in prop
        ):
            unsupported = set(prop) - _NESTED_MODEL_KEYWORDS
            if unsupported or isinstance(prop.get("additionalProperties"), dict):
                raise ValueError(
                    f"Unsupported nested object {parent_name}.{prop_name}: {prop}"
                )
            helper_name = f"{parent_name}{to_pascal_case(prop_name)}"
            if helper_name in taken_names:
                raise ValueError(f"Generated name {helper_name} is already taken")
            taken_names.add(helper_name)
            helper_schema = _extract_nested_models(
                codegen, helper_name, prop, blocks, taken_names, imports
            )
            blocks.append(
                codegen.compile_object_def(
                    helper_name,
                    helper_schema,
                    json_schema_extra=_a2r_object_schema_extra(
                        helper_schema, inline=True, imports=imports
                    ),
                )
            )
            ref: dict[str, Any] = {"$ref": f"#/$defs/{helper_name}"}
            if "description" in prop:
                ref["description"] = prop["description"]
            prop = ref
        elif (
            isinstance(prop, dict)
            and prop.get("type") == "array"
            and isinstance(prop.get("items"), dict)
            and prop["items"].get("type") == "object"
            and "properties" in prop["items"]
        ):
            items = prop["items"]
            unsupported = set(items) - _NESTED_MODEL_KEYWORDS
            if unsupported or isinstance(items.get("additionalProperties"), dict):
                raise ValueError(
                    f"Unsupported nested array item {parent_name}.{prop_name}: {items}"
                )
            helper_name = f"{parent_name}{to_pascal_case(prop_name)}Item"
            if helper_name in taken_names:
                raise ValueError(f"Generated name {helper_name} is already taken")
            taken_names.add(helper_name)
            helper_schema = _extract_nested_models(
                codegen, helper_name, items, blocks, taken_names, imports
            )
            blocks.append(
                codegen.compile_object_def(
                    helper_name,
                    helper_schema,
                    json_schema_extra=_a2r_object_schema_extra(
                        helper_schema, inline=True, imports=imports
                    ),
                )
            )
            prop = {**prop, "items": {"$ref": f"#/$defs/{helper_name}"}}
        new_props[prop_name] = _prepare_a2r_property(prop_name, prop, codegen, imports)
    return {**schema, "properties": new_props}


def _compile_a2r_non_message_def(
    def_name: str,
    def_spec: dict[str, Any],
    codegen: PydanticCodegen,
    imports: _ExtraImports,
) -> str:
    """Compiles a non-Message `$defs` entry (e.g. `Component`, `ComponentsList`)."""
    imports.type_alias_type = True
    annotations: list[str] = []
    desc = def_spec.get("description")
    if isinstance(desc, str) and desc:
        annotations.append(f"Field(description={python_literal(desc)})")
    if def_spec.get("type") == "array":
        spec_copy = dict(def_spec)
        min_items = spec_copy.pop("minItems", None)
        py_type = codegen.map_json_type_to_python(def_name, spec_copy)
        if min_items is not None:
            imports.helpers.add("SchemaKeywords")
            annotations.append(
                f"SchemaKeywords({{'minItems': {python_literal(min_items)}}})"
            )
    else:
        py_type = "dict[str, Any]"
        keywords = {k: v for k, v in def_spec.items() if k != "description"}
        if keywords:
            imports.helpers.add("SchemaKeywords")
            annotations.append(
                f"SchemaKeywords({_render_a2r_schema_code(keywords, imports)},"
                " replace=True)"
            )
    inner = (
        f"Annotated[{py_type}, {', '.join(annotations)}]" if annotations else py_type
    )
    return f"{def_name} = TypeAliasType({python_literal(def_name)}, {inner})"


def generate_agent_to_renderer(
    version: str,
    a2r_data: dict[str, Any],
    a2r_name: str = "",
    common_data: dict[str, Any] | None = None,
) -> str:
    """Generates agent_to_renderer.py / server_to_client.py content."""
    codegen = PydanticCodegen(version)
    codegen.allow_inline = False
    codegen.schema_defaults = True
    codegen.skip_component_property = False
    codegen.spec_fidelity = True
    is_modern = is_modern_terminology(version, a2r_name)
    defs_a2r = a2r_data.get("$defs", {})

    common_def_names = (
        set(common_data.get("$defs", {}).keys()) if common_data else set()
    )
    referenced_common = find_common_refs(a2r_data, common_def_names)
    needed_imports = ["StrictBaseModel"] + sorted(list(referenced_common))
    import_source = ".common_types" if common_data else "..common_types"
    a2r_imports = f"from {import_source} import {', '.join(needed_imports)}\n"

    imports = _ExtraImports()
    root_desc = a2r_data.get("description", "")

    def _header(extra_imports: str = "") -> str:
        file_header = FILE_HEADER
        if isinstance(root_desc, str) and root_desc:
            doc_str = f'"""{root_desc}"""'
            file_header = file_header.replace(
                "from __future__ import annotations",
                f"{doc_str}\n\nfrom __future__ import annotations",
                1,
            )
        extra = f"{extra_imports}\n" if extra_imports else ""
        return (
            f"{file_header}\n"
            "from typing import Annotated, Any, Final, Literal\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            + extra
            + a2r_imports
            + "from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE"
        )

    a2r_blocks = [_header()]

    msg_names = []
    # Names of generated classes, which nested helper models must not reuse.
    taken_names = (
        set(defs_a2r)
        | set(needed_imports)
        | {m.replace("Message", "") for m in defs_a2r if m.endswith("Message")}
    )
    codegen.known_local_refs = taken_names

    non_msg_defs = {k: v for k, v in defs_a2r.items() if not k.endswith("Message")}
    if non_msg_defs:
        for def_name in topological_sort_defs(non_msg_defs):
            a2r_blocks.append(
                _compile_a2r_non_message_def(
                    def_name, non_msg_defs[def_name], codegen, imports
                )
            )
    if "ComponentsList" not in non_msg_defs and "Component" not in non_msg_defs:
        a2r_blocks.append(
            "ComponentsList = list[dict[str, Any]]\nComponent = dict[str, Any]"
        )

    if defs_a2r:
        for mname, mschema in defs_a2r.items():
            if not mname.endswith("Message"):
                continue
            payload_name = mname.replace("Message", "")
            envelope_keys = [
                k for k in mschema.get("properties", {}).keys() if k != "version"
            ]
            if not envelope_keys:
                continue
            envelope_key = envelope_keys[0]
            payload_schema = mschema.get("properties", {}).get(envelope_key, {})
            if payload_schema:
                if "$ref" in payload_schema:
                    ref_target = payload_schema["$ref"].rsplit("/", 1)[-1]
                    a2r_blocks.append(f"{payload_name} = {ref_target}")
                else:
                    payload_schema = _extract_nested_models(
                        codegen,
                        payload_name,
                        payload_schema,
                        a2r_blocks,
                        taken_names,
                        imports,
                    )
                    a2r_blocks.append(
                        codegen.compile_object_def(
                            payload_name,
                            payload_schema,
                            json_schema_extra=_a2r_object_schema_extra(
                                payload_schema, inline=True, imports=imports
                            ),
                        )
                    )

            snake_env = to_snake_case(envelope_key)
            alias_opt = f', alias="{envelope_key}"' if snake_env != envelope_key else ""
            msg_req = mschema.get("required") or [envelope_key, "version"]
            msg_req_lit = python_literal(list(msg_req))
            imports.helpers.add("SchemaKeywords")
            msg_config = (
                "    model_config ="
                " ConfigDict(json_schema_extra=SchemaKeywords({'required':"
                f" {msg_req_lit}}}))\n"
            )
            a2r_blocks.append(
                f"class {mname}(StrictBaseModel):\n"
                + msg_config
                + "    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n"
                f"    {snake_env}: {payload_name} = Field(...{alias_opt})"
            )
            msg_names.append(mname)
    else:
        props = a2r_data.get("properties", {})
        for key, val_schema in props.items():
            pascal_key = to_pascal_case(key)
            payload_name = pascal_key
            mname = f"{pascal_key}Message"
            val_schema = _extract_nested_models(
                codegen,
                payload_name,
                val_schema,
                a2r_blocks,
                taken_names,
                imports,
            )
            a2r_blocks.append(
                codegen.compile_object_def(
                    payload_name,
                    val_schema,
                    json_schema_extra=_a2r_object_schema_extra(
                        val_schema, inline=False, imports=imports
                    ),
                )
            )
            snake_env = to_snake_case(key)
            alias_opt = f', alias="{key}"' if snake_env != key else ""
            a2r_blocks.append(
                f"class {mname}(StrictBaseModel):\n"
                "    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n"
                f"    {snake_env}: {payload_name} = Field(...{alias_opt})"
            )
            msg_names.append(mname)
        aliases = []
        if (
            "BeginRenderingMessage" in msg_names
            and "CreateSurfaceMessage" not in msg_names
        ):
            aliases.extend([
                "CreateSurface = BeginRendering",
                "CreateSurfaceMessage = BeginRenderingMessage",
            ])
        if (
            "SurfaceUpdateMessage" in msg_names
            and "UpdateComponentsMessage" not in msg_names
        ):
            aliases.extend([
                "UpdateComponents = SurfaceUpdate",
                "UpdateComponentsMessage = SurfaceUpdateMessage",
            ])
        if (
            "DataModelUpdateMessage" in msg_names
            and "UpdateDataModelMessage" not in msg_names
        ):
            aliases.extend([
                "UpdateDataModel = DataModelUpdate",
                "UpdateDataModelMessage = DataModelUpdateMessage",
            ])
        if aliases:
            a2r_blocks.append("\n".join(aliases))

    if msg_names:
        if is_modern:
            a2r_blocks.append(f"AgentToRendererMessage = {' | '.join(msg_names)}")
            a2r_blocks.append(
                "AgentToRendererMessageList = list[AgentToRendererMessage]"
            )
            a2r_blocks.append(
                "class AgentToRendererMessageListWrapper(StrictBaseModel):\n   "
                ' messages: AgentToRendererMessageList = Field(..., description="An'
                ' object wrapping a list of A2UI Agent-to-Renderer messages.")'
            )
        else:
            a2r_blocks.append(f"ServerToClientMessage = {' | '.join(msg_names)}")
            a2r_blocks.append(
                "AgentToRendererMessage = ServerToClientMessage\nA2uiMessage ="
                " ServerToClientMessage"
            )
            a2r_blocks.append(
                "class A2uiMessageListWrapper(StrictBaseModel):\n    messages:"
                ' list[ServerToClientMessage] = Field(..., description="A list of'
                ' messages.")'
            )

    if defs_a2r:
        manifest_lines = [f"    {python_literal(key)}: {key}," for key in defs_a2r]
    else:
        manifest_lines = [
            f"    {python_literal(key)}: {to_pascal_case(key)},"
            for key in a2r_data.get("properties", {})
        ]
    if manifest_lines:
        a2r_blocks.append(
            "AGENT_TO_RENDERER_DEFS: Final[dict[str, Any]] = {\n"
            + "\n".join(manifest_lines)
            + "\n}"
        )

    imports.helpers.update(codegen.used_helpers)
    a2r_blocks[0] = _header(imports.render())

    return "\n\n\n".join(b.strip() for b in a2r_blocks if b.strip()) + "\n"


def generate_renderer_to_agent(
    version: str,
    r2a_data: dict[str, Any],
    a2r_name: str = "",
    common_data: dict[str, Any] | None = None,
) -> str:
    """Generates renderer_to_agent.py / client_to_server.py content."""
    codegen = PydanticCodegen(version)
    is_modern = is_modern_terminology(version, a2r_name)
    props = r2a_data.get("properties", {})
    common_def_names = (
        set(common_data.get("$defs", {}).keys()) if common_data else set()
    )
    referenced_common = find_common_refs(r2a_data, common_def_names)
    needed_imports = ["StrictBaseModel"] + sorted(list(referenced_common))
    import_source = ".common_types" if common_data else "..common_types"
    r2a_imports = f"from {import_source} import {', '.join(needed_imports)}\n"

    r2a_blocks = [
        f"{FILE_HEADER}\n"
        "from typing import Any, Literal\n"
        "from pydantic import BaseModel, Field, ConfigDict\n"
        + r2a_imports
        + "from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE",
    ]
    r2a_names: list[str] = []
    msg_union_members: list[str] = []

    # Process all event properties dynamically from the schema
    for prop_name, prop_spec in props.items():
        if prop_name == "version":
            continue

        # 1. Action payloads
        if "action" in prop_name.lower():
            if is_modern:
                r2a_blocks.append(
                    codegen.compile_object_def("A2uiRendererAction", prop_spec)
                )
                r2a_blocks.append("ActionPayload = A2uiRendererAction")
                r2a_names.extend(["A2uiRendererAction", "ActionPayload"])
                msg_cls = "A2uiRendererActionMessage"
                snake_prop = to_snake_case(prop_name)
                alias_opt = f', alias="{prop_name}"' if snake_prop != prop_name else ""
                r2a_blocks.append(
                    f"class {msg_cls}(StrictBaseModel):\n"
                    "    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n"
                    f"    {snake_prop}: A2uiRendererAction = Field(...{alias_opt})"
                )
                msg_union_members.append(msg_cls)
                r2a_names.append(msg_cls)
            else:
                r2a_blocks.append(
                    codegen.compile_object_def("A2uiClientAction", prop_spec)
                )
                r2a_blocks.append(
                    "A2uiRendererAction = A2uiClientAction\n"
                    "A2uiClientUserAction = A2uiClientAction\n"
                    "ActionPayload = A2uiClientAction"
                )
                r2a_names.extend([
                    "A2uiClientAction",
                    "A2uiRendererAction",
                    "A2uiClientUserAction",
                    "ActionPayload",
                ])
                msg_cls = "A2uiClientActionMessage"
                snake_prop = to_snake_case(prop_name)
                alias_opt = f', alias="{prop_name}"' if snake_prop != prop_name else ""
                r2a_blocks.append(
                    f"class {msg_cls}(StrictBaseModel):\n"
                    "    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n"
                    f"    {snake_prop}: A2uiClientAction = Field(...{alias_opt})"
                )
                r2a_blocks.append(
                    "A2uiRendererActionMessage = A2uiClientActionMessage\n"
                    "A2uiClientUserActionMessage = A2uiClientActionMessage"
                )
                msg_union_members.append(msg_cls)
                r2a_names.extend([
                    "A2uiClientActionMessage",
                    "A2uiRendererActionMessage",
                    "A2uiClientUserActionMessage",
                ])

        # 2. Error payloads
        elif "error" in prop_name.lower():
            err_classes = []
            if "oneOf" in prop_spec or "anyOf" in prop_spec:
                items = prop_spec.get("oneOf") or prop_spec.get("anyOf", [])
                for item in items:
                    err_title = item.get("title", "")
                    if "validation" in err_title.lower():
                        class_name = "A2uiValidationError"
                    elif "generic" in err_title.lower():
                        class_name = "A2uiGenericError"
                    else:
                        class_name = (
                            "".join(
                                p.capitalize()
                                for p in re.split(r"[^a-zA-Z0-9]+", err_title)
                                if p
                            )
                            if err_title
                            else "A2uiError"
                        )
                        if not class_name.startswith("A2ui"):
                            class_name = f"A2ui{class_name}"
                    r2a_blocks.append(codegen.compile_object_def(class_name, item))
                    err_classes.append(class_name)
                    r2a_names.append(class_name)
            elif "properties" in prop_spec:
                err_cls = "A2uiRendererError" if is_modern else "A2uiClientError"
                r2a_blocks.append(codegen.compile_object_def(err_cls, prop_spec))
                err_classes.append(err_cls)
                r2a_names.append(err_cls)
            else:
                r2a_blocks.append(
                    "class A2uiGenericError(StrictBaseModel):\n"
                    "    code: str | None = Field(default=None)\n"
                    "    message: str | None = Field(default=None)"
                )
                err_classes.append("A2uiGenericError")
                r2a_names.append("A2uiGenericError")

            if err_classes:
                if "A2uiValidationError" not in err_classes:
                    r2a_blocks.append(
                        "class A2uiValidationError(StrictBaseModel):\n    pass"
                    )
                    r2a_names.append("A2uiValidationError")
                r2a_blocks.append(f"A2uiRendererError = {' | '.join(err_classes)}")
                r2a_names.append("A2uiRendererError")

            msg_cls = "A2uiRendererErrorMessage"
            snake_prop = to_snake_case(prop_name)
            err_type = "A2uiRendererError"
            r2a_blocks.append(
                f"class {msg_cls}(StrictBaseModel):\n"
                "    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n"
                f"    {snake_prop}: {err_type} = Field(...)"
            )
            msg_union_members.append(msg_cls)
            r2a_names.append(msg_cls)

        # 3. Other event payloads (e.g. callAgentFunction, rendererFunctionResponse, etc.)
        else:
            if "$ref" in prop_spec:
                payload_type = codegen.map_json_type_to_python(prop_name, prop_spec)
            else:
                payload_type = to_pascal_case(prop_name)
                r2a_blocks.append(codegen.compile_object_def(payload_type, prop_spec))
                r2a_names.append(payload_type)

            msg_cls = f"{to_pascal_case(prop_name)}Message"
            snake_prop = to_snake_case(prop_name)
            alias_opt = f', alias="{prop_name}"' if snake_prop != prop_name else ""
            r2a_blocks.append(
                f"class {msg_cls}(StrictBaseModel):\n"
                "    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n"
                f"    {snake_prop}: {payload_type} = Field(...{alias_opt})"
            )
            msg_union_members.append(msg_cls)
            r2a_names.append(msg_cls)

    union_def = " | ".join(msg_union_members) if msg_union_members else "Any"

    if is_modern:
        r2a_blocks.append(f"RendererToAgentMessage = {union_def}")
        r2a_blocks.append(
            "class A2uiRendererDataModel(StrictBaseModel):\n    version:"
            " PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n    surfaces: dict[str,"
            ' dict[str, Any]] = Field(..., description="A map of surface IDs to data'
            ' models.")'
        )
        r2a_blocks.append("RendererToAgentMessageList = list[RendererToAgentMessage]")
        r2a_blocks.append(
            "class RendererToAgentMessageListWrapper(StrictBaseModel):\n    messages:"
            ' RendererToAgentMessageList = Field(..., description="An object'
            ' wrapping a list of A2UI Renderer-to-Agent messages.")'
        )
        r2a_names.extend([
            "RendererToAgentMessage",
            "A2uiRendererDataModel",
            "RendererToAgentMessageList",
            "RendererToAgentMessageListWrapper",
        ])
    else:
        r2a_blocks.append(f"A2uiClientMessage = {union_def}")
        r2a_blocks.append(
            "ClientToServerMessage = A2uiClientMessage\n"
            "RendererToAgentMessage = A2uiClientMessage"
        )
        r2a_names.extend([
            "A2uiClientMessage",
            "ClientToServerMessage",
            "RendererToAgentMessage",
        ])
        r2a_blocks.append(
            "class A2uiClientDataModel(StrictBaseModel):\n    version:"
            " PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n    surfaces: dict[str,"
            ' dict[str, Any]] = Field(..., description="A map of surface IDs to data'
            ' models.")'
        )
        r2a_blocks.append(f"A2uiClientMessageList = list[ClientToServerMessage]")
        r2a_blocks.append(
            "class A2uiClientMessageListWrapper(StrictBaseModel):\n    messages:"
            ' A2uiClientMessageList = Field(..., description="List wrapper.")'
        )
        r2a_names.extend([
            "A2uiClientDataModel",
            "A2uiClientMessageList",
            "A2uiClientMessageListWrapper",
        ])

    return "\n\n\n".join(b.strip() for b in r2a_blocks if b.strip()) + "\n"


def generate_renderer_capabilities(
    version: str,
    capabilities_data: dict[str, Any],
    is_modern: bool | None = None,
    has_catalog_definition: bool = False,
    has_common_types: bool = True,
) -> str:
    """Generates renderer_capabilities.py / client_capabilities.py content."""
    codegen = PydanticCodegen(version)
    dir_name = version_to_underscore(version)
    spec_dot = ensure_v_prefix(version)
    if is_modern is None:
        is_modern = is_modern_terminology(version)
    common_mod = ".common_types" if has_common_types else "..common_types"
    caps_blocks = [
        (
            f"{FILE_HEADER}\n"
            "from typing import Any, Literal\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            f"from {common_mod} import StrictBaseModel\n"
            "from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE"
        ),
    ]

    defs = capabilities_data.get("$defs", {})
    inline_catalog_defined = False
    for def_name in topological_sort_defs(defs):
        def_spec = dict(defs[def_name])
        props: dict[str, Any] = {}
        req: list[str] = []
        if "allOf" in def_spec:
            for item in def_spec["allOf"]:
                if isinstance(item, dict):
                    props.update(item.get("properties", {}))
                    req.extend(item.get("required", []))
        if not props and "properties" in def_spec:
            props = def_spec.get("properties", {})
            req = def_spec.get("required", [])

        is_extensible = (
            def_spec.get("additionalProperties") is True
            or ("properties" not in def_spec and "additionalProperties" not in def_spec)
            or def_name in ("Catalog", "InlineCatalog")
        )
        model_spec = {
            "description": def_spec.get("description", ""),
            "properties": props,
            "required": req,
            "additionalProperties": is_extensible,
        }
        base_class = "BaseModel" if is_extensible else "StrictBaseModel"
        target_name = (
            "InlineCatalog" if def_name in ("Catalog", "InlineCatalog") else def_name
        )
        caps_blocks.append(
            codegen.compile_object_def(target_name, model_spec, base_class=base_class)
        )
        if def_name in ("Catalog", "InlineCatalog"):
            inline_catalog_defined = True
            caps_blocks.append("Catalog = InlineCatalog")

    root_props = capabilities_data.get("properties", {})
    ver_prop_key = next(
        (
            k
            for k in root_props
            if k == spec_dot
            or k == f"v{version.lstrip('v')}"
            or (k.startswith("v") and isinstance(root_props[k], dict))
        ),
        None,
    )
    if (
        ver_prop_key
        and isinstance(root_props[ver_prop_key], dict)
        and "properties" in root_props[ver_prop_key]
    ):
        v_props = root_props[ver_prop_key].get("properties", {})
        v_req = root_props[ver_prop_key].get("required", [])
    else:
        v_props = root_props
        v_req = capabilities_data.get("required", [])

    if not inline_catalog_defined:
        inline_cat_schema = v_props.get("inlineCatalogs", {})
        ref_target = ""
        if "items" in inline_cat_schema and isinstance(
            inline_cat_schema["items"], dict
        ):
            ref_target = inline_cat_schema["items"].get("$ref", "")

        if "catalog_definition" in ref_target or has_catalog_definition:
            caps_blocks.append(
                "\nfrom .catalog_definition import CatalogDefinition\n\n"
                "InlineCatalog = CatalogDefinition\n"
                "Catalog = InlineCatalog"
            )
        else:
            caps_blocks.append(
                "class InlineCatalog(BaseModel):\n"
                '    model_config = ConfigDict(extra="allow")\n\n'
                "Catalog = InlineCatalog"
            )

    cap_cls_name = f"V{dir_name[1:].replace('_', '')}Capabilities"
    alt_cap_cls_name = f"V{dir_name[1:]}Capabilities"
    cap_lines = [f"class {cap_cls_name}(StrictBaseModel):"]
    cap_props_lines = codegen.compile_properties(v_props, v_req)
    if cap_props_lines:
        cap_lines.extend(cap_props_lines)
    else:
        cap_lines.append("    pass")
    caps_blocks.append("\n".join(cap_lines))

    if alt_cap_cls_name != cap_cls_name:
        caps_blocks.append(f"{alt_cap_cls_name} = {cap_cls_name}")

    if is_modern:
        caps_blocks.append(
            f"class A2uiRendererCapabilities(StrictBaseModel):\n    {dir_name}:"
            f" {cap_cls_name} | None = Field(default=None, alias=PROTOCOL_VERSION)"
        )
    else:
        caps_blocks.append(
            f"class A2uiClientCapabilities(StrictBaseModel):\n    {dir_name}:"
            f" {cap_cls_name} | None = Field(default=None, alias=PROTOCOL_VERSION)"
        )
        caps_blocks.append("A2uiRendererCapabilities = A2uiClientCapabilities")

    return "\n\n\n".join(b.strip() for b in caps_blocks if b.strip()) + "\n"


def generate_agent_capabilities(
    version: str,
    capabilities_data: dict[str, Any],
    is_modern: bool | None = None,
    has_common_types: bool = True,
) -> str:
    """Generates agent_capabilities.py / server_capabilities.py content."""
    codegen = PydanticCodegen(version)
    dir_name = version_to_underscore(version)
    spec_dot = ensure_v_prefix(version)
    if is_modern is None:
        is_modern = is_modern_terminology(version)
    common_mod = ".common_types" if has_common_types else "..common_types"
    caps_blocks = [
        (
            f"{FILE_HEADER}\n"
            "from typing import Any\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            f"from {common_mod} import StrictBaseModel\n"
            "from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE"
        ),
    ]

    defs = capabilities_data.get("$defs", {})
    for def_name in topological_sort_defs(defs):
        def_spec = dict(defs[def_name])
        props: dict[str, Any] = {}
        req: list[str] = []
        if "allOf" in def_spec:
            for item in def_spec["allOf"]:
                if isinstance(item, dict):
                    props.update(item.get("properties", {}))
                    req.extend(item.get("required", []))
        if not props and "properties" in def_spec:
            props = def_spec.get("properties", {})
            req = def_spec.get("required", [])

        is_extensible = def_spec.get("additionalProperties") is True
        model_spec = {
            "description": def_spec.get("description", ""),
            "properties": props,
            "required": req,
            "additionalProperties": is_extensible,
        }
        base_class = "BaseModel" if is_extensible else "StrictBaseModel"
        caps_blocks.append(
            codegen.compile_object_def(def_name, model_spec, base_class=base_class)
        )

    root_props = capabilities_data.get("properties", {})
    ver_prop_key = next(
        (
            k
            for k in root_props
            if k == spec_dot
            or k == f"v{version.lstrip('v')}"
            or (k.startswith("v") and isinstance(root_props[k], dict))
        ),
        None,
    )
    if (
        ver_prop_key
        and isinstance(root_props[ver_prop_key], dict)
        and "properties" in root_props[ver_prop_key]
    ):
        v_props = root_props[ver_prop_key].get("properties", {})
        v_req = root_props[ver_prop_key].get("required", [])
    else:
        v_props = root_props
        v_req = capabilities_data.get("required", [])

    prefix = "Agent" if is_modern else "Server"
    cap_cls_name = f"V{dir_name[1:].replace('_', '')}{prefix}Capabilities"
    alt_cap_cls_name = f"V{dir_name[1:]}{prefix}Capabilities"

    cap_lines = [f"class {cap_cls_name}(StrictBaseModel):"]
    cap_props_lines = codegen.compile_properties(v_props, v_req)
    if cap_props_lines:
        cap_lines.extend(cap_props_lines)
    else:
        cap_lines.append("    pass")
    caps_blocks.append("\n".join(cap_lines))

    if alt_cap_cls_name != cap_cls_name:
        caps_blocks.append(f"{alt_cap_cls_name} = {cap_cls_name}")

    if is_modern:
        caps_blocks.append(
            f"class A2uiAgentCapabilities(StrictBaseModel):\n    {dir_name}:"
            f" {cap_cls_name} | None = Field(default=None, alias=PROTOCOL_VERSION)"
        )
    else:
        alt_prefix = "Agent"
        cross_cap_cls_name = f"V{dir_name[1:].replace('_', '')}{alt_prefix}Capabilities"
        cross_alt_cap_cls_name = f"V{dir_name[1:]}{alt_prefix}Capabilities"
        caps_blocks.append(f"{cross_cap_cls_name} = {cap_cls_name}")
        if cross_alt_cap_cls_name != cross_cap_cls_name:
            caps_blocks.append(f"{cross_alt_cap_cls_name} = {cap_cls_name}")
        caps_blocks.append(
            f"class A2uiServerCapabilities(StrictBaseModel):\n    {dir_name}:"
            f" {cap_cls_name} | None = Field(default=None, alias=PROTOCOL_VERSION)"
        )
        caps_blocks.append("A2uiAgentCapabilities = A2uiServerCapabilities")

    return "\n\n\n".join(b.strip() for b in caps_blocks if b.strip()) + "\n"


def generate_catalog_definition(
    version: str,
    cat_def_data: dict[str, Any],
    common_data: dict[str, Any] | None = None,
) -> str:
    """Generates catalog_definition.py content."""
    codegen = PydanticCodegen(version)
    defs = cat_def_data.get("$defs", {})
    common_def_names = (
        set(common_data.get("$defs", {}).keys()) if common_data else set()
    )
    referenced_common = find_common_refs(cat_def_data, common_def_names)
    needed_imports = ["StrictBaseModel"] + sorted(list(referenced_common))
    common_imports_str = ", ".join(needed_imports)
    common_mod = ".common_types" if common_data else "..common_types"

    import_header = (
        f"{FILE_HEADER}\n"
        "from typing import Any, Literal\n"
        "from pydantic import BaseModel, Field, ConfigDict, model_validator\n"
        f"from {common_mod} import {common_imports_str}\n"
        "from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE"
    )
    blocks = [import_header]

    # 1. Compile all $defs dynamically in topological order
    sorted_def_names = topological_sort_defs(defs)
    for def_name in sorted_def_names:
        def_spec = dict(defs[def_name])
        props: dict[str, Any] = {}
        req: list[str] = []

        if "allOf" in def_spec:
            for item in def_spec["allOf"]:
                if isinstance(item, dict):
                    props.update(item.get("properties", {}))
                    req.extend(item.get("required", []))
        if not props and "properties" in def_spec:
            props = def_spec.get("properties", {})
            req = def_spec.get("required", [])

        if props:
            is_extensible = def_spec.get(
                "additionalProperties"
            ) is True or def_name in (
                "ComponentDefinition",
                "FunctionDefinition",
            )
            model_spec = {
                "description": def_spec.get("description", ""),
                "properties": props,
                "required": req,
                "additionalProperties": is_extensible,
            }
            base_class = "BaseModel" if is_extensible else "StrictBaseModel"
            comp_block = codegen.compile_object_def(
                def_name, model_spec, base_class=base_class
            )
            if def_name == "FunctionDefinition":
                validator_code = (
                    '    @model_validator(mode="after")\n    def'
                    " _validate_user_activation(self) -> FunctionDefinition:\n       "
                    " if self.requires_user_activation and self.allowed_callers !="
                    " 'rendererOnly':\n            raise ValueError(\"Functions with"
                    " requiresUserActivation=True can only have allowedCallers equal to"
                    " 'rendererOnly'.\")\n        return self\n"
                )
                comp_block = comp_block.rstrip() + "\n" + validator_code
            blocks.append(comp_block)

    # 2. Compile property-level $defs (e.g. CatalogDefs) dynamically
    root_props = dict(cat_def_data.get("properties", {}))
    defs_prop = root_props.get("$defs", {})
    if isinstance(defs_prop, dict) and defs_prop.get("properties"):
        catalog_defs_spec = {
            "description": defs_prop.get("description", ""),
            "properties": defs_prop.get("properties", {}),
            "required": defs_prop.get("required", []),
            "additionalProperties": defs_prop.get("additionalProperties", True),
        }
        blocks.append(
            codegen.compile_object_def(
                "CatalogDefs", catalog_defs_spec, base_class="BaseModel"
            )
        )
        root_props["$defs"] = {"$ref": "#/$defs/CatalogDefs"}

    # 3. Compile root CatalogDefinition dynamically
    root_req = list(cat_def_data.get("required", []))
    root_spec = {
        "description": cat_def_data.get("description", ""),
        "properties": root_props,
        "required": root_req,
    }
    blocks.append(codegen.compile_object_def("CatalogDefinition", root_spec))

    return "\n\n\n".join(b.strip() for b in blocks if b.strip()) + "\n"


def generate_schema_init(
    version: str,
    modules: dict[str, str],
) -> str:
    """Generates __init__.py content for a version schema directory by inspecting module symbols."""
    ver_init = [
        FILE_HEADER,
        "",
        "from .constants import *",
    ]
    all_exports: list[str] = []

    for mod_name, mod_code in modules.items():
        symbols = extract_exported_symbols(mod_code)
        if not symbols:
            continue
        all_exports.extend(symbols)
        import_lines = [f"    {s}," for s in symbols]
        ver_init.append(
            f"from .{mod_name} import (\n" + "\n".join(import_lines) + "\n)"
        )

    deduped_exports = list(dict.fromkeys(all_exports))
    all_export_lines = [f'    "{name}",' for name in deduped_exports]
    ver_init.extend([
        "",
        "",
        "__all__ = [",
        "\n".join(all_export_lines),
        "]",
        "",
    ])
    return "\n".join(ver_init)
