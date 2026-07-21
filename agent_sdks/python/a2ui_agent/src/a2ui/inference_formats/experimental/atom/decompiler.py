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

"""Decompilation engine for A2UI Atom format."""

import json
from typing import Any, Dict, List, Union, Optional
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog


class AtomDecompiler:
    """Decompiles structured A2UI JSON payloads back into compact Atom S-expressions.

    Attributes:
        catalog: The catalog containing component and function schemas.
    """

    def __init__(self, catalog: Optional[Union[Catalog[Any, Any], A2uiCatalog]] = None):
        """Initializes an AtomDecompiler instance.

        Args:
            catalog: The catalog containing component and function schemas.
        """
        self.catalog = catalog

    def decompile(self, payload: Dict[str, Any]) -> str:
        """Decompiles an A2UI JSON payload dictionary into Atom S-expression syntax.

        Args:
            payload: The A2UI JSON message dictionary payload.

        Returns:
            The decompiled Atom S-expression formatted string.
        """
        if "deleteSurface" in payload:
            surf_id = payload["deleteSurface"].get("surfaceId", "main")
            return f'(deleteSurface "{surf_id}")'

        if "callFunction" in payload:
            call_obj = payload["callFunction"]
            func_name = call_obj.get("call", "")
            args = call_obj.get("args", {})
            args_str = " ".join(
                [f":{k} {self._format_val(v)}" for k, v in args.items()]
            )
            return f'(callFunction "{func_name}" {args_str})'.strip()

        if "updateDataModel" in payload:
            val_obj = payload["updateDataModel"].get("value", {})
            data_pairs = " ".join(
                [f"$/{k} {self._format_val(v)}" for k, v in val_obj.items()]
            )
            return f"(data {data_pairs})"

        if "createSurface" in payload:
            surface_obj = payload["createSurface"]
            components = surface_obj.get("components", [])
            data_model = surface_obj.get("dataModel", {})

            lines = []
            if data_model:
                pairs = " ".join(
                    [f"$/{k} {self._format_val(v)}" for k, v in data_model.items()]
                )
                lines.append(f"(data {pairs})\n")

            if components:
                # Map component ID to object
                comp_map = {c["id"]: c for c in components}
                # Find root component (first node not referenced as a child, or node_0)
                all_children = set()
                for c in components:
                    if "child" in c and isinstance(c["child"], str):
                        all_children.add(c["child"])
                    if "children" in c:
                        ch = c["children"]
                        if isinstance(ch, list):
                            all_children.update(
                                elem
                                for elem in ch
                                if isinstance(elem, str) and elem in comp_map
                            )
                        elif isinstance(ch, dict) and "componentId" in ch:
                            all_children.add(ch["componentId"])
                    for pk, pv in c.items():
                        if pk in ("id", "component", "child", "children"):
                            continue
                        if isinstance(pv, dict) and "componentId" in pv:
                            all_children.add(pv["componentId"])
                        elif isinstance(pv, list):
                            all_children.update(
                                elem
                                for elem in pv
                                if isinstance(elem, str) and elem in comp_map
                            )

                root_id = components[0]["id"]
                for c in components:
                    if c["id"] not in all_children:
                        root_id = c["id"]
                        break

                lines.append(self._decompile_component(root_id, comp_map, indent=0))

            return "\n".join(lines)

        return ""

    def _decompile_component(
        self, comp_id: str, comp_map: Dict[str, Any], indent: int = 0
    ) -> str:
        if comp_id not in comp_map:
            return ""

        comp = comp_map[comp_id]
        comp_type = comp.get("component", "View")
        pad = "  " * indent

        props = []
        child_nodes = []

        for k, v in comp.items():
            if k in ("id", "component"):
                continue
            if isinstance(v, dict) and "componentId" in v:
                tmpl_child_id = v["componentId"]
                path_val = v.get("path", "")
                items_arg = f':items $/{path_val.lstrip("/")}' if path_val else ""
                decomp_child = self._decompile_component(
                    tmpl_child_id, comp_map, indent + 1
                )
                child_nodes.append(
                    f"{pad}  (template {items_arg}\n{decomp_child})".strip()
                )
            elif isinstance(v, str) and v in comp_map:
                # Single child reference
                decomp_child = self._decompile_component(v, comp_map, indent + 1)
                if k in ("child", "content", "trigger"):
                    child_nodes.append(decomp_child)
                else:
                    props.append(f":{k} {decomp_child.strip()}")
            elif (
                isinstance(v, list)
                and v
                and all(isinstance(elem, str) and elem in comp_map for elem in v)
            ):
                # Child list reference
                sub_children = [
                    self._decompile_component(elem, comp_map, indent + 1) for elem in v
                ]
                if k == "children":
                    child_nodes.extend(sub_children)
                else:
                    joined_nodes = "\n".join(sub_children)
                    props.append(f":{k} [\n{joined_nodes}\n{pad}]")
            else:
                props.append(f":{k} {self._format_val(v)}")

        props_str = " " + " ".join(props) if props else ""

        if not child_nodes:
            return f"{pad}({comp_type}{props_str})"

        children_str = "\n" + "\n".join(child_nodes)
        return f"{pad}({comp_type}{props_str}{children_str})"

    def _format_val(self, val: Any) -> str:
        if isinstance(val, bool):
            return "true" if val else "false"
        if val is None:
            return "null"
        if isinstance(val, dict):
            if "path" in val:
                path = val["path"]
                return (
                    f"$/{path}"
                    if not path.startswith("/") and not path.startswith("$")
                    else path
                )
            if "event" in val:
                evt = val["event"]
                if isinstance(evt, dict):
                    name = evt.get("name", "")
                    ctx = evt.get("context", {})
                else:
                    name = str(evt)
                    ctx = val.get("context", {})
                ctx_str = (
                    " "
                    + " ".join([f":{k} {self._format_val(v)}" for k, v in ctx.items()])
                    if ctx
                    else ""
                )
                return f'(Event "{name}"{ctx_str})'
        if isinstance(val, str):
            return f'"{val}"'
        return str(val)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps decompiled Atom S-expression blocks within <a2ui> sentinel tags.

        Args:
            blocks: A list of decompiled S-expression string blocks.

        Returns:
            The formatted text block enclosed in sentinel tags.
        """
        return "<a2ui>\n" + "\n\n".join(blocks) + "\n</a2ui>"
