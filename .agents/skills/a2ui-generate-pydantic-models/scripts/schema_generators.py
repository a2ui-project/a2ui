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

import re
from typing import Any
from engine import PydanticCodegen
from utils import (
    FILE_HEADER,
    ensure_v_prefix,
    extract_exported_symbols,
    find_common_refs,
    get_base_common_symbols,
    is_modern_terminology,
    to_pascal_case,
    to_snake_case,
    topological_sort_defs,
    version_to_underscore,
)


def generate_common_types(
    version: str,
    common_data: dict[str, Any],
) -> str:
    """Generates common_types.py content dynamically from $defs."""
    codegen = PydanticCodegen(version)
    codegen.allow_inline = False
    defs = common_data.get("$defs", {})

    base_symbols = get_base_common_symbols()
    # Any class/type defined in base common_types.py is imported and not repeated in versioned folders
    imports_from_common = [
        s
        for s in base_symbols
        if s != "ComponentCommon"
        or "ComponentCommon" not in defs
        or defs["ComponentCommon"].get("properties", {}).keys() <= {"id"}
    ]
    imports_from_common.sort()
    import_list_str = "\n".join(f"    {name}," for name in imports_from_common)

    common_blocks = [
        (
            f"{FILE_HEADER}\nfrom typing import Annotated, Any, Dict, List,"
            " Literal, Optional, Union\nfrom pydantic import AfterValidator,"
            " BaseModel, Field, ConfigDict\nfrom ..common_types import"
            f" (\n{import_list_str}\n)"
        ),
    ]

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
                common_blocks.append(
                    "ChildList = list[ComponentId] | TemplateChildList"
                )
            else:
                common_blocks.append(codegen.compile_union_def("ChildList", spec))
            processed.add(name)
            return

        if name == "IndexSystemFunction":
            if (
                "properties" in spec
                and "args" in spec["properties"]
                and "properties" in spec["properties"]["args"]
            ):
                args_spec = spec["properties"]["args"]
                common_blocks.append(
                    codegen.compile_object_def("IndexSystemFunctionArgs", args_spec)
                )
                idx_spec_copy = dict(spec)
                idx_spec_copy["properties"] = dict(spec["properties"])
                idx_spec_copy["properties"]["args"] = {
                    "$ref": "#/$defs/IndexSystemFunctionArgs",
                    "description": spec["properties"]["args"].get("description", ""),
                }
                common_blocks.append(
                    codegen.compile_object_def("IndexSystemFunction", idx_spec_copy)
                )
            else:
                common_blocks.append(codegen.compile_object_def(name, spec))
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

        if name == "FunctionResponse":
            if (
                "properties" in spec
                and "error" in spec["properties"]
                and "properties" in spec["properties"]["error"]
            ):
                err_spec = spec["properties"]["error"]
                common_blocks.append(
                    codegen.compile_object_def("FunctionResponseError", err_spec)
                )
                fn_spec_copy = dict(spec)
                fn_spec_copy["properties"] = dict(spec["properties"])
                fn_spec_copy["properties"]["error"] = {
                    "$ref": "#/$defs/FunctionResponseError",
                    "description": spec["properties"]["error"].get("description", ""),
                }
                common_blocks.append(
                    codegen.compile_object_def("FunctionResponse", fn_spec_copy)
                )
            else:
                common_blocks.append(codegen.compile_object_def(name, spec))
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
                forbidden_keys = set()
                for it in union_items:
                    if (
                        isinstance(it, dict)
                        and it.get("type") == "object"
                        and "not" in it
                    ):
                        not_clause = it["not"]
                        if "required" in not_clause:
                            forbidden_keys.update(not_clause["required"])
                        for branch in not_clause.get("anyOf", []) + not_clause.get(
                            "oneOf", []
                        ):
                            if "required" in branch:
                                forbidden_keys.update(branch["required"])

                forbidden_set_repr = (
                    "{" + ", ".join(f'"{k}"' for k in sorted(forbidden_keys)) + "}"
                )
                validator_code = f"""def _validate_literal_object(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError("Expected a dictionary object")
    forbidden = {forbidden_set_repr}
    found = forbidden.intersection(v.keys())
    if found:
        raise ValueError(
            f"Object in {name} cannot contain forbidden properties: {{', '.join(sorted(found))}}"
        )
    return v

LiteralObject = Annotated[dict[str, Any], AfterValidator(_validate_literal_object)]"""
                common_blocks.append(validator_code)

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

        if "properties" in spec or spec.get("type") == "object":
            common_blocks.append(codegen.compile_object_def(name, spec))
        elif "oneOf" in spec or "anyOf" in spec or "allOf" in spec:
            common_blocks.append(codegen.compile_union_def(name, spec))
        elif "enum" in spec:
            enum_vals = [f'"{v}"' for v in spec["enum"]]
            common_blocks.append(f"{name} = Literal[{', '.join(enum_vals)}]")
        elif "$ref" in spec:
            mapped = codegen.map_json_type_to_python("", spec)
            common_blocks.append(f"{name} = {mapped}")
        elif spec.get("type") == "string":
            common_blocks.append(f"{name} = str")
        elif spec.get("type") in ("number", "integer"):
            common_blocks.append(f"{name} = float")
        elif spec.get("type") == "boolean":
            common_blocks.append(f"{name} = bool")
        elif spec.get("type") == "array":
            item_type = (
                codegen.map_json_type_to_python("", spec.get("items", {}))
                if "items" in spec
                else "Any"
            )
            common_blocks.append(f"{name} = list[{item_type}]")
        else:
            common_blocks.append(f"{name} = Any")

        processed.add(name)

    # Dynamic topological ordering:
    sorted_def_keys = topological_sort_defs(defs)
    for key in sorted_def_keys:
        _compile_def(key, defs[key])

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
            "from typing import Any, Dict, List, Literal, Optional, Union\n"
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
        "from typing import Any, Dict, List, Literal, Optional, Union\n"
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
            "from typing import Any, Dict, List, Literal, Optional\n"
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
        "from typing import Any, Dict, List, Literal, Optional, Union\n"
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
