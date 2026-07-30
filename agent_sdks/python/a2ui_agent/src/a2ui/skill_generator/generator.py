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

"""Core engine for synthesizing A2UI Agent Skills from catalogs and examples."""

import glob
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from ..basic_catalog.provider import BasicCatalog
from ..schema.catalog import CatalogConfig, A2uiCatalog
from .config import SkillConfig
from .templates import (
    BUILDER_LIB_JS_TEMPLATE,
    BUILDER_LIB_TEMPLATE,
    EMITTER_LIB_JS_TEMPLATE,
    EMITTER_LIB_TEMPLATE,
    META_SKILL_MD_TEMPLATE,
    RUNTIME_BRIDGE_JS_TEMPLATE,
    RUNTIME_BRIDGE_TEMPLATE,
    SKILL_MD_JS_TEMPLATE,
    SKILL_MD_TEMPLATE,
    VALIDATE_UI_SCRIPT_JS_TEMPLATE,
    VALIDATE_UI_SCRIPT_TEMPLATE,
    VALIDATOR_LIB_TEMPLATE,
)


class SkillGenerator:
    """Orchestrates creation of custom .agents/skills/<skill-name>/ directories."""

    def __init__(
        self,
        config: Optional[SkillConfig] = None,
        catalogs: Optional[List[Union[str, CatalogConfig, Dict[str, Any]]]] = None,
        examples_path: Optional[str] = None,
        examples: Optional[List[Union[str, Dict[str, Any]]]] = None,
        version: str = "0.9",
    ):
        self.config = config or SkillConfig()
        self.version = version
        self.catalogs_raw = catalogs or self.config.catalogs
        self.examples_path = examples_path or self.config.examples_path
        self.examples_raw = examples or self.config.examples or []
        self.parsed_catalogs: List[Dict[str, Any]] = []
        self._load_catalogs()

    def _load_catalogs(self) -> None:
        """Loads and normalizes catalog dictionary definitions."""
        if not self.catalogs_raw:
            try:
                cfg = BasicCatalog.get_config(self.version)
                loaded_dict = cfg.provider.load()
                self.parsed_catalogs.append(loaded_dict)
            except Exception:
                self.parsed_catalogs.append(self._get_default_basic_catalog_dict())
        else:
            for item in self.catalogs_raw:
                if isinstance(item, str):
                    if os.path.exists(item):
                        with open(item, "r", encoding="utf-8") as f:
                            self.parsed_catalogs.append(json.load(f))
                elif isinstance(item, dict):
                    self.parsed_catalogs.append(item)
                elif hasattr(item, "provider"):
                    self.parsed_catalogs.append(item.provider.load())

    def _get_default_basic_catalog_dict(self) -> Dict[str, Any]:
        """Provides a standard fallback basic catalog definition."""
        return {
            "catalog_id": "https://a2ui.org/catalogs/basic",
            "components": {
                "Text": {
                    "description": "Displays text content",
                    "properties": {"text": {"type": "string"}, "usage": {"type": "string"}},
                },
                "Button": {
                    "description": "Interactive action button",
                    "properties": {"label": {"type": "string"}, "action_id": {"type": "string"}},
                },
                "Card": {
                    "description": "Container card",
                    "properties": {"title": {"type": "string"}, "children": {"type": "array"}},
                },
                "Container": {
                    "description": "Generic layout container",
                    "properties": {"direction": {"type": "string"}, "children": {"type": "array"}},
                },
                "Image": {
                    "description": "Displays an image asset",
                    "properties": {"url": {"type": "string"}, "alt": {"type": "string"}},
                },
            },
        }

    def _extract_components(self) -> Dict[str, Dict[str, Any]]:
        """Consolidates all component definitions across loaded catalogs (supporting dict and list formats)."""
        components = {}
        for cat in self.parsed_catalogs:
            comps = cat.get("components", {})
            if isinstance(comps, dict):
                components.update(comps)
            elif isinstance(comps, list):
                for item in comps:
                    if isinstance(item, dict) and "name" in item:
                        c_name = item["name"]
                        props_raw = item.get("props") or item.get("properties") or {}
                        norm_props = {}
                        if isinstance(props_raw, dict):
                            for p_name, p_val in props_raw.items():
                                if isinstance(p_val, dict):
                                    norm_props[p_name] = p_val
                                else:
                                    norm_props[p_name] = {"type": str(p_val)}
                        desc = item.get("description", f"{c_name} component")
                        components[c_name] = {"description": desc, "properties": norm_props}
        return components

    def _build_catalog_documentation(self) -> str:
        """Generates markdown component documentation for SKILL.md."""
        comps = self._extract_components()
        lines = []
        for comp_name, comp_info in comps.items():
            desc = comp_info.get("description", "A2UI UI Component")
            props = comp_info.get("properties", {})
            lines.append(f"### `{comp_name}`")
            lines.append(f"{desc}\n")
            if props:
                lines.append("**Properties:**")
                for prop_name, prop_spec in props.items():
                    prop_type = prop_spec.get("type", "any")
                    lines.append(f"- `{prop_name}` ({prop_type})")
            lines.append("")
        return "\n".join(lines)

    def _build_component_classes_python(self) -> str:
        """Generates Python builder classes for lib/builder.py."""
        comps = self._extract_components()
        code_blocks = []
        for comp_name, comp_info in comps.items():
            props = list(comp_info.get("properties", {}).keys())

            class_code = (
                f"class {comp_name}(Component):\n"
                f'    """Builder for {comp_name} component."""\n'
                f"    def __init__(self, *args, **kwargs):\n"
                f"        prop_names = {props}\n"
                f"        props = {{}}\n"
                f"        for i, arg in enumerate(args):\n"
                f"            if i < len(prop_names):\n"
                f"                props[prop_names[i]] = arg\n"
                f"        for k, v in kwargs.items():\n"
                f"            props[k] = v\n"
                f"        super().__init__('{comp_name}', props)\n"
            )
            code_blocks.append(class_code)
        return "\n\n".join(code_blocks)

    def _build_component_classes_js(self) -> str:
        """Generates JavaScript builder classes for lib/builder.js."""
        comps = self._extract_components()
        code_blocks = []
        for comp_name in comps.keys():
            class_code = (
                f"export class {comp_name} extends Component {{\n"
                f"  constructor(props = {{}}) {{\n"
                f"    super('{comp_name}', props);\n"
                f"  }}\n"
                f"}}"
            )
            code_blocks.append(class_code)
        return "\n\n".join(code_blocks)

    def _convert_a2ui_message_to_js(self, msg_data: Dict[str, Any]) -> str:
        """Converts an A2UI message payload into bespoke executable JavaScript builder code."""
        payload = msg_data.get("payload", msg_data)
        used_components = set()

        def format_node(node: Any, indent_level: int = 1) -> str:
            if not isinstance(node, dict):
                return json.dumps(node)

            comp_type = node.get("type") or node.get("component")
            if not comp_type:
                return json.dumps(node)

            used_components.add(comp_type)
            indent = "  " * indent_level
            inner_indent = "  " * (indent_level + 1)

            props_str_list = []
            for k, v in node.items():
                if k in ("type", "component", "id"):
                    continue
                if k == "children" and isinstance(v, list):
                    child_lines = [format_node(child, indent_level + 2) for child in v]
                    props_str_list.append(
                        f"children: [\n{'  ' * (indent_level + 2)}"
                        + f",\n{'  ' * (indent_level + 2)}".join(child_lines)
                        + f"\n{inner_indent}]"
                    )
                elif isinstance(v, dict) and ("type" in v or "component" in v):
                    props_str_list.append(f"{k}: {format_node(v, indent_level + 1)}")
                else:
                    props_str_list.append(f"{k}: {json.dumps(v)}")

            props_body = f",\n{inner_indent}".join(props_str_list)
            if props_body:
                return f"new {comp_type}({{\n{inner_indent}{props_body}\n{indent}}})"
            else:
                return f"new {comp_type}()"

        js_ui_code = format_node(payload)
        comp_imports = ", ".join(sorted(used_components)) or "Component"

        return (
            f"import {{ {comp_imports} }} from '../lib/builder.js';\n"
            f"import {{ updateComponents }} from '../lib/emitter.js';\n\n"
            f"const ui = {js_ui_code};\n\n"
            f"updateComponents(ui);\n"
        )

    def _convert_a2ui_message_to_python(self, msg_data: Dict[str, Any]) -> str:
        """Converts an A2UI message payload into bespoke executable Python builder code."""
        payload = msg_data.get("payload", msg_data)
        used_components = set()

        def format_node(node: Any, indent_level: int = 1) -> str:
            if not isinstance(node, dict):
                return repr(node)

            comp_type = node.get("type") or node.get("component")
            if not comp_type:
                return repr(node)

            used_components.add(comp_type)
            indent = "    " * indent_level
            inner_indent = "    " * (indent_level + 1)

            props_str_list = []
            for k, v in node.items():
                if k in ("type", "component", "id"):
                    continue
                if k == "children" and isinstance(v, list):
                    child_lines = [format_node(child, indent_level + 2) for child in v]
                    props_str_list.append(
                        f"children=[\n{'    ' * (indent_level + 2)}"
                        + f",\n{'    ' * (indent_level + 2)}".join(child_lines)
                        + f"\n{inner_indent}]"
                    )
                elif isinstance(v, dict) and ("type" in v or "component" in v):
                    props_str_list.append(f"{k}={format_node(v, indent_level + 1)}")
                else:
                    props_str_list.append(f"{k}={repr(v)}")

            props_body = f",\n{inner_indent}".join(props_str_list)
            if props_body:
                return f"{comp_type}(\n{inner_indent}{props_body}\n{indent})"
            else:
                return f"{comp_type}()"

        py_ui_code = format_node(payload)
        comp_imports = ", ".join(sorted(used_components)) or "Component"

        return (
            "import sys\n"
            "from pathlib import Path\n"
            "sys.path.insert(0, str(Path(__file__).parent.parent))\n"
            f"from lib.builder import {comp_imports}\n"
            "from lib.emitter import emit_ui\n\n"
            f"ui = {py_ui_code}\n"
            "emit_ui(ui)\n"
        )

    def _generate_references(self, references_dir: Path, is_js: bool) -> None:
        """Generates bespoke code snippets in references/ from provided A2UI example messages and writes README.md."""
        ext = "js" if is_js else "py"
        collected_examples: List[Dict[str, Any]] = []

        # 1. Parse example messages provided via list
        for item in self.examples_raw:
            if isinstance(item, dict):
                collected_examples.append(item)
            elif isinstance(item, str):
                if os.path.exists(item):
                    with open(item, "r", encoding="utf-8") as f:
                        collected_examples.append(json.load(f))
                else:
                    try:
                        collected_examples.append(json.loads(item))
                    except Exception:
                        pass

        # 2. Parse example messages provided via directory path
        if self.examples_path and os.path.exists(self.examples_path):
            if os.path.isdir(self.examples_path):
                ex_files = glob.glob(os.path.join(self.examples_path, "*.json"))
                for ex_file in ex_files:
                    try:
                        with open(ex_file, "r", encoding="utf-8") as f:
                            collected_examples.append(json.load(f))
                    except Exception:
                        pass
            elif os.path.isfile(self.examples_path):
                try:
                    with open(self.examples_path, "r", encoding="utf-8") as f:
                        collected_examples.append(json.load(f))
                except Exception:
                    pass

        # 3. Generate bespoke code reference files for each collected A2UI example message
        created_files = []
        if collected_examples:
            for idx, ex_msg in enumerate(collected_examples, 1):
                msg_name = ex_msg.get("name") or ex_msg.get("payload", {}).get("type") or f"example_{idx}"
                sanitized_name = f"{idx:02d}_{str(msg_name).lower().replace(' ', '_')}.{ext}"

                if is_js:
                    code_content = self._convert_a2ui_message_to_js(ex_msg)
                else:
                    code_content = self._convert_a2ui_message_to_python(ex_msg)

                with open(references_dir / sanitized_name, "w", encoding="utf-8") as f:
                    f.write(code_content)
                created_files.append((sanitized_name, str(msg_name)))
        else:
            # Fallback reference if no example messages provided
            sanitized_name = f"01_basic_reference.{ext}"
            if is_js:
                ref_code = (
                    "import { Text, Button } from '../lib/builder.js';\n"
                    "import { updateComponents } from '../lib/emitter.js';\n\n"
                    "const ui = new Text({ text: 'Basic A2UI Reference Example' });\n\n"
                    "updateComponents(ui);\n"
                )
            else:
                ref_code = (
                    "import sys\n"
                    "from pathlib import Path\n"
                    "sys.path.insert(0, str(Path(__file__).parent.parent))\n"
                    "from lib.builder import Text\n"
                    "from lib.emitter import emit_ui\n\n"
                    "ui = Text(text='Basic A2UI Reference Example')\n"
                    "emit_ui(ui)\n"
                )
            with open(references_dir / sanitized_name, "w", encoding="utf-8") as f:
                f.write(ref_code)
            created_files.append((sanitized_name, "basic_reference"))

        # 4. Generate references/README.md index file
        readme_lines = [
            "# Reference Examples Index\n",
            "This directory contains executable reference code examples demonstrating how to construct and emit A2UI components using `lib/builder` and `lib/emitter`.\n",
            "## Available Reference Modules\n"
        ]

        for filename, title in created_files:
            readme_lines.append(f"- [`{filename}`]({filename}): Demonstrates `{title}` A2UI rendering flow.")

        readme_lines.extend([
            "\n## How to Execute Reference Self-Test\n",
            "You can run any reference script directly via CLI to test execution and A2UI protocol bounding:\n"
        ])

        if is_js:
            readme_lines.append(f"```bash\nnode references/{created_files[0][0]}\n```")
        else:
            readme_lines.append(f"```bash\npython3 references/{created_files[0][0]}\n```")

        with open(references_dir / "README.md", "w", encoding="utf-8") as f:
            f.write("\n".join(readme_lines) + "\n")

    def generate(self, output_dir: Optional[str] = None) -> str:
        """Generates the full agent skill directory and returns its absolute path."""
        target_dir = Path(output_dir or self.config.output_dir).resolve()
        target_dir.mkdir(parents=True, exist_ok=True)

        lib_dir = target_dir / "lib"
        catalog_dir = target_dir / "catalog"
        runtime_dir = target_dir / "runtime"
        scripts_dir = target_dir / "scripts"
        references_dir = target_dir / "references"

        for d in [lib_dir, catalog_dir, runtime_dir, scripts_dir, references_dir]:
            d.mkdir(exist_ok=True)

        # 1. Write catalog JSON files
        with open(catalog_dir / "components.json", "w", encoding="utf-8") as f:
            json.dump({"components": self._extract_components()}, f, indent=2)

        is_js = self.config.target_language.lower() in ["javascript", "js", "typescript", "ts"]

        # 2. Write lib/ files
        if is_js:
            component_classes_code = self._build_component_classes_js()
            with open(lib_dir / "builder.js", "w", encoding="utf-8") as f:
                f.write(BUILDER_LIB_JS_TEMPLATE.format(component_classes=component_classes_code))
            with open(lib_dir / "emitter.js", "w", encoding="utf-8") as f:
                f.write(EMITTER_LIB_JS_TEMPLATE)
        else:
            component_classes_code = self._build_component_classes_python()
            with open(lib_dir / "builder.py", "w", encoding="utf-8") as f:
                f.write(BUILDER_LIB_TEMPLATE.format(component_classes=component_classes_code))
            with open(lib_dir / "emitter.py", "w", encoding="utf-8") as f:
                f.write(EMITTER_LIB_TEMPLATE)
            with open(lib_dir / "validator.py", "w", encoding="utf-8") as f:
                f.write(VALIDATOR_LIB_TEMPLATE)
            with open(lib_dir / "__init__.py", "w", encoding="utf-8") as f:
                f.write("# lib package for A2UI skill\n")

        # 3. Write runtime/ and scripts/
        if is_js:
            with open(runtime_dir / "bridge.js", "w", encoding="utf-8") as f:
                f.write(RUNTIME_BRIDGE_JS_TEMPLATE)
            with open(scripts_dir / "validate_ui.js", "w", encoding="utf-8") as f:
                f.write(VALIDATE_UI_SCRIPT_JS_TEMPLATE)
            os.chmod(scripts_dir / "validate_ui.js", 0o755)
        else:
            with open(runtime_dir / "bridge.py", "w", encoding="utf-8") as f:
                f.write(RUNTIME_BRIDGE_TEMPLATE)
            with open(scripts_dir / "validate_ui.py", "w", encoding="utf-8") as f:
                f.write(VALIDATE_UI_SCRIPT_TEMPLATE)
            os.chmod(scripts_dir / "validate_ui.py", 0o755)

        # 4. Write SKILL.md
        skill_name_title = self.config.skill_name.replace("-", " ").title()
        catalog_docs = self._build_catalog_documentation()
        template_to_use = SKILL_MD_JS_TEMPLATE if is_js else SKILL_MD_TEMPLATE
        skill_md_content = template_to_use.format(
            skill_name=self.config.skill_name,
            skill_name_title=skill_name_title,
            description=self.config.description,
            catalog_documentation=catalog_docs,
        )
        with open(target_dir / "SKILL.md", "w", encoding="utf-8") as f:
            f.write(skill_md_content)

        # 5. Write reference examples in references/
        self._generate_references(references_dir, is_js)

        return str(target_dir)
