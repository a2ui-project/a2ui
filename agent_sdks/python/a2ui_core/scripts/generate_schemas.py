# Copyright 2026 Google LLC
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

import json
import os
import re
from typing import Any, Dict, List, Optional

# Base directories
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SPEC_VERSION = "v0_9"
SPEC_VERSION_DOT = SPEC_VERSION.replace("_", ".")
SPEC_DIR = os.path.abspath(
    os.path.join(SCRIPT_DIR, "../../../../specification", SPEC_VERSION)
)
JSON_DIR = "json"
CATALOGS_DIR = "catalogs"

# Input file paths
COMMON_TYPES_PATH = os.path.join(SPEC_DIR, JSON_DIR, "common_types.json")
CLIENT_CAPABILITIES_PATH = os.path.join(SPEC_DIR, JSON_DIR, "client_capabilities.json")
CLIENT_TO_SERVER_PATH = os.path.join(SPEC_DIR, JSON_DIR, "client_to_server.json")
BASIC_CATALOG_PATH = os.path.join(SPEC_DIR, CATALOGS_DIR, "basic", "catalog.json")
SERVER_TO_CLIENT_PATH = os.path.join(SPEC_DIR, JSON_DIR, "server_to_client.json")

# Output directories
SCHEMA_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "../src/a2ui/core/schema"))
BASIC_CATALOG_DIR = os.path.abspath(
    os.path.join(SCRIPT_DIR, "../src/a2ui/core/basic_catalog")
)
CATALOG_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "../src/a2ui/core/catalog"))

# Output file paths
COMMON_TYPES_OUT_PATH = os.path.join(SCHEMA_DIR, "common_types.py")
CONSTANTS_OUT_PATH = os.path.join(SCHEMA_DIR, "constants.py")
CLIENT_CAPABILITIES_OUT_PATH = os.path.join(SCHEMA_DIR, "client_capabilities.py")
CLIENT_TO_SERVER_OUT_PATH = os.path.join(SCHEMA_DIR, "client_to_server.py")
COMPONENTS_OUT_PATH = os.path.join(BASIC_CATALOG_DIR, "components.py")
FUNCTION_APIS_OUT_PATH = os.path.join(BASIC_CATALOG_DIR, "function_apis.py")
STYLES_OUT_PATH = os.path.join(BASIC_CATALOG_DIR, "styles.py")
SERVER_TO_CLIENT_OUT_PATH = os.path.join(SCHEMA_DIR, "server_to_client.py")
SCHEMA_INIT_OUT_PATH = os.path.join(SCHEMA_DIR, "__init__.py")
BASIC_CATALOG_INIT_OUT_PATH = os.path.join(BASIC_CATALOG_DIR, "__init__.py")
CATALOG_FUNCTIONS_OUT_PATH = os.path.join(CATALOG_DIR, "functions.py")
CATALOG_INIT_OUT_PATH = os.path.join(CATALOG_DIR, "__init__.py")

# Dynamic registry to accumulate discovered inline object schemas to compile as helper classes
INLINE_OBJECTS: Dict[str, Dict[str, Any]] = {}
ALLOW_INLINE_COMPILATION = False

FILE_HEADER = """# Copyright 2026 Google LLC
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
"""


def map_json_type_to_python(prop_name: str, prop: Dict[str, Any]) -> str:
    """Maps JSON Schema property types to Pydantic python type strings."""
    if "const" in prop:
        cval = prop["const"]
        if isinstance(cval, str):
            return f"Literal['{cval}']"
        return f"Literal[{cval}]"

    if "$ref" in prop:
        ref = prop["$ref"]
        if isinstance(ref, str):
            if "common_types.json" in ref:
                ref_name = ref.split("/")[-1]
                return ref_name
            elif ref.startswith("#/"):
                return ref.split("/")[-1]
        return "Any"

    if "oneOf" in prop or "anyOf" in prop:
        union_items = prop.get("oneOf") or prop.get("anyOf")
        if union_items is not None:
            mapped_items = []
            for item in union_items:
                mapped = map_json_type_to_python(prop_name, item)
                if mapped not in mapped_items:
                    mapped_items.append(mapped)
            if len(mapped_items) == 1:
                return mapped_items[0]
            return f"Union[{', '.join(mapped_items)}]"

    if "allOf" in prop:
        allOf_items = prop["allOf"]
        if allOf_items:
            return map_json_type_to_python(prop_name, allOf_items[0])

    t = prop.get("type")
    if t == "string":
        if "enum" in prop:
            enum_vals = [f'"{v}"' for v in prop["enum"]]
            return f"Literal[{', '.join(enum_vals)}]"
        return "str"
    elif t == "number":
        return "float"
    elif t == "integer":
        return "int"
    elif t == "boolean":
        return "bool"
    elif t == "array":
        items = prop.get("items", {})
        item_type = map_json_type_to_python(prop_name, items)
        return f"List[{item_type}]"
    elif t == "object":
        if ALLOW_INLINE_COMPILATION and "properties" in prop:
            # Generic, dependency-free heuristic for naming inline helper classes:
            # 1. Plural properties (lists/arrays of objects like 'tabs' or 'options'):
            #    Singularize the property name and append 'Item' (e.g., 'TabItem', 'OptionItem').
            # 2. Singular or Union properties (like 'name' for 'Icon'):
            #    Capitalize the object's first internal property key (e.g., 'svgPath' -> 'SvgPath').
            if prop_name.endswith("ies"):
                base_name = prop_name[:-3] + "y"
                class_name = f"{base_name[0].upper()}{base_name[1:]}Item"
            elif prop_name.endswith("s") and not prop_name.endswith("ss"):
                base_name = prop_name[:-1]
                class_name = f"{base_name[0].upper()}{base_name[1:]}Item"
            else:
                first_prop = list(prop["properties"].keys())[0]
                class_name = f"{first_prop[0].upper()}{first_prop[1:]}"
            INLINE_OBJECTS[class_name] = prop
            return class_name
        return "Dict[str, Any]"

    return "Any"


def to_snake_case(name: str) -> str:
    if name in ("v0_9",):
        return name
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def compile_properties_to_pydantic(
    props: Dict[str, Any], required: List[str]
) -> List[str]:
    """Reusable helper to compile raw property schemas to Pydantic fields dynamically using snake_case."""
    lines = []
    for prop_name, prop_desc in props.items():
        if prop_name in ("component",):
            continue
        py_type = map_json_type_to_python(prop_name, prop_desc)
        description = prop_desc.get("description", "").replace("\n", " ")

        field_opts = []
        if description:
            field_opts.append(f'description="{description}"')

        if "pattern" in prop_desc:
            pattern_val = prop_desc["pattern"]
            field_opts.append(f'pattern="{pattern_val}"')

        has_default = False
        if "default" in prop_desc:
            has_default = True
            default_val = prop_desc["default"]
            if isinstance(default_val, str):
                field_opts.append(f'default="{default_val}"')
            else:
                field_opts.append(f"default={default_val}")
        elif "const" in prop_desc:
            has_default = True
            default_val = prop_desc["const"]
            if isinstance(default_val, str):
                field_opts.append(f'default="{default_val}"')
            else:
                field_opts.append(f"default={default_val}")

        snake_name = to_snake_case(prop_name)
        if snake_name != prop_name:
            field_opts.insert(0, f'alias="{prop_name}"')

        field_str = f", {', '.join(field_opts)}" if field_opts else ""

        if prop_name in required:
            if "const" in prop_desc:
                const_val = prop_desc["const"]
                const_str = (
                    f'"{const_val}"' if isinstance(const_val, str) else str(const_val)
                )
                clean_opts = [o for o in field_opts if not o.startswith("default=")]
                field_str = f", {', '.join(clean_opts)}" if clean_opts else ""
                lines.append(
                    f"    {snake_name}: {py_type} = Field({const_str}{field_str})"
                )
            else:
                lines.append(f"    {snake_name}: {py_type} = Field(...{field_str})")
        else:
            if has_default:
                clean_field_str = field_str.lstrip(", ")
                lines.append(
                    f"    {snake_name}: Optional[{py_type}] = Field({clean_field_str})"
                )
            else:
                lines.append(
                    f"    {snake_name}: Optional[{py_type}] = Field(None{field_str})"
                )
    return lines


def compile_component_to_pydantic(
    name: str,
    schema: Dict[str, Any],
    base_class: str = "ComponentCommon",
    common_data: Optional[Dict[str, Any]] = None,
) -> str:
    """Generates Python Pydantic class string representing one Component."""
    lines = [
        f"class {name}Component({base_class}):",
        f'    component: Literal["{name}"] = "{name}"',
    ]
    props = {}
    required = []
    if "allOf" in schema:
        for part in schema["allOf"]:
            if "properties" in part:
                props.update(part["properties"])
            if "required" in part:
                required.extend(part["required"])
            if "$ref" in part:
                ref = part["$ref"]
                if "common_types.json" in ref and common_data:
                    ref_name = ref.split("/")[-1]
                    ref_spec = common_data.get("$defs", {}).get(ref_name, {})
                    if "properties" in ref_spec:
                        props.update(ref_spec["properties"])
                    if "required" in ref_spec:
                        required.extend(ref_spec["required"])
    elif "properties" in schema:
        props = schema["properties"]
        required = schema.get("required", [])

    # Filter out base-class inherited properties to avoid redundancy in generated subclass fields
    filtered_props = {
        k: v for k, v in props.items() if k not in ("id", "accessibility", "weight")
    }
    lines.extend(compile_properties_to_pydantic(filtered_props, required))
    return "\n".join(lines) + "\n"


def compile_object_def(
    class_name: str, spec: Dict[str, Any], base_class: Optional[str] = None
) -> str:
    """Generates Python Pydantic class representing a standard JSON Schema object definition."""
    add_props = spec.get("additionalProperties", False)
    if add_props:
        bcls = base_class or "BaseModel"
        lines = [
            f"class {class_name}({bcls}):",
            "    model_config = ConfigDict(populate_by_name=True)",
        ]
    else:
        bcls = base_class or "StrictBaseModel"
        lines = [f"class {class_name}({bcls}):"]
    props = spec.get("properties", {})
    required = spec.get("required", [])
    if not props:
        lines.append("    pass")
        return "\n".join(lines) + "\n"
    lines.extend(compile_properties_to_pydantic(props, required))
    return "\n".join(lines) + "\n"


def compile_union_def(class_name: str, spec: Dict[str, Any]) -> str:
    """Generates a Python Union type alias dynamically representing a oneOf/anyOf schema list."""
    union_items = spec.get("oneOf") or spec.get("anyOf") or spec.get("allOf")
    if not union_items:
        return f"{class_name} = Any"

    mapped_items = []
    for item in union_items:
        ref_item = item
        if isinstance(item, dict) and "allOf" in item:
            # Extract underlying dynamic FunctionCall reference
            ref_item = item["allOf"][0]

        mapped = map_json_type_to_python("", ref_item)

        # Ensure proper typing inside Dynamic lists
        if mapped == "List[Any]" and "items" in ref_item:
            item_type = map_json_type_to_python("", ref_item["items"])
            mapped = f"List[{item_type}]"

        if mapped not in mapped_items:
            mapped_items.append(mapped)

    return f"{class_name} = Union[{', '.join(mapped_items)}]\n"


def compile_function_to_pydantic(name: str, schema: Dict[str, Any]) -> tuple[str, str]:
    """Generates Python Pydantic class representing one function with its arguments."""
    lines = []
    args_class = "None"

    props = schema.get("properties", {}).get("args", {}).get("properties", {})
    required = schema.get("properties", {}).get("args", {}).get("required", [])

    if props:
        args_class = f"{name[0].upper()}{name[1:]}Args"
        lines.append(f"class {args_class}(StrictBaseModel):")
        lines.extend(compile_properties_to_pydantic(props, required))
        lines.append("")

    func_class = f"{name[0].upper()}{name[1:]}Api"
    return_type = (
        schema.get("properties", {}).get("returnType", {}).get("const", "boolean")
    )
    lines.append(f"class {func_class}(FunctionApi):")
    lines.append(f'    name = "{name}"')
    if args_class != "None":
        lines.append(f"    schema = {args_class}")
    else:
        lines.append("    schema = None")
    lines.append(f'    return_type = "{return_type}"\n')

    return "\n".join(lines), func_class


def generate_schema_constants() -> str:
    """Generates schema/constants.py containing global specification constants."""
    output = [
        f'SPEC_VERSION = "{SPEC_VERSION_DOT}"\n',
    ]
    return "\n".join(output)


def generate_common_types(common_data: Dict[str, Any]) -> str:
    """Generates common_types.py dynamically from raw JSON specifications."""
    output = [
        "from typing import Annotated, Any, Dict, List, Literal, Optional, Union",
        "from pydantic import BaseModel, Field, ConfigDict, GetCoreSchemaHandler",
        "from pydantic_core import CoreSchema\n",
        'class ComponentReference:\n    """Base marker class for all A2UI component references."""\n',
        "class SingleReference(str, ComponentReference):\n"
        "    @classmethod\n"
        "    def __get_pydantic_core_schema__(\n"
        "        cls, source_type: Any, handler: GetCoreSchemaHandler\n"
        "    ) -> CoreSchema:\n"
        "        from pydantic_core import core_schema\n"
        "        return core_schema.no_info_after_validator_function(\n"
        "            cls,\n"
        "            core_schema.str_schema(),\n"
        "            serialization=core_schema.plain_serializer_function_ser_schema(str),\n"
        "        )\n",
        'class ListReference(ComponentReference):\n    """Marker class indicating a field holds a list of component references."""\n',
        "class StrictBaseModel(BaseModel):",
        '    model_config = ConfigDict(extra="forbid", populate_by_name=True)\n',
    ]

    defs = common_data.get("$defs", {})

    # 1. Generate ComponentId type alias
    output.append("ComponentId = SingleReference\n")

    # 2. Generate DataBinding
    output.append(compile_object_def("DataBinding", defs["DataBinding"]))

    # 3. Generate FunctionCall dynamically (inheriting default returns)
    output.append(compile_object_def("FunctionCall", defs["FunctionCall"]))

    # 4. Generate Dynamic Unions dynamically from raw JSON spec
    output.append(compile_union_def("DynamicValue", defs["DynamicValue"]))
    output.append(compile_union_def("DynamicString", defs["DynamicString"]))
    output.append(compile_union_def("DynamicNumber", defs["DynamicNumber"]))
    output.append(compile_union_def("DynamicBoolean", defs["DynamicBoolean"]))
    output.append(compile_union_def("DynamicStringList", defs["DynamicStringList"]))

    # 5. Generate TemplateChildList & ChildList dynamically
    template_spec = defs["ChildList"]["oneOf"][1]
    output.append(
        compile_object_def(
            "TemplateChildList",
            template_spec,
            base_class="StrictBaseModel, ListReference",
        )
    )
    output.append("ChildList = Union[List[ComponentId], TemplateChildList]\n")

    # 6. Generate AccessibilityAttributes & CheckRule
    output.append(
        compile_object_def("AccessibilityAttributes", defs["AccessibilityAttributes"])
    )
    output.append(compile_object_def("CheckRule", defs["CheckRule"]))

    # 7. Generate ActionEvent, Wrappers, and Action Union dynamically
    event_spec = defs["Action"]["oneOf"][0]["properties"]["event"]
    output.append(compile_object_def("ActionEvent", event_spec))

    import copy

    orig_desc = defs["Action"]["oneOf"][0]["properties"]["event"].get("description")
    event_wrapper_spec = copy.deepcopy(defs["Action"]["oneOf"][0])
    event_wrapper_spec["properties"]["event"] = {
        "$ref": "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ActionEvent"
    }
    if orig_desc:
        event_wrapper_spec["properties"]["event"]["description"] = orig_desc
    output.append(compile_object_def("ActionEventWrapper", event_wrapper_spec))

    func_wrapper_spec = defs["Action"]["oneOf"][1]
    output.append(compile_object_def("ActionFunctionCallWrapper", func_wrapper_spec))
    output.append("Action = Union[ActionEventWrapper, ActionFunctionCallWrapper]\n")

    # 8. Generate ComponentCommon
    output.append(compile_object_def("ComponentCommon", defs["ComponentCommon"]))

    return "\n".join(output)


def generate_basic_catalog_components(
    catalog_data: Dict[str, Any], common_data: Optional[Dict[str, Any]] = None
) -> tuple[str, List[str]]:
    """Generates components.py containing all component schemas extending CatalogComponentCommon."""
    global ALLOW_INLINE_COMPILATION
    INLINE_OBJECTS.clear()
    ALLOW_INLINE_COMPILATION = True

    output = [
        "from typing import Any, Dict, List, Literal, Optional, Union, Annotated",
        "from pydantic import BaseModel, Field, ConfigDict\n",
        "from ..schema.common_types import (",
        "    StrictBaseModel, ComponentCommon, AccessibilityAttributes, DynamicString, DynamicNumber, ",
        "    DynamicBoolean, DynamicStringList, ChildList, Action, CheckRule, DataBinding, ComponentId",
        ")",
        "from ..catalog.components import ModelComponentApi\n",
    ]

    # Generate CatalogComponentCommon extending ComponentCommon
    defs = catalog_data.get("$defs", {})
    if "CatalogComponentCommon" in defs:
        lines = ["class CatalogComponentCommon(ComponentCommon):"]
        props = defs["CatalogComponentCommon"].get("properties", {})
        required = defs["CatalogComponentCommon"].get("required", [])
        lines.extend(compile_properties_to_pydantic(props, required))
        output.append("\n".join(lines) + "\n")
    else:
        output.append("class CatalogComponentCommon(ComponentCommon):\n    pass\n")

    # Compile all components (this automatically registers discovered inline objects)
    components = catalog_data.get("components", {})
    comp_code_blocks = []
    comp_names = []
    for cname, cschema in components.items():
        comp_class_name = f"{cname}Component"
        comp_names.append(comp_class_name)
        comp_code_blocks.append(
            compile_component_to_pydantic(
                cname,
                cschema,
                base_class="CatalogComponentCommon",
                common_data=common_data,
            )
        )

    # Compile dynamically discovered inline object helper classes
    inline_code_blocks = []
    inline_names = sorted(list(INLINE_OBJECTS.keys()))
    for iname in inline_names:
        ispec = INLINE_OBJECTS[iname]
        inline_code_blocks.append(compile_object_def(iname, ispec))

    # Prepend helper classes before component classes
    output.extend(inline_code_blocks)
    output.extend(comp_code_blocks)

    # Extract components that are part of anyComponent/oneOf in the schema
    any_comp_refs = defs.get("anyComponent", {}).get("oneOf", [])
    any_comp_names = []
    for ref_item in any_comp_refs:
        ref = ref_item.get("$ref", "")
        if ref.startswith("#/components/"):
            name = ref.split("/")[-1]
            comp_class_name = f"{name}Component"
            if comp_class_name in comp_names:
                any_comp_names.append(comp_class_name)
    if not any_comp_names:
        any_comp_names = comp_names

    # Generate the AnyComponent Union natively.
    # This uses a Pydantic Discriminated Union (annotated with Field(..., discriminator="component"))
    # to enable:
    # 1. O(1) routing during validation: Pydantic instantly routes incoming payloads to the
    #    correct component class based on the "component" key rather than sequentially testing 18+ schemas.
    # 2. Distinct, targeted validation error reports when a component schema fails.
    # 3. Seamless, typed deserialization of heterogeneous component lists in updateComponents/createSurface payloads.
    output.append("AnyComponent = Annotated[")
    output.append("    Union[")
    for cname in any_comp_names:
        output.append(f"        {cname},")
    output.append("    ],")
    output.append('    Field(..., discriminator="component")')
    output.append("]\n")

    wrapped_names = []
    for cname in comp_names:
        if cname.endswith("Component"):
            base_name = cname[:-9]
            api_const_name = f"{to_snake_case(base_name).upper()}_COMPONENT_API"
            output.append(f"{api_const_name} = ModelComponentApi({cname})\n")
            wrapped_names.append(api_const_name)

    output.append("BASIC_COMPONENTS = [")
    for wname in wrapped_names:
        output.append(f"    {wname},")
    output.append("]\n")

    any_comp_names.append("AnyComponent")
    any_comp_names.append("BASIC_COMPONENTS")
    any_comp_names.extend(wrapped_names)
    for iname in reversed(inline_names):
        any_comp_names.insert(0, iname)
    any_comp_names.insert(0, "CatalogComponentCommon")
    ALLOW_INLINE_COMPILATION = False
    return "\n".join(output), any_comp_names


def generate_basic_catalog_functions(
    catalog_data: Dict[str, Any],
) -> tuple[str, List[str]]:
    """Generates functions.py containing all standard catalog functions."""
    output = [
        "from typing import Any, Dict, List, Literal, Optional, Union, Annotated",
        "from pydantic import BaseModel, Field, ConfigDict\n",
        "from ..schema.common_types import StrictBaseModel, DynamicString, DynamicNumber, DynamicBoolean, DynamicValue, DynamicStringList",
        "from ..catalog.functions import FunctionApi\n",
    ]

    functions = catalog_data.get("functions", {})
    func_classes = []
    for fname, fschema in functions.items():
        fcode, fclass = compile_function_to_pydantic(fname, fschema)
        output.append(fcode)
        func_classes.append(fclass)

    # Extract functions that are part of anyFunction/oneOf in the schema
    any_func_refs = (
        catalog_data.get("$defs", {}).get("anyFunction", {}).get("oneOf", [])
    )
    any_func_names = []
    for ref_item in any_func_refs:
        ref = ref_item.get("$ref", "")
        if ref.startswith("#/functions/"):
            name = ref.split("/")[-1]
            func_class_name = f"{name[0].upper()}{name[1:]}Api"
            if func_class_name in func_classes:
                any_func_names.append(func_class_name)
    if not any_func_names:
        any_func_names = func_classes

    return "\n".join(output), any_func_names


def generate_basic_catalog_styles(catalog_data: Dict[str, Any]) -> str:
    """Generates styles.py containing theme Pydantic models and default style tokens."""
    output = [
        "from typing import Any, Dict, List, Literal, Optional, Union",
        "from pydantic import BaseModel, Field, ConfigDict\n",
        "from ..schema.common_types import StrictBaseModel\n",
    ]

    theme_spec = catalog_data.get("$defs", {}).get("theme", {})
    if theme_spec:
        output.append(compile_object_def("Theme", theme_spec))
    else:
        output.append("class Theme(BaseModel):\n    pass\n")

    return "\n".join(output)


def generate_server_to_client(s2c_data: Dict[str, Any]) -> tuple[str, List[str]]:
    """Generates server_to_client.py containing message envelopes and wrapper types."""
    output = [
        "from typing import Any, Dict, List, Literal, Optional, Union",
        "from pydantic import BaseModel, Field, ConfigDict\n",
        "from .common_types import StrictBaseModel",
        "from .constants import SPEC_VERSION, SPEC_VERSION_TYPE\n",
    ]

    defs = s2c_data.get("$defs", {})
    msg_names = list(defs.keys())
    for mname, mschema in defs.items():
        payload_name = mname.replace("Message", "")
        output.append(f"class {payload_name}(StrictBaseModel):")

        payload_props = (
            mschema.get("properties", {})
            .get(mschema.get("required", [""])[0], {})
            .get("properties", {})
        )
        payload_required = (
            mschema.get("properties", {})
            .get(mschema.get("required", [""])[0], {})
            .get("required", [])
        )

        lines = compile_properties_to_pydantic(payload_props, payload_required)
        output.extend(lines)
        output.append("\n")

        # Message envelopes
        envelope_key = [
            k for k in mschema.get("properties", {}).keys() if k != "version"
        ][0]
        snake_envelope = to_snake_case(envelope_key)
        alias_opt = (
            f', alias="{envelope_key}"' if snake_envelope != envelope_key else ""
        )
        output.append(f"class {mname}(StrictBaseModel):")
        output.append(f"    version: SPEC_VERSION_TYPE = SPEC_VERSION")
        output.append(f"    {snake_envelope}: {payload_name} = Field(...{alias_opt})")
        output.append("\n")

    # Envelope wrappers
    msg_union_str = ", ".join(msg_names)
    output.append(f"A2uiMessage = Union[{msg_union_str}]\n")
    output.append("class A2uiMessageListWrapper(StrictBaseModel):")
    output.append(
        '    messages: List[A2uiMessage] = Field(..., description="A list of messages.")'
    )

    return "\n".join(output), msg_names


def generate_client_capabilities(capabilities_data: Dict[str, Any]) -> str:
    """Generates client_capabilities.py mirroring the TS schema."""
    output = [
        "from typing import Any, Dict, List, Literal, Optional",
        "from pydantic import BaseModel, Field, ConfigDict",
        "from .common_types import StrictBaseModel",
        "from .constants import SPEC_VERSION, SPEC_VERSION_TYPE\n",
    ]
    defs = capabilities_data.get("$defs", {})
    if "FunctionDefinition" in defs:
        output.append(
            compile_object_def("FunctionDefinition", defs["FunctionDefinition"])
        )
    if "Catalog" in defs:
        output.append(compile_object_def("InlineCatalog", defs["Catalog"]))

    output.append("class V09Capabilities(StrictBaseModel):")
    v9_props = (
        capabilities_data.get("properties", {})
        .get(SPEC_VERSION_DOT, {})
        .get("properties", {})
    )
    v9_req = (
        capabilities_data.get("properties", {})
        .get(SPEC_VERSION_DOT, {})
        .get("required", [])
    )
    output.extend(compile_properties_to_pydantic(v9_props, v9_req))
    output.append("\n")

    output.append("class A2uiClientCapabilities(StrictBaseModel):")
    output.append(
        f"    v0_9: Optional[V09Capabilities] = Field(None, alias=SPEC_VERSION)"
    )

    code = "\n".join(output)
    code = code.replace("List[Catalog]", "List[InlineCatalog]")
    return code


def generate_client_to_server(c2s_data: Dict[str, Any]) -> str:
    """Generates client_to_server.py mirroring the TS event schema."""
    output = [
        "from typing import Any, Dict, List, Literal, Optional, Union",
        "from pydantic import BaseModel, Field, ConfigDict",
        "from .common_types import StrictBaseModel",
        "from .constants import SPEC_VERSION, SPEC_VERSION_TYPE\n",
    ]
    props = c2s_data.get("properties", {})

    if "action" in props:
        action_spec = props["action"]
        output.append(compile_object_def("A2uiClientAction", action_spec))

    error_variants = props.get("error", {}).get("oneOf", [])
    error_class_names = []
    for idx, variant in enumerate(error_variants):
        title = variant.get("title", f"GenericError")
        if title == "Validation Failed Error":
            cname = "A2uiValidationError"
        elif title == "Generic Error":
            cname = "A2uiGenericError"
        else:
            cname = title.replace(" ", "")
        output.append(compile_object_def(cname, variant))
        error_class_names.append(cname)

    if error_class_names:
        output.append(f"A2uiClientError = Union[{', '.join(error_class_names)}]\n")

    output.append("class A2uiClientActionMessage(StrictBaseModel):")
    output.append(f"    version: SPEC_VERSION_TYPE = SPEC_VERSION")
    output.append("    action: A2uiClientAction = Field(...)")
    output.append("\n")

    output.append("class A2uiClientErrorMessage(StrictBaseModel):")
    output.append(f"    version: SPEC_VERSION_TYPE = SPEC_VERSION")
    output.append("    error: A2uiClientError = Field(...)")
    output.append("\n")

    output.append(
        "A2uiClientMessage = Union[A2uiClientActionMessage, A2uiClientErrorMessage]\n"
    )

    # Client Data Model
    output.append("class A2uiClientDataModel(StrictBaseModel):")
    output.append(f"    version: SPEC_VERSION_TYPE = SPEC_VERSION")
    output.append(
        '    surfaces: Dict[str, Dict[str, Any]] = Field(..., description="A map of surface IDs to their current data models.")\n'
    )

    # Client Message List and List Wrapper
    output.append("A2uiClientMessageList = List[A2uiClientMessage]\n")

    output.append("class A2uiClientMessageListWrapper(StrictBaseModel):")
    output.append(
        '    messages: A2uiClientMessageList = Field(..., description="An object wrapping a list of A2UI Client-to-Server messages.")'
    )
    return "\n".join(output)


def generate_schema_init(msg_names: List[str]) -> str:
    """Generates schema/__init__.py re-exporting only common types and server messages."""
    output = [
        "from .common_types import (",
        "    StrictBaseModel as StrictBaseModel,",
        "    DataBinding as DataBinding,",
        "    FunctionCall as FunctionCall,",
        "    AccessibilityAttributes as AccessibilityAttributes,",
        "    CheckRule as CheckRule,",
        "    ActionEvent as ActionEvent,",
        "    Action as Action,",
        "    ComponentCommon as ComponentCommon,",
        ")",
        "from .constants import *",
        "from .server_to_client import (",
    ]
    for mname in msg_names:
        output.append(f"    {mname} as {mname},")
        rname = mname.replace("Message", "")
        output.append(f"    {rname} as {rname},")
    output.append("    A2uiMessage as A2uiMessage,")
    output.append("    A2uiMessageListWrapper as A2uiMessageListWrapper,")
    output.append(")")
    output.append("from .client_capabilities import (")
    output.append("    A2uiClientCapabilities as A2uiClientCapabilities,")
    output.append("    V09Capabilities as V09Capabilities,")
    output.append("    InlineCatalog as InlineCatalog,")
    output.append("    FunctionDefinition as FunctionDefinition,")
    output.append(")")
    output.append("from .client_to_server import (")
    output.append("    A2uiClientMessage as A2uiClientMessage,")
    output.append("    A2uiClientActionMessage as A2uiClientActionMessage,")
    output.append("    A2uiClientErrorMessage as A2uiClientErrorMessage,")
    output.append("    A2uiClientAction as A2uiClientAction,")
    output.append("    A2uiValidationError as A2uiValidationError,")
    output.append("    A2uiGenericError as A2uiGenericError,")
    output.append("    A2uiClientError as A2uiClientError,")
    output.append("    A2uiClientDataModel as A2uiClientDataModel,")
    output.append("    A2uiClientMessageList as A2uiClientMessageList,")
    output.append("    A2uiClientMessageListWrapper as A2uiClientMessageListWrapper,")
    output.append(")")
    return "\n".join(output)


def main() -> None:
    print("Compiling modular and symmetrical A2UI schemas mirroring web_core...")

    os.makedirs(SCHEMA_DIR, exist_ok=True)
    os.makedirs(BASIC_CATALOG_DIR, exist_ok=True)
    os.makedirs(CATALOG_DIR, exist_ok=True)

    # 1. Generate schema/common_types.py
    with open(COMMON_TYPES_PATH, "r") as f:
        common_data = json.load(f)
    common_code = generate_common_types(common_data)
    with open(COMMON_TYPES_OUT_PATH, "w") as f:
        f.write(FILE_HEADER + common_code)
    print(f"Generated: {COMMON_TYPES_OUT_PATH}")

    if not os.path.exists(CONSTANTS_OUT_PATH):
        constants_code = generate_schema_constants()
        with open(CONSTANTS_OUT_PATH, "w") as f:
            f.write(FILE_HEADER + constants_code)
        print(f"Generated: {CONSTANTS_OUT_PATH}")

    # 2. Generate basic_catalog/components.py
    with open(BASIC_CATALOG_PATH, "r") as f:
        catalog_data = json.load(f)
    catalog_code, comp_names = generate_basic_catalog_components(
        catalog_data, common_data
    )
    with open(COMPONENTS_OUT_PATH, "w") as f:
        f.write(FILE_HEADER + catalog_code)
    print(f"Generated: {COMPONENTS_OUT_PATH}")

    # 3. Generate basic_catalog/function_apis.py
    functions_code, func_names = generate_basic_catalog_functions(catalog_data)
    with open(FUNCTION_APIS_OUT_PATH, "w") as f:
        f.write(FILE_HEADER + functions_code)
    print(f"Generated: {FUNCTION_APIS_OUT_PATH}")

    # 4. Generate basic_catalog/styles.py
    styles_code = generate_basic_catalog_styles(catalog_data)
    with open(STYLES_OUT_PATH, "w") as f:
        f.write(FILE_HEADER + styles_code)
    print(f"Generated: {STYLES_OUT_PATH}")

    # 5.1. Generate schema/server_to_client.py
    with open(SERVER_TO_CLIENT_PATH, "r") as f:
        s2c_data = json.load(f)
    s2c_code, msg_names = generate_server_to_client(s2c_data)
    with open(SERVER_TO_CLIENT_OUT_PATH, "w") as f:
        f.write(FILE_HEADER + s2c_code)
    print(f"Generated: {SERVER_TO_CLIENT_OUT_PATH}")

    # 5.2 Generate schema/client_capabilities.py
    with open(CLIENT_CAPABILITIES_PATH, "r") as f:
        cc_data = json.load(f)
    cc_code = generate_client_capabilities(cc_data)
    with open(CLIENT_CAPABILITIES_OUT_PATH, "w") as f:
        f.write(FILE_HEADER + cc_code)
    print(f"Generated: {CLIENT_CAPABILITIES_OUT_PATH}")

    # 5.3 Generate schema/client_to_server.py
    with open(CLIENT_TO_SERVER_PATH, "r") as f:
        cts_data = json.load(f)
    cts_code = generate_client_to_server(cts_data)
    with open(CLIENT_TO_SERVER_OUT_PATH, "w") as f:
        f.write(FILE_HEADER + cts_code)
    print(f"Generated: {CLIENT_TO_SERVER_OUT_PATH}")

    # 6. Generate schema/__init__.py
    schema_init_code = generate_schema_init(msg_names)
    with open(SCHEMA_INIT_OUT_PATH, "w") as f:
        f.write(FILE_HEADER + schema_init_code)
    print(f"Generated: {SCHEMA_INIT_OUT_PATH}")

    # 7. Auto-format all generated files with pyink
    try:
        import subprocess

        generated_files = [
            COMMON_TYPES_OUT_PATH,
            CONSTANTS_OUT_PATH,
            COMPONENTS_OUT_PATH,
            FUNCTION_APIS_OUT_PATH,
            STYLES_OUT_PATH,
            SERVER_TO_CLIENT_OUT_PATH,
            CLIENT_CAPABILITIES_OUT_PATH,
            CLIENT_TO_SERVER_OUT_PATH,
            SCHEMA_INIT_OUT_PATH,
        ]
        # Format files using pyink via workspace environment
        cmd = ["uv", "run", "pyink"] + generated_files
        subprocess.run(cmd, cwd=os.path.join(SCRIPT_DIR, "../"), check=True)
        print("Successfully formatted generated files using pyink!")
    except Exception as e:
        print(f"Skipped pyink formatting: {e}")

    print("Schema specs compilation successfully finished!")


if __name__ == "__main__":
    main()
