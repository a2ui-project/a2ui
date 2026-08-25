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

"""Core processing, expansion engine, and dynamic resolver execution for A2UI Templates."""

from __future__ import annotations

import asyncio
import inspect
import re
from typing import (
    Any,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Tuple,
    TypeAlias,
    Union,
)
import jsonschema
from .models import (
    Template,
    StaticTemplate,
    DynamicTemplate,
    BaseTemplate,
    Param,
    ParamType,
    ParamRef,
    Concat,
    FormatExpr,
    TemplateLoop,
    TemplateComponent,
    normalize_a2ui_type_to_jsonschema,
    flatten_nested_layout,
)

# ---------------------------------------------------------------------------
# Strong Semantic Type Aliases
# ---------------------------------------------------------------------------

# 1. Identifier Types
TemplateId: TypeAlias = str
InstanceId: TypeAlias = str
ComponentId: TypeAlias = str
ParamPath: TypeAlias = str

# 2. Template Evaluation Types
TemplateParams: TypeAlias = Mapping[str, Any]
TemplateNodeDict: TypeAlias = Dict[str, Any]

# 3. Standard A2UI Wire-Format Output Types
A2UIComponent: TypeAlias = Dict[str, Any]
A2UIComponentList: TypeAlias = List[A2UIComponent]
A2UIMessage: TypeAlias = Dict[str, Any]

# 4. Catalog and Schema Types
CatalogSchema: TypeAlias = Dict[str, Any]
JSONSchemaDict: TypeAlias = Dict[str, Any]

__all__ = [
    "TemplateProcessor",
    "TemplateId",
    "InstanceId",
    "ComponentId",
    "ParamPath",
    "TemplateParams",
    "TemplateNodeDict",
    "A2UIComponent",
    "A2UIComponentList",
    "A2UIMessage",
    "CatalogSchema",
    "JSONSchemaDict",
]


def _resolve_param_path(path: ParamPath, params: TemplateParams) -> Tuple[bool, Any]:
    """Resolves a dot-separated parameter path (e.g. 'user.name' or 'user.metrics.count') from params dict."""
    parts = path.split(".")
    curr: Any = params
    for part in parts:
        if isinstance(curr, (dict, Mapping)) and part in curr:
            curr = curr[part]
        elif (
            isinstance(curr, (list, tuple)) and part.isdigit() and int(part) < len(curr)
        ):
            curr = curr[int(part)]
        else:
            return False, None
    return True, curr


def _substitute_params(val: Any, params: TemplateParams) -> Any:
    """Recursively replaces parameter references with their resolved values."""
    if isinstance(val, (ParamRef, Concat, FormatExpr, TemplateLoop)):
        val = val.to_dict()

    if isinstance(val, dict):
        # 1. Direct param reference: {"param": "userName", "default": ...}
        if (
            "param" in val
            and isinstance(val["param"], str)
            and "template" not in val
            and "item" not in val
        ):
            param_path = val["param"]
            found, res = _resolve_param_path(param_path, params)
            if found and res is not None:
                return res
            if "default" in val:
                return val["default"]
            return None

        # 2. String concatenation: {"concat": ["Strategic Objectives: ", {"param": "teamName"}]}
        if "concat" in val and isinstance(val["concat"], list):
            parts = []
            for item in val["concat"]:
                sub = _substitute_params(item, params)
                if sub is not None:
                    parts.append(str(sub))
            return "".join(parts)

        # 3. String formatting: {"format": "Competency: {name}", "args": {...}}
        if "format" in val and "args" in val and isinstance(val["args"], dict):
            fmt_str = str(val["format"])
            args_sub = {
                k: _substitute_params(v, params) for k, v in val["args"].items()
            }
            try:
                return fmt_str.format(**args_sub)
            except Exception:
                return fmt_str

        # 4. Standard dictionary traversal
        return {k: _substitute_params(v, params) for k, v in val.items()}

    elif isinstance(val, list):
        return [_substitute_params(x, params) for x in val]

    elif isinstance(val, str):
        # Exact parameter match preserving type: e.g. "${user}" or "${score}"
        match = re.match(r"^\$\{([\w\.]+)\}$", val)
        if match:
            param_path = match.group(1)
            found, res = _resolve_param_path(param_path, params)
            if found:
                return res

        # In-string placeholder replacement: replace all occurrences of ${path}
        pattern = re.compile(r"\$\{([\w\.]+)\}")

        def replacer(m: re.Match[str]) -> str:
            path = m.group(1)
            found, res = _resolve_param_path(path, params)
            if found and res is not None:
                return str(res)
            return str(m.group(0))

        return str(pattern.sub(replacer, val))

    return val


# Private aliases for internal backwards-compatibility if referenced
resolve_param_path = _resolve_param_path
substitute_params = _substitute_params


class TemplateProcessor:
    """Manages template registration, synthetic catalog compilation, and payload expansion."""

    def __init__(
        self,
        templates: Sequence[
            Union[BaseTemplate, Template, StaticTemplate, DynamicTemplate]
        ],
        base_catalog: Optional[Union[CatalogSchema, Any]] = None,
        version: str = "v0.9.1",
    ):
        """Initializes the TemplateProcessor.

        Args:
            templates: List of registered Template definitions.
            base_catalog: Optional base catalog schema dict or A2uiCatalog instance.
                If omitted, the processor operates independently without catalog assumptions.
            version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
        """
        self.templates: Dict[
            TemplateId, Union[BaseTemplate, Template, StaticTemplate, DynamicTemplate]
        ] = {t.template_id: t for t in templates}
        self.version = version
        self.base_catalog: Optional[CatalogSchema] = None
        self.base_catalog_id: Optional[str] = None

        if base_catalog is not None:
            if hasattr(base_catalog, "catalog_schema") and isinstance(
                base_catalog.catalog_schema, dict
            ):
                self.base_catalog = base_catalog.catalog_schema
            elif isinstance(base_catalog, dict):
                self.base_catalog = base_catalog

            if self.base_catalog is not None:
                self.base_catalog_id = self.base_catalog.get(
                    "$id"
                ) or self.base_catalog.get("id")

        self._validate_templates()

    def generate_inference_catalog(
        self,
        allowed_primitives: Optional[Sequence[str]] = None,
    ) -> CatalogSchema:
        """Generates a synthetic JSON catalog containing allowed primitives and all registered templates."""
        if allowed_primitives is None:
            if self.base_catalog is not None:
                allowed_primitives = list(
                    self.base_catalog.get("components", {}).keys()
                )
            else:
                allowed_primitives = []

        catalog_id = (
            self.base_catalog_id
            if self.base_catalog_id
            else "https://a2ui.org/catalog/synthetic"
        )

        synthetic_catalog: CatalogSchema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "$id": catalog_id,
            "catalogId": catalog_id,
            "title": "A2UI Synthetic Inference Catalog",
            "components": {},
            "functions": (
                self.base_catalog.get("functions", {})
                if self.base_catalog is not None
                else {}
            ),
            "$defs": {
                "anyComponent": {
                    "oneOf": [],
                    "discriminator": {"propertyName": "component"},
                },
                "anyFunction": (
                    self.base_catalog.get("$defs", {}).get("anyFunction", {})
                    if self.base_catalog is not None
                    else {}
                ),
            },
        }

        # 1. Copy over allowed primitives from the base catalog if present
        if self.base_catalog is not None:
            base_components = self.base_catalog.get("components", {})
            for prim in allowed_primitives:
                if prim in base_components:
                    synthetic_catalog["components"][prim] = base_components[prim]
                    synthetic_catalog["$defs"]["anyComponent"]["oneOf"].append(
                        {"$ref": f"#/components/{prim}"}
                    )

        # 2. Add registered custom templates as high-level component schemas
        common_types_url = (
            "https://a2ui.org/specification/v0_9/common_types.json"
            if "0.9" in self.version
            else "https://a2ui.org/specification/v1_0/common_types.json"
        )

        for t_id, template in self.templates.items():
            param_required = []
            properties_dict: Dict[str, Any] = {"component": {"const": t_id}}

            raw_params = (
                template.parameters.items() if hasattr(template, "parameters") else {}
            )

            for p_name, p_meta in raw_params:
                p_meta_dict = p_meta.to_dict() if isinstance(p_meta, Param) else p_meta
                properties_dict[p_name] = self._promote_parameter(p_meta_dict)
                p_type = (
                    p_meta.type.value
                    if isinstance(p_meta, Param) and isinstance(p_meta.type, ParamType)
                    else (
                        p_meta.get("type")
                        if isinstance(p_meta, dict)
                        else getattr(p_meta, "type", None)
                    )
                )
                has_default = (
                    p_meta.default is not None
                    if isinstance(p_meta, Param)
                    else (isinstance(p_meta, dict) and "default" in p_meta)
                )
                if not has_default and p_type != "array":
                    param_required.append(p_name)

            template_schema = {
                "type": "object",
                "allOf": [
                    {"$ref": f"{common_types_url}#/$defs/ComponentCommon"},
                    {
                        "type": "object",
                        "properties": properties_dict,
                        "required": ["component"] + param_required,
                    },
                ],
                "unevaluatedProperties": False,
            }
            if template.description:
                template_schema["description"] = template.description

            synthetic_catalog["components"][t_id] = template_schema
            synthetic_catalog["$defs"]["anyComponent"]["oneOf"].append(
                {"$ref": f"#/components/{t_id}"}
            )

        return synthetic_catalog

    def expand_template(
        self,
        instance_id: InstanceId,
        template_id: TemplateId,
        passed_params: TemplateParams,
        _depth: int = 0,
        _call_stack: Optional[List[TemplateId]] = None,
    ) -> A2UIComponentList:
        """Recursively expands a template instance into standard primitive components."""
        if _call_stack is None:
            _call_stack = []

        template = self.templates.get(template_id)
        if not template:
            available = list(self.templates.keys())
            raise ValueError(
                f"Template '{template_id}' is not registered. Available: {available}"
            )

        if template_id in _call_stack:
            raise ValueError(
                f"Circular template reference detected: {' -> '.join(_call_stack)} ->"
                f" {template_id}"
            )

        if _depth > 32:
            raise RecursionError(
                f"Maximum template expansion depth exceeded ({_depth}) at"
                f" '{template_id}'. Call stack: {' -> '.join(_call_stack)}"
            )

        current_stack = _call_stack + [template_id]

        # 1. Handle DynamicTemplate execution
        if getattr(template, "is_dynamic", False):
            dynamic_tmpl: DynamicTemplate = template  # type: ignore

            # Mode A: Programmatic Render Function (returns AST tree or list directly)
            if dynamic_tmpl.render_fn is not None:
                if isinstance(passed_params, (dict, Mapping)):
                    sig = inspect.signature(dynamic_tmpl.render_fn)
                    has_kwargs = any(
                        p.kind == inspect.Parameter.VAR_KEYWORD
                        for p in sig.parameters.values()
                    )
                    if has_kwargs:
                        filtered_params = dict(passed_params)
                    else:
                        filtered_params = {
                            k: v
                            for k, v in passed_params.items()
                            if k in sig.parameters
                        }
                    res = dynamic_tmpl.render_fn(**filtered_params)
                elif isinstance(passed_params, list):
                    res = dynamic_tmpl.render_fn(*passed_params)
                else:
                    res = dynamic_tmpl.render_fn(passed_params)
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
                                    " 'nest-asyncio' to run async render functions"
                                    " synchronously."
                                ) from err
                            res_tree = loop.run_until_complete(res)
                        else:
                            res_tree = loop.run_until_complete(res)
                    except RuntimeError as err:
                        if "already running" in str(err) or "run_until_complete" in str(
                            err
                        ):
                            raise
                        res_tree = asyncio.run(res)
                    except Exception:
                        res_tree = asyncio.run(res)
                else:
                    res_tree = res

                if isinstance(res_tree, list):
                    flattened_list: A2UIComponentList = []
                    for item in res_tree:
                        _, comps = flatten_nested_layout(item, parent_id=instance_id)
                        flattened_list.extend(comps)
                    return flattened_list
                else:
                    _, flat_components = flatten_nested_layout(res_tree)
                    # Normalize root ID to instance_id
                    result: A2UIComponentList = []
                    for c in flat_components:
                        c_copy = dict(c)
                        if c_copy["id"] == "root":
                            c_copy["id"] = instance_id
                        elif c_copy["id"].startswith("root_"):
                            c_copy["id"] = f"{instance_id}_{c_copy['id'][5:]}"
                        if "child" in c_copy and isinstance(c_copy["child"], str):
                            if c_copy["child"] == "root":
                                c_copy["child"] = instance_id
                            elif c_copy["child"].startswith("root_"):
                                c_copy["child"] = f"{instance_id}_{c_copy['child'][5:]}"
                        if "children" in c_copy and isinstance(
                            c_copy["children"], list
                        ):
                            c_copy["children"] = [
                                (
                                    instance_id
                                    if ch == "root"
                                    else (
                                        f"{instance_id}_{ch[5:]}"
                                        if isinstance(ch, str)
                                        and ch.startswith("root_")
                                        else ch
                                    )
                                )
                                for ch in c_copy["children"]
                            ]
                        result.append(c_copy)
                    return result

            # Mode B: Resolver + Static Layout Binding
            elif dynamic_tmpl.layout is not None:
                resolved_data = dynamic_tmpl.resolve(dict(passed_params))
                combined_params = {**dict(passed_params), **resolved_data}
                layout = dynamic_tmpl.layout
                return self._expand_static_layout(
                    instance_id,
                    layout,
                    combined_params,
                    _depth=_depth + 1,
                    _call_stack=current_stack,
                )

        # 2. Handle StaticTemplate execution
        return self._expand_static_layout(
            instance_id,
            template,
            passed_params,
            _depth=_depth + 1,
            _call_stack=current_stack,
        )

    @staticmethod
    def _map_id(internal_id: str, instance_id: InstanceId) -> ComponentId:
        if internal_id == "root":
            return instance_id
        return f"{instance_id}_{internal_id}"

    @staticmethod
    def _resolve_slot(val: Any, params: TemplateParams) -> Tuple[bool, Any]:
        if isinstance(val, (ParamRef, TemplateLoop)):
            val = val.to_dict()
        if (
            isinstance(val, dict)
            and "param" in val
            and "template" not in val
            and "item" not in val
        ):
            p_path = val["param"]
            found, res = _resolve_param_path(p_path, params)
            if found:
                return True, res
            if "default" in val:
                return True, val["default"]
        elif isinstance(val, str):
            if val.startswith("${") and val.endswith("}"):
                p_path = val[2:-1]
                found, res = _resolve_param_path(p_path, params)
                if found:
                    return True, res
            elif val.startswith("__PARAM__"):
                p_name = val[9:]
                found, res = _resolve_param_path(p_name, params)
                if found:
                    return True, res
        return False, val

    @classmethod
    def _map_child_list(
        cls, child_list: Any, instance_id: InstanceId, params: TemplateParams
    ) -> Any:
        if isinstance(child_list, list):
            res_list: List[Any] = []
            for c_id in child_list:
                is_slot, slot_val = cls._resolve_slot(c_id, params)
                if is_slot:
                    if isinstance(slot_val, list):
                        res_list.extend(slot_val)
                    elif slot_val is not None:
                        res_list.append(slot_val)
                else:
                    res_list.append(
                        cls._map_id(c_id, instance_id)
                        if isinstance(c_id, str)
                        else c_id
                    )
            return res_list
        elif isinstance(child_list, (str, dict, ParamRef, TemplateLoop)):
            is_slot, slot_val = cls._resolve_slot(child_list, params)
            if is_slot:
                return slot_val
            if isinstance(child_list, str):
                return cls._map_id(child_list, instance_id)
            return child_list
        return child_list

    def _expand_static_layout(
        self,
        instance_id: InstanceId,
        layout: Union[StaticTemplate, Template, Any],
        passed_params: TemplateParams,
        _depth: int = 0,
        _call_stack: Optional[List[TemplateId]] = None,
    ) -> A2UIComponentList:
        template_id = getattr(layout, "template_id", "AnonymousTemplate")

        # 1. Resolve parameters and assign default values
        params: Dict[str, Any] = {}
        layout_params = getattr(layout, "parameters", {})
        for p_name, p_meta in layout_params.items():
            if isinstance(p_meta, Param):
                p_meta_dict = p_meta.to_dict()
                p_type = (
                    p_meta.type.value
                    if isinstance(p_meta.type, ParamType)
                    else str(p_meta.type)
                )
            else:
                p_meta_dict = p_meta
                p_type = str(p_meta.get("type", "string"))

            if p_name in passed_params:
                val = passed_params[p_name]
                if p_type in ["array", "children"]:
                    if isinstance(val, list):
                        params[p_name] = val
                    elif isinstance(val, dict):
                        params[p_name] = [val]
                    elif val == p_name or val is None:
                        params[p_name] = p_meta_dict.get("default", [])
                    else:
                        params[p_name] = [val]
                else:
                    params[p_name] = val

                # Validate parameter value if data type
                is_expression = isinstance(params[p_name], dict) and any(
                    k in params[p_name] for k in ["path", "concat", "format", "param"]
                )
                if (
                    isinstance(p_meta_dict, dict)
                    and p_type not in ["child", "children", "action"]
                    and not is_expression
                    and not (
                        isinstance(params[p_name], str)
                        and (
                            params[p_name].startswith("${")
                            or params[p_name].startswith("__")
                        )
                    )
                ):
                    val_schema = normalize_a2ui_type_to_jsonschema(p_meta_dict)
                    if val_schema:
                        try:
                            jsonschema.validate(
                                instance=params[p_name], schema=val_schema
                            )
                        except jsonschema.ValidationError as err:
                            raise ValueError(
                                f"Template '{template_id}': Parameter '{p_name}'"
                                f" failed validation: {err.message}"
                            ) from err
            elif "default" in p_meta_dict and p_meta_dict["default"] is not None:
                params[p_name] = p_meta_dict["default"]
            elif p_type in ["array", "children"]:
                params[p_name] = []
            elif p_meta_dict.get("required") is False or (
                isinstance(p_meta, Param) and not p_meta.required
            ):
                pass
            else:
                raise ValueError(
                    f"Missing required parameter '{p_name}' for template"
                    f" '{template_id}'"
                )

        # Merge in passed params that may not be in schema
        for k, v in passed_params.items():
            if k not in params:
                params[k] = v

        expanded_components: List[Dict[str, Any]] = []

        # 2. First pass: Map internal component IDs, handle slots & loop unrolling
        components_list = getattr(layout, "components", [])
        for comp in components_list:
            comp_copy = (
                comp.to_dict() if isinstance(comp, TemplateComponent) else dict(comp)
            )
            comp_copy["id"] = self._map_id(comp_copy["id"], instance_id)

            if "child" in comp_copy:
                is_slot, slot_val = self._resolve_slot(comp_copy["child"], params)
                if is_slot:
                    if slot_val is None:
                        comp_copy.pop("child", None)
                    else:
                        comp_copy["child"] = slot_val
                else:
                    if isinstance(comp_copy["child"], str):
                        comp_copy["child"] = self._map_id(
                            comp_copy["child"], instance_id
                        )

            if "children" in comp_copy:
                is_slot, slot_val = self._resolve_slot(comp_copy["children"], params)
                if is_slot:
                    if slot_val is None:
                        comp_copy["children"] = []
                    elif isinstance(slot_val, list):
                        comp_copy["children"] = slot_val
                    else:
                        comp_copy["children"] = [slot_val]
                elif (
                    isinstance(comp_copy["children"], dict)
                    and "param" in comp_copy["children"]
                    and (
                        "template" in comp_copy["children"]
                        or "item" in comp_copy["children"]
                    )
                ):
                    children_meta = comp_copy["children"]
                    param_name = children_meta["param"]
                    array_data = params.get(param_name, [])

                    if (
                        isinstance(array_data, list)
                        and array_data
                        and all(isinstance(x, str) for x in array_data)
                    ):
                        comp_copy["children"] = array_data
                    else:
                        if not isinstance(array_data, list):
                            raise ValueError(
                                f"Template '{template_id}': Parameter '{param_name}'"
                                " must be an array/list for loop unrolling."
                            )

                        unrolled_child_ids = []

                        # Case A: Inline item layout loop
                        if "item" in children_meta and isinstance(
                            children_meta["item"], list
                        ):
                            item_comps = children_meta["item"]
                            as_var = children_meta.get("as")
                            for idx, item in enumerate(array_data):
                                sub_instance_id = f"{comp_copy['id']}_item_{idx}"
                                unrolled_child_ids.append(sub_instance_id)

                                item_dict = (
                                    dict(item)
                                    if isinstance(item, dict)
                                    else {"value": item}
                                )
                                sub_params = {**params, **item_dict}
                                if as_var:
                                    sub_params[as_var] = item_dict

                                inline_template = StaticTemplate(
                                    template_id=f"{template_id}_inline_{idx}",
                                    parameters={},
                                    components=item_comps,
                                )
                                sub_expanded = self._expand_static_layout(
                                    sub_instance_id,
                                    inline_template,
                                    sub_params,
                                    _depth=_depth + 1,
                                    _call_stack=_call_stack,
                                )
                                expanded_components.extend(sub_expanded)

                        # Case B: Named template loop
                        elif "template" in children_meta:
                            item_template_id = children_meta["template"]
                            for idx, item in enumerate(array_data):
                                sub_instance_id = f"{comp_copy['id']}_item_{idx}"
                                unrolled_child_ids.append(sub_instance_id)
                                sub_params = (
                                    item if isinstance(item, dict) else {"value": item}
                                )
                                sub_expanded = self.expand_template(
                                    sub_instance_id,
                                    item_template_id,
                                    sub_params,
                                    _depth=_depth + 1,
                                    _call_stack=_call_stack,
                                )
                                expanded_components.extend(sub_expanded)

                        comp_copy["children"] = unrolled_child_ids
                else:
                    comp_copy["children"] = self._map_child_list(
                        comp_copy["children"], instance_id, params
                    )

            comp_final = _substitute_params(comp_copy, params)
            expanded_components.append(comp_final)

        # 4. Second pass: Flatten any nested template invocations
        final_list: A2UIComponentList = []
        for c in expanded_components:
            c_type = c.get("component")
            if c_type in self.templates:
                nested_instance_id = c["id"]
                nested_template_id = c_type
                nested_params = self._get_template_params(
                    c, self.templates[nested_template_id]
                )
                nested_expanded = self.expand_template(
                    nested_instance_id,
                    nested_template_id,
                    nested_params,
                    _depth=_depth + 1,
                    _call_stack=_call_stack,
                )
                final_list.extend(nested_expanded)
            else:
                final_list.append(c)

        return final_list

    def process_message(
        self, message: Union[A2UIMessage, Sequence[A2UIMessage]]
    ) -> Union[A2UIMessage, List[A2UIMessage]]:
        """Intercepts A2UI server-to-client messages and unwraps any embedded template components."""
        if isinstance(message, list):
            return [self.process_message(m) for m in message]

        if not isinstance(message, dict):
            return message

        msg_copy = dict(message)

        for envelope_key in ["createSurface", "updateComponents"]:
            if envelope_key in msg_copy:
                payload = dict(msg_copy[envelope_key])
                if (
                    envelope_key == "createSurface"
                    and "catalogId" in payload
                    and self.base_catalog_id is not None
                ):
                    payload["catalogId"] = self.base_catalog_id
                if "components" in payload:
                    components = payload["components"]

                    # Normalize single top-level template instances to root ID
                    if len(components) == 1:
                        single_comp = components[0]
                        if (
                            isinstance(single_comp, dict)
                            and single_comp.get("component") in self.templates
                        ):
                            fixed_comp = dict(single_comp)
                            fixed_comp["id"] = "root"
                            components = [fixed_comp]

                    expanded_list: A2UIComponentList = []
                    for comp in components:
                        comp_type = comp.get("component")
                        if comp_type in self.templates:
                            instance_id = comp.get("id", "root")
                            params = self._get_template_params(
                                comp, self.templates[comp_type]
                            )
                            expanded = self.expand_template(
                                instance_id, comp_type, params
                            )
                            expanded_list.extend(expanded)
                        else:
                            expanded_list.append(comp)

                    payload["components"] = expanded_list
                msg_copy[envelope_key] = payload

        return msg_copy

    def _promote_parameter(self, p_meta: Dict[str, Any]) -> JSONSchemaDict:
        """Promotes a template parameter to an A2UI catalog schema property."""
        if not isinstance(p_meta, dict):
            return p_meta

        common_types_url = (
            "https://a2ui.org/specification/v0_9/common_types.json"
            if "0.9" in self.version
            else "https://a2ui.org/specification/v1_0/common_types.json"
        )

        p_type = p_meta.get("type")
        if p_type == "child":
            res = {"$ref": f"{common_types_url}#/$defs/ComponentId"}
            for k in ["title", "description", "default"]:
                if k in p_meta:
                    res[k] = p_meta[k]
            return res
        if p_type == "children":
            res = {"$ref": f"{common_types_url}#/$defs/ChildList"}
            for k in ["title", "description", "default"]:
                if k in p_meta:
                    res[k] = p_meta[k]
            return res
        if p_type == "action":
            res = {"$ref": f"{common_types_url}#/$defs/Action"}
            for k in ["title", "description", "default"]:
                if k in p_meta:
                    res[k] = p_meta[k]
            return res
        if p_type == "enum" and "values" in p_meta:
            res = {
                "type": "string",
                "enum": p_meta["values"],
            }
            for k in ["title", "description", "default"]:
                if k in p_meta:
                    res[k] = p_meta[k]
            return res

        ref_map = {
            "string": f"{common_types_url}#/$defs/DynamicString",
            "number": f"{common_types_url}#/$defs/DynamicNumber",
            "integer": f"{common_types_url}#/$defs/DynamicNumber",
            "boolean": f"{common_types_url}#/$defs/DynamicBoolean",
        }

        target_ref = ref_map.get(str(p_type))
        if target_ref:
            promoted: JSONSchemaDict = {"allOf": [{"$ref": target_ref}]}
            metadata = {}
            for k in ["title", "description", "default"]:
                if k in p_meta:
                    metadata[k] = p_meta[k]
            if metadata:
                promoted["allOf"].append(metadata)
            return promoted

        return dict(p_meta)

    def _validate_templates(self) -> None:
        """Validates all registered templates."""
        for t_id, template in self.templates.items():
            if isinstance(template, StaticTemplate):
                template.validate_definition()
                for comp in template.components:
                    comp_dict = (
                        comp.to_dict() if isinstance(comp, TemplateComponent) else comp
                    )
                    comp_type = comp_dict.get("component")
                    if not comp_type:
                        raise ValueError(
                            f"Component in template '{t_id}' is missing 'component'"
                            " type."
                        )

    def validate_templates(self) -> None:
        """Deprecated alias for _validate_templates."""
        self._validate_templates()

    def _get_template_params(
        self,
        comp: A2UIComponent,
        template: Union[BaseTemplate, Template, StaticTemplate, DynamicTemplate],
    ) -> Dict[str, Any]:
        """Extracts passed parameters from a component dictionary."""
        params: Dict[str, Any] = {}
        raw_keys = template.parameters.keys() if hasattr(template, "parameters") else []
        for p_name in raw_keys:
            if p_name in comp:
                params[p_name] = comp[p_name]
        return params
