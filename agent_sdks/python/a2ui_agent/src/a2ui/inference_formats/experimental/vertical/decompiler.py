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
        lines: List[str] = []
        surfaces_seen: List[str] = []
        surface_components: Dict[str, List[Dict[str, Any]]] = {}

        for msg in messages:
            if not isinstance(msg, dict):
                continue
            surf_id = None
            comps = []
            if "createSurface" in msg and isinstance(msg["createSurface"], dict):
                surf_id = msg["createSurface"].get("surfaceId")
                comps = msg["createSurface"].get("components", [])
            elif "updateComponents" in msg and isinstance(
                msg["updateComponents"], dict
            ):
                surf_id = msg["updateComponents"].get("surfaceId")
                comps = msg["updateComponents"].get("components", [])

            if surf_id:
                if surf_id not in surface_components:
                    surface_components[surf_id] = []
                    surfaces_seen.append(surf_id)
                surface_components[surf_id].extend(comps)
            elif comps:
                default_key = "_default"
                if default_key not in surface_components:
                    surface_components[default_key] = []
                    surfaces_seen.append(default_key)
                surface_components[default_key].extend(comps)

        for s_id in surfaces_seen:
            comps = surface_components[s_id]
            if not comps:
                continue
            comp_map = {c["id"]: c for c in comps if isinstance(c, dict) and "id" in c}
            root_comp = comp_map.get("root") or (comps[0] if comps else None)
            if not root_comp:
                continue

            root_type = root_comp.get("component", "")
            # Backward compat: if old single-surface container with children
            if root_type in ("Column", "List") and "children" in root_comp:
                for child_id in root_comp.get("children", []):
                    child_comp = comp_map.get(child_id)
                    if child_comp:
                        lines.append(self._format_component(child_comp))
            else:
                lines.append(self._format_component(root_comp))

        return "\n".join(lines)

    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps decompiled code blocks inside sentinel tags."""
        joined = "\n".join(blocks).strip()
        return f"{A2UI_INFERENCE_OPEN_TAG}\n{joined}\n{A2UI_INFERENCE_CLOSE_TAG}"
