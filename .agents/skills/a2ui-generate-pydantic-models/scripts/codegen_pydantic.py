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

"""Dynamic, version-agnostic automated generator for Pydantic v2 schemas and basic catalogs across any A2UI spec version."""

import argparse
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple, Union

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../../../.."))
SPEC_ROOT = os.path.join(REPO_ROOT, "specification")
CORE_SRC_ROOT = os.path.join(REPO_ROOT, "python/a2ui_core/src/a2ui/core")

FILE_HEADER = """# Copyright 2024 Google LLC
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

# Auto-generated. Do not edit manually.
from __future__ import annotations"""


def _ensure_v_prefix(version: str) -> str:
    """Ensures a version string has a 'v' or 'V' prefix (e.g. '0.9' -> 'v0.9')."""
    if not version:
        raise ValueError("version is required")
    v = version.strip()
    return v if v.startswith("v") or v.startswith("V") else f"v{v}"


def _version_to_underscore(version: str) -> str:
    """Converts a dotted version string (e.g. 'v0.9', '0.8') to underscore format (e.g. 'v0_9', 'v0_8')."""
    v = _ensure_v_prefix(version)
    return v.lower().replace(".", "_")


def _is_modern_terminology(version: str, a2r_name: str = "") -> bool:
    """Returns True if the version or file uses modern A2UI terminology (v1.0+)."""
    if "agent_to_renderer" in a2r_name:
        return True
    dir_name = _version_to_underscore(version)
    return dir_name not in ("v0_8", "v0_9", "v0_9_1")


def _to_snake_case(name: str) -> str:
    """Converts a camelCase or PascalCase identifier to snake_case."""
    if re.match(r"^v\d+(?:_\d+)*$", name):
        return name
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _to_pascal_case(name: str) -> str:
    """Converts a camelCase or snake_case string to PascalCase preserving camelCase segments."""
    if not name:
        return name
    if "_" not in name and "-" not in name and " " not in name:
        return name[0].upper() + name[1:]
    clean = re.sub(r"[^a-zA-Z0-9_]", "_", name)
    parts = clean.split("_")
    return "".join(p[0].upper() + p[1:] for p in parts if p)


def _generate_constants_code(
    version: str,
    a2r_data: Dict[str, Any],
    r2a_data: Dict[str, Any],
) -> str:
    """Dynamically generates constants.py based on the version's schema definitions."""
    dir_name = _version_to_underscore(version)
    spec_dot = _ensure_v_prefix(version)
    lines = [
        FILE_HEADER,
        "from typing import Final, Literal",
        "",
        f'SPEC_VERSION: Final[Literal["{spec_dot}"]] = "{spec_dot}"',
        f'SPEC_VERSION_TYPE = Literal["{spec_dot}"]',
        "",
        'ROOT_ID = "root"',
        'CATALOG_COMPONENTS_KEY = "components"',
        'SURFACE_ID_KEY = "surfaceId"',
    ]

    # Theme / styling property keys based on schema
    if dir_name == "v0_8":
        lines.append('THEME_KEY = "styles"')
        lines.append('STYLES_KEY = "styles"')
    else:
        lines.append('THEME_KEY = "theme"')
        lines.append('STYLES_KEY = "styles"')

    lines.append('SPEC_BASE_URL = "https://a2ui.org/specification"')
    lines.append("")

    # Outbound message type constants
    lines.append("# Outbound message types")
    outbound_keys: List[str] = []
    defs = a2r_data.get("$defs", {})
    if defs:
        for mname, mschema in defs.items():
            if mname.endswith("Message"):
                for k in mschema.get("properties", {}).keys():
                    if k != "version" and k not in outbound_keys:
                        outbound_keys.append(k)
    else:
        for k in a2r_data.get("properties", {}).keys():
            if k != "version" and k not in outbound_keys:
                outbound_keys.append(k)

    for key in outbound_keys:
        const_var = f"MSG_TYPE_{_to_snake_case(key).upper()}"
        lines.append(f'{const_var} = "{key}"')

    # Cross-version aliases for v0_8
    if dir_name == "v0_8":
        lines.append("MSG_TYPE_CREATE_SURFACE = MSG_TYPE_BEGIN_RENDERING")
        lines.append("MSG_TYPE_UPDATE_COMPONENTS = MSG_TYPE_SURFACE_UPDATE")
        lines.append("MSG_TYPE_UPDATE_DATA_MODEL = MSG_TYPE_DATA_MODEL_UPDATE")

    # Inbound message type constants
    lines.append("")
    lines.append("# Inbound message types")
    inbound_props = r2a_data.get("properties", {})
    for key in inbound_props.keys():
        if key != "version":
            const_var = f"MSG_TYPE_{_to_snake_case(key).upper()}"
            lines.append(f'{const_var} = "{key}"')

    if "userAction" in inbound_props and "action" not in inbound_props:
        lines.append("MSG_TYPE_ACTION = MSG_TYPE_USER_ACTION")
    elif "action" in inbound_props and "userAction" not in inbound_props:
        lines.append("MSG_TYPE_USER_ACTION = MSG_TYPE_ACTION")

    lines.append("")
    return "\n".join(lines)


class PydanticCodegen:
    """Deterministic Pydantic v2 code generator from JSON Schema."""

    def __init__(self, version: str):
        self.version = _ensure_v_prefix(version)
        self.dir_name = _version_to_underscore(self.version)
        self.spec_dot = self.version
        self.inline_objects: Dict[str, Dict[str, Any]] = {}
        self.allow_inline = True

    def map_json_type_to_python(self, prop_name: str, prop: Dict[str, Any]) -> str:
        """Maps JSON Schema property type to Python typing string."""
        if "const" in prop:
            cval = prop["const"]
            if isinstance(cval, str):
                return f"Literal['{cval}']"
            return f"Literal[{cval}]"

        if "$ref" in prop:
            ref = prop["$ref"]
            if isinstance(ref, str):
                if ref.endswith("/ComponentsList"):
                    return "List[Dict[str, Any]]"
                if ref.endswith("/Component") or ref.endswith("/anyComponent"):
                    return "Dict[str, Any]"
                if ref.endswith("/CallId"):
                    return "str"
                if ref.endswith("/Child"):
                    return "Child"
                if ref.endswith("/Extensions"):
                    return "Optional[Dict[str, Any]]"
                if "common_types.json" in ref or ref.startswith("#/$defs/"):
                    return ref.split("/")[-1]
                elif ref.startswith("#/components/"):
                    return f"{ref.split('/')[-1]}Component"
                elif ref.startswith("#/"):
                    return ref.split("/")[-1]
            return "Any"

        if "oneOf" in prop or "anyOf" in prop:
            union_items = prop.get("oneOf") or prop.get("anyOf")
            if union_items is not None:
                mapped_items = []
                for item in union_items:
                    mapped = self.map_json_type_to_python(prop_name, item)
                    if mapped not in mapped_items:
                        mapped_items.append(mapped)
                if len(mapped_items) == 1:
                    return mapped_items[0]
                return f"Union[{', '.join(mapped_items)}]"

        if "allOf" in prop:
            allOf_items = prop["allOf"]
            if allOf_items:
                return self.map_json_type_to_python(prop_name, allOf_items[0])

        if "enum" in prop:
            enum_vals = [
                f'"{v}"' if isinstance(v, str) else str(v) for v in prop["enum"]
            ]
            return f"Literal[{', '.join(enum_vals)}]"

        t = prop.get("type")
        if t == "string":
            return "str"
        elif t == "number":
            return "float"
        elif t == "integer":
            return "int"
        elif t == "boolean":
            return "bool"
        elif t == "array":
            items = prop.get("items", {})
            if isinstance(items, list):
                item_types = [
                    self.map_json_type_to_python(prop_name, it) for it in items
                ]
                return f"Tuple[{', '.join(item_types)}]"
            item_type = self.map_json_type_to_python(prop_name, items)
            return f"List[{item_type}]"
        elif t == "object":
            if self.allow_inline and "properties" in prop:
                if len(prop["properties"]) == 1:
                    single_prop = list(prop["properties"].keys())[0]
                    class_name = _to_pascal_case(single_prop)
                elif prop_name.endswith("ies"):
                    base_name = prop_name[:-3] + "y"
                    class_name = f"{_to_pascal_case(base_name)}Item"
                elif prop_name.endswith("s") and not prop_name.endswith("ss"):
                    base_name = prop_name[:-1]
                    class_name = f"{_to_pascal_case(base_name)}Item"
                elif prop_name:
                    class_name = f"{_to_pascal_case(prop_name)}Item"
                else:
                    first_prop = list(prop["properties"].keys())[0]
                    class_name = f"{_to_pascal_case(first_prop)}Item"
                self.inline_objects[class_name] = prop
                return class_name
            add_props = prop.get("additionalProperties")
            if isinstance(add_props, dict):
                val_type = self.map_json_type_to_python(prop_name, add_props)
                return f"Dict[str, {val_type}]"
            return "Dict[str, Any]"

        return "Any"

    def compile_properties(
        self, props: Dict[str, Any], required: List[str]
    ) -> List[str]:
        """Compiles JSON Schema properties into Pydantic v2 field declarations."""
        lines = []
        for prop_name, prop_desc in props.items():
            if prop_name == "component":
                continue
            py_type = self.map_json_type_to_python(prop_name, prop_desc)
            raw_desc = (
                prop_desc.get("description", "").replace("\n", " ").replace('"', '\\"')
            )

            field_opts = []
            if raw_desc:
                field_opts.append(f'description="{raw_desc}"')

            if "pattern" in prop_desc:
                pat = prop_desc["pattern"].replace("\\", "\\\\")
                field_opts.append(f'pattern=r"{pat}"')

            has_default = False
            if "default" in prop_desc:
                has_default = True
                default_val = prop_desc["default"]
                if isinstance(default_val, str):
                    field_opts.append(f'default="{default_val}"')
                elif isinstance(default_val, bool):
                    field_opts.append(f"default={default_val}")
                elif default_val is None:
                    field_opts.append("default=None")
                else:
                    field_opts.append(f"default={default_val}")
            elif "const" in prop_desc:
                has_default = True
                const_val = prop_desc["const"]
                if isinstance(const_val, str):
                    field_opts.append(f'default="{const_val}"')
                elif isinstance(const_val, bool):
                    field_opts.append(f"default={const_val}")
                else:
                    field_opts.append(f"default={const_val}")

            snake_name = _to_snake_case(prop_name)
            if snake_name != prop_name:
                field_opts.insert(0, f'alias="{prop_name}"')

            field_str = f", {', '.join(field_opts)}" if field_opts else ""

            if prop_name in required:
                clean_opts = [o for o in field_opts if not o.startswith("default=")]
                field_str = f", {', '.join(clean_opts)}" if clean_opts else ""
                if "const" in prop_desc:
                    const_val = prop_desc["const"]
                    const_str = (
                        f'"{const_val}"'
                        if isinstance(const_val, str)
                        else str(const_val)
                    )
                    lines.append(
                        f"    {snake_name}: {py_type} = Field({const_str}{field_str})"
                    )
                else:
                    lines.append(f"    {snake_name}: {py_type} = Field(...{field_str})")
            else:
                if has_default:
                    clean_field_str = field_str.lstrip(", ")
                    lines.append(
                        f"    {snake_name}: Optional[{py_type}] ="
                        f" Field({clean_field_str})"
                    )
                else:
                    lines.append(
                        f"    {snake_name}: Optional[{py_type}] ="
                        f" Field(None{field_str})"
                    )

        return lines

    def compile_object_def(
        self, class_name: str, spec: Dict[str, Any], base_class: Optional[str] = None
    ) -> str:
        """Compiles a single object schema definition into a Pydantic class."""
        add_props = spec.get("additionalProperties", False)
        if add_props is True or isinstance(add_props, dict):
            bcls = base_class or "BaseModel"
            lines = [
                f"class {class_name}({bcls}):",
                '    model_config = ConfigDict(extra="allow", populate_by_name=True)',
            ]
        else:
            bcls = base_class or "StrictBaseModel"
            lines = [f"class {class_name}({bcls}):"]

        raw_desc = spec.get("description", "").replace("\n", " ")
        if raw_desc:
            lines.append(f'    """{raw_desc}"""')

        props = spec.get("properties", {})
        required = spec.get("required", [])
        prop_lines = self.compile_properties(props, required)
        if not prop_lines:
            lines.append("    pass")
            return "\n".join(lines) + "\n"

        lines.extend(prop_lines)
        return "\n".join(lines) + "\n"

    def compile_union_def(self, class_name: str, spec: Dict[str, Any]) -> str:
        """Compiles a union schema into a type alias."""
        union_items = spec.get("oneOf") or spec.get("anyOf") or spec.get("allOf")
        if not union_items:
            return f"{class_name} = Any\n"

        mapped_items = []
        for item in union_items:
            ref_item = item
            if isinstance(item, dict) and "allOf" in item:
                ref_item = item["allOf"][0]
            mapped = self.map_json_type_to_python("", ref_item)
            if mapped not in mapped_items:
                mapped_items.append(mapped)

        return f"{class_name} = Union[{', '.join(mapped_items)}]\n"


def generate_common_types(
    version: str,
    common_data: Dict[str, Any],
) -> str:
    """Generates common_types.py content."""
    codegen = PydanticCodegen(version)
    codegen.allow_inline = False
    defs = common_data.get("$defs", {})
    common_blocks = [
        (
            f"{FILE_HEADER}\nfrom typing import Annotated, Any, Dict, List, Literal,"
            " Optional, Union\nfrom pydantic import BaseModel, Field, ConfigDict,"
            " GetCoreSchemaHandler, ValidationInfo, field_validator\nfrom"
            " pydantic_core import CoreSchema"
        ),
        """class ComponentReference:
    \"\"\"Base marker class for all A2UI component references.\"\"\"""",
        """class SingleReference(str, ComponentReference):
    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        from pydantic_core import core_schema

        return core_schema.no_info_after_validator_function(
            cls,
            core_schema.str_schema(),
            serialization=core_schema.plain_serializer_function_ser_schema(str),
        )""",
        """class ListReference(ComponentReference):
    \"\"\"Marker class indicating a field holds a list of component references.\"\"\"""",
        """class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("version", mode="after", check_fields=False)
    @classmethod
    def validate_version_field(cls, v: Any, info: ValidationInfo) -> Any:
        context = info.context or {}
        target_version = context.get("target_version")
        if target_version is None:
            from .constants import SPEC_VERSION

            target_version = SPEC_VERSION
        if v != target_version:
            raise ValueError(f"Input should be '{target_version}'")
        return v""",
        """ComponentId = SingleReference
Child = SingleReference
CallId = str""",
    ]

    if "DataBinding" in defs:
        common_blocks.append(
            codegen.compile_object_def("DataBinding", defs["DataBinding"])
        )
    else:
        common_blocks.append(
            "class DataBinding(StrictBaseModel):\n    path: str = Field(...,"
            ' description="A JSON Pointer path to a value in the data model.")'
        )

    if "FunctionCall" in defs:
        common_blocks.append(
            codegen.compile_object_def("FunctionCall", defs["FunctionCall"])
        )
    else:
        common_blocks.append(
            "class FunctionCall(StrictBaseModel):\n    call: str = Field(...,"
            ' description="The name of the function to call.")\n    args:'
            " Optional[Dict[str, Any]] = Field(None)\n    return_type: Optional[str] ="
            ' Field("boolean", alias="returnType")'
        )

    dynamic_types = []
    if "DynamicValue" in defs:
        dynamic_types.append(
            codegen.compile_union_def("DynamicValue", defs["DynamicValue"])
        )
    else:
        dynamic_types.append(
            "DynamicValue = Union[str, float, bool, List[Any], DataBinding,"
            " FunctionCall]"
        )

    if "DynamicString" in defs:
        dynamic_types.append(
            codegen.compile_union_def("DynamicString", defs["DynamicString"])
        )
    else:
        dynamic_types.append("DynamicString = Union[str, DataBinding, FunctionCall]")

    if "DynamicNumber" in defs:
        dynamic_types.append(
            codegen.compile_union_def("DynamicNumber", defs["DynamicNumber"])
        )
    else:
        dynamic_types.append("DynamicNumber = Union[float, DataBinding, FunctionCall]")

    if "DynamicBoolean" in defs:
        dynamic_types.append(
            codegen.compile_union_def("DynamicBoolean", defs["DynamicBoolean"])
        )
    else:
        dynamic_types.append("DynamicBoolean = Union[bool, DataBinding, FunctionCall]")

    if "DynamicStringList" in defs:
        dynamic_types.append(
            codegen.compile_union_def("DynamicStringList", defs["DynamicStringList"])
        )
    else:
        dynamic_types.append(
            "DynamicStringList = Union[List[str], DataBinding, FunctionCall]"
        )

    common_blocks.append("\n\n".join(dt.strip() for dt in dynamic_types))

    if "ChildList" in defs:
        clist_spec = defs["ChildList"]
        if "oneOf" in clist_spec and len(clist_spec["oneOf"]) > 1:
            template_spec = clist_spec["oneOf"][1]
            common_blocks.append(
                codegen.compile_object_def(
                    "TemplateChildList",
                    template_spec,
                    base_class="StrictBaseModel, ListReference",
                )
            )
            common_blocks.append(
                "ChildList = Union[List[ComponentId], TemplateChildList]"
            )
    else:
        common_blocks.append(
            "class TemplateChildList(StrictBaseModel, ListReference):\n   "
            ' component_id: ComponentId = Field(..., alias="componentId")\n    path:'
            " str = Field(...)"
        )
        common_blocks.append("ChildList = Union[List[ComponentId], TemplateChildList]")

    if "AccessibilityAttributes" in defs:
        common_blocks.append(
            codegen.compile_object_def(
                "AccessibilityAttributes", defs["AccessibilityAttributes"]
            )
        )
    else:
        common_blocks.append(
            "class AccessibilityAttributes(StrictBaseModel):\n    label:"
            " Optional[DynamicString] = Field(None)\n    description:"
            ' Optional[DynamicString] = Field(None)\n    live: Literal["off", "polite",'
            ' "assertive"] = Field("off")\n    hidden: Optional[DynamicBoolean] ='
            " Field(None)"
        )

    if "ValidationResult" in defs:
        common_blocks.append(
            codegen.compile_object_def("ValidationResult", defs["ValidationResult"])
        )

    if "CheckRule" in defs:
        common_blocks.append(codegen.compile_object_def("CheckRule", defs["CheckRule"]))
    else:
        common_blocks.append(
            "class CheckRule(StrictBaseModel):\n    condition: Any = Field(...)\n   "
            " message: Optional[str] = Field(None)"
        )

    if "Extensions" in defs:
        common_blocks.append(
            codegen.compile_object_def(
                "Extensions", defs["Extensions"], base_class="BaseModel"
            )
        )

    if "Action" in defs:
        action_spec = defs["Action"]
        if "oneOf" in action_spec:
            event_part = action_spec["oneOf"][0]
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
                        event_part["properties"]["event"].get(
                            "description", "The event to dispatch to the server."
                        )
                    ),
                }
                common_blocks.append(
                    codegen.compile_object_def("ActionEventWrapper", event_wrapper_spec)
                )
            if (
                len(action_spec["oneOf"]) > 1
                and "properties" in action_spec["oneOf"][1]
            ):
                common_blocks.append(
                    codegen.compile_object_def(
                        "ActionFunctionCallWrapper", action_spec["oneOf"][1]
                    )
                )
            common_blocks.append(
                "Action = Union[ActionEventWrapper, ActionFunctionCallWrapper]"
            )
    else:
        common_blocks.append(
            "class ActionEvent(StrictBaseModel):\n    name: str = Field(...)\n   "
            " context: Optional[Dict[str, Any]] = Field(None)"
        )
        common_blocks.append(
            "class ActionEventWrapper(StrictBaseModel):\n    event: ActionEvent ="
            " Field(...)"
        )
        common_blocks.append(
            "class ActionFunctionCallWrapper(StrictBaseModel):\n    function_call:"
            ' FunctionCall = Field(..., alias="functionCall")'
        )
        common_blocks.append(
            "Action = Union[ActionEventWrapper, ActionFunctionCallWrapper]"
        )

    if "ComponentCommon" in defs:
        common_blocks.append(
            codegen.compile_object_def("ComponentCommon", defs["ComponentCommon"])
        )
    else:
        common_blocks.append(
            "class ComponentCommon(StrictBaseModel):\n    id: ComponentId ="
            " Field(...)\n    accessibility: Optional[AccessibilityAttributes] ="
            " Field(None)"
        )

    if "FunctionResponse" in defs:
        common_blocks.append("""class FunctionResponseError(StrictBaseModel):
    code: str = Field(...)
    message: str = Field(...)""")
        common_blocks.append("""class FunctionResponse(StrictBaseModel):
    function_call_id: Optional[str] = Field(None, alias="functionCallId")
    call_id: Optional[str] = Field(None, alias="callId")
    value: Optional[Any] = Field(None)
    result: Optional[Any] = Field(None)
    error: Optional[Union[FunctionResponseError, str, Dict[str, Any]]] = Field(None)""")

    return "\n\n\n".join(b.strip() for b in common_blocks if b.strip()) + "\n"


def generate_agent_to_renderer(
    version: str,
    a2r_data: Dict[str, Any],
    a2r_name: str = "",
) -> Tuple[str, List[str]]:
    """Generates agent_to_renderer.py / server_to_client.py content and message names."""
    codegen = PydanticCodegen(version)
    codegen.allow_inline = False
    dir_name = _version_to_underscore(version)
    is_modern = _is_modern_terminology(version, a2r_name)
    defs_a2r = a2r_data.get("$defs", {})

    needed_imports = ["StrictBaseModel"]
    if (
        "callRendererFunction" in defs_a2r
        or "CallRendererFunction" in defs_a2r
        or "CallRendererFunctionMessage" in defs_a2r
    ):
        needed_imports.append("FunctionCall")
    if (
        "agentFunctionResponse" in defs_a2r
        or "AgentFunctionResponse" in defs_a2r
        or "AgentFunctionResponseMessage" in defs_a2r
    ):
        needed_imports.append("FunctionResponse")
    a2r_imports = f"from .common_types import {', '.join(needed_imports)}\n"

    a2r_blocks = [
        (
            f"{FILE_HEADER}\n"
            "from typing import Any, Dict, List, Literal, Optional, Union\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            + a2r_imports
            + "from .constants import SPEC_VERSION, SPEC_VERSION_TYPE"
        ),
        "ComponentsList = List[Dict[str, Any]]\nComponent = Dict[str, Any]",
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
                a2r_blocks.append(
                    codegen.compile_object_def(payload_name, payload_schema)
                )

            snake_env = _to_snake_case(envelope_key)
            alias_opt = f', alias="{envelope_key}"' if snake_env != envelope_key else ""
            a2r_blocks.append(
                f"class {mname}(StrictBaseModel):\n"
                "    version: SPEC_VERSION_TYPE = SPEC_VERSION\n"
                f"    {snake_env}: {payload_name} = Field(...{alias_opt})"
            )
            msg_names.append(mname)
    else:
        props = a2r_data.get("properties", {})
        for key, val_schema in props.items():
            pascal_key = _to_pascal_case(key)
            payload_name = pascal_key
            mname = f"{pascal_key}Message"
            a2r_blocks.append(codegen.compile_object_def(payload_name, val_schema))
            snake_env = _to_snake_case(key)
            alias_opt = f', alias="{key}"' if snake_env != key else ""
            a2r_blocks.append(
                f"class {mname}(StrictBaseModel):\n"
                "    version: SPEC_VERSION_TYPE = SPEC_VERSION\n"
                f"    {snake_env}: {payload_name} = Field(...{alias_opt})"
            )
            msg_names.append(mname)

        if dir_name == "v0_8":
            a2r_blocks.append(
                "CreateSurface = BeginRendering\n"
                "CreateSurfaceMessage = BeginRenderingMessage\n"
                "UpdateComponents = SurfaceUpdate\n"
                "UpdateComponentsMessage = SurfaceUpdateMessage\n"
                "UpdateDataModel = DataModelUpdate\n"
                "UpdateDataModelMessage = DataModelUpdateMessage"
            )

    if msg_names:
        if is_modern:
            a2r_blocks.append(f"AgentToRendererMessage = Union[{', '.join(msg_names)}]")
            a2r_blocks.append(
                "ServerToClientMessage = AgentToRendererMessage\nA2uiMessage ="
                " AgentToRendererMessage"
            )
            a2r_blocks.append(
                "class A2uiMessageListWrapper(StrictBaseModel):\n    messages:"
                ' List[AgentToRendererMessage] = Field(..., description="A list of'
                ' messages.")'
            )
        else:
            a2r_blocks.append(f"ServerToClientMessage = Union[{', '.join(msg_names)}]")
            a2r_blocks.append(
                "AgentToRendererMessage = ServerToClientMessage\nA2uiMessage ="
                " ServerToClientMessage"
            )
            a2r_blocks.append(
                "class A2uiMessageListWrapper(StrictBaseModel):\n    messages:"
                ' List[ServerToClientMessage] = Field(..., description="A list of'
                ' messages.")'
            )

    return "\n\n\n".join(b.strip() for b in a2r_blocks if b.strip()) + "\n", msg_names


def generate_renderer_to_agent(
    version: str,
    r2a_data: Dict[str, Any],
    a2r_name: str = "",
) -> str:
    """Generates renderer_to_agent.py / client_to_server.py content."""
    codegen = PydanticCodegen(version)
    is_modern = _is_modern_terminology(version, a2r_name)
    props = r2a_data.get("properties", {})
    needed_imports = ["StrictBaseModel"]
    if "callAgentFunction" in props:
        needed_imports.append("FunctionCall")
    if "rendererFunctionResponse" in props:
        needed_imports.append("FunctionResponse")
    action_prop = props.get("action", {}) or props.get("userAction", {})
    action_subprops = action_prop.get("properties", {})
    if "metadata" in action_subprops:
        needed_imports.append("Extensions")
    r2a_imports = f"from .common_types import {', '.join(needed_imports)}\n"

    r2a_blocks = [
        f"{FILE_HEADER}\n"
        "from typing import Any, Dict, List, Literal, Optional, Union\n"
        "from pydantic import BaseModel, Field, ConfigDict\n"
        + r2a_imports
        + "from .constants import SPEC_VERSION, SPEC_VERSION_TYPE",
    ]
    action_key = (
        "action"
        if "action" in props
        else "userAction"
        if "userAction" in props
        else None
    )
    if action_key:
        if is_modern:
            r2a_blocks.append(
                codegen.compile_object_def("A2uiRendererAction", props[action_key])
            )
            r2a_blocks.append(
                "A2uiClientAction = A2uiRendererAction\n"
                "A2uiClientUserAction = A2uiRendererAction\n"
                "ActionPayload = A2uiRendererAction"
            )
        else:
            r2a_blocks.append(
                codegen.compile_object_def("A2uiClientAction", props[action_key])
            )
            r2a_blocks.append(
                "A2uiRendererAction = A2uiClientAction\n"
                "A2uiClientUserAction = A2uiClientAction\n"
                "ActionPayload = A2uiClientAction"
            )

    if "callAgentFunction" in props:
        r2a_blocks.append(
            codegen.compile_object_def("CallAgentFunction", props["callAgentFunction"])
        )

    if "error" in props:
        err_spec = props["error"]
        err_classes = []
        if "oneOf" in err_spec or "anyOf" in err_spec:
            items = err_spec.get("oneOf") or err_spec.get("anyOf", [])
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
        elif "properties" in err_spec:
            r2a_blocks.append(codegen.compile_object_def("A2uiClientError", err_spec))
            err_classes.append("A2uiClientError")
        else:
            r2a_blocks.append(
                "class A2uiGenericError(StrictBaseModel):\n"
                "    code: Optional[str] = Field(None)\n"
                "    message: Optional[str] = Field(None)"
            )
            err_classes.append("A2uiGenericError")

        if err_classes:
            if "A2uiValidationFailedError" in err_classes:
                r2a_blocks.append("A2uiValidationError = A2uiValidationFailedError")
            elif "A2uiValidationError" in err_classes:
                r2a_blocks.append("A2uiValidationFailedError = A2uiValidationError")
            else:
                r2a_blocks.append(
                    "class A2uiValidationError(StrictBaseModel):\n    pass"
                )
            r2a_blocks.append(f"A2uiClientError = Union[{', '.join(err_classes)}]")
            r2a_blocks.append("A2uiRendererError = A2uiClientError")

    msg_union_members = []
    if action_key:
        snake_act = _to_snake_case(action_key)
        alias_opt = f', alias="{action_key}"' if snake_act != action_key else ""
        if is_modern:
            r2a_blocks.append(
                "class A2uiRendererActionMessage(StrictBaseModel):\n"
                "    version: SPEC_VERSION_TYPE = SPEC_VERSION\n"
                f"    {snake_act}: A2uiRendererAction = Field(...{alias_opt})"
            )
            r2a_blocks.append(
                "A2uiClientActionMessage = A2uiRendererActionMessage\n"
                "A2uiClientUserActionMessage = A2uiRendererActionMessage"
            )
            msg_union_members.append("A2uiRendererActionMessage")
        else:
            r2a_blocks.append(
                "class A2uiClientActionMessage(StrictBaseModel):\n"
                "    version: SPEC_VERSION_TYPE = SPEC_VERSION\n"
                f"    {snake_act}: A2uiClientAction = Field(...{alias_opt})"
            )
            r2a_blocks.append(
                "A2uiRendererActionMessage = A2uiClientActionMessage\n"
                "A2uiClientUserActionMessage = A2uiClientActionMessage"
            )
            msg_union_members.append("A2uiClientActionMessage")

    if "callAgentFunction" in props:
        r2a_blocks.append(
            "class CallAgentFunctionMessage(StrictBaseModel):\n    version:"
            " SPEC_VERSION_TYPE = SPEC_VERSION\n    call_agent_function:"
            ' CallAgentFunction = Field(..., alias="callAgentFunction")'
        )
        msg_union_members.append("CallAgentFunctionMessage")

    if "rendererFunctionResponse" in props:
        r2a_blocks.append(
            "class RendererFunctionResponseMessage(StrictBaseModel):\n    version:"
            " SPEC_VERSION_TYPE = SPEC_VERSION\n    renderer_function_response:"
            ' FunctionResponse = Field(..., alias="rendererFunctionResponse")'
        )
        msg_union_members.append("RendererFunctionResponseMessage")

    if "error" in props:
        r2a_blocks.append(
            "class A2uiClientErrorMessage(StrictBaseModel):\n"
            "    version: SPEC_VERSION_TYPE = SPEC_VERSION\n"
            "    error: A2uiClientError = Field(...)"
        )
        msg_union_members.append("A2uiClientErrorMessage")

    union_def = f"Union[{', '.join(msg_union_members)}]" if msg_union_members else "Any"

    if is_modern:
        r2a_blocks.append(f"RendererToAgentMessage = {union_def}")
        r2a_blocks.append(
            "ClientToServerMessage = RendererToAgentMessage\n"
            "A2uiClientMessage = RendererToAgentMessage"
        )
    else:
        r2a_blocks.append(f"A2uiClientMessage = {union_def}")
        r2a_blocks.append(
            "ClientToServerMessage = A2uiClientMessage\n"
            "RendererToAgentMessage = A2uiClientMessage"
        )

    union_name = "RendererToAgentMessage" if is_modern else "ClientToServerMessage"
    r2a_blocks.append(
        "class A2uiClientDataModel(StrictBaseModel):\n    version:"
        " SPEC_VERSION_TYPE = SPEC_VERSION\n    surfaces: Dict[str, Dict[str, Any]]"
        ' = Field(..., description="A map of surface IDs to data models.")'
    )
    r2a_blocks.append(f"A2uiClientMessageList = List[{union_name}]")
    r2a_blocks.append(
        "class A2uiClientMessageListWrapper(StrictBaseModel):\n    messages:"
        ' A2uiClientMessageList = Field(..., description="List wrapper.")'
    )

    return "\n\n\n".join(b.strip() for b in r2a_blocks if b.strip()) + "\n"


def generate_renderer_capabilities(
    version: str,
    capabilities_data: Dict[str, Any],
    is_modern: Optional[bool] = None,
) -> str:
    """Generates renderer_capabilities.py / client_capabilities.py content."""
    codegen = PydanticCodegen(version)
    dir_name = _version_to_underscore(version)
    spec_dot = _ensure_v_prefix(version)
    if is_modern is None:
        is_modern = _is_modern_terminology(version)
    caps_blocks = [
        (
            f"{FILE_HEADER}\n"
            "from typing import Any, Dict, List, Literal, Optional\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            "from .common_types import StrictBaseModel\n"
            "from .constants import SPEC_VERSION, SPEC_VERSION_TYPE"
        ),
    ]

    defs_caps = capabilities_data.get("$defs", {})
    if "FunctionDefinition" in defs_caps:
        caps_blocks.append(
            codegen.compile_object_def(
                "FunctionDefinition", defs_caps["FunctionDefinition"]
            )
        )
    if "Catalog" in defs_caps:
        caps_blocks.append(
            codegen.compile_object_def("InlineCatalog", defs_caps["Catalog"])
        )
        caps_blocks.append("Catalog = InlineCatalog")
    else:
        caps_blocks.append(
            "class InlineCatalog(BaseModel):\n"
            '    model_config = ConfigDict(extra="allow")'
        )
        caps_blocks.append("Catalog = InlineCatalog")
        if "FunctionDefinition" not in defs_caps:
            caps_blocks.append(
                "class FunctionDefinition(BaseModel):\n"
                '    model_config = ConfigDict(extra="allow")'
            )

    v_key = spec_dot
    v_props = (
        capabilities_data.get("properties", {}).get(v_key, {}).get("properties", {})
    )
    v_req = capabilities_data.get("properties", {}).get(v_key, {}).get("required", [])

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

    caps_blocks.append(
        f"class A2uiRendererCapabilities(StrictBaseModel):\n    {dir_name}:"
        f" Optional[{cap_cls_name}] = Field(None, alias=SPEC_VERSION)"
    )
    caps_blocks.append("A2uiClientCapabilities = A2uiRendererCapabilities")

    return "\n\n\n".join(b.strip() for b in caps_blocks if b.strip()) + "\n"


def generate_schema_init(
    version: str,
    msg_names: List[str],
    c2s_names: Optional[List[str]] = None,
) -> str:
    """Generates __init__.py content for a version schema directory."""
    dir_name = _version_to_underscore(version)
    is_modern = _is_modern_terminology(version)
    common_types_list = [
        "StrictBaseModel",
        "DataBinding",
        "FunctionCall",
        "AccessibilityAttributes",
        "CheckRule",
        "ActionEvent",
        "Action",
        "ComponentCommon",
    ]
    common_export_lines = [f"    {c}," for c in common_types_list]

    s2c_export_list = []
    for mn in msg_names:
        s2c_export_list.append(mn)
        payload = mn.replace("Message", "")
        if payload != mn and payload not in s2c_export_list:
            s2c_export_list.append(payload)
    if dir_name == "v0_8":
        s2c_export_list.extend([
            "CreateSurface",
            "CreateSurfaceMessage",
            "UpdateComponents",
            "UpdateComponentsMessage",
            "UpdateDataModel",
            "UpdateDataModelMessage",
        ])
    if is_modern:
        s2c_export_list.extend([
            "AgentToRendererMessage",
            "A2uiMessage",
            "ServerToClientMessage",
            "A2uiMessageListWrapper",
        ])
    else:
        s2c_export_list.extend([
            "A2uiMessage",
            "ServerToClientMessage",
            "AgentToRendererMessage",
            "A2uiMessageListWrapper",
        ])
    s2c_lines = [f"    {name}," for name in s2c_export_list]

    caps_module_name = "renderer_capabilities" if is_modern else "client_capabilities"
    if is_modern:
        v_tag = f"V{dir_name.replace('v', '').replace('_', '')}Capabilities"
        caps_export_list = [
            "A2uiRendererCapabilities",
            "A2uiClientCapabilities",
            v_tag,
            "InlineCatalog",
            "FunctionDefinition",
            f"V{dir_name.replace('v', '').capitalize()}Capabilities",
        ]
    else:
        v_tag = "V08Capabilities" if dir_name == "v0_8" else "V09Capabilities"
        v_tag_alt = "V0_8Capabilities" if dir_name == "v0_8" else "V0_9Capabilities"
        caps_export_list = [
            "A2uiClientCapabilities",
            "A2uiRendererCapabilities",
            v_tag,
            "InlineCatalog",
            "FunctionDefinition",
            v_tag_alt,
        ]
    caps_lines = [f"    {name}," for name in caps_export_list]

    c2s_module_name = "renderer_to_agent" if is_modern else "client_to_server"
    if is_modern:
        c2s_export_list = [
            "RendererToAgentMessage",
            "ClientToServerMessage",
            "A2uiClientMessage",
            "A2uiRendererActionMessage",
            "A2uiClientActionMessage",
            "A2uiClientUserActionMessage",
            "A2uiClientErrorMessage",
            "A2uiRendererAction",
            "A2uiClientAction",
            "A2uiClientUserAction",
            "ActionPayload",
            "A2uiValidationError",
            "A2uiGenericError",
            "A2uiClientError",
            "A2uiRendererError",
            "A2uiClientDataModel",
            "A2uiClientMessageList",
            "A2uiClientMessageListWrapper",
        ]
    else:
        c2s_export_list = [
            "A2uiClientMessage",
            "ClientToServerMessage",
            "RendererToAgentMessage",
            "A2uiClientActionMessage",
            "A2uiClientErrorMessage",
            "A2uiClientAction",
            "A2uiRendererAction",
            "A2uiValidationError",
            "A2uiGenericError",
            "A2uiClientError",
            "A2uiClientDataModel",
            "A2uiClientMessageList",
            "A2uiClientMessageListWrapper",
        ]
    c2s_lines = [f"    {name}," for name in c2s_export_list]

    all_exports = (
        common_types_list + s2c_export_list + caps_export_list + c2s_export_list
    )
    deduped_exports = list(dict.fromkeys(all_exports))
    all_export_lines = [f'    "{name}",' for name in deduped_exports]

    out_s2c_name = "agent_to_renderer" if is_modern else "server_to_client"
    ver_init = [
        FILE_HEADER,
        "",
        "from .common_types import (",
        "\n".join(common_export_lines),
        ")",
        "from .constants import *",
        f"from .{out_s2c_name} import (",
        "\n".join(s2c_lines),
        ")",
        f"from .{caps_module_name} import (",
        "\n".join(caps_lines),
        ")",
        f"from .{c2s_module_name} import (",
        "\n".join(c2s_lines),
        ")",
        "",
        "",
        "__all__ = [",
        "\n".join(all_export_lines),
        "]",
        "",
    ]
    return "\n".join(ver_init)


def generate_basic_catalog_components(
    version: str,
    catalog_data: Dict[str, Any],
    common_data: Optional[Dict[str, Any]] = None,
) -> Tuple[str, List[str]]:
    """Generates components.py content and generated class names."""
    codegen = PydanticCodegen(version)
    dir_name = _version_to_underscore(version)
    common_defs = common_data.get("$defs", {}) if common_data else {}
    all_defs = dict(common_defs)
    all_defs.update(catalog_data.get("$defs", {}))

    comp_blocks = [
        (
            f"{FILE_HEADER}\n"
            "from typing import Any, Dict, List, Literal, Optional, Union, Annotated\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            f"from ...schema.{dir_name}.common_types import (\n"
            "    StrictBaseModel,\n"
            "    ComponentCommon,\n"
            "    AccessibilityAttributes,\n"
            "    DynamicString,\n"
            "    DynamicNumber,\n"
            "    DynamicBoolean,\n"
            "    DynamicValue,\n"
            "    DynamicStringList,\n"
            "    ChildList,\n"
            "    Child,\n"
            "    Action,\n"
            "    CheckRule,\n"
            "    DataBinding,\n"
            "    ComponentId,\n"
            ")\n"
            "from ...catalog.components import ModelComponentApi"
        ),
    ]

    names = []
    defs = catalog_data.get("$defs", {})
    if "CatalogComponentCommon" in defs:
        comp_blocks.append(
            codegen.compile_object_def(
                "CatalogComponentCommon",
                defs["CatalogComponentCommon"],
                base_class="ComponentCommon",
            )
        )
        names.append("CatalogComponentCommon")
    else:
        comp_blocks.append("class CatalogComponentCommon(ComponentCommon):\n    pass")
        names.append("CatalogComponentCommon")

    any_comp_def = defs.get("anyComponent", {})
    allowed_union_components = set()
    if "oneOf" in any_comp_def:
        for it in any_comp_def["oneOf"]:
            if isinstance(it, dict) and "$ref" in it:
                ref_name = it["$ref"].split("/")[-1]
                allowed_union_components.add(f"{ref_name}Component")

    components = catalog_data.get("components", {})
    comp_names = []
    component_defs = []
    for cname, cschema in components.items():
        comp_class_name = f"{cname}Component"
        comp_names.append(comp_class_name)
        lines = [
            f"class {comp_class_name}(CatalogComponentCommon):",
            f'    component: Literal["{cname}"] = "{cname}"',
        ]
        props = dict(cschema.get("properties", {}))
        req = list(cschema.get("required", []))
        if "allOf" in cschema:
            for sub_item in cschema["allOf"]:
                if isinstance(sub_item, dict):
                    if "$ref" in sub_item:
                        ref_key = sub_item["$ref"].split("/")[-1]
                        if (
                            ref_key not in ("ComponentCommon", "CatalogComponentCommon")
                            and ref_key in all_defs
                        ):
                            resolved_def = all_defs[ref_key]
                            props.update(resolved_def.get("properties", {}))
                            req.extend(resolved_def.get("required", []))
                    else:
                        props.update(sub_item.get("properties", {}))
                        req.extend(sub_item.get("required", []))
        filtered_props = {
            k: v
            for k, v in props.items()
            if k not in ("id", "accessibility", "catalogId", "component")
        }
        lines.extend(codegen.compile_properties(filtered_props, req))
        component_defs.append("\n".join(lines))

    inline_names = []
    processed_inline = set()
    while len(processed_inline) < len(codegen.inline_objects):
        current_batch = [
            (k, v)
            for k, v in list(codegen.inline_objects.items())
            if k not in processed_inline
        ]
        for iname, ispec in current_batch:
            processed_inline.add(iname)
            inline_names.append(iname)
            comp_blocks.append(codegen.compile_object_def(iname, ispec))

    comp_blocks.extend(component_defs)
    names.extend(inline_names)
    names.extend(comp_names)

    union_comp_names = [
        c
        for c in comp_names
        if not allowed_union_components or c in allowed_union_components
    ]
    any_comp_lines = [
        "AnyComponent = Annotated[",
        "    Union[",
    ]
    for cname in union_comp_names:
        any_comp_lines.append(f"        {cname},")
    any_comp_lines.append("    ],")
    any_comp_lines.append('    Field(..., discriminator="component")')
    any_comp_lines.append("]")
    names.append("AnyComponent")

    api_names = []
    api_lines = []
    for cname in comp_names:
        base = cname.replace("Component", "")
        const_name = f"{_to_snake_case(base).upper()}_COMPONENT_API"
        api_lines.append(f"{const_name} = ModelComponentApi({cname})")
        api_names.append(const_name)

    basic_comp_lines = ["BASIC_COMPONENTS = ["]
    for aname in api_names:
        basic_comp_lines.append(f"    {aname},")
    basic_comp_lines.append("]")
    names.append("BASIC_COMPONENTS")
    names.extend(api_names)

    tail_sections = [
        "\n".join(any_comp_lines),
        "\n\n".join(api_lines),
        "\n".join(basic_comp_lines),
    ]
    comp_blocks.append("\n\n".join(tail_sections))
    return "\n\n\n".join(b.strip() for b in comp_blocks if b.strip()) + "\n", comp_names


def generate_basic_catalog_functions(
    version: str,
    catalog_data: Dict[str, Any],
) -> Tuple[str, List[str]]:
    """Generates function_apis.py content and generated class names."""
    codegen = PydanticCodegen(version)
    dir_name = _version_to_underscore(version)
    func_blocks = [
        (
            f"{FILE_HEADER}\nfrom typing import Any, Dict, List, Literal, Optional,"
            " Union\nfrom pydantic import BaseModel, Field, ConfigDict\nfrom"
            f" ...schema.{dir_name}.common_types import StrictBaseModel, DynamicString,"
            " DynamicNumber, DynamicBoolean, DynamicValue, DynamicStringList,"
            " DataBinding, FunctionCall\nfrom ...catalog.functions import FunctionApi"
        ),
    ]

    names = []
    functions = catalog_data.get("functions", {})
    defs = catalog_data.get("$defs", {})
    any_func_def = defs.get("anyFunction", {})
    allowed_funcs = set()
    if "oneOf" in any_func_def:
        for it in any_func_def["oneOf"]:
            if isinstance(it, dict) and "$ref" in it:
                ref_name = it["$ref"].split("/")[-1]
                allowed_funcs.add(ref_name)

    api_func_names = []
    for fname, fschema in functions.items():
        fprops = dict(fschema.get("properties", {}))
        if "allOf" in fschema:
            for sub_item in fschema["allOf"]:
                if isinstance(sub_item, dict):
                    fprops.update(sub_item.get("properties", {}))
        args_schema = fprops.get("args", {})
        args_props = dict(args_schema.get("properties", {}))
        args_req = list(args_schema.get("required", []))
        if "allOf" in args_schema:
            for sub_item in args_schema["allOf"]:
                if isinstance(sub_item, dict):
                    args_props.update(sub_item.get("properties", {}))
                    args_req.extend(sub_item.get("required", []))

        args_class_name = "None"
        if args_props:
            args_class_name = f"{_to_pascal_case(fname)}Args"
            func_blocks.append(
                codegen.compile_object_def(
                    args_class_name, {"properties": args_props, "required": args_req}
                )
            )

        func_class_name = f"{_to_pascal_case(fname)}Api"
        ret_type_val = fprops.get("returnType", {}).get("const", "boolean")
        if (
            isinstance(fprops.get("returnType"), dict)
            and "enum" in fprops["returnType"]
        ):
            ret_type_val = fprops["returnType"]["enum"][0]

        func_class_lines = [
            f"class {func_class_name}(FunctionApi):",
            f'    name = "{fname}"',
            f"    schema = {args_class_name}",
            f'    return_type = "{ret_type_val}"',
        ]
        func_blocks.append("\n".join(func_class_lines))
        names.append(func_class_name)
        if not allowed_funcs or fname in allowed_funcs:
            api_func_names.append(func_class_name)

    return (
        "\n\n\n".join(b.strip() for b in func_blocks if b.strip()) + "\n",
        names,
    )


def generate_basic_catalog_styles(
    version: str,
    catalog_data: Dict[str, Any],
) -> str:
    """Generates styles.py content."""
    codegen = PydanticCodegen(version)
    style_blocks = [
        (
            f"{FILE_HEADER}\nfrom typing import Any, Dict, Optional\nfrom"
            " pydantic import BaseModel, Field, ConfigDict"
        ),
    ]

    defs = catalog_data.get("$defs", {})
    if "theme" in defs:
        style_blocks.append(codegen.compile_object_def("Theme", defs["theme"]))
    elif "Theme" in defs:
        style_blocks.append(codegen.compile_object_def("Theme", defs["Theme"]))
    else:
        style_blocks.append(
            'class Theme(BaseModel):\n    model_config = ConfigDict(extra="allow",'
            " populate_by_name=True)\n    pass"
        )
    return "\n\n\n".join(b.strip() for b in style_blocks if b.strip()) + "\n"


def generate_version_schemas(
    version: str,
    spec_root: Optional[str] = None,
    out_root: Optional[str] = None,
) -> None:
    """Generates all Pydantic schema files for a given protocol version."""
    codegen = PydanticCodegen(version)
    codegen.allow_inline = (
        False  # Keep message envelope payloads strictly typed to generic mappings
    )
    dir_name = _version_to_underscore(version)
    s_root = spec_root or SPEC_ROOT
    o_root = out_root or CORE_SRC_ROOT
    spec_dir = os.path.join(s_root, dir_name)
    json_dir = (
        os.path.join(spec_dir, "json")
        if os.path.exists(os.path.join(spec_dir, "json"))
        else spec_dir
    )
    out_dir = os.path.join(o_root, "schema", dir_name)
    os.makedirs(out_dir, exist_ok=True)

    # 0. Load schema envelopes to derive constants and message classes
    a2r_name = (
        "agent_to_renderer.json"
        if os.path.exists(os.path.join(json_dir, "agent_to_renderer.json"))
        else "server_to_client.json"
    )
    a2r_path = os.path.join(json_dir, a2r_name)
    a2r_data = {}
    if os.path.exists(a2r_path):
        with open(a2r_path, "r", encoding="utf-8") as f:
            a2r_data = json.load(f)

    r2a_name = (
        "renderer_to_agent.json"
        if os.path.exists(os.path.join(json_dir, "renderer_to_agent.json"))
        else "client_to_server.json"
    )
    r2a_path = os.path.join(json_dir, r2a_name)
    r2a_data = {}
    if os.path.exists(r2a_path):
        with open(r2a_path, "r", encoding="utf-8") as f:
            r2a_data = json.load(f)

    # 1. Generate constants.py dynamically from schemas
    constants_path = os.path.join(out_dir, "constants.py")
    constants_code = _generate_constants_code(version, a2r_data, r2a_data)
    with open(constants_path, "w", encoding="utf-8") as f:
        f.write(constants_code)

    # 2. Generate common_types.py
    common_types_possible = [
        os.path.join(json_dir, "common_types.json"),
        os.path.join(spec_dir, "common_types.json"),
    ]
    common_types_json_path = next(
        (p for p in common_types_possible if os.path.exists(p)), None
    )
    common_data: Dict[str, Any] = {}
    if common_types_json_path:
        with open(common_types_json_path, "r", encoding="utf-8") as f:
            common_data = json.load(f)

    common_types_code = generate_common_types(version, common_data)
    common_types_out = os.path.join(out_dir, "common_types.py")
    with open(common_types_out, "w", encoding="utf-8") as f:
        f.write(common_types_code)

    # 3. Generate agent_to_renderer.py / server_to_client.py
    is_modern = _is_modern_terminology(version, a2r_name)
    msg_names: List[str] = []
    if a2r_data:
        a2r_code, msg_names = generate_agent_to_renderer(version, a2r_data, a2r_name)
        out_file_name = "agent_to_renderer.py" if is_modern else "server_to_client.py"
        with open(os.path.join(out_dir, out_file_name), "w", encoding="utf-8") as f:
            f.write(a2r_code)

    # 4. Generate renderer_to_agent.py / client_to_server.py
    if r2a_data:
        r2a_code = generate_renderer_to_agent(version, r2a_data, a2r_name)
        out_r2a_name = "renderer_to_agent.py" if is_modern else "client_to_server.py"
        with open(os.path.join(out_dir, out_r2a_name), "w", encoding="utf-8") as f:
            f.write(r2a_code)

    # 5. Generate renderer_capabilities.py / client_capabilities.py
    caps_name = (
        "renderer_capabilities.json"
        if os.path.exists(os.path.join(json_dir, "renderer_capabilities.json"))
        else "client_capabilities.json"
    )
    if not os.path.exists(os.path.join(json_dir, caps_name)):
        caps_name = "a2ui_client_capabilities_schema.json"
    caps_path = os.path.join(json_dir, caps_name)
    if os.path.exists(caps_path):
        with open(caps_path, "r", encoding="utf-8") as f:
            caps_data = json.load(f)

        caps_code = generate_renderer_capabilities(
            version, caps_data, is_modern=is_modern
        )
        out_caps_name = (
            "renderer_capabilities.py" if is_modern else "client_capabilities.py"
        )
        with open(os.path.join(out_dir, out_caps_name), "w", encoding="utf-8") as f:
            f.write(caps_code)

    # 6. Generate schema/__init__.py for version package
    schema_init_code = generate_schema_init(version, msg_names)
    with open(os.path.join(out_dir, "__init__.py"), "w", encoding="utf-8") as f:
        f.write(schema_init_code)


def generate_basic_catalog(
    version: str,
    spec_root: Optional[str] = None,
    out_root: Optional[str] = None,
) -> None:
    """Generates basic catalog components, functions, styles, and catalog classes for a given version."""
    dir_name = _version_to_underscore(version)
    s_root = spec_root or SPEC_ROOT
    o_root = out_root or CORE_SRC_ROOT

    # Check potential catalog paths strictly within the target version directory
    possible_paths = [
        os.path.join(s_root, dir_name, "catalogs/basic/catalog.json"),
        os.path.join(s_root, dir_name, "json/standard_catalog_definition.json"),
        os.path.join(s_root, dir_name, "json/catalogs/basic/catalog.json"),
        os.path.join(s_root, dir_name, "json/catalog.json"),
        os.path.join(s_root, dir_name, "standard_catalog_definition.json"),
    ]
    catalog_path = next((p for p in possible_paths if os.path.exists(p)), None)
    if not catalog_path:
        return

    out_dir = os.path.join(o_root, "basic_catalog", dir_name)
    os.makedirs(out_dir, exist_ok=True)

    with open(catalog_path, "r", encoding="utf-8") as f:
        cat_data = json.load(f)

    common_types_possible = [
        os.path.join(s_root, dir_name, "json/common_types.json"),
        os.path.join(s_root, dir_name, "common_types.json"),
    ]
    common_types_json_path = next(
        (p for p in common_types_possible if os.path.exists(p)), None
    )
    common_data: Optional[Dict[str, Any]] = None
    if common_types_json_path:
        with open(common_types_json_path, "r", encoding="utf-8") as f:
            common_data = json.load(f)

    # 1. Components
    comp_code, comp_names = generate_basic_catalog_components(
        version, cat_data, common_data
    )
    with open(os.path.join(out_dir, "components.py"), "w", encoding="utf-8") as f:
        f.write(comp_code)

    # 2. Functions
    functions = cat_data.get("functions", {})
    api_func_names = []
    if functions:
        func_code, api_func_names = generate_basic_catalog_functions(version, cat_data)
        with open(
            os.path.join(out_dir, "function_apis.py"), "w", encoding="utf-8"
        ) as f:
            f.write(func_code)

    # 3. Styles
    style_code = generate_basic_catalog_styles(version, cat_data)
    with open(os.path.join(out_dir, "styles.py"), "w", encoding="utf-8") as f:
        f.write(style_code)

    # 4. Catalog & __init__.py
    comp_exports = list(
        dict.fromkeys(["BASIC_COMPONENTS"] + comp_names + ["AnyComponent"])
    )
    comp_import_lines = [f"    {name}," for name in comp_exports]
    func_import_lines = [f"    {name}," for name in api_func_names]

    operator_sections = []
    if os.path.exists(os.path.join(out_dir, "operator_apis.py")):
        operator_sections = [
            "from .operator_apis import (",
            "    AddApi,",
            "    SubtractApi,",
            "    MultiplyApi,",
            "    DivideApi,",
            "    EqualsApi,",
            "    NotEqualsApi,",
            "    GreaterThanApi,",
            "    LessThanApi,",
            "    ContainsApi,",
            "    StartsWithApi,",
            "    EndsWithApi,",
            ")",
        ]

    has_func_impls = os.path.exists(os.path.join(out_dir, "function_impls.py"))

    cat_init = [
        FILE_HEADER,
        "from typing import Optional",
        "",
    ]
    if comp_import_lines:
        cat_init.extend([
            "from .components import (",
            "\n".join(comp_import_lines),
            ")",
        ])
    if func_import_lines:
        cat_init.extend([
            "from .function_apis import (",
            "\n".join(func_import_lines),
            ")",
        ])
    if operator_sections:
        cat_init.extend(operator_sections)

    theme_spec = cat_data.get("$defs", {}).get("theme", {}) or cat_data.get(
        "$defs", {}
    ).get("Theme", {})
    if theme_spec or os.path.exists(os.path.join(out_dir, "styles.py")):
        cat_init.append("from .styles import Theme")
    if has_func_impls:
        cat_init.extend([
            "from .function_impls import (",
            "    BASIC_FUNCTION_IMPLEMENTATIONS,",
            "    create_basic_catalog_functions,",
            ")",
        ])

    functions_arg = "create_basic_catalog_functions(locale)" if has_func_impls else "[]"
    theme_arg_line = (
        "            theme_schema=Theme.model_json_schema(),\n" if theme_spec else ""
    )

    cat_init.extend([
        f"from ...schema.{dir_name}.constants import SPEC_VERSION, SPEC_BASE_URL",
        "from ...catalog import Catalog, ModelComponentApi, FunctionImplementation",
        "",
        "",
        "def _basic_catalog_id(spec_version: str) -> str:",
        "    return (",
        (
            "        f\"{SPEC_BASE_URL}/{spec_version.replace('.',"
            " '_')}/catalogs/basic/catalog.json\""
        ),
        "    )",
        "",
        "",
        "class BasicCatalog(Catalog[ModelComponentApi, FunctionImplementation]):",
        "",
        "    def __init__(self, locale: Optional[str] = None):",
        "        super().__init__(",
        "            catalog_id=_basic_catalog_id(SPEC_VERSION),",
        "            spec_version=SPEC_VERSION,",
        "            components=BASIC_COMPONENTS,",
        f"            functions={functions_arg},",
        f"{theme_arg_line}        )",
        "",
        "",
    ])

    func_impl_exports = (
        ["BASIC_FUNCTION_IMPLEMENTATIONS", "create_basic_catalog_functions"]
        if has_func_impls
        else []
    )
    theme_exports = ["Theme"] if theme_spec else []
    all_cat_exports = list(
        dict.fromkeys(
            comp_exports
            + api_func_names
            + (
                [
                    "AddApi",
                    "SubtractApi",
                    "MultiplyApi",
                    "DivideApi",
                    "EqualsApi",
                    "NotEqualsApi",
                    "GreaterThanApi",
                    "LessThanApi",
                    "ContainsApi",
                    "StartsWithApi",
                    "EndsWithApi",
                ]
                if operator_sections
                else []
            )
            + theme_exports
            + func_impl_exports
            + ["BasicCatalog"]
        )
    )
    all_lines = [f'    "{name}",' for name in all_cat_exports]
    cat_init.extend([
        "__all__ = [",
        "\n".join(all_lines),
        "]",
        "",
    ])
    with open(os.path.join(out_dir, "__init__.py"), "w", encoding="utf-8") as f:
        f.write("\n".join(cat_init))


def update_root_schema_init(
    known_versions: List[str],
    out_root: Optional[str] = None,
) -> None:
    """Dynamically regenerates src/a2ui/core/schema/__init__.py with all known versions."""
    o_root = out_root or CORE_SRC_ROOT
    version_triples = []
    for v in known_versions:
        d_name = _version_to_underscore(v)
        s_dot = _ensure_v_prefix(v)
        e_name = d_name.upper()
        version_triples.append((d_name, s_dot, e_name))

    imports_lines = [f"from . import {d} as {d}" for d, _, _ in version_triples]

    enum_members = []
    for _, s_dot, e_name in version_triples:
        enum_members.append(f'    {e_name} = "{s_dot}"')

    agent_union_items = []
    renderer_union_items = []
    for d, _, _ in version_triples:
        has_modern = os.path.exists(
            os.path.join(o_root, "schema", d, "agent_to_renderer.py")
        )
        if has_modern:
            agent_union_items.append(f"    {d}.AgentToRendererMessage,")
            renderer_union_items.append(f"    {d}.RendererToAgentMessage,")
        else:
            agent_union_items.append(f"    {d}.ServerToClientMessage,")
            renderer_union_items.append(f"    {d}.ClientToServerMessage,")

    # If flat existing schema files are present in the directory, re-export from them
    root_has_flat = os.path.exists(os.path.join(o_root, "schema/common_types.py"))

    latest_dir = version_triples[-1][0] if version_triples else "v0_9"

    if root_has_flat:
        legacy_reexports = """# Re-exports from primary schema namespace for backwards compatibility
from .common_types import *
from .constants import *
from .server_to_client import *
from .client_to_server import *
from .client_capabilities import *
"""
        target_dir = latest_dir
    else:
        preferred_reexport = (
            "v0_9" if any(d == "v0_9" for d, _, _ in version_triples) else latest_dir
        )
        legacy_reexports = f"""# Re-exports from primary schema namespace for backwards compatibility
from .{preferred_reexport}.common_types import *
from .{preferred_reexport}.constants import *
from .{preferred_reexport}.server_to_client import *
from .{preferred_reexport}.client_to_server import *
from .{preferred_reexport}.client_capabilities import *
"""
        target_dir = preferred_reexport

    has_action = False
    target_path = os.path.join(o_root, "schema", target_dir)
    if os.path.exists(target_path):
        for f in os.listdir(target_path):
            if f.endswith(".py"):
                with open(
                    os.path.join(target_path, f), "r", encoding="utf-8"
                ) as file_obj:
                    if "A2uiRendererAction" in file_obj.read():
                        has_action = True
                        break

    if has_action:
        primary_action = f"A2uiRendererAction = {target_dir}.A2uiRendererAction"
    else:
        primary_action = "A2uiRendererAction = Any"

    content = f"""{FILE_HEADER}
from enum import Enum
from typing import Any, Union

# Versioned schema namespaces
{chr(10).join(imports_lines)}

# Multi-version Protocol Version Enum
class A2uiProtocolVersion(str, Enum):
{chr(10).join(enum_members)}


# Multi-version envelope unions (v1.0+ primary terminology)
AgentToRendererMessage = Union[
{chr(10).join(agent_union_items)}
]

RendererToAgentMessage = Union[
{chr(10).join(renderer_union_items)}
]

# Aliases for cross-version consistency
ServerToClientMessage = AgentToRendererMessage
ClientToServerMessage = RendererToAgentMessage
A2uiMessage = AgentToRendererMessage
A2uiClientMessage = RendererToAgentMessage
{primary_action}
A2uiClientAction = A2uiRendererAction
A2uiClientUserAction = A2uiRendererAction

{legacy_reexports}
"""
    with open(os.path.join(o_root, "schema/__init__.py"), "w", encoding="utf-8") as f:
        f.write(content)


def main():
    parser = argparse.ArgumentParser(
        description="A2UI Dynamic Pydantic Codegen Engine",
        epilog=(
            "Examples:\n"
            "  python codegen_pydantic.py --version v1.0   # Generate models for v1.0"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--version",
        "-v",
        required=True,
        help="Target protocol version to generate (e.g. 'v0.8', 'v0.9', 'v1.0')",
    )
    args = parser.parse_args()

    version = args.version
    dir_name = _version_to_underscore(version)
    spec_dot = _ensure_v_prefix(version)
    print(
        f"Generating Pydantic models & basic catalog for {spec_dot} (module:"
        f" {dir_name})..."
    )
    generate_version_schemas(version)
    generate_basic_catalog(version)

    all_schema_dirs = []
    schema_root = os.path.join(CORE_SRC_ROOT, "schema")
    if os.path.exists(schema_root):
        for entry in sorted(os.listdir(schema_root)):
            if os.path.isdir(os.path.join(schema_root, entry)) and entry.startswith(
                "v"
            ):
                if os.path.exists(os.path.join(schema_root, entry, "__init__.py")):
                    all_schema_dirs.append(entry.replace("_", "."))

    if all_schema_dirs:
        update_root_schema_init(all_schema_dirs)

    print("Schema codegen completed successfully.")


if __name__ == "__main__":
    main()
