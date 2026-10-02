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

"""Internal JSON schema helpers for the generated common types models.

Some specification schemas use constructs Pydantic cannot derive from model
fields: composition (`allOf`/`oneOf`) over other models, a reference to the
catalog's function union in another document, or an `anyOf` that must not be
rewritten to `oneOf`. The generated models declare such keywords with these
helpers, so no specification schema is copied verbatim.

This module is internal to a2ui-core and is not re-exported by any facade.
"""

from __future__ import annotations

import copy
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Annotated, Any, Final

from pydantic import GetCoreSchemaHandler, GetJsonSchemaHandler, TypeAdapter
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import core_schema

# Pydantic rejects `$ref`s it has not registered while it generates a schema,
# so declared keywords reference other defs through these markers, which
# `resolve_ref_markers` replaces afterwards: one for the catalog's function
# union in another document, and one for a def of the same document.
CATALOG_FUNCTIONS_MARKER: Final[str] = "x-a2ui-catalog-functions"
CATALOG_FUNCTIONS_REF: Final[str] = "catalog.json#/$defs/anyFunction"
DEF_REF_MARKER: Final[str] = "x-a2ui-def-ref"

# Marks a union whose `anyOf` is kept, because its branches may overlap.
KEEP_ANY_OF_MARKER: Final[str] = "x-a2ui-keep-anyOf"

# Carries a specification `title`. Pydantic's own titles are dropped when the
# schema is cleaned; this one becomes the `title` keyword instead.
SPEC_TITLE_KEY: Final[str] = "x-a2ui-title"

# Marks the def of a model that stands for a nested object in the
# specification, for example `ComponentCommonMetadata`. Pydantic emits every
# model as a `$defs` entry; `inline_marked_defs` puts the object back inline.
INLINE_DEF_MARKER: Final[str] = "x-a2ui-inline"

# Leading keyword order of an inlined def, as the specification writes them.
_INLINED_KEYWORD_ORDER: Final[tuple[str, ...]] = ("type", "description", "properties")

# Whether JSON schemas are generated in the specification's shape.
_SPEC_SCHEMA: ContextVar[bool] = ContextVar("_SPEC_SCHEMA", default=False)


@contextmanager
def spec_schema() -> Iterator[None]:
    """Generates JSON schemas in the specification's shape within the block.

    The specification composes some definitions with the catalog's function
    union, which only resolves next to a catalog. By default the models emit
    the flat shape they validate, which catalogs embed; the published common
    types schema is generated inside this block.
    """
    token = _SPEC_SCHEMA.set(True)
    try:
        yield
    finally:
        _SPEC_SCHEMA.reset(token)


def is_spec_schema() -> bool:
    """Returns whether JSON schemas are generated in the specification's shape."""
    return _SPEC_SCHEMA.get()


def catalog_functions() -> dict[str, Any]:
    """Returns the placeholder for a reference to the catalog's function union."""
    return {CATALOG_FUNCTIONS_MARKER: True}


def def_ref(name: str) -> dict[str, Any]:
    """Returns the placeholder for a `$ref` to the def `name` of the document."""
    return {DEF_REF_MARKER: name}


def resolve_ref_markers(node: Any) -> Any:
    """Replaces the placeholders of `catalog_functions` and `def_ref` with `$ref`s."""
    if isinstance(node, list):
        return [resolve_ref_markers(item) for item in node]
    if not isinstance(node, dict):
        return node
    ref: str | None = None
    if node.get(CATALOG_FUNCTIONS_MARKER) is True:
        ref = CATALOG_FUNCTIONS_REF
    elif isinstance(node.get(DEF_REF_MARKER), str):
        ref = f"#/$defs/{node[DEF_REF_MARKER]}"
    rest = {
        k: resolve_ref_markers(v)
        for k, v in node.items()
        if k not in (CATALOG_FUNCTIONS_MARKER, DEF_REF_MARKER)
    }
    return rest if ref is None else {"$ref": ref, **rest}


def inline_marked_defs(document: dict[str, Any]) -> dict[str, Any]:
    """Inlines the defs marked with `INLINE_DEF_MARKER` at their references.

    Sibling keywords of a `$ref` (e.g. a `description`) take precedence over
    the def's own keywords. The marked defs are removed from `$defs`.

    Returns:
        A copy of `document` without marked defs.
    """
    defs = document.get("$defs")
    if not isinstance(defs, dict):
        return document
    marked = {
        name: {k: v for k, v in schema.items() if k != INLINE_DEF_MARKER}
        for name, schema in defs.items()
        if isinstance(schema, dict) and schema.get(INLINE_DEF_MARKER) is True
    }
    if not marked:
        return document

    def inline(node: Any, visiting: frozenset[str]) -> Any:
        if isinstance(node, list):
            return [inline(item, visiting) for item in node]
        if not isinstance(node, dict):
            return node
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/$defs/"):
            name = ref[len("#/$defs/") :]
            if name in marked:
                if name in visiting:
                    raise ValueError(f"Cannot inline the recursive def '{name}'.")
                siblings = {k: v for k, v in node.items() if k != "$ref"}
                merged = {**marked[name], **siblings}
                ordered = {k: merged[k] for k in _INLINED_KEYWORD_ORDER if k in merged}
                ordered.update(merged)
                return inline(copy.deepcopy(ordered), visiting | {name})
        return {k: inline(v, visiting) for k, v in node.items()}

    result: dict[str, Any] = {
        k: inline(v, frozenset()) for k, v in document.items() if k != "$defs"
    }
    kept = {name: schema for name, schema in defs.items() if name not in marked}
    if kept:
        result["$defs"] = inline(kept, frozenset())
    return result


class JsonSchemaAs:
    """Annotation that derives a field's JSON schema from another type.

    Validation still uses the annotated type. This lets a field document the
    specification's precise shape without changing what it accepts. It
    applies only within `spec_schema()`.
    """

    def __init__(self, schema_type: Any) -> None:
        self.schema_type = schema_type
        self._adapter: TypeAdapter[Any] | None = None
        self._generating: ContextVar[bool] = ContextVar(
            f"json_schema_as_{id(self)}", default=False
        )

    def __get_pydantic_json_schema__(
        self, schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        if not is_spec_schema():
            return handler(schema)
        # The schema type may contain the model that owns this field, for
        # example `FunctionCall` inside `DynamicValue`. Pydantic inlines that
        # model and only records its definition once it is complete, so the
        # nested copy would recurse forever. The nested copy gets an empty
        # schema instead; the outer copy completes afterwards and replaces its
        # definition, so the published schema is unaffected. The guard needs a
        # single shared instance, so declare it once at module level.
        if self._generating.get():
            return {}
        # Built on first use, when every model the type refers to is defined.
        if self._adapter is None:
            self._adapter = TypeAdapter(self.schema_type)
        token = self._generating.set(True)
        try:
            return handler(self._adapter.core_schema)
        finally:
            self._generating.reset(token)


class KeepAnyOf:
    """Annotation marking a union whose JSON schema keeps `anyOf`."""

    def __get_pydantic_json_schema__(
        self, schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(schema)
        json_schema[KEEP_ANY_OF_MARKER] = True
        return json_schema


class _OmitAdditionalProperties:
    """Annotation that drops the implied `additionalProperties: true`."""

    def __get_pydantic_json_schema__(
        self, schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(schema)
        if json_schema.get("additionalProperties") is True:
            del json_schema["additionalProperties"]
        return json_schema


# An object with any keys, emitted as a plain `{"type": "object"}`.
OpenObject = Annotated[dict[str, Any], _OmitAdditionalProperties()]


class SchemaKeywords:
    """JSON schema keywords that a type or model cannot produce itself.

    Use it as an `Annotated` metadata item, or as a model's
    `json_schema_extra`. On a model, the keywords apply only to the model
    whose config declares them; subclasses inherit the config but keep their
    own schema. For example, `ComponentCommon` leaves `additionalProperties`
    out as the specification does, while catalog components that subclass it
    stay closed. A `oneOf` of required properties that a model declares is
    also validated (see `SpecBaseModel`).

    Args:
        keywords: Keywords to set, for example `unevaluatedProperties`.
        drop: Keywords to remove first, for example `additionalProperties`
            where the specification leaves the object open.
        spec_only: Whether the keywords apply only within `spec_schema()`,
            because they reference the catalog's function union.
        replace: Whether the keywords replace the schema except its
            `description`, for a def that the specification writes as pure
            composition.
    """

    def __init__(
        self,
        keywords: dict[str, Any] | None = None,
        *,
        drop: tuple[str, ...] = (),
        spec_only: bool = False,
        replace: bool = False,
    ) -> None:
        self.keywords = keywords or {}
        self.drop = drop
        self.spec_only = spec_only
        self.replace = replace

    def declared_by(self, cls: type[Any]) -> bool:
        """Returns whether `cls` declares these keywords, not a base class."""
        return not any(
            getattr(base, "model_config", {}).get("json_schema_extra") is self
            for base in cls.__mro__[1:]
        )

    def required_one_of(self) -> list[list[str]] | None:
        """Returns the property groups of a `oneOf` of required properties.

        For example `FunctionResponse` requires exactly one of `value` and
        `error`. Returns None if the keywords have no such `oneOf`.
        """
        branches = self.keywords.get("oneOf")
        if not (
            isinstance(branches, list)
            and branches
            and all(isinstance(b, dict) and set(b) == {"required"} for b in branches)
        ):
            return None
        return [list(branch["required"]) for branch in branches]

    def apply(self, schema: dict[str, Any]) -> None:
        """Applies the keywords to `schema` in place."""
        if self.spec_only and not is_spec_schema():
            return
        keywords = copy.deepcopy(self.keywords)
        if self.replace:
            kept = {k: schema[k] for k in ("description",) if k in schema}
            schema.clear()
            if "type" in keywords:
                schema["type"] = keywords["type"]
            schema.update(kept)
        for keyword in self.drop:
            schema.pop(keyword, None)
        schema.update(keywords)

    def __call__(self, schema: dict[str, Any], cls: type[Any]) -> None:
        if self.declared_by(cls):
            self.apply(schema)

    def __get_pydantic_json_schema__(
        self, schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        json_schema = handler(schema)
        self.apply(handler.resolve_ref_schema(json_schema))
        return json_schema


class ReturnType:
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

    def _validate(self, call: Any) -> Any:
        if "return_type" in call.model_fields_set:
            if call.return_type != self.expected:
                raise ValueError(
                    "FunctionCall in Dynamic type must have returnType"
                    f" '{self.expected}', got '{call.return_type}'"
                )
            return call
        if call.return_type != self.expected:
            call = call.model_copy()
            object.__setattr__(call, "return_type", self.expected)
        return call


def is_identifier_key(key: str) -> bool:
    """Returns whether `key` is a Unicode identifier (UAX #31).

    This is the check that the pattern `^[\\p{XID_Start}_][\\p{XID_Continue}]*$`
    describes; Python's `re` module cannot compile `\\p{...}` classes.
    """
    return key.isidentifier()
