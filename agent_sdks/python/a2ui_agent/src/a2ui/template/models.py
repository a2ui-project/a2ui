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

"""Data models for A2UI Template definitions, typed parameters, expressions, and dynamic resolvers."""

from __future__ import annotations

import asyncio
from enum import Enum
import inspect
import json
from pathlib import Path
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union
import jsonschema

SCHEMA_PATH = Path(__file__).parent / "schema" / "template_definition.json"
with open(SCHEMA_PATH, "r", encoding="utf-8") as _f:
    TEMPLATE_DEFINITION_SCHEMA = json.load(_f)


class ParamType(str, Enum):
    """Supported A2UI semantic parameter types."""

    STRING = "string"
    NUMBER = "number"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    ENUM = "enum"
    OBJECT = "object"
    ARRAY = "array"
    CHILD = "child"
    CHILDREN = "children"
    ACTION = "action"


@dataclass
class Param:
    """Strongly typed template parameter definition."""

    type: Union[ParamType, str]
    title: Optional[str] = None
    description: Optional[str] = None
    default: Optional[Any] = None
    values: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None
    items: Optional[Union[Param, Dict[str, Any], str]] = None
    required: bool = True
    minimum: Optional[float] = None
    maximum: Optional[float] = None

    @classmethod
    def string(
        cls,
        description: Optional[str] = None,
        title: Optional[str] = None,
        default: Optional[str] = None,
    ) -> Param:
        return cls(
            type=ParamType.STRING,
            description=description,
            title=title,
            default=default,
        )

    @classmethod
    def number(
        cls,
        description: Optional[str] = None,
        title: Optional[str] = None,
        default: Optional[float] = None,
    ) -> Param:
        return cls(
            type=ParamType.NUMBER,
            description=description,
            title=title,
            default=default,
        )

    @classmethod
    def integer(
        cls,
        description: Optional[str] = None,
        title: Optional[str] = None,
        default: Optional[int] = None,
    ) -> Param:
        return cls(
            type=ParamType.INTEGER,
            description=description,
            title=title,
            default=default,
        )

    @classmethod
    def boolean(
        cls,
        description: Optional[str] = None,
        title: Optional[str] = None,
        default: Optional[bool] = None,
    ) -> Param:
        return cls(
            type=ParamType.BOOLEAN,
            description=description,
            title=title,
            default=default,
        )

    @classmethod
    def enum(
        cls,
        values: List[str],
        description: Optional[str] = None,
        title: Optional[str] = None,
        default: Optional[str] = None,
    ) -> Param:
        return cls(
            type=ParamType.ENUM,
            values=values,
            description=description,
            title=title,
            default=default,
        )

    @classmethod
    def child(
        cls, description: Optional[str] = None, title: Optional[str] = None
    ) -> Param:
        return cls(type=ParamType.CHILD, description=description, title=title)

    @classmethod
    def children(
        cls, description: Optional[str] = None, title: Optional[str] = None
    ) -> Param:
        return cls(
            type=ParamType.CHILDREN,
            description=description,
            title=title,
            default=[],
        )

    @classmethod
    def action(
        cls, description: Optional[str] = None, title: Optional[str] = None
    ) -> Param:
        return cls(type=ParamType.ACTION, description=description, title=title)

    @classmethod
    def array(
        cls,
        items: Union[Param, Dict[str, Any], str],
        description: Optional[str] = None,
        title: Optional[str] = None,
    ) -> Param:
        return cls(
            type=ParamType.ARRAY, items=items, description=description, title=title
        )

    @classmethod
    def object(
        cls,
        properties: Dict[str, Any],
        description: Optional[str] = None,
        title: Optional[str] = None,
    ) -> Param:
        return cls(
            type=ParamType.OBJECT,
            properties=properties,
            description=description,
            title=title,
        )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Param:
        raw_type = data.get("type", "string")
        p_type = (
            ParamType(raw_type)
            if raw_type in ParamType._value2member_map_
            else raw_type
        )
        return cls(
            type=p_type,
            title=data.get("title"),
            description=data.get("description"),
            default=data.get("default"),
            values=data.get("values"),
            properties=data.get("properties"),
            items=data.get("items"),
            required=data.get("required", True),
            minimum=data.get("minimum"),
            maximum=data.get("maximum"),
        )

    def to_dict(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {
            "type": (
                self.type.value if isinstance(self.type, ParamType) else str(self.type)
            )
        }
        if self.title:
            res["title"] = self.title
        if self.description:
            res["description"] = self.description
        if self.default is not None:
            res["default"] = self.default
        if self.values is not None:
            res["values"] = self.values
        if self.properties is not None:
            res["properties"] = {
                k: v.to_dict() if isinstance(v, Param) else v
                for k, v in self.properties.items()
            }
        if self.items is not None:
            res["items"] = (
                self.items.to_dict() if isinstance(self.items, Param) else self.items
            )
        if self.minimum is not None:
            res["minimum"] = self.minimum
        if self.maximum is not None:
            res["maximum"] = self.maximum
        return res


@dataclass
class ParamRef:
    """Direct reference to a parameter or dot path."""

    param: str
    default: Optional[Any] = None

    def to_dict(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {"param": self.param}
        if self.default is not None:
            res["default"] = self.default
        return res


@dataclass
class Concat:
    """String concatenation expression of literals and parameter references."""

    concat: List[Union[str, ParamRef, Dict[str, Any]]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "concat": [
                (p.to_dict() if isinstance(p, ParamRef) else p) for p in self.concat
            ]
        }


@dataclass
class FormatExpr:
    """String formatting expression with {key} arguments."""

    format: str
    args: Dict[str, Union[str, ParamRef, Dict[str, Any]]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "format": self.format,
            "args": {
                k: v.to_dict() if isinstance(v, ParamRef) else v
                for k, v in self.args.items()
            },
        }


@dataclass
class TemplateLoop:
    """Array mapping parameter to child template instances."""

    param: str
    template: str

    def to_dict(self) -> Dict[str, Any]:
        return {"param": self.param, "template": self.template}


@dataclass
class TemplateComponent:
    """Strongly typed template component definition."""

    id: str
    component: str
    properties: Dict[str, Any] = field(default_factory=dict)
    child: Optional[Union[str, ParamRef, Dict[str, Any]]] = None
    children: Optional[Union[List[Any], ParamRef, TemplateLoop, Dict[str, Any]]] = None

    def to_dict(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {"id": self.id, "component": self.component}
        if self.child is not None:
            res["child"] = (
                self.child.to_dict() if isinstance(self.child, ParamRef) else self.child
            )
        if self.children is not None:
            if isinstance(self.children, (ParamRef, TemplateLoop)):
                res["children"] = self.children.to_dict()
            else:
                res["children"] = self.children
        for k, v in self.properties.items():
            if isinstance(v, (ParamRef, Concat, FormatExpr, TemplateLoop)):
                res[k] = v.to_dict()
            else:
                res[k] = v
        return res

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> TemplateComponent:
        data_copy = dict(data)
        c_id = data_copy.pop("id")
        c_type = data_copy.pop("component")
        child = data_copy.pop("child", None)
        children = data_copy.pop("children", None)
        return cls(
            id=c_id,
            component=c_type,
            properties=data_copy,
            child=child,
            children=children,
        )


def normalize_a2ui_type_to_jsonschema(meta: Any) -> Any:
    """Recursively converts an A2UI parameter type schema into standard JSON Schema."""
    if isinstance(meta, Param):
        meta = meta.to_dict()
    if not isinstance(meta, dict):
        return meta
    schema = dict(meta)
    p_type = schema.get("type")
    if p_type == "enum" and "values" in schema:
        schema["type"] = "string"
        schema["enum"] = schema.pop("values")
    elif p_type in ["child", "action"]:
        schema["type"] = "string"
    elif p_type == "children":
        schema["type"] = "array"
        schema["items"] = {"type": "string"}

    if "properties" in schema and isinstance(schema["properties"], dict):
        schema["properties"] = {
            k: normalize_a2ui_type_to_jsonschema(v)
            for k, v in schema["properties"].items()
        }
    if "items" in schema:
        if isinstance(schema["items"], dict) or isinstance(schema["items"], Param):
            schema["items"] = normalize_a2ui_type_to_jsonschema(schema["items"])
        elif isinstance(schema["items"], str):
            schema["items"] = {"type": schema["items"]}
    return schema


@dataclass
class BaseTemplate:
    """Base class for all templates."""

    template_id: str
    description: Optional[str] = None
    sample_data: Optional[Dict[str, Any]] = None
    is_dynamic: bool = False


@dataclass
class StaticTemplate(BaseTemplate):
    """Declarative A2UI template definition with components and parameter substitutions."""

    parameters: Dict[str, Union[Param, Dict[str, Any]]] = field(default_factory=dict)
    components: List[Union[TemplateComponent, Dict[str, Any]]] = field(
        default_factory=list
    )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> StaticTemplate:
        """Constructs a StaticTemplate instance from a dictionary payload."""
        template_id = data.get("templateId") or data.get("template_id")
        if not template_id:
            raise ValueError("Template dictionary must contain 'templateId'.")
        raw_params = data.get("parameters", {})
        parsed_params: Dict[str, Union[Param, Dict[str, Any]]] = {}
        for k, v in raw_params.items():
            parsed_params[k] = Param.from_dict(v) if isinstance(v, dict) else v

        instance = cls(
            template_id=template_id,
            parameters=parsed_params,
            components=data.get("components", []),
            sample_data=data.get("sampleData") or data.get("sample_data"),
            description=data.get("description"),
            is_dynamic=False,
        )
        instance.validate_definition()
        return instance

    @classmethod
    def from_json_file(cls, file_path: str) -> StaticTemplate:
        """Loads and parses a Template definition from a JSON file."""
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)

    def to_dict(self) -> Dict[str, Any]:
        """Serializes the template instance to a dictionary."""
        params_dict: Dict[str, Any] = {}
        for k, v in self.parameters.items():
            params_dict[k] = v.to_dict() if isinstance(v, Param) else v

        comps_list: List[Dict[str, Any]] = []
        for c in self.components:
            comps_list.append(c.to_dict() if isinstance(c, TemplateComponent) else c)

        res: Dict[str, Any] = {
            "templateId": self.template_id,
            "parameters": params_dict,
            "components": comps_list,
        }
        if self.description:
            res["description"] = self.description
        if self.sample_data is not None:
            res["sampleData"] = self.sample_data
        return res

    def validate_definition(self) -> None:
        """Statically validates the template against the JSON Schema, verifies parameter references, and validates sampleData."""
        raw_dict = self.to_dict()
        try:
            jsonschema.validate(instance=raw_dict, schema=TEMPLATE_DEFINITION_SCHEMA)
        except jsonschema.ValidationError as err:
            raise ValueError(
                f"Template '{self.template_id}' fails template_definition.json schema:"
                f" {err.message}"
            ) from err

        expr_pattern = re.compile(r"\$\{([\w\.]+)\}")

        def check_val(val: Any) -> None:
            if isinstance(val, dict):
                if "param" in val and isinstance(val["param"], str):
                    check_path(val["param"])
                if "concat" in val and isinstance(val["concat"], list):
                    for elem in val["concat"]:
                        check_val(elem)
                if "format" in val and "args" in val and isinstance(val["args"], dict):
                    for v in val["args"].values():
                        check_val(v)
                for v in val.values():
                    check_val(v)
            elif isinstance(val, list):
                for item in val:
                    check_val(item)
            elif isinstance(val, str):
                for m in expr_pattern.finditer(val):
                    check_path(m.group(1))

        def check_path(path: str) -> None:
            parts = path.split(".")
            root = parts[0]
            if root not in self.parameters:
                if root.startswith("__"):
                    return
                raise ValueError(
                    f"Template '{self.template_id}': Component references parameter"
                    f" '{root}' in '{path}', but it is not declared in template"
                    " parameters."
                )

            curr_schema = self.parameters[root]
            if isinstance(curr_schema, Param):
                curr_schema = curr_schema.to_dict()
            for part in parts[1:]:
                if isinstance(curr_schema, dict) and "properties" in curr_schema:
                    props = curr_schema.get("properties", {})
                    if part not in props:
                        raise ValueError(
                            f"Template '{self.template_id}': Component references"
                            f" property '{part}' in '{path}', but it is not declared in"
                            f" parameter '{root}' properties."
                        )
                    curr_schema = props[part]

        for comp in self.components:
            comp_dict = comp.to_dict() if isinstance(comp, TemplateComponent) else comp
            check_val(comp_dict)

        if self.sample_data and isinstance(self.sample_data, dict):
            for p_name, p_val in self.sample_data.items():
                if p_name in self.parameters:
                    p_meta = self.parameters[p_name]
                    if isinstance(p_meta, Param):
                        p_type = (
                            p_meta.type.value
                            if isinstance(p_meta.type, ParamType)
                            else str(p_meta.type)
                        )
                    else:
                        p_type = str(p_meta.get("type", "string"))
                    if p_type in ["child", "children", "action"]:
                        continue

                    val_schema = normalize_a2ui_type_to_jsonschema(p_meta)
                    try:
                        jsonschema.validate(instance=p_val, schema=val_schema)
                    except jsonschema.ValidationError as err:
                        raise ValueError(
                            f"Template '{self.template_id}': sampleData for parameter"
                            f" '{p_name}' fails validation: {err.message}"
                        ) from err


# Retain Template alias for backward compatibility
Template = StaticTemplate


class DynamicTemplate(BaseTemplate):
    """Programmatic template that resolves dynamic data server-side before expanding layout."""

    def __init__(
        self,
        template_id: str,
        resolver: Callable[..., Any],
        layout: Union[StaticTemplate, str, Dict[str, Any]],
        parameters: Optional[Dict[str, Union[Param, Dict[str, Any]]]] = None,
        description: Optional[str] = None,
        sample_data: Optional[Dict[str, Any]] = None,
        render_fn: Optional[
            Callable[[str, Dict[str, Any], Any], List[Dict[str, Any]]]
        ] = None,
    ):
        super().__init__(
            template_id=template_id,
            description=description,
            sample_data=sample_data,
            is_dynamic=True,
        )
        self.resolver = resolver
        self.render_fn = render_fn

        if isinstance(layout, str):
            self.layout = StaticTemplate.from_json_file(layout)
        elif isinstance(layout, dict):
            self.layout = StaticTemplate.from_dict(layout)
        else:
            self.layout = layout

        if parameters is not None:
            self.parameters = parameters
        else:
            self.parameters = self._infer_parameters_from_resolver(resolver)

    @staticmethod
    def _infer_parameters_from_resolver(
        fn: Callable[..., Any],
    ) -> Dict[str, Union[Param, Dict[str, Any]]]:
        """Automatically derives parameter definitions from the Python resolver function signature."""
        sig = inspect.signature(fn)
        inferred: Dict[str, Union[Param, Dict[str, Any]]] = {}
        type_map = {
            str: ParamType.STRING,
            int: ParamType.INTEGER,
            float: ParamType.NUMBER,
            bool: ParamType.BOOLEAN,
        }
        for name, p in sig.parameters.items():
            if name in ["self", "kwargs", "context"]:
                continue
            p_type = type_map.get(p.annotation, ParamType.STRING)
            default = p.default if p.default is not inspect.Parameter.empty else None
            inferred[name] = Param(
                type=p_type,
                default=default,
                description=f"Input parameter '{name}' for dynamic resolver.",
            )
        return inferred

    def resolve(self, passed_params: Dict[str, Any]) -> Dict[str, Any]:
        """Executes the resolver synchronously or asynchronously."""
        res = self.resolver(**passed_params)
        if asyncio.iscoroutine(res):
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # Running in async context
                    import nest_asyncio  # type: ignore

                    nest_asyncio.apply()
                    res_val = loop.run_until_complete(res)
                else:
                    res_val = loop.run_until_complete(res)
            except Exception:
                res_val = asyncio.run(res)
            return dict(res_val) if isinstance(res_val, dict) else res_val
        return dict(res) if isinstance(res, dict) else res

    def to_dict(self) -> Dict[str, Any]:
        params_dict: Dict[str, Any] = {}
        for k, v in self.parameters.items():
            params_dict[k] = v.to_dict() if isinstance(v, Param) else v

        res: Dict[str, Any] = {
            "templateId": self.template_id,
            "parameters": params_dict,
            "components": [
                (c.to_dict() if isinstance(c, TemplateComponent) else c)
                for c in self.layout.components
            ],
            "isDynamic": True,
        }
        if self.description:
            res["description"] = self.description
        if self.sample_data is not None:
            res["sampleData"] = self.sample_data
        return res
