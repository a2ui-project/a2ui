# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Decompilation engine for A2UI Vertical inference format.

Converts structured A2UI message payloads back into clean plain-text Vertical notation.
"""

import json
from typing import Any, Dict, List, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import (
    A2UI_INFERENCE_OPEN_TAG,
    A2UI_INFERENCE_CLOSE_TAG,
)


def _format_value(val: Any) -> str:
    """Formats a Python / JSON value into Vertical syntax string."""
    if val is None:
        return "null"
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        # Escape quotes
        escaped = val.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    if isinstance(val, dict):
        # Data binding path
        if "path" in val and isinstance(val["path"], str):
            p = val["path"]
            if p.startswith("/"):
                return f"${p}"
            return f"$/{p}"
        # Event action
        if "event" in val and isinstance(val["event"], dict):
            ev = val["event"]
            ev_name = ev.get("name", "")
            context = ev.get("context", {})
            parts = [f'"{ev_name}"']
            if isinstance(context, dict):
                for k, v in context.items():
                    parts.append(f"{k}={_format_value(v)}")
            return f"Event({', '.join(parts)})"
        # Standard dict
        inner = ", ".join(f"{k}={_format_value(v)}" for k, v in val.items())
        return f"{{{inner}}}"
    if isinstance(val, list):
        inner = ", ".join(_format_value(item) for item in val)
        return f"[{inner}]"
    return str(val)


class VerticalDecompiler:
    """Decompiles structured A2UI payloads into plain-text Vertical syntax.

    Attributes:
        catalog: Component catalog schema helper.
    """

    def __init__(self, catalog: Union[Catalog[Any, Any], A2uiCatalog]):
        """Initializes the decompiler with a catalog."""
        self.catalog = catalog

    def _format_component(self, comp: Dict[str, Any]) -> str:
        """Formats a single component dictionary into ComponentName(kwargs...)."""
        comp_type = comp.get("component", "Unknown")
        args_parts: List[str] = []

        for k, v in comp.items():
            if k in ("component", "id", "child", "children"):
                continue
            args_parts.append(f"{k}={_format_value(v)}")

        return f"{comp_type}({', '.join(args_parts)})"

    def decompile(self, val: Union[Dict[str, Any], List[Dict[str, Any]]]) -> str:
        """Decompiles an A2UI message or list of messages into Vertical format string.

        Args:
            val: Standard A2UI wire JSON message dict or list of message dicts.

        Returns:
            Decompiled plain-text Vertical component definitions.
        """
        messages: List[Dict[str, Any]] = val if isinstance(val, list) else [val]
        components_map: Dict[str, Dict[str, Any]] = {}
        root_id: Optional[str] = None
        component_order: List[str] = []

        for msg in messages:
            if not isinstance(msg, dict):
                continue
            # Check v1.0 createSurface or v0.9 updateComponents
            comps = []
            if "createSurface" in msg and isinstance(msg["createSurface"], dict):
                comps = msg["createSurface"].get("components", [])
            elif "updateComponents" in msg and isinstance(
                msg["updateComponents"], dict
            ):
                comps = msg["updateComponents"].get("components", [])

            for c in comps:
                if isinstance(c, dict) and "id" in c:
                    cid = c["id"]
                    components_map[cid] = c
                    if cid not in component_order:
                        component_order.append(cid)
                    if root_id is None and (
                        cid == "root"
                        or not component_order
                        or component_order[0] == cid
                    ):
                        root_id = cid

        if not components_map:
            return ""

        if root_id is None:
            root_id = component_order[0]

        root_comp = components_map.get(root_id, {})
        root_type = root_comp.get("component", "")

        # Check if root is a vertical container (Column or List)
        if root_type in ("Column", "List") and "children" in root_comp:
            children_ids = root_comp.get("children", [])
            lines = []
            for child_id in children_ids:
                child_comp = components_map.get(child_id)
                if child_comp:
                    lines.append(self._format_component(child_comp))
            return "\n".join(lines)

        # Single component root
        return self._format_component(root_comp)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps decompiled code blocks inside sentinel tags."""
        joined = "\n".join(blocks).strip()
        return f"{A2UI_INFERENCE_OPEN_TAG}\n{joined}\n{A2UI_INFERENCE_CLOSE_TAG}"
