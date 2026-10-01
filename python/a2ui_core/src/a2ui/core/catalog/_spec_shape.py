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

"""Specification-shaped catalog schemas of component and function models.

A component model composes base models, as the specification composes defs
with `allOf`: the common types models (for example `ComponentCommon` and
`Checkable`) and catalog models (for example `CatalogComponentCommon`). A
function's args model is the specification's `args` object. This module
turns such models back into the specification's schemas. The layout rules
depend only on the protocol version, not on the catalog.

This module is internal to a2ui-core and is not re-exported by any facade.
"""

from __future__ import annotations

import inspect
from typing import Any, Final, NamedTuple, TypeGuard

from pydantic import BaseModel

from ..common.semver import is_at_least_version
from ..schema import ProtocolVersion
from ..schema.common_types_schema import get_common_types_symbols

_REF_TEMPLATE: Final[str] = "#/$defs/{model}"

# The common types model every component model derives from.
_COMPONENT_COMMON: Final[str] = "ComponentCommon"

# The discriminator property of a component.
_COMPONENT_KEY: Final[str] = "component"


class SpecSchema(NamedTuple):
    """A specification-shaped schema and the defs it needs.

    Attributes:
        schema: The component or function schema.
        catalog_defs: Defs of the catalog models the schema composes, for
            example `CatalogComponentCommon`.
        model_defs: The defs Pydantic emitted for the models' fields, which
            the catalog resolves to common types or writes inline.
    """

    schema: dict[str, Any]
    catalog_defs: dict[str, Any]
    model_defs: dict[str, Any]


def _is_model(value: Any) -> TypeGuard[type[BaseModel]]:
    return isinstance(value, type) and issubclass(value, BaseModel)


def _own_fields(model: type[BaseModel]) -> list[str]:
    """Returns the names of the fields `model` declares, not inherits."""
    inherited: set[str] = set()
    for base in model.__bases__:
        if _is_model(base):
            inherited.update(base.model_fields)
    return [name for name in model.model_fields if name not in inherited]


def _description(model: type[BaseModel]) -> str | None:
    """Returns the description of `model`'s own docstring, if any."""
    doc = model.__dict__.get("__doc__")
    return inspect.cleandoc(doc) if isinstance(doc, str) and doc.strip() else None


def _object_schema(
    model: type[BaseModel], description: str | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Returns the object schema of `model`'s own fields and their defs.

    The schema has `type`, the optional `description`, `properties` and
    `required`, as the specification writes an object.
    """
    flat = model.model_json_schema(ref_template=_REF_TEMPLATE)
    aliases = [model.model_fields[name].alias or name for name in _own_fields(model)]
    properties = {alias: flat["properties"][alias] for alias in aliases}
    required = [name for name in flat.get("required", []) if name in properties]
    schema: dict[str, Any] = {"type": "object"}
    if description:
        schema["description"] = description
    schema["properties"] = properties
    if required:
        schema["required"] = required
    return schema, flat.get("$defs", {})


def _composed_models(model: type[BaseModel]) -> list[type[BaseModel]]:
    """Returns the models that `model`'s bases compose, roots first.

    Each base contributes its ancestors that declare fields, so a base that
    extends another (for example `CatalogComponentCommon` extending
    `ComponentCommon`) composes both, as the specification does.
    """
    composed: list[type[BaseModel]] = []
    for base in model.__bases__:
        if not _is_model(base):
            continue
        for ancestor in reversed(base.__mro__):
            if (
                _is_model(ancestor)
                and ancestor not in composed
                and _own_fields(ancestor)
            ):
                composed.append(ancestor)
    return composed


class SpecShaper:
    """Builds specification-shaped schemas for a protocol version (v0.9+).

    Args:
        protocol_version: The catalog's protocol version.
    """

    def __init__(self, protocol_version: ProtocolVersion) -> None:
        self._v1 = is_at_least_version(protocol_version, ProtocolVersion.V1_0)
        symbols = get_common_types_symbols(protocol_version)
        # The common types models, which the catalog references by def name.
        self.common_models: dict[type[BaseModel], str] = {
            symbol: name for name, symbol in symbols.items() if _is_model(symbol)
        }
        self._component_common = symbols.get(_COMPONENT_COMMON)

    def component_schema(self, name: str, model: Any) -> SpecSchema | None:
        """Returns the specification schema of a component model.

        Args:
            name: The component's name.
            model: The component's model class.

        Returns:
            The schema, or None if `model` is not a model that derives from the
            version's `ComponentCommon`.
        """
        if not (
            _is_model(model)
            and _is_model(self._component_common)
            and issubclass(model, self._component_common)
        ):
            return None

        catalog_defs: dict[str, Any] = {}
        model_defs: dict[str, Any] = {}
        refs: list[dict[str, Any]] = []
        for composed in _composed_models(model):
            # From v1.0 on, the message envelope adds `ComponentCommon`.
            if self._v1 and composed is self._component_common:
                continue
            def_name = self.common_models.get(composed)
            if def_name is None:
                def_name = composed.__name__
                catalog_defs[def_name], defs = _object_schema(
                    composed, _description(composed)
                )
                model_defs.update(defs)
            refs.append({"$ref": f"#/$defs/{def_name}"})

        description = _description(model)
        # The specification puts a v1.0 description on the component and a
        # v0.9 description on the object of its own properties.
        inner, defs = _object_schema(model, None if self._v1 else description)
        model_defs.update(defs)
        properties = inner["properties"]
        if _COMPONENT_KEY in properties:
            properties[_COMPONENT_KEY] = {"const": name}
            required = inner.setdefault("required", [])
            if _COMPONENT_KEY not in required:
                required.insert(0, _COMPONENT_KEY)

        schema: dict[str, Any] = {"type": "object"}
        if self._v1:
            if description:
                schema["description"] = description
            if refs:
                schema["allOf"] = [*refs, inner]
            else:
                schema.update({k: v for k, v in inner.items() if k != "type"})
        else:
            schema["allOf"] = [*refs, inner]
            schema["unevaluatedProperties"] = False
        return SpecSchema(schema, catalog_defs, model_defs)

    def function_schema(self, function: Any) -> SpecSchema | None:
        """Returns the specification schema of a function call.

        Args:
            function: The function's API, whose `schema` is its args model.

        Returns:
            The schema, or None if the function's `schema` is not a model.
        """
        args_model = getattr(function, "schema", None)
        if not _is_model(args_model):
            return None
        args = args_model.model_json_schema(ref_template=_REF_TEMPLATE)
        model_defs = args.pop("$defs", {})
        args.pop("title", None)
        args = {"type": "object", **{k: v for k, v in args.items() if k != "type"}}

        call = {"const": function.name}
        description = getattr(function, "description", None)
        schema: dict[str, Any] = {"type": "object"}
        if description:
            schema["description"] = description
        if self._v1:
            schema["returnType"] = function.return_type
            if getattr(function, "requires_user_activation", False):
                schema["requiresUserActivation"] = True
            schema["properties"] = {"@call": call, "args": args}
            schema["required"] = ["@call", "args"]
        else:
            schema["properties"] = {
                "call": call,
                "args": args,
                "returnType": {"const": function.return_type},
            }
            schema["required"] = ["call", "args"]
            schema["unevaluatedProperties"] = False
        return SpecSchema(schema, {}, model_defs)
