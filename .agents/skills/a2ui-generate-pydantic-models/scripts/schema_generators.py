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


_RETURN_TYPE_ANNOTATION_CODE = '''class _ReturnType:
    """Requires the FunctionCall branch of a dynamic value to return `expected`.

    Validation checks an explicit `returnType` or fills in `expected`, and the
    JSON schema constrains the FunctionCall reference with a `returnType` const.
    """

    def __init__(self, expected: str) -> None:
        self.expected = expected

    def __get_pydantic_core_schema__(
        self, source: Any, handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        return core_schema.no_info_after_validator_function(
            self._validate, handler(source)
        )

    def __get_pydantic_json_schema__(
        self, schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        return {
            "allOf": [
                handler(schema),
                {"properties": {"returnType": {"const": self.expected}}},
            ]
        }

    def _validate(self, fc: FunctionCall) -> FunctionCall:
        if "return_type" in fc.model_fields_set:
            if fc.return_type != self.expected:
                raise ValueError(
                    f"FunctionCall in Dynamic type must have returnType '{self.expected}', got '{fc.return_type}'"
                )
            return fc
        if fc.return_type != self.expected:
            fc = fc.model_copy()
            object.__setattr__(fc, "return_type", self.expected)
        return fc'''

# JSON schema keywords that model fields cannot produce: composition, keywords
# that replace Pydantic's own, and annotations such as the specification's
# `returnType`. A generated hook copies them from the specification.
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

# The Unicode identifier pattern (UAX #31), which Python's `re` cannot compile.
_IDENTIFIER_KEY_PATTERN = r"^[\p{XID_Start}_][\p{XID_Continue}]*$"

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
        self.return_type = False
        self.json_schema_hook = False
        self.model_validator = False
        self.type_alias_type = False

    def render(self) -> str:
        lines = []
        pydantic_names = set()
        if self.return_type:
            pydantic_names |= {"GetCoreSchemaHandler", "GetJsonSchemaHandler"}
        if self.json_schema_hook:
            pydantic_names.add("GetJsonSchemaHandler")
        if self.model_validator:
            pydantic_names.add("model_validator")
        if pydantic_names:
            names = ", ".join(sorted(pydantic_names, key=_import_sort_key))
            lines.append(f"from pydantic import {names}")
        if self.return_type or self.json_schema_hook:
            lines.append("from pydantic.json_schema import JsonSchemaValue")
        core_names = []
        if self.json_schema_hook:
            core_names.append("CoreSchema")
        if self.return_type:
            core_names.append("core_schema")
        if core_names:
            lines.append(f"from pydantic_core import {', '.join(core_names)}")
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


def _function_call_return_type(spec: dict[str, Any]) -> str | None:
    """Returns the `returnType` const that a dynamic def requires of function calls."""
    for branch in spec.get("oneOf", []):
        if not isinstance(branch, dict) or "allOf" not in branch:
            continue
        for sub in branch["allOf"]:
            props = sub.get("properties") if isinstance(sub, dict) else None
            rt = props.get("returnType") if isinstance(props, dict) else None
            if isinstance(rt, dict) and "const" in rt:
                return str(rt["const"])
    return None


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


def _literal_object_validator_code(
    name: str, union_items: list[Any], schema_annotation: str | None = None
) -> str:
    """Emits the `LiteralObject` type that rejects keys forbidden by `not` clauses.

    Args:
        name: The union that the literal object belongs to, for error messages.
        union_items: The union branches, whose `not` clauses list forbidden keys.
        schema_annotation: An annotation that shapes the type's JSON schema.
    """
    forbidden_keys: set[str] = set()
    for it in union_items:
        if not (isinstance(it, dict) and it.get("type") == "object" and "not" in it):
            continue
        forbidden_keys.update(_not_clause_forbidden_keys(name, it["not"]))

    if forbidden_keys:
        forbidden_set_repr = (
            "{" + ", ".join(f'"{k}"' for k in sorted(forbidden_keys)) + "}"
        )
    else:
        forbidden_set_repr = "set()"
    annotations = ["dict[str, Any]", "AfterValidator(_validate_literal_object)"]
    if schema_annotation:
        annotations.append(schema_annotation)
    return f"""def _validate_literal_object(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError("Expected a dictionary object")
    forbidden = {forbidden_set_repr}
    found = forbidden.intersection(v.keys())
    if found:
        raise ValueError(
            f"Object in {name} cannot contain forbidden properties: {{', '.join(sorted(found))}}"
        )
    return v

LiteralObject = Annotated[{", ".join(annotations)}]"""


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
    versioned_symbols = {"ComponentCommon", "FunctionCall"} | {
        name for name, spec in defs.items() if is_dynamic_def(spec)
    }
    if is_at_least_v10(version):
        versioned_symbols.add("DataBinding")
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
        """Renders a spec fragment as Python code whose `$ref`s come from models.

        An `anyOf` is marked to be kept, since the cleaner otherwise rewrites
        it to `oneOf`.
        """
        if isinstance(node, list):
            return "[" + ", ".join(_render_schema_code(item) for item in node) + "]"
        if not isinstance(node, dict):
            return repr(node)
        if isinstance(node.get("$ref"), str):
            ref = node["$ref"]
            if len(node) != 1:
                # Pydantic would not register the referenced def.
                raise ValueError(f"Unsupported $ref with sibling keywords: {node}")
            ref_name = _local_ref_name(ref)
            if ref_name is not None and _is_model_def(ref_name):
                imports.helpers.add("model_ref")
                return f"model_ref({ref_name}, handler)"
            if ref.endswith(_CATALOG_FUNCTIONS_REF_SUFFIX):
                imports.helpers.add("catalog_functions")
                return "catalog_functions()"
            raise ValueError(f"Unsupported $ref in a composition: {ref}")
        items = [f"{json.dumps(k)}: {_render_schema_code(v)}" for k, v in node.items()]
        if "anyOf" in node:
            imports.helpers.add("KEEP_ANY_OF_MARKER")
            items.append("KEEP_ANY_OF_MARKER: True")
        return "{" + ", ".join(items) + "}"

    def _render_keywords_code(keywords: dict[str, Any]) -> str:
        """Renders a def's top-level keywords, carrying `title` as a spec title."""
        items = []
        for key, value in keywords.items():
            if key == "title":
                imports.helpers.add("SPEC_TITLE_KEY")
                items.append(f"SPEC_TITLE_KEY: {_render_schema_code(value)}")
            else:
                items.append(f"{json.dumps(key)}: {_render_schema_code(value)}")
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

        The model validates its fields; `_one_of_required_validator_code`
        validates a `oneOf` of required fields; the catalog validates the
        function a `oneOf` of catalog functions selects. Other composition
        next to `properties` would only be published, so it is rejected.
        """
        unsupported = [
            key for key in ("allOf", "anyOf", "not", "patternProperties") if key in spec
        ]
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

    def _spec_hook_code(name: str, spec: dict[str, Any]) -> str:
        """Emits `__get_pydantic_json_schema__` for keywords fields cannot produce.

        When the spec declares properties, the model derives them and the hook
        adds the spec's other keywords (see `_SPEC_KEYWORDS`). Models forbid
        extra keys, so Pydantic emits `additionalProperties: false`; where the
        spec leaves it out, the hook removes it. Catalogs get the same schema,
        except when a keyword references the catalog's function union: that
        keyword is only published, and catalogs keep the flat model schema.

        Otherwise the spec is pure composition and the published schema is the
        spec, with `$ref`s resolved through the models.

        The hook applies to the model itself; subclasses keep their own schema.

        Returns:
            The hook method, or an empty string if the spec needs none.

        Raises:
            ValueError: If the spec uses keywords that nothing would enforce.
        """
        if "properties" in spec:
            _check_model_keywords(name, spec)
            keywords = {k: spec[k] for k in _SPEC_KEYWORDS if k in spec}
            open_in_spec = "additionalProperties" not in spec
            if not keywords and not open_in_spec:
                return ""
            lines = []
            if open_in_spec:
                lines.append("target.pop('additionalProperties', None)\n")
            if keywords:
                lines.append(f"target.update({_render_keywords_code(keywords)})\n")
            body = (
                "        json_schema = handler(core_schema)\n"
                f"        if cls is not {name}:\n"
                "            return json_schema\n"
            )
            if _is_catalog_functions_one_of(spec):
                body += (
                    "        if not is_spec_schema():\n            return json_schema\n"
                )
            body += "        target = handler.resolve_ref_schema(json_schema)\n"
            body += "".join(f"        {line}" for line in lines)
            body += "        return json_schema\n"
        else:
            if not any(key in spec for key in ("allOf", "anyOf", "oneOf")):
                raise ValueError(f"Unsupported object def without properties: {name}")
            body = (
                f"        if not is_spec_schema() or cls is not {name}:\n"
                "            return handler(core_schema)\n"
                f"        return {_render_keywords_code(spec)}\n"
            )
        imports.json_schema_hook = True
        if "is_spec_schema()" in body:
            imports.helpers.add("is_spec_schema")
        return (
            "\n\n    @classmethod\n"
            "    def __get_pydantic_json_schema__(\n"
            "        cls, core_schema: CoreSchema, handler: GetJsonSchemaHandler\n"
            "    ) -> JsonSchemaValue:\n"
            + body
        )

    def _one_of_required_validator_code(name: str, spec: dict[str, Any]) -> str:
        """Emits a validator for a `oneOf` that selects between required fields.

        For example, `FunctionResponse` requires exactly one of `value` and
        `error`. A field counts as present when it is set, even to None.

        Returns:
            The validator method, or an empty string if the spec needs none.
        """
        branches = spec.get("oneOf")
        if not (
            "properties" in spec
            and isinstance(branches, list)
            and branches
            and all(isinstance(b, dict) and set(b) == {"required"} for b in branches)
        ):
            return ""
        field_groups = tuple(
            tuple(to_snake_case(prop) for prop in branch["required"])
            for branch in branches
        )
        choices = " | ".join(", ".join(branch["required"]) for branch in branches)
        imports.model_validator = True
        return (
            '\n\n    @model_validator(mode="after")\n    def'
            f" _check_one_of_required(self) -> {name}:\n        branches ="
            f" {field_groups!r}\n        matched = sum(\n            all(field in"
            " self.model_fields_set for field in fields)\n            for fields in"
            " branches\n        )\n        if matched != 1:\n            raise"
            f' ValueError("{name} must set exactly one of: {choices}")\n        return'
            " self\n"
        )

    def _compile_model(
        name: str,
        spec: dict[str, Any],
        base_class: str | None = None,
        inline: bool = False,
    ) -> None:
        """Compiles an object def into a model, with helper models for nested objects.

        A nested object property with its own properties becomes a helper model
        named after its parent and property, for example
        `ComponentCommonMetadata`. Helper models carry `INLINE_DEF_MARKER`, so
        schemas put them back inline at their references, as the specification
        does.
        """
        model_props: dict[str, Any] = {}
        for prop_name, prop in spec.get("properties", {}).items():
            if (
                isinstance(prop, dict)
                and prop.get("type") == "object"
                and "properties" in prop
            ):
                helper_name = f"{name}{to_pascal_case(prop_name)}"
                _compile_model(helper_name, prop, inline=True)
                ref: dict[str, Any] = {"$ref": f"#/$defs/{helper_name}"}
                if "description" in prop:
                    ref["description"] = prop["description"]
                prop = ref
            model_props[prop_name] = prop
        model_code = codegen.compile_object_def(
            name, {**spec, "properties": model_props}, base_class=base_class
        )
        if inline:
            imports.helpers.add("INLINE_DEF_MARKER")
            model_code = model_code.replace(
                "model_config = ConfigDict(",
                "model_config = ConfigDict(json_schema_extra={INLINE_DEF_MARKER:"
                " True}, ",
                1,
            )
        common_blocks.append(
            model_code.rstrip()
            + _spec_hook_code(name, spec)
            + _one_of_required_validator_code(name, spec)
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
        imports.helpers |= {"JsonSchemaKeywords", "OpenObject", "is_identifier_key"}
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
            f'    "{name}",\n'
            "    Annotated[\n"
            "        OpenObject,\n"
            f"        AfterValidator({validator}),\n"
            f"        JsonSchemaKeywords({_render_schema_code(keywords)}),\n"
            "    ],\n"
            ")"
        )

    def _check_def_keywords(name: str, spec: dict[str, Any], allowed: set[str]) -> None:
        unsupported = set(spec) - allowed
        if unsupported:
            raise ValueError(f"Unsupported keywords in {name}: {sorted(unsupported)}")

    # Dynamic compilation from $defs:
    processed: set[str] = set(imports_from_common)

    def _compile_def(name: str, spec: dict[str, Any]) -> None:
        if name in processed:
            return

        # Special handling for structural composite types:
        if name == "ChildList":
            if "oneOf" in spec and len(spec["oneOf"]) > 1:
                template_spec = spec["oneOf"][1]
                common_blocks.append(
                    codegen.compile_object_def(
                        "TemplateChildList",
                        template_spec,
                        base_class="StrictBaseModel, ListReference",
                    )
                )
                common_blocks.append(f"ChildList = {' | '.join(_CHILD_LIST_BRANCHES)}")
            else:
                common_blocks.append(codegen.compile_union_def("ChildList", spec))
            processed.add(name)
            return

        if name == "Action":
            if "oneOf" in spec:
                event_part = spec["oneOf"][0]
                if "properties" in event_part and "event" in event_part["properties"]:
                    common_blocks.append(
                        codegen.compile_object_def(
                            "ActionEvent", event_part["properties"]["event"]
                        )
                    )
                    event_wrapper_spec = dict(event_part)
                    event_wrapper_spec["properties"] = dict(event_part["properties"])
                    event_wrapper_spec["properties"]["event"] = {
                        "$ref": "#/$defs/ActionEvent",
                        "description": (
                            event_part["properties"]["event"].get("description", "")
                        ),
                    }
                    common_blocks.append(
                        codegen.compile_object_def(
                            "ActionEventWrapper", event_wrapper_spec
                        )
                    )
                if len(spec["oneOf"]) > 1 and "properties" in spec["oneOf"][1]:
                    common_blocks.append(
                        codegen.compile_object_def(
                            "ActionFunctionCallWrapper", spec["oneOf"][1]
                        )
                    )
                common_blocks.append(
                    "Action = ActionEventWrapper | ActionFunctionCallWrapper"
                )
            else:
                common_blocks.append(codegen.compile_union_def("Action", spec))
            processed.add(name)
            return

        if name == "FunctionCall":
            # The model is flattened so any function call validates without the
            # catalog. The spec's composition keywords and precise `args` shape
            # are expressed as JSON schema hooks over the models instead.
            if "properties" in spec:
                fn_props = dict(spec["properties"])
                if "args" in fn_props:
                    args_spec = dict(fn_props["args"])
                    schema_as_constants["_FUNCTION_CALL_ARGS_SCHEMA"] = (
                        _schema_only_type_expr(args_spec, field_root=True),
                        "FunctionCall",
                    )
                    args_spec[PYTHON_TYPE_KEY] = (
                        "Annotated[dict[str, Any], _FUNCTION_CALL_ARGS_SCHEMA]"
                    )
                    imports.helpers.add("JsonSchemaAs")
                    fn_props["args"] = args_spec
                fn_spec = {
                    "description": spec.get("description", "Invokes a named function."),
                    "properties": fn_props,
                    "required": spec.get("required", ["call"]),
                }
                fn_code = codegen.compile_object_def("FunctionCall", fn_spec)
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
            else:
                fn_common = defs.get("FunctionCommon", {})
                fn_props = {}
                call_key = (
                    "@call" if "@call" in fn_common.get("properties", {}) else "call"
                )
                if call_key in fn_common.get("properties", {}):
                    fn_props[call_key] = fn_common["properties"][call_key]
                else:
                    fn_props[call_key] = {
                        "type": "string",
                        "description": "The name of the function to call.",
                    }
                fn_props["args"] = {
                    "type": "object",
                    "description": "Arguments passed to the function.",
                }
                for k, v in fn_common.get("properties", {}).items():
                    if k != call_key:
                        fn_props[k] = v
                fn_spec = {
                    "description": spec.get("description", "Invokes a named function."),
                    "properties": fn_props,
                    "required": fn_common.get("required", [call_key]),
                }
                fn_code = codegen.compile_object_def("FunctionCall", fn_spec)
            fn_code = fn_code.rstrip() + _spec_hook_code(name, spec)
            common_blocks.append(fn_code)
            processed.add(name)
            return

        if is_dynamic_def(spec):
            expected_rt = _function_call_return_type(spec)
            if expected_rt and "_ReturnType" not in processed:
                common_blocks.append(_RETURN_TYPE_ANNOTATION_CODE)
                processed.add("_ReturnType")
            if expected_rt:
                fn_branch = f'Annotated[FunctionCall, _ReturnType("{expected_rt}")]'
            else:
                fn_branch = "FunctionCall"

            # Members follow the spec's branch order, which the JSON schema keeps.
            members: list[str] = []
            for branch in spec["oneOf"]:
                if not isinstance(branch, dict):
                    raise ValueError(f"Unsupported branch in {name}: {branch}")
                if branch.get("$ref") == "#/$defs/DataBinding":
                    members.append("DataBinding")
                elif is_function_call_branch(branch):
                    members.append(fn_branch)
                elif branch.get("type") == "object" and "not" in branch:
                    # The `not` clause keeps the branch exclusive of bindings
                    # and function calls, which catalogs rely on too.
                    imports.helpers.add("JsonSchemaKeywords")
                    not_code = _render_schema_code({"not": branch["not"]})
                    common_blocks.append(
                        _literal_object_validator_code(
                            name,
                            spec["oneOf"],
                            f"JsonSchemaKeywords({not_code},"
                            ' drop=("additionalProperties",))',
                        )
                    )
                    members.append("LiteralObject")
                else:
                    members.append(_strict_literal_type(branch))
            common_blocks.append(f"{name} = {' | '.join(members)}")
            processed.add(name)
            return

        # Generic schema compilation:
        if "oneOf" in spec or "anyOf" in spec:
            union_items = spec.get("oneOf") or spec.get("anyOf") or []
            has_negated_object = any(
                isinstance(it, dict) and it.get("type") == "object" and "not" in it
                for it in union_items
            )
            if has_negated_object:
                common_blocks.append(_literal_object_validator_code(name, union_items))

                ref_items = []
                non_ref_items = []
                for item in union_items:
                    if isinstance(item, dict) and "$ref" in item:
                        ref_items.append(codegen.map_json_type_to_python("", item))
                    elif (
                        isinstance(item, dict)
                        and item.get("type") == "object"
                        and "not" in item
                    ):
                        continue
                    else:
                        non_ref_items.append(codegen.map_json_type_to_python("", item))

                all_mapped = non_ref_items + ref_items + ["LiteralObject"]
                common_blocks.append(f"{name} = {' | '.join(all_mapped)}")
                processed.add(name)
                return

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
            common_blocks.append(f'{name} = TypeAliasType("{name}", {py_type})')
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
            f'    {alias_name} = TypeAliasType("{alias_target}", {alias_target})'
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
        f'    "{key}": {_common_types_manifest_entry(key, spec, class_names)},'
        for key, spec in defs.items()
    ]
    manifest_code = (
        "COMMON_TYPES_DEFS: Final[dict[str, Any]] = {\n"
        + "\n".join(defs_manifest_lines)
        + "\n}"
    )
    common_blocks.append(manifest_code)

    imports.return_type = "_ReturnType" in processed
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


def generate_agent_to_renderer(
    version: str,
    a2r_data: dict[str, Any],
    a2r_name: str = "",
    common_data: dict[str, Any] | None = None,
) -> str:
    """Generates agent_to_renderer.py / server_to_client.py content."""
    codegen = PydanticCodegen(version)
    codegen.allow_inline = False
    dir_name = version_to_underscore(version)
    is_modern = is_modern_terminology(version, a2r_name)
    defs_a2r = a2r_data.get("$defs", {})

    common_def_names = (
        set(common_data.get("$defs", {}).keys()) if common_data else set()
    )
    referenced_common = find_common_refs(a2r_data, common_def_names)
    needed_imports = ["StrictBaseModel"] + sorted(list(referenced_common))
    import_source = ".common_types" if common_data else "..common_types"
    a2r_imports = f"from {import_source} import {', '.join(needed_imports)}\n"

    a2r_blocks = [
        (
            f"{FILE_HEADER}\n"
            "from typing import Any, Literal\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            + a2r_imports
            + "from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE"
        ),
        "ComponentsList = list[dict[str, Any]]\nComponent = dict[str, Any]",
    ]

    msg_names = []
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
                    a2r_blocks.append(
                        codegen.compile_object_def(payload_name, payload_schema)
                    )

            snake_env = to_snake_case(envelope_key)
            alias_opt = f', alias="{envelope_key}"' if snake_env != envelope_key else ""
            a2r_blocks.append(
                f"class {mname}(StrictBaseModel):\n"
                "    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION\n"
                f"    {snake_env}: {payload_name} = Field(...{alias_opt})"
            )
            msg_names.append(mname)
    else:
        props = a2r_data.get("properties", {})
        for key, val_schema in props.items():
            pascal_key = to_pascal_case(key)
            payload_name = pascal_key
            mname = f"{pascal_key}Message"
            a2r_blocks.append(codegen.compile_object_def(payload_name, val_schema))
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
                    "    code: str | None = Field(None)\n"
                    "    message: str | None = Field(None)"
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
            f" {cap_cls_name} | None = Field(None, alias=PROTOCOL_VERSION)"
        )
    else:
        caps_blocks.append(
            f"class A2uiClientCapabilities(StrictBaseModel):\n    {dir_name}:"
            f" {cap_cls_name} | None = Field(None, alias=PROTOCOL_VERSION)"
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
            f" {cap_cls_name} | None = Field(None, alias=PROTOCOL_VERSION)"
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
            f" {cap_cls_name} | None = Field(None, alias=PROTOCOL_VERSION)"
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
