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
import functools
import inspect
import json
import os
from pathlib import Path
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
import jsonschema
import yaml


def _find_template_schema_path() -> Optional[Path]:
    """Finds the template definition JSON schema in specification/proposals/templates/schema/."""
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = (
            parent
            / "specification"
            / "proposals"
            / "templates"
            / "schema"
            / "template_definition.json"
        )
        if candidate.is_file():
            return candidate
    return None


SCHEMA_PATH = _find_template_schema_path()
TEMPLATE_DEFINITION_SCHEMA: Optional[Dict[str, Any]] = None
if SCHEMA_PATH and SCHEMA_PATH.is_file():
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
    """Array mapping parameter to child template instances or inline item layouts."""

    param: str
    template: Optional[str] = None
    item: Optional[List[Union[TemplateComponent, Dict[str, Any]]]] = None
    as_var: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {"param": self.param}
        if self.template:
            res["template"] = self.template
        if self.item:
            res["item"] = [
                (c.to_dict() if isinstance(c, TemplateComponent) else c)
                for c in self.item
            ]
        if self.as_var:
            res["as"] = self.as_var
        return res


@dataclass
class TemplateComponent:
    """Strongly typed template component definition."""

    id: str
    component: str
    properties: Dict[str, Any] = field(default_factory=dict)
    child: Optional[Union[str, ParamRef, Dict[str, Any]]] = None
    children: Optional[Union[List[Any], ParamRef, TemplateLoop, Dict[str, Any]]] = None
    catalog_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        res: Dict[str, Any] = {"id": self.id, "component": self.component}
        if self.catalog_id is not None:
            res["catalogId"] = self.catalog_id
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
        c_cat = data_copy.pop("catalogId", None) or data_copy.pop("catalog_id", None)
        child = data_copy.pop("child", None)
        children = data_copy.pop("children", None)
        return cls(
            id=c_id,
            component=c_type,
            catalog_id=c_cat,
            properties=data_copy,
            child=child,
            children=children,
        )


def normalize_node(node: Any) -> Any:
    """Polymorphically converts builder objects, dataclasses, or Pydantic models into dicts."""
    if node is None:
        return None
    if hasattr(node, "to_dict") and callable(node.to_dict):
        return node.to_dict()
    if hasattr(node, "model_dump") and callable(node.model_dump):
        return node.model_dump(exclude_none=True, by_alias=True)
    import dataclasses

    if dataclasses.is_dataclass(node) and not isinstance(node, type):
        return dataclasses.asdict(node)
    return node


def flatten_nested_layout(
    node: Any,
    parent_id: Optional[str] = None,
    slot_name: Optional[str] = None,
    index: Optional[int] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Recursively flattens a nested layout tree (dicts, builder objects) into a flat component graph with synthetic IDs.

    Returns:
        Tuple of (assigned_component_id, list_of_flattened_components)
    """
    node = normalize_node(node)
    if not isinstance(node, dict):
        return str(node), []

    node_copy = dict(node)
    comp_type = node_copy.get("component", "Node").lower()

    # 1. Determine or generate synthetic component ID
    if "id" in node_copy and node_copy["id"]:
        node_id = str(node_copy["id"])
    elif parent_id is None:
        node_id = "root"
    elif slot_name and index is not None:
        node_id = f"{parent_id}_{slot_name}_{index}_{comp_type}"
    elif slot_name:
        node_id = f"{parent_id}_{slot_name}_{comp_type}"
    elif index is not None:
        node_id = f"{parent_id}_{index}_{comp_type}"
    else:
        node_id = f"{parent_id}_{comp_type}"

    node_copy["id"] = node_id
    flat_components: List[Dict[str, Any]] = []

    # 2. Process nested 'child'
    if "child" in node_copy:
        child_val = normalize_node(node_copy["child"])
        if isinstance(child_val, dict) and "component" in child_val:
            child_id, sub_comps = flatten_nested_layout(
                child_val, parent_id=node_id, slot_name="child"
            )
            node_copy["child"] = child_id
            flat_components.extend(sub_comps)
        else:
            node_copy["child"] = child_val

    # 3. Process nested 'children'
    if "children" in node_copy:
        children_val = normalize_node(node_copy["children"])
        if isinstance(children_val, list):
            flattened_child_ids: List[Any] = []
            for idx, raw_item in enumerate(children_val):
                item = normalize_node(raw_item)
                if isinstance(item, dict) and "component" in item:
                    item_id, sub_comps = flatten_nested_layout(
                        item, parent_id=node_id, slot_name="child", index=idx
                    )
                    flattened_child_ids.append(item_id)
                    flat_components.extend(sub_comps)
                elif isinstance(item, dict) and "loop" in item:
                    # Loop inside children list
                    loop_cfg = item["loop"]
                    loop_dict: Dict[str, Any] = {"param": loop_cfg.get("param")}
                    if "as" in loop_cfg:
                        loop_dict["as"] = loop_cfg["as"]
                    if "item" in loop_cfg and isinstance(loop_cfg["item"], dict):
                        _, item_sub_comps = flatten_nested_layout(loop_cfg["item"])
                        loop_dict["item"] = item_sub_comps
                    elif "template" in loop_cfg:
                        loop_dict["template"] = loop_cfg["template"]
                    flattened_child_ids.append(loop_dict)
                else:
                    flattened_child_ids.append(item)
            node_copy["children"] = flattened_child_ids
        elif isinstance(children_val, dict) and "loop" in children_val:
            loop_cfg = children_val["loop"]
            loop_dict = {"param": loop_cfg.get("param")}
            if "as" in loop_cfg:
                loop_dict["as"] = loop_cfg["as"]
            if "item" in loop_cfg and isinstance(loop_cfg["item"], dict):
                _, item_sub_comps = flatten_nested_layout(loop_cfg["item"])
                loop_dict["item"] = item_sub_comps
            elif "template" in loop_cfg:
                loop_dict["template"] = loop_cfg["template"]
            node_copy["children"] = loop_dict
        else:
            node_copy["children"] = children_val

    flat_components.insert(0, node_copy)
    return node_id, flat_components


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
        if isinstance(schema["items"], (dict, Param)):
            schema["items"] = normalize_a2ui_type_to_jsonschema(schema["items"])
        elif isinstance(schema["items"], str):
            schema["items"] = {"type": schema["items"]}
    return schema


@dataclass
class BaseTemplate:
    """Base class for all templates."""

    name: str = ""
    catalogs: List[str] = field(default_factory=list)
    id: Optional[str] = None
    imports: Union[List[str], Dict[str, str]] = field(default_factory=list)
    version: str = "0.1"
    description: Optional[str] = None
    sample_data: Optional[Dict[str, Any]] = None
    is_dynamic: bool = False
    template_id: str = ""

    def __post_init__(self):
        if not self.name and self.template_id:
            self.name = self.template_id
        elif not self.template_id and self.name:
            self.template_id = self.name
        if isinstance(self.catalogs, str):
            self.catalogs = [self.catalogs]


@dataclass
class StaticTemplate(BaseTemplate):
    """Declarative A2UI template definition authored in YAML with layout trees and parameter substitutions."""

    parameters: Dict[str, Union[Param, Dict[str, Any]]] = field(default_factory=dict)
    components: List[Union[TemplateComponent, Dict[str, Any]]] = field(
        default_factory=list
    )
    raw_layout: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> StaticTemplate:
        """Constructs a StaticTemplate instance from a dictionary payload."""
        name = data.get("name") or data.get("templateId") or data.get("template_id")
        if not name:
            raise ValueError(
                "Template dictionary must contain 'name' (or 'templateId')."
            )

        version = data.get("version")
        if not version:
            raise ValueError(f"Template '{name}' missing required 'version' attribute.")
        if version != "0.1":
            raise ValueError(
                f"Unsupported template version '{version}'. Currently only '0.1' is"
                " supported."
            )

        catalogs_raw = data.get("catalogs", [])
        if isinstance(catalogs_raw, str):
            catalogs = [catalogs_raw]
        elif isinstance(catalogs_raw, (list, tuple)):
            catalogs = list(catalogs_raw)
        else:
            catalogs = []

        id_val = data.get("id")
        imports = data.get("imports", [])

        raw_params = data.get("parameters", {})
        parsed_params: Dict[str, Union[Param, Dict[str, Any]]] = {}
        for k, v in raw_params.items():
            parsed_params[k] = Param.from_dict(v) if isinstance(v, dict) else v

        # Flatten nested layout if provided
        raw_layout = data.get("layout")
        components: List[Union[TemplateComponent, Dict[str, Any]]] = []
        if raw_layout and isinstance(raw_layout, dict):
            _, flat_comps = flatten_nested_layout(raw_layout)
            components = list(flat_comps)
        elif "components" in data and isinstance(data["components"], list):
            components = list(data["components"])
        else:
            raise ValueError(
                f"Template '{name}' must declare a 'layout' tree definition."
            )

        instance = cls(
            name=name,
            catalogs=catalogs,
            id=id_val,
            imports=imports,
            template_id=name,
            version=version,
            parameters=parsed_params,
            components=components,
            raw_layout=raw_layout,
            sample_data=data.get("sampleData") or data.get("sample_data"),
            description=data.get("description"),
            is_dynamic=False,
        )
        instance.validate_definition()
        return instance

    @classmethod
    def from_yaml_string(cls, yaml_content: str) -> List[StaticTemplate]:
        """Parses a YAML string containing one or more '---' separated template documents."""
        docs = list(yaml.safe_load_all(yaml_content))
        templates: List[StaticTemplate] = []
        for doc in docs:
            if not doc or not isinstance(doc, dict):
                continue
            templates.append(cls.from_dict(doc))
        if not templates:
            raise ValueError("No valid template definitions found in YAML content.")
        return templates

    @classmethod
    def from_yaml_file(cls, file_path: Union[str, Path]) -> List[StaticTemplate]:
        """Loads and parses all Template definitions from a YAML file."""
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return cls.from_yaml_string(content)

    @classmethod
    def from_yaml(cls, yaml_content: str) -> StaticTemplate:
        """Convenience method to load a single template definition from YAML."""
        templates = cls.from_yaml_string(yaml_content)
        return templates[0]

    def to_dict(self) -> Dict[str, Any]:
        """Serializes the template instance to a dictionary."""
        params_dict: Dict[str, Any] = {}
        for k, v in self.parameters.items():
            params_dict[k] = v.to_dict() if isinstance(v, Param) else v

        comps_list: List[Dict[str, Any]] = []
        for c in self.components:
            comps_list.append(c.to_dict() if isinstance(c, TemplateComponent) else c)

        res: Dict[str, Any] = {
            "version": self.version,
            "name": self.name,
            "templateId": self.name,
            "catalogs": self.catalogs,
            "parameters": params_dict,
        }
        if self.id is not None:
            res["id"] = self.id
        if self.imports:
            res["imports"] = self.imports
        if self.raw_layout is not None:
            res["layout"] = self.raw_layout
        else:
            res["components"] = comps_list

        if self.description:
            res["description"] = self.description
        if self.sample_data is not None:
            res["sampleData"] = self.sample_data
        return res

    def to_yaml(self) -> str:
        """Serializes the template instance to a clean YAML string."""
        return yaml.dump(self.to_dict(), sort_keys=False)

    @staticmethod
    def _collect_loop_vars(val: Any, loop_vars: set) -> None:
        if isinstance(val, dict):
            if "as" in val and isinstance(val["as"], str):
                loop_vars.add(val["as"])
            for v in val.values():
                StaticTemplate._collect_loop_vars(v, loop_vars)
        elif isinstance(val, list):
            for item in val:
                StaticTemplate._collect_loop_vars(item, loop_vars)

    def _check_val(self, val: Any, loop_vars: set) -> None:
        expr_pattern = re.compile(r"(?<!\\)(?:\{\{\s*|\$\{)([\w\.]+)(?:\s*\}\}|\})")
        if isinstance(val, dict):
            if "param" in val and isinstance(val["param"], str):
                self._check_path(val["param"], loop_vars)
            if "concat" in val and isinstance(val["concat"], list):
                for elem in val["concat"]:
                    self._check_val(elem, loop_vars)
            if "format" in val and "args" in val and isinstance(val["args"], dict):
                for v in val["args"].values():
                    self._check_val(v, loop_vars)
            for v in val.values():
                self._check_val(v, loop_vars)
        elif isinstance(val, list):
            for item in val:
                self._check_val(item, loop_vars)
        elif isinstance(val, str):
            for m in expr_pattern.finditer(val):
                self._check_path(m.group(1), loop_vars)

    def _check_path(self, path: str, loop_vars: set) -> None:
        parts = path.split(".")
        root = parts[0]
        if root not in self.parameters:
            if root.startswith("__") or root in loop_vars:
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

    def validate_definition(self) -> None:
        """Statically validates the template against the JSON Schema, verifies parameter references, and validates sampleData."""
        if TEMPLATE_DEFINITION_SCHEMA is not None:
            raw_dict = self.to_dict()
            try:
                jsonschema.validate(
                    instance=raw_dict, schema=TEMPLATE_DEFINITION_SCHEMA
                )
            except jsonschema.ValidationError as err:
                raise ValueError(
                    f"Template '{self.template_id}' fails template_definition.json"
                    f" schema: {err.message}"
                ) from err

        loop_vars = {"item"}
        for comp in self.components:
            comp_dict = comp.to_dict() if isinstance(comp, TemplateComponent) else comp
            self._collect_loop_vars(comp_dict, loop_vars)

        for comp in self.components:
            comp_dict = comp.to_dict() if isinstance(comp, TemplateComponent) else comp
            self._check_val(comp_dict, loop_vars)

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
    """Programmatic template that either executes a data resolver for a static layout or runs a render function returning an AST."""

    def __init__(
        self,
        name: Optional[str] = None,
        catalogs: Optional[Union[List[str], str]] = None,
        id: Optional[str] = None,
        imports: Optional[Union[List[str], Dict[str, str]]] = None,
        render: Optional[Callable[..., Any]] = None,
        resolver: Optional[Callable[..., Any]] = None,
        layout: Optional[Union[StaticTemplate, str, Dict[str, Any]]] = None,
        parameters: Optional[Dict[str, Union[Param, Dict[str, Any]]]] = None,
        description: Optional[str] = None,
        sample_data: Optional[Dict[str, Any]] = None,
        render_fn: Optional[Callable[..., Any]] = None,
        version: str = "0.1",
        template_id: Optional[str] = None,
    ):
        template_name = name or template_id
        if not template_name:
            raise ValueError("DynamicTemplate must provide 'name' (or 'template_id').")

        self.layout: Optional[StaticTemplate] = None
        if layout is not None:
            if isinstance(layout, str):
                if os.path.exists(layout):
                    self.layout = StaticTemplate.from_yaml_file(layout)[0]
                else:
                    self.layout = StaticTemplate.from_yaml(layout)
            elif isinstance(layout, dict):
                self.layout = StaticTemplate.from_dict(layout)
            else:
                self.layout = layout

        catalogs_list: List[str] = []
        if catalogs is not None:
            catalogs_list = [catalogs] if isinstance(catalogs, str) else list(catalogs)
        elif self.layout is not None and self.layout.catalogs:
            catalogs_list = list(self.layout.catalogs)

        super().__init__(
            name=template_name,
            catalogs=catalogs_list,
            id=id,
            imports=imports or [],
            template_id=template_name,
            version=version,
            description=description,
            sample_data=sample_data,
            is_dynamic=True,
        )
        self.render_fn = render or render_fn
        self.resolver = resolver

        target_fn = self.render_fn or self.resolver
        if target_fn is None and self.layout is None:
            raise ValueError(
                f"DynamicTemplate '{template_name}' must provide either a 'render'"
                " function or a ('resolver', 'layout') pair."
            )

        if parameters is not None:
            self.parameters = parameters
        elif target_fn is not None:
            self.parameters = self._infer_parameters_from_resolver(target_fn)
        else:
            self.parameters = {}

    @staticmethod
    def _infer_parameters_from_resolver(
        fn: Callable[..., Any],
    ) -> Dict[str, Union[Param, Dict[str, Any]]]:
        """Automatically derives parameter definitions from the Python function signature."""
        sig = inspect.signature(fn)
        inferred: Dict[str, Union[Param, Dict[str, Any]]] = {}
        type_map = {
            str: ParamType.STRING,
            int: ParamType.INTEGER,
            float: ParamType.NUMBER,
            bool: ParamType.BOOLEAN,
        }
        for name, p in sig.parameters.items():
            if name in ["self", "context"] or p.kind in (
                inspect.Parameter.VAR_POSITIONAL,
                inspect.Parameter.VAR_KEYWORD,
            ):
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
        if self.resolver is None:
            return {}
        if isinstance(passed_params, dict):
            sig = inspect.signature(self.resolver)
            has_kwargs = any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
            )
            if has_kwargs:
                filtered_params = passed_params
            else:
                filtered_params = {
                    k: v for k, v in passed_params.items() if k in sig.parameters
                }
            res = self.resolver(**filtered_params)
        elif isinstance(passed_params, list):
            res = self.resolver(*passed_params)
        else:
            res = self.resolver(passed_params)

        if asyncio.iscoroutine(res):
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    try:
                        import nest_asyncio  # type: ignore

                        nest_asyncio.apply()
                    except ImportError as err:
                        raise RuntimeError(
                            "An event loop is already running. Please install"
                            " 'nest-asyncio' to run async resolvers synchronously."
                        ) from err
                    res_val = loop.run_until_complete(res)
                else:
                    res_val = loop.run_until_complete(res)
            except RuntimeError as err:
                if "already running" in str(err) or "run_until_complete" in str(err):
                    raise
                res_val = asyncio.run(res)
            except Exception:
                res_val = asyncio.run(res)
            return dict(res_val) if isinstance(res_val, dict) else {}
        return dict(res) if isinstance(res, dict) else {}

    def to_dict(self) -> Dict[str, Any]:
        params_dict: Dict[str, Any] = {}
        for k, v in self.parameters.items():
            params_dict[k] = v.to_dict() if isinstance(v, Param) else v

        comps_list = []
        if self.layout is not None:
            comps_list = [
                (c.to_dict() if isinstance(c, TemplateComponent) else c)
                for c in self.layout.components
            ]

        res: Dict[str, Any] = {
            "version": self.version,
            "templateId": self.template_id,
            "parameters": params_dict,
            "components": comps_list,
            "isDynamic": True,
        }
        if self.description:
            res["description"] = self.description
        if self.sample_data is not None:
            res["sampleData"] = self.sample_data
        return res

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Allows the DynamicTemplate instance to remain directly callable in unit tests or user code."""
        if self.render_fn is not None:
            return self.render_fn(*args, **kwargs)
        if self.resolver is not None:
            return self.resolve(kwargs if kwargs else (args[0] if args else {}))
        raise TypeError(f"DynamicTemplate '{self.name}' is not callable.")

    def to_yaml(self) -> str:
        """Serializes the dynamic template or underlying layout to a clean YAML string."""
        if self.layout is not None:
            return self.layout.to_yaml()
        return yaml.dump(self.to_dict(), sort_keys=False)


def dynamic_template(
    name_or_fn: Optional[Union[str, Callable[..., Any]]] = None,
    *,
    name: Optional[str] = None,
    catalogs: Optional[Union[List[str], str]] = None,
    id: Optional[str] = None,
    imports: Optional[Union[List[str], Dict[str, str]]] = None,
    description: Optional[str] = None,
    sample_data: Optional[Dict[str, Any]] = None,
    version: str = "0.1",
    **kwargs: Any,
) -> Union[DynamicTemplate, Callable[[Callable[..., Any]], DynamicTemplate]]:
    """Decorator to declare an A2UI DynamicTemplate directly on a Python render function.

    Can be used with or without arguments:
        @dynamic_template(catalogs=["https://a2ui.org/specification/v0_9_1/catalogs/basic/catalog.json"])
        def user_card(title: str): ...

        @dynamic_template
        def user_card(title: str): ...
    """

    def _decorator(fn: Callable[..., Any]) -> DynamicTemplate:
        explicit_name = name or (name_or_fn if isinstance(name_or_fn, str) else None)
        tmpl_name = explicit_name or "".join(
            word.capitalize() for word in fn.__name__.split("_")
        )
        desc = description or (fn.__doc__.strip() if fn.__doc__ else None)

        tmpl = DynamicTemplate(
            name=tmpl_name,
            catalogs=catalogs,
            id=id,
            imports=imports,
            render=fn,
            description=desc,
            sample_data=sample_data,
            version=version,
            **kwargs,
        )
        functools.update_wrapper(tmpl, fn)
        return tmpl

    if callable(name_or_fn):
        return _decorator(name_or_fn)
    return _decorator
