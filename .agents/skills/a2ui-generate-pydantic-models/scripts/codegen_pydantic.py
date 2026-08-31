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
import sys
from typing import Any

# Allow intra-package imports when run directly as a script
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from catalog_generators import (
    generate_basic_catalog_components,
    generate_basic_catalog_functions,
    generate_basic_catalog_index,
    generate_basic_catalog_styles,
)
from engine import PydanticCodegen
from schema_generators import (
    generate_agent_capabilities,
    generate_agent_to_renderer,
    generate_catalog_definition,
    generate_common_types,
    generate_renderer_capabilities,
    generate_renderer_to_agent,
    generate_schema_init,
)
from utils import (
    FILE_HEADER,
    ensure_v_prefix,
    extract_exported_symbols,
    find_common_refs,
    get_base_common_symbols,
    get_schema_dependencies,
    is_modern_terminology,
    to_pascal_case,
    to_snake_case,
    topological_sort_defs,
    version_to_underscore,
)

# Backward-compatibility aliases for tests and external callers
_ensure_v_prefix = ensure_v_prefix
_version_to_underscore = version_to_underscore
_is_modern_terminology = is_modern_terminology
_to_snake_case = to_snake_case
_to_pascal_case = to_pascal_case

REPO_ROOT = os.path.abspath(os.path.join(_SCRIPT_DIR, "../../../.."))
SPEC_ROOT = os.path.join(REPO_ROOT, "specification")
CORE_SRC_ROOT = os.path.join(REPO_ROOT, "python/a2ui_core/src/a2ui/core")

def _generate_constants_code(
    version: str,
    a2r_data: dict[str, Any],
    r2a_data: dict[str, Any],
) -> str:
    """Dynamically generates constants.py based on the version's schema definitions."""
    dir_name = version_to_underscore(version)
    spec_dot = ensure_v_prefix(version)
    lines = [
        FILE_HEADER,
        "from typing import Final, Literal",
        "",
        f'PROTOCOL_VERSION: Final[Literal["{spec_dot}"]] = "{spec_dot}"',
        f'PROTOCOL_VERSION_TYPE = Literal["{spec_dot}"]',
        "",
        'ROOT_ID = "root"',
        'CATALOG_COMPONENTS_KEY = "components"',
        'SURFACE_ID_KEY = "surfaceId"',
    ]

    # Theme / styling property keys based on schema property existence
    has_styles_prop = False
    defs = a2r_data.get("$defs", {})
    if defs:
        for mschema in defs.values():
            if isinstance(mschema, dict):
                for pval in mschema.get("properties", {}).values():
                    if isinstance(pval, dict) and "styles" in pval.get(
                        "properties", {}
                    ):
                        has_styles_prop = True
                        break
    else:
        for pval in a2r_data.get("properties", {}).values():
            if isinstance(pval, dict) and "styles" in pval.get("properties", {}):
                has_styles_prop = True
                break

    if has_styles_prop:
        lines.append('THEME_KEY = "styles"')
        lines.append('STYLES_KEY = "styles"')
    else:
        lines.append('THEME_KEY = "theme"')
        lines.append('STYLES_KEY = "styles"')

    lines.append('PROTOCOL_BASE_URL = "https://a2ui.org/specification"')
    lines.append("")

    # Outbound message type constants
    lines.append("# Outbound message types")
    outbound_keys: list[str] = []
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
        const_var = f"MSG_TYPE_{to_snake_case(key).upper()}"
        lines.append(f'{const_var} = "{key}"')

    # Cross-version aliases when legacy message properties are present
    if "beginRendering" in outbound_keys and "createSurface" not in outbound_keys:
        lines.append("MSG_TYPE_CREATE_SURFACE = MSG_TYPE_BEGIN_RENDERING")
    if "surfaceUpdate" in outbound_keys and "updateComponents" not in outbound_keys:
        lines.append("MSG_TYPE_UPDATE_COMPONENTS = MSG_TYPE_SURFACE_UPDATE")
    if "dataModelUpdate" in outbound_keys and "updateDataModel" not in outbound_keys:
        lines.append("MSG_TYPE_UPDATE_DATA_MODEL = MSG_TYPE_DATA_MODEL_UPDATE")

    # Inbound message type constants
    lines.append("")
    lines.append("# Inbound message types")
    inbound_props = r2a_data.get("properties", {})
    for key in inbound_props.keys():
        if key != "version":
            const_var = f"MSG_TYPE_{to_snake_case(key).upper()}"
            lines.append(f'{const_var} = "{key}"')

    if "userAction" in inbound_props and "action" not in inbound_props:
        lines.append("MSG_TYPE_ACTION = MSG_TYPE_USER_ACTION")
    elif "action" in inbound_props and "userAction" not in inbound_props:
        lines.append("MSG_TYPE_USER_ACTION = MSG_TYPE_ACTION")

    lines.append("")
    return "\n".join(lines)

def generate_version_schemas(
    version: str,
    spec_root: str | None = None,
    out_root: str | None = None,
) -> None:
    """Generates all Pydantic schema files for a given protocol version."""
    codegen = PydanticCodegen(version)
    codegen.allow_inline = False
    dir_name = version_to_underscore(version)
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

    is_modern = is_modern_terminology(version, a2r_name)
    modules: dict[str, str] = {}

    # 1. Generate constants.py
    constants_code = _generate_constants_code(version, a2r_data, r2a_data)
    with open(os.path.join(out_dir, "constants.py"), "w", encoding="utf-8") as f:
        f.write(constants_code)

    # 2. Generate common_types.py
    common_types_path = os.path.join(json_dir, "common_types.json")
    common_data: dict[str, Any] | None = None
    if os.path.exists(common_types_path):
        with open(common_types_path, "r", encoding="utf-8") as f:
            common_data = json.load(f)
        common_code = generate_common_types(version, common_data)
        with open(os.path.join(out_dir, "common_types.py"), "w", encoding="utf-8") as f:
            f.write(common_code)
        modules["common_types"] = common_code
    else:
        old_common_py = os.path.join(out_dir, "common_types.py")
        if os.path.exists(old_common_py):
            os.remove(old_common_py)

    # 3. Generate agent_to_renderer.py / server_to_client.py
    if a2r_data:
        a2r_code = generate_agent_to_renderer(
            version, a2r_data, a2r_name, common_data=common_data
        )
        out_file_name = "agent_to_renderer" if is_modern else "server_to_client"
        with open(
            os.path.join(out_dir, f"{out_file_name}.py"), "w", encoding="utf-8"
        ) as f:
            f.write(a2r_code)
        modules[out_file_name] = a2r_code

    # 4. Generate catalog_definition.py
    cat_def_json_path = os.path.join(json_dir, "catalog_definition.json")
    if not os.path.exists(cat_def_json_path):
        cat_def_json_path = os.path.join(json_dir, "catalog_description_schema.json")
    if os.path.exists(cat_def_json_path):
        with open(cat_def_json_path, "r", encoding="utf-8") as f:
            cat_def_data = json.load(f)
        cat_def_code = generate_catalog_definition(
            version, cat_def_data, common_data=common_data
        )
        with open(
            os.path.join(out_dir, "catalog_definition.py"), "w", encoding="utf-8"
        ) as f:
            f.write(cat_def_code)
        modules["catalog_definition"] = cat_def_code

    # 5. Generate renderer_capabilities.py / client_capabilities.py
    caps_name = (
        "renderer_capabilities.json"
        if os.path.exists(os.path.join(json_dir, "renderer_capabilities.json"))
        else "client_capabilities.json"
    )
    if not os.path.exists(os.path.join(json_dir, caps_name)):
        caps_name = "a2ui_client_capabilities_schema.json"
    caps_path = os.path.join(json_dir, caps_name)
    has_cat_def = "catalog_definition" in modules
    has_common = bool(common_data)
    if os.path.exists(caps_path):
        with open(caps_path, "r", encoding="utf-8") as f:
            caps_data = json.load(f)

        caps_code = generate_renderer_capabilities(
            version,
            caps_data,
            is_modern=is_modern,
            has_catalog_definition=has_cat_def,
            has_common_types=has_common,
        )
        out_caps_name = "renderer_capabilities" if is_modern else "client_capabilities"
        with open(
            os.path.join(out_dir, f"{out_caps_name}.py"), "w", encoding="utf-8"
        ) as f:
            f.write(caps_code)
        modules[out_caps_name] = caps_code

    # 6. Generate agent_capabilities.py / server_capabilities.py
    agent_caps_name = (
        "agent_capabilities.json"
        if os.path.exists(os.path.join(json_dir, "agent_capabilities.json"))
        else "server_capabilities.json"
    )
    agent_caps_path = os.path.join(json_dir, agent_caps_name)
    if os.path.exists(agent_caps_path):
        with open(agent_caps_path, "r", encoding="utf-8") as f:
            agent_caps_data = json.load(f)
        agent_caps_code = generate_agent_capabilities(
            version,
            agent_caps_data,
            is_modern=is_modern,
            has_common_types=has_common,
        )
        out_agent_caps_name = (
            "agent_capabilities" if is_modern else "server_capabilities"
        )
        with open(
            os.path.join(out_dir, f"{out_agent_caps_name}.py"), "w", encoding="utf-8"
        ) as f:
            f.write(agent_caps_code)
        modules[out_agent_caps_name] = agent_caps_code

    # 7. Generate renderer_to_agent.py / client_to_server.py
    if r2a_data:
        r2a_code = generate_renderer_to_agent(
            version, r2a_data, a2r_name, common_data=common_data
        )
        out_r2a_name = "renderer_to_agent" if is_modern else "client_to_server"
        with open(
            os.path.join(out_dir, f"{out_r2a_name}.py"), "w", encoding="utf-8"
        ) as f:
            f.write(r2a_code)
        modules[out_r2a_name] = r2a_code

    # 8. Generate schema/__init__.py for version package
    schema_init_code = generate_schema_init(version, modules)
    with open(os.path.join(out_dir, "__init__.py"), "w", encoding="utf-8") as f:
        f.write(schema_init_code)

def generate_basic_catalog(
    version: str,
    spec_root: str | None = None,
    out_root: str | None = None,
) -> None:
    """Generates basic catalog components, functions, styles, and catalog classes for a given version."""
    dir_name = version_to_underscore(version)
    s_root = spec_root or SPEC_ROOT
    o_root = out_root or CORE_SRC_ROOT

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
    common_data: dict[str, Any] | None = None
    if common_types_json_path:
        with open(common_types_json_path, "r", encoding="utf-8") as f:
            common_data = json.load(f)

    # 1. Components
    comp_code = generate_basic_catalog_components(version, cat_data, common_data)
    with open(os.path.join(out_dir, "components.py"), "w", encoding="utf-8") as f:
        f.write(comp_code)

    # 2. Functions
    functions = cat_data.get("functions", {})
    func_code = ""
    if functions:
        func_code = generate_basic_catalog_functions(
            version, cat_data, common_data=common_data
        )
        with open(
            os.path.join(out_dir, "function_apis.py"), "w", encoding="utf-8"
        ) as f:
            f.write(func_code)

    # 3. Styles
    style_code = generate_basic_catalog_styles(version, cat_data)
    styles_path = os.path.join(out_dir, "styles.py")
    if style_code:
        with open(styles_path, "w", encoding="utf-8") as f:
            f.write(style_code)
    elif os.path.exists(styles_path):
        os.remove(styles_path)

    # 4. Catalog & __init__.py
    cat_init_code = generate_basic_catalog_index(
        version, out_dir, comp_code, func_code, style_code
    )
    with open(os.path.join(out_dir, "__init__.py"), "w", encoding="utf-8") as f:
        f.write(cat_init_code)

def update_root_schema_init(
    known_versions: list[str],
    out_root: str | None = None,
) -> None:
    """Dynamically regenerates src/a2ui/core/schema/__init__.py with all known versions."""
    o_root = out_root or CORE_SRC_ROOT
    version_triples = []
    for v in known_versions:
        d_name = version_to_underscore(v)
        s_dot = ensure_v_prefix(v)
        e_name = d_name.upper()
        version_triples.append((d_name, s_dot, e_name))

    imports_lines = [f"from . import {d}" for d, _, _ in version_triples]

    enum_members = []
    for _, s_dot, e_name in version_triples:
        enum_members.append(f'    {e_name} = "{s_dot}"')
        if e_name == "V0_9":
            enum_members.append('    V0_9_1 = "v0.9.1"')

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

    latest_dir = version_triples[-1][0] if version_triples else "v0_9"
    s2c_compat_dirs = [
        d
        for d, _, _ in version_triples
        if os.path.exists(os.path.join(o_root, "schema", d, "server_to_client.py"))
        and os.path.exists(os.path.join(o_root, "schema", d, "common_types.py"))
    ]
    preferred_reexport = s2c_compat_dirs[-1] if s2c_compat_dirs else latest_dir
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

    has_reexport_common = bool(
        preferred_reexport
        and os.path.exists(
            os.path.join(o_root, "schema", preferred_reexport, "common_types.py")
        )
    )

    if has_reexport_common:
        base_common_section = ""
    else:
        base_symbols = get_base_common_symbols()
        base_imports = "\n".join(f"    {s}," for s in sorted(base_symbols))
        base_common_section = f"""# Shared base common types across all protocol versions
from .common_types import (
{base_imports}
)
"""

    agent_union_str = " | ".join([x.strip().rstrip(",") for x in agent_union_items])
    renderer_union_str = " | ".join([x.strip().rstrip(",") for x in renderer_union_items])

    content = f"""{FILE_HEADER}
from __future__ import annotations
from enum import Enum
from typing import Any

# Versioned schema namespaces
{chr(10).join(imports_lines)}

{base_common_section}# Multi-version Protocol Version Enum
class A2uiProtocolVersion(str, Enum):
{chr(10).join(enum_members)}

ProtocolVersion = A2uiProtocolVersion


# Multi-version envelope unions (v1.0+ primary terminology)
AgentToRendererMessage = {agent_union_str}

RendererToAgentMessage = {renderer_union_str}

# Aliases for cross-version consistency
ServerToClientMessage = AgentToRendererMessage
ClientToServerMessage = RendererToAgentMessage
A2uiMessage = AgentToRendererMessage
A2uiClientMessage = RendererToAgentMessage
{primary_action}
A2uiClientAction = A2uiRendererAction
A2uiClientUserAction = A2uiRendererAction

AgentToRendererMessagePayload = AgentToRendererMessage | list[AgentToRendererMessage] | dict[str, Any]
ServerToClientMessagePayload = AgentToRendererMessagePayload
RendererToAgentMessagePayload = RendererToAgentMessage | list[RendererToAgentMessage] | dict[str, Any]
ClientToServerMessagePayload = RendererToAgentMessagePayload

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
    dir_name = version_to_underscore(version)
    spec_dot = ensure_v_prefix(version)
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
