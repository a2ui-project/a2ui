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

"""Pydantic v2 code generators for Basic Catalog definitions (components, function_apis, styles)."""

import os
from typing import Any
from engine import PydanticCodegen
from utils import (
    FILE_HEADER,
    extract_exported_symbols,
    find_common_refs,
    get_base_common_symbols,
    to_pascal_case,
    to_snake_case,
    version_to_underscore,
)

def generate_basic_catalog_components(
    version: str,
    catalog_data: dict[str, Any],
    common_data: dict[str, Any] | None = None,
) -> str:
    """Generates components.py content."""
    codegen = PydanticCodegen(version)
    dir_name = version_to_underscore(version)
    common_defs = common_data.get("$defs", {}) if common_data else {}
    common_def_names = set(common_defs.keys())
    all_defs = dict(common_defs)
    all_defs.update(catalog_data.get("$defs", {}))

    referenced_common = find_common_refs(
        catalog_data, common_def_names, common_defs=common_defs
    )
    base_symbols = set(get_base_common_symbols())
    common_imports_set = (referenced_common & common_def_names) | (
        base_symbols & (common_def_names | base_symbols)
    )
    common_imports = sorted(list(common_imports_set))

    import_lines = [f"    {ci}," for ci in common_imports]
    common_module_path = (
        f"...schema.{dir_name}.common_types"
        if common_data
        else "...schema.common_types"
    )
    common_import_stmt = (
        f"from {common_module_path} import (\n" + "\n".join(import_lines) + "\n)"
    )

    comp_blocks = [
        (
            f"{FILE_HEADER}\n"
            "from typing import Any, Dict, List, Literal, Optional, Union, Annotated\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            f"{common_import_stmt}\n"
            "from ...catalog.components import ModelComponentApi"
        ),
    ]

    names = []
    defs = catalog_data.get("$defs", {})
    has_catalog_common = "CatalogComponentCommon" in defs
    base_comp_class = (
        "CatalogComponentCommon" if has_catalog_common else "ComponentCommon"
    )
    if has_catalog_common:
        comp_blocks.append(
            codegen.compile_object_def(
                "CatalogComponentCommon",
                defs["CatalogComponentCommon"],
                base_class="ComponentCommon",
            )
        )
        names.append("CatalogComponentCommon")

    any_comp_def = defs.get("anyComponent", {})
    allowed_union_components = set()
    if "oneOf" in any_comp_def:
        for it in any_comp_def["oneOf"]:
            if isinstance(it, dict) and "$ref" in it:
                ref_name = it["$ref"].split("/")[-1]
                allowed_union_components.add(f"{ref_name}Component")

    # Dynamically extract all properties defined in the base class hierarchy from the schema
    inherited_props: set[str] = {"id"}
    if "ComponentCommon" in all_defs and isinstance(all_defs["ComponentCommon"], dict):
        inherited_props.update(all_defs["ComponentCommon"].get("properties", {}).keys())
    if "CatalogComponentCommon" in all_defs and isinstance(
        all_defs["CatalogComponentCommon"], dict
    ):
        inherited_props.update(
            all_defs["CatalogComponentCommon"].get("properties", {}).keys()
        )

    components = catalog_data.get("components", {})
    comp_names = []
    component_defs = []
    for cname, cschema in components.items():
        comp_class_name = f"{cname}Component"
        comp_names.append(comp_class_name)
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

        # Identify discriminator property from schema if present (e.g. const: cname or enum: [cname])
        discriminator_keys = {
            k
            for k, v in props.items()
            if isinstance(v, dict)
            and (v.get("const") == cname or v.get("enum") == [cname])
        } or {"component"}
        discriminator_prop = next(iter(discriminator_keys), "component")

        lines = [
            f"class {comp_class_name}({base_comp_class}):",
            f'    {discriminator_prop}: Literal["{cname}"] = "{cname}"',
        ]

        skip_keys = inherited_props | discriminator_keys
        filtered_props = {k: v for k, v in props.items() if k not in skip_keys}
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
    union_str = " | ".join(union_comp_names) if union_comp_names else "Any"
    any_comp_lines = [
        f'AnyComponent = Annotated[{union_str}, Field(..., discriminator="component")]'
    ]
    names.append("AnyComponent")

    api_names = []
    api_lines = []
    for cname in comp_names:
        base = cname.replace("Component", "")
        const_name = f"{to_snake_case(base).upper()}_COMPONENT_API"
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
    return "\n\n\n".join(b.strip() for b in comp_blocks if b.strip()) + "\n"

def generate_basic_catalog_functions(
    version: str,
    catalog_data: dict[str, Any],
    common_data: dict[str, Any] | None = None,
) -> str:
    """Generates function_apis.py content."""
    codegen = PydanticCodegen(version)
    dir_name = version_to_underscore(version)
    common_defs = common_data.get("$defs", {}) if common_data else {}
    common_def_names = set(common_defs.keys())
    func_blocks = []

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
            args_class_name = f"{to_pascal_case(fname)}Args"
            func_blocks.append(
                codegen.compile_object_def(
                    args_class_name, {"properties": args_props, "required": args_req}
                )
            )

        func_class_name = f"{to_pascal_case(fname)}Api"
        ret_type_val = fschema.get("returnType")
        if isinstance(ret_type_val, dict):
            ret_type_val = ret_type_val.get("const") or (
                ret_type_val.get("enum", [None])[0]
            )
        if not ret_type_val:
            ret_prop = fprops.get("returnType")
            if isinstance(ret_prop, str):
                ret_type_val = ret_prop
            elif isinstance(ret_prop, dict):
                ret_type_val = ret_prop.get("const") or (
                    ret_prop.get("enum", [None])[0]
                )
        if not ret_type_val:
            ret_type_val = "boolean"

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

    body_text = "\n\n\n".join(b.strip() for b in func_blocks if b.strip())
    referenced_common = find_common_refs(
        functions, common_def_names, common_defs=common_defs
    )
    used_imports = ["StrictBaseModel"] + sorted(list(referenced_common))

    common_module_path = (
        f"...schema.{dir_name}.common_types"
        if common_data
        else "...schema.common_types"
    )
    header = (
        f"{FILE_HEADER}\nfrom typing import Any, Dict, List, Literal, Optional,"
        " Union\nfrom pydantic import BaseModel, Field, ConfigDict\nfrom"
        f" {common_module_path} import {', '.join(used_imports)}\nfrom"
        " ...catalog.functions import FunctionApi\n\n\n"
    )

    return header + body_text + "\n"

def generate_basic_catalog_styles(
    version: str,
    catalog_data: dict[str, Any],
) -> str | None:
    """Generates styles.py content if the catalog defines styles or theme."""
    defs = catalog_data.get("$defs", {})
    styles_spec = catalog_data.get("styles")

    if not styles_spec and "theme" not in defs and "Theme" not in defs:
        return None

    codegen = PydanticCodegen(version)
    style_blocks = [
        (
            f"{FILE_HEADER}\n"
            "from typing import Any\n"
            "from pydantic import BaseModel, Field, ConfigDict\n"
            "from ...schema.common_types import StrictBaseModel"
        ),
    ]

    if styles_spec and isinstance(styles_spec, dict):
        # v0.8 styles: map of style name to schema definition (e.g. font, primaryColor)
        styles_props_schema = {
            "type": "object",
            "properties": styles_spec,
            "description": (
                styles_spec.get("description", "")
                if isinstance(styles_spec, dict)
                else ""
            ),
        }
        style_blocks.append(
            codegen.compile_object_def(
                "Styles", styles_props_schema, base_class="BaseModel"
            )
        )
        style_blocks.append("Theme = Styles")
    elif "theme" in defs:
        style_blocks.append(codegen.compile_object_def("Theme", defs["theme"]))
    elif "Theme" in defs:
        style_blocks.append(codegen.compile_object_def("Theme", defs["Theme"]))

    return "\n\n\n".join(b.strip() for b in style_blocks if b.strip()) + "\n"

def generate_basic_catalog_index(
    version: str,
    out_dir: str,
    comp_code: str,
    func_code: str,
    style_code: str | None,
) -> str:
    """Generates __init__.py content for a version basic_catalog directory."""
    dir_name = version_to_underscore(version)
    comp_symbols = extract_exported_symbols(comp_code)
    comp_exports = [
        s
        for s in comp_symbols
        if s != "CatalogComponentCommon" and not s.startswith("_")
    ]
    comp_import_lines = [f"    {name}," for name in comp_exports]

    func_symbols = extract_exported_symbols(func_code) if func_code else []
    api_func_names = [s for s in func_symbols if s.endswith("Api")]
    func_import_lines = [f"    {name}," for name in api_func_names]

    style_symbols = extract_exported_symbols(style_code) if style_code else []
    has_theme = "Theme" in style_symbols or "Styles" in style_symbols

    shared_op_path = os.path.join(os.path.dirname(out_dir), "operator_apis.py")
    local_op_path = os.path.join(out_dir, "operator_apis.py")

    shared_op_names = []
    local_op_names = []

    if os.path.exists(shared_op_path) and func_code:
        with open(shared_op_path, "r", encoding="utf-8") as f:
            shared_symbols = extract_exported_symbols(f.read())
        shared_op_names = [s for s in shared_symbols if s.endswith("Api")]

    if os.path.exists(local_op_path) and func_code:
        with open(local_op_path, "r", encoding="utf-8") as f:
            local_symbols = extract_exported_symbols(f.read())
        local_op_names = [
            s for s in local_symbols if s.endswith("Api") and s not in shared_op_names
        ]

    operator_sections = []
    if shared_op_names:
        op_lines = [f"    {name}," for name in shared_op_names]
        operator_sections.extend([
            "from ..operator_apis import (",
            "\n".join(op_lines),
            ")",
        ])
    if local_op_names:
        op_lines = [f"    {name}," for name in local_op_names]
        operator_sections.extend([
            "from .operator_apis import (",
            "\n".join(op_lines),
            ")",
        ])

    operator_names = shared_op_names + local_op_names

    has_func_impls = (
        os.path.exists(os.path.join(out_dir, "function_impls.py"))
        or os.path.exists(os.path.join(os.path.dirname(out_dir), "function_impls.py"))
    ) and bool(func_code)
    shared_impls = not os.path.exists(
        os.path.join(out_dir, "function_impls.py")
    ) and os.path.exists(os.path.join(os.path.dirname(out_dir), "function_impls.py"))

    typing_types = ["Optional"]
    if shared_impls and has_func_impls:
        typing_types.insert(0, "Any")
    typing_line = f"from typing import {', '.join(typing_types)}"

    cat_init = [
        FILE_HEADER,
        typing_line,
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

    if has_theme:
        if "Styles" in style_symbols:
            cat_init.append("from .styles import Styles, Theme")
        else:
            cat_init.append("from .styles import Theme")
    if has_func_impls and not shared_impls:
        cat_init.extend([
            "from .function_impls import (",
            "    BASIC_FUNCTION_IMPLEMENTATIONS,",
            "    create_basic_catalog_functions,",
            ")",
        ])

    functions_arg = (
        "create_basic_catalog_functions(locale=locale)" if has_func_impls else "[]"
    )
    theme_arg_line = (
        "            theme_schema=Theme.model_json_schema(),\n" if has_theme else ""
    )
    lazy_func_import = (
        "        from ..function_impls import create_basic_catalog_functions\n"
        if (shared_impls and has_func_impls)
        else ""
    )

    cat_init.extend([
        (
            f"from ...schema.{dir_name}.constants import PROTOCOL_VERSION,"
            " PROTOCOL_BASE_URL"
        ),
        "from ...catalog import Catalog, ModelComponentApi, FunctionImplementation",
        "",
        "",
        "def _basic_catalog_id(protocol_version: str) -> str:",
        "    return (",
        (
            "        f\"{PROTOCOL_BASE_URL}/{protocol_version.replace('.',"
            " '_')}/catalogs/basic/catalog.json\""
        ),
        "    )",
        "",
        "",
        "class BasicCatalog(Catalog[ModelComponentApi, FunctionImplementation]):",
        "",
        "    def __init__(self, locale: str | None = None):",
        f"{lazy_func_import}        super().__init__(",
        "            catalog_id=_basic_catalog_id(PROTOCOL_VERSION),",
        "            protocol_version=PROTOCOL_VERSION,",
        "            components=BASIC_COMPONENTS,",
        f"            functions={functions_arg},",
        f"{theme_arg_line}        )",
        "",
        "",
    ])

    if shared_impls and has_func_impls:
        cat_init.extend([
            "def __getattr__(name: str) -> Any:",
            "    if name == 'BASIC_FUNCTION_IMPLEMENTATIONS':",
            "        from ..function_impls import create_basic_catalog_functions",
            "        return create_basic_catalog_functions(PROTOCOL_VERSION)",
            "    if name == 'create_basic_catalog_functions':",
            "        from .. import function_impls",
            "        return getattr(function_impls, name)",
            (
                "    raise AttributeError(f'module {__name__!r} has no attribute"
                " {name!r}')"
            ),
            "",
            "",
        ])

    func_impl_exports = (
        ["BASIC_FUNCTION_IMPLEMENTATIONS", "create_basic_catalog_functions"]
        if has_func_impls
        else []
    )
    theme_exports = [s for s in style_symbols if s in ("Theme", "Styles")]
    all_cat_exports = list(
        dict.fromkeys(
            comp_exports
            + api_func_names
            + operator_names
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
    return "\n".join(cat_init)
