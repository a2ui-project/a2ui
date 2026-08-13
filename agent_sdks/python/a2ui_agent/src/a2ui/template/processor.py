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

"""Core processing and expansion engine for A2UI Templates."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Union
from .models import Template


def substitute_params(val: Any, params: Dict[str, Any]) -> Any:
    """Recursively replaces parameter references with their values.

    Supports exact parameter mapping (preserving original Python type) and
    in-string interpolation for '${param_name}' placeholders.
    """
    if isinstance(val, dict):
        if "param" in val and len(val) == 1:
            param_name = val["param"]
            return params.get(param_name)
        return {k: substitute_params(v, params) for k, v in val.items()}
    elif isinstance(val, list):
        return [substitute_params(x, params) for x in val]
    elif isinstance(val, str):
        # 1. Exact parameter match preserving type
        match = re.match(r"^\$\{(\w+)\}$", val)
        if match:
            param_name = match.group(1)
            if param_name in params:
                return params[param_name]
        # 2. In-string placeholder replacement
        for k, v in params.items():
            placeholder = f"${{{k}}}"
            if placeholder in val:
                val = val.replace(placeholder, str(v))
        return val
    return val


class TemplateProcessor:
    """Manages template registration, synthetic catalog compilation, and payload expansion."""

    def __init__(
        self,
        templates: List[Template],
        base_catalog: Optional[Union[Dict[str, Any], Any]] = None,
        version: str = "v0.9.1",
    ):
        """Initializes the TemplateProcessor.

        Args:
            templates: List of registered Template definitions.
            base_catalog: Optional base catalog schema dict or A2uiCatalog instance.
            version: Target A2UI protocol version ("v0.9", "v0.9.1", or "v1.0").
        """
        self.templates: Dict[str, Template] = {t.template_id: t for t in templates}
        if hasattr(base_catalog, "catalog_schema"):
            self.base_catalog = base_catalog.catalog_schema
        elif isinstance(base_catalog, dict):
            self.base_catalog = base_catalog
        else:
            self.base_catalog = {}
        self.version = version
        if (
            base_catalog
            and hasattr(base_catalog, "catalog_schema")
            and isinstance(base_catalog.catalog_schema, dict)
        ):
            self.base_catalog_id = (
                base_catalog.catalog_schema.get("$id")
                or base_catalog.catalog_schema.get("id")
                or "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
            )
        elif isinstance(base_catalog, dict):
            self.base_catalog_id = (
                base_catalog.get("$id")
                or base_catalog.get("id")
                or "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
            )
        else:
            self.base_catalog_id = (
                "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
            )

        self.validate_templates()

    def _get_template_params(
        self, comp: Dict[str, Any], template: Template
    ) -> Dict[str, Any]:
        """Extracts passed parameters from a component dictionary."""
        if "params" in comp and isinstance(comp["params"], dict):
            return comp["params"]
        return {k: v for k, v in comp.items() if k in template.parameters}

    def generate_inference_catalog(
        self, allowed_primitives: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Generates a synthetic A2UI catalog schema.

        Includes the allowed primitive components from the base catalog alongside
        all registered custom templates as high-level component schemas.
        """
        allowed_primitives = allowed_primitives or [
            "Card",
            "Column",
            "Row",
            "Text",
            "Divider",
            "Icon",
            "Button",
        ]

        synthetic_catalog: Dict[str, Any] = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "catalogId": "https://a2ui.org/catalog/synthetic",
            "title": "A2UI Synthetic Inference Catalog",
            "components": {},
            "functions": self.base_catalog.get("functions", {}),
            "$defs": {
                "anyComponent": {
                    "oneOf": [],
                    "discriminator": {"propertyName": "component"},
                },
                "anyFunction": (
                    self.base_catalog.get("$defs", {}).get("anyFunction", {})
                ),
            },
        }

        # 1. Copy over allowed primitives from the base catalog
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

            for p_name, p_meta in template.parameters.items():
                properties_dict[p_name] = self._promote_parameter(p_meta)
                if "default" not in p_meta and p_meta.get("type") != "array":
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

            synthetic_catalog["components"][t_id] = template_schema
            synthetic_catalog["$defs"]["anyComponent"]["oneOf"].append(
                {"$ref": f"#/components/{t_id}"}
            )

        return synthetic_catalog

    def expand_template(
        self, instance_id: str, template_id: str, passed_params: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Recursively expands a template instance into standard primitive components."""
        template = self.templates.get(template_id)
        if not template:
            raise ValueError(f"Template '{template_id}' is not registered.")

        # 1. Resolve parameters and assign default values
        params: Dict[str, Any] = {}
        for p_name, p_meta in template.parameters.items():
            if p_name in passed_params:
                val = passed_params[p_name]
                p_type = p_meta.get("type")
                if p_type == "array" or p_type == "children":
                    if isinstance(val, list):
                        params[p_name] = val
                    elif isinstance(val, dict):
                        params[p_name] = [val]
                    elif val == p_name or val is None:
                        params[p_name] = p_meta.get("default", [])
                    else:
                        params[p_name] = [val]
                else:
                    params[p_name] = val
            elif "default" in p_meta:
                params[p_name] = p_meta["default"]
            elif p_meta.get("type") == "array":
                params[p_name] = []
            else:
                raise ValueError(
                    f"Missing required parameter '{p_name}' for template"
                    f" '{template_id}'"
                )

        expanded_components: List[Dict[str, Any]] = []

        # 2. Helpers for ID mapping
        def map_id(internal_id: str) -> str:
            if internal_id == "root":
                return instance_id
            return f"{instance_id}_{internal_id}"

        def map_child_list(child_list: Any) -> Any:
            if isinstance(child_list, list):
                res = []
                for c_id in child_list:
                    is_slot, slot_val = resolve_slot(c_id)
                    if is_slot:
                        if isinstance(slot_val, list):
                            res.extend(slot_val)
                        elif slot_val is not None:
                            res.append(slot_val)
                    else:
                        res.append(map_id(c_id))
                return res
            elif isinstance(child_list, str):
                is_slot, slot_val = resolve_slot(child_list)
                if is_slot:
                    return slot_val
                return map_id(child_list)
            elif isinstance(child_list, dict):
                res = dict(child_list)
                if "componentId" in res:
                    is_slot, slot_val = resolve_slot(res["componentId"])
                    res["componentId"] = (
                        slot_val if is_slot else map_id(res["componentId"])
                    )
                return res
            return child_list

        def resolve_slot(val: Any) -> tuple[bool, Any]:
            if isinstance(val, str):
                if val.startswith("${") and val.endswith("}"):
                    p_name = val[2:-1]
                    if p_name in params:
                        return True, params[p_name]
                elif val.startswith("__PARAM__"):
                    p_name = val[9:]
                    if p_name in params:
                        return True, params[p_name]
            return False, val

        # 3. First pass: Map internal component IDs and handle slots & static loop unrolling
        for comp in template.components:
            comp_copy = dict(comp)
            comp_copy["id"] = map_id(comp_copy["id"])

            if "child" in comp_copy:
                is_slot, slot_val = resolve_slot(comp_copy["child"])
                if is_slot:
                    if slot_val is None:
                        comp_copy.pop("child", None)
                    else:
                        comp_copy["child"] = slot_val
                else:
                    comp_copy["child"] = map_id(comp_copy["child"])

            if "children" in comp_copy:
                is_slot, slot_val = resolve_slot(comp_copy["children"])
                if is_slot:
                    if slot_val is None:
                        comp_copy["children"] = []
                    else:
                        comp_copy["children"] = slot_val
                elif (
                    isinstance(comp_copy["children"], dict)
                    and "param" in comp_copy["children"]
                    and "template" in comp_copy["children"]
                ):
                    children_meta = comp_copy["children"]
                    param_name = children_meta["param"]
                    item_template_id = children_meta["template"]
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
                                " must be an array/list for static loop unrolling."
                            )

                        unrolled_child_ids = []
                        for idx, item in enumerate(array_data):
                            sub_instance_id = f"{comp_copy['id']}_item_{idx}"
                            unrolled_child_ids.append(sub_instance_id)
                            sub_params = (
                                item if isinstance(item, dict) else {"value": item}
                            )
                            sub_expanded = self.expand_template(
                                sub_instance_id, item_template_id, sub_params
                            )
                            expanded_components.extend(sub_expanded)

                        comp_copy["children"] = unrolled_child_ids
                else:
                    comp_copy["children"] = map_child_list(comp_copy["children"])

            comp_final = substitute_params(comp_copy, params)
            expanded_components.append(comp_final)

        # 4. Second pass: Flatten any nested template invocations
        final_list = []
        for c in expanded_components:
            c_type = c.get("component")
            if c_type in self.templates:
                nested_instance_id = c["id"]
                nested_template_id = c_type
                nested_params = self._get_template_params(
                    c, self.templates[nested_template_id]
                )
                nested_expanded = self.expand_template(
                    nested_instance_id, nested_template_id, nested_params
                )
                final_list.extend(nested_expanded)
            else:
                final_list.append(c)

        return final_list

    def process_message(self, message: Any) -> Any:
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
                    and self.base_catalog_id
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

                    expanded_list = []
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

    def _promote_parameter(self, p_meta: Dict[str, Any]) -> Dict[str, Any]:
        """Promotes a template parameter schema to a dynamic schema if dynamic is enabled."""
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

        is_dynamic = p_meta.get("dynamic", False)
        already_dynamic = "$ref" in p_meta and "Dynamic" in p_meta["$ref"]

        if not is_dynamic and not already_dynamic:
            res = dict(p_meta)
            res.pop("dynamic", None)
            return res

        if already_dynamic:
            res = dict(p_meta)
            res.pop("dynamic", None)
            return res

        ref_map = {
            "string": f"{common_types_url}#/$defs/DynamicString",
            "number": f"{common_types_url}#/$defs/DynamicNumber",
            "integer": f"{common_types_url}#/$defs/DynamicNumber",
            "boolean": f"{common_types_url}#/$defs/DynamicBoolean",
        }

        target_ref = ref_map.get(p_type)
        if not target_ref:
            res = dict(p_meta)
            res.pop("dynamic", None)
            return res

        metadata = {}
        for k in ["title", "description", "default"]:
            if k in p_meta:
                metadata[k] = p_meta[k]

        promoted: Dict[str, Any] = {"allOf": [{"$ref": target_ref}]}
        if metadata:
            promoted["allOf"].append(metadata)

        return promoted

    def validate_templates(self) -> None:
        """Validates all registered templates."""
        for t_id, template in self.templates.items():
            for comp in template.components:
                comp_type = comp.get("component")
                if not comp_type:
                    raise ValueError(
                        f"Component in template '{t_id}' is missing 'component' type."
                    )
