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

"""Host Target Profile specification schema and parser."""

from __future__ import annotations

from dataclasses import dataclass, field
import importlib.resources
import json
import os
from typing import Any, Dict, List, Optional


class TargetProfileError(Exception):
    """Raised when a host target profile fails to load or parse."""


@dataclass
class HostTargetProfile:
    """Specification for a host runtime target environment.

    Attributes:
        name: Unique identifier for the host target profile.
        protocol_versions: List of supported A2UI protocol versions (e.g. ["0.8", "0.9"]).
        wire_client_version: Host client wire version string (e.g. "v0.9").
        mime_types: Allowed MIME types for the host (e.g. ["application/json+a2ui"]).
        catalog: Default or required catalog name / ID for the target.
        quirks: Dictionary of runtime quirks and constraint flags.
    """

    name: str
    protocol_versions: List[str]
    wire_client_version: str
    mime_types: List[str]
    catalog: str
    quirks: Dict[str, bool] = field(default_factory=dict)

    @classmethod
    def load(cls, target: str) -> HostTargetProfile:
        """Loads a HostTargetProfile from a built-in profile name or file path.

        Args:
            target: Name of built-in profile (e.g. "gemini-enterprise") or file path.

        Returns:
            The parsed HostTargetProfile instance.

        Raises:
            TargetProfileError: If the profile cannot be found or parsed.
        """
        target_path: Optional[str] = None

        # Check if direct file path exists
        if os.path.isfile(target):
            target_path = target
        else:
            # Check built-in profiles directory
            norm_name = target.replace("_", "-").lower()
            profiles_dir = os.path.join(os.path.dirname(__file__), "profiles")
            for candidate in [
                os.path.join(profiles_dir, f"{norm_name}.yaml"),
                os.path.join(profiles_dir, f"{norm_name}.yml"),
                os.path.join(profiles_dir, f"{norm_name}.json"),
                os.path.join(profiles_dir, f"{target}.yaml"),
                os.path.join(profiles_dir, f"{target}.json"),
            ]:
                if os.path.isfile(candidate):
                    target_path = candidate
                    break

        if not target_path:
            # Try finding via importlib.resources
            try:
                norm_name = target.replace("_", "-").lower()
                files = importlib.resources.files("a2ui.targets.profiles")
                for ext in [".yaml", ".yml", ".json"]:
                    p = files.joinpath(f"{norm_name}{ext}")
                    if p.is_file():
                        target_path = str(p)
                        break
            except Exception:
                pass

        if not target_path or not os.path.isfile(target_path):
            available = cls.list_available_profiles()
            raise TargetProfileError(
                f"Host target profile '{target}' not found. Available profiles:"
                f" {available}"
            )

        try:
            with open(target_path, "r", encoding="utf-8") as f:
                content = f.read()

            data: Dict[str, Any]
            if target_path.endswith((".yaml", ".yml")):
                try:
                    import yaml

                    data = yaml.safe_load(content)
                except ImportError:
                    # Fallback if pyyaml is missing: parse simple key-value YAML or JSON
                    try:
                        data = json.loads(content)
                    except Exception:
                        raise TargetProfileError(
                            f"PyYAML is required to parse YAML profile '{target_path}'."
                        )
            else:
                data = json.loads(content)

            if not isinstance(data, dict):
                raise TargetProfileError(
                    f"Profile '{target_path}' did not parse as an object."
                )

            return cls(
                name=data.get("name", target),
                protocol_versions=[str(v) for v in data.get("protocol_versions", [])],
                wire_client_version=str(data.get("wire_client_version", "")),
                mime_types=[str(m) for m in data.get("mime_types", [])],
                catalog=str(data.get("catalog", "")),
                quirks={k: bool(v) for k, v in data.get("quirks", {}).items()},
            )
        except Exception as e:
            if isinstance(e, TargetProfileError):
                raise
            raise TargetProfileError(f"Failed to load profile '{target}': {e}") from e

    @classmethod
    def list_available_profiles(cls) -> List[str]:
        """Lists names of all available built-in host target profiles."""
        profiles_dir = os.path.join(os.path.dirname(__file__), "profiles")
        names = []
        if os.path.isdir(profiles_dir):
            for f in os.listdir(profiles_dir):
                if f.endswith((".yaml", ".yml", ".json")) and not f.endswith(
                    "_catalog.json"
                ):
                    name = os.path.splitext(f)[0]
                    names.append(name)
        return sorted(list(set(names)))

    def validate_payload(self, payload: Any) -> List[str]:
        """Validates a payload against this target profile constraints and quirks.

        Args:
            payload: The raw parsed A2UI payload (list, dict, or A2A Part).

        Returns:
            A list of error message strings. Empty list indicates full compliance.
        """
        errors: List[str] = []

        # 1. MIME Type Validation
        mime_type = self._extract_mime_type(payload)
        if mime_type:
            exact_match = self.quirks.get("mime-exact-match", False)
            if exact_match:
                if mime_type not in self.mime_types:
                    errors.append(
                        f"Incompatible MIME type '{mime_type}'. Target '{self.name}'"
                        f" requires exact match in: {self.mime_types}"
                    )
            else:
                if mime_type not in self.mime_types:
                    errors.append(
                        f"Incompatible MIME type '{mime_type}'. Target '{self.name}'"
                        f" expects one of: {self.mime_types}"
                    )

        # 2. Protocol Version Validation
        versions = self._extract_protocol_versions(payload)
        allowed_norms = {v.lstrip("v") for v in self.protocol_versions}
        for ver in versions:
            norm_ver = ver.lstrip("v")
            if norm_ver not in allowed_norms:
                errors.append(
                    f"Incompatible protocol version '{ver}'. Target '{self.name}'"
                    f" supports versions: {self.protocol_versions}"
                )

        # 3. Quirk: side-panel-requires-canvas-root
        if self.quirks.get("side-panel-requires-canvas-root", False):
            quirk_errors = self._validate_side_panel_quirk(payload)
            errors.extend(quirk_errors)

        return errors

    def _extract_mime_type(self, payload: Any) -> Optional[str]:
        """Extracts the MIME type from payload or transport metadata."""
        if isinstance(payload, dict):
            if "mimeType" in payload:
                return str(payload["mimeType"])
            if "mime_type" in payload:
                return str(payload["mime_type"])
            if "metadata" in payload and isinstance(payload["metadata"], dict):
                meta = payload["metadata"]
                if "mimeType" in meta:
                    return str(meta["mimeType"])
                if "mime_type" in meta:
                    return str(meta["mime_type"])
            # A2A Part structure: root.metadata
            if "root" in payload and isinstance(payload["root"], dict):
                root_meta = payload["root"].get("metadata", {})
                if isinstance(root_meta, dict):
                    if "mimeType" in root_meta:
                        return str(root_meta["mimeType"])
                    if "mime_type" in root_meta:
                        return str(root_meta["mime_type"])
        return None

    def _extract_protocol_versions(self, payload: Any) -> List[str]:
        """Extracts all protocol versions declared in the payload."""
        versions: List[str] = []
        messages = self._extract_messages(payload)
        for msg in messages:
            if isinstance(msg, dict) and "version" in msg:
                versions.append(str(msg["version"]))

        if not versions and isinstance(payload, dict):
            if "version" in payload and isinstance(payload["version"], str):
                versions.append(payload["version"])
            if "protocolVersion" in payload and isinstance(
                payload["protocolVersion"], str
            ):
                versions.append(payload["protocolVersion"])

        return versions

    def _extract_messages(self, payload: Any) -> List[Dict[str, Any]]:
        """Normalizes various payload wrappers to a list of message dicts."""
        if isinstance(payload, list):
            return [m for m in payload if isinstance(m, dict)]
        if isinstance(payload, dict):
            if "messages" in payload and isinstance(payload["messages"], list):
                return [m for m in payload["messages"] if isinstance(m, dict)]
            if "root" in payload and isinstance(payload["root"], dict):
                data = payload["root"].get("data")
                if isinstance(data, list):
                    return [m for m in data if isinstance(m, dict)]
                if isinstance(data, dict):
                    return self._extract_messages(data)
            # Check if this dict itself is an A2UI message
            if any(
                k in payload
                for k in (
                    "createSurface",
                    "updateComponents",
                    "updateDataModel",
                    "deleteSurface",
                )
            ):
                return [payload]
        return []

    def _validate_side_panel_quirk(self, payload: Any) -> List[str]:
        """Enforces that side-panel surfaces and Canvas components have Canvas as the root."""
        errors: List[str] = []
        messages = self._extract_messages(payload)

        for msg in messages:
            if not isinstance(msg, dict) or "updateComponents" not in msg:
                continue
            uc = msg["updateComponents"]
            if not isinstance(uc, dict):
                continue
            surface_id = str(uc.get("surfaceId", ""))
            components = uc.get("components", [])
            if not isinstance(components, list) or not components:
                continue

            children_ids: set[str] = set()
            canvas_ids: List[str] = []

            for comp in components:
                if not isinstance(comp, dict):
                    continue
                cid = comp.get("id")
                ctype = comp.get("component")
                if ctype == "Canvas" and cid:
                    canvas_ids.append(str(cid))

                for prop in ("children", "child", "tabs", "content", "trigger"):
                    val = comp.get(prop)
                    if isinstance(val, str):
                        children_ids.add(val)
                    elif isinstance(val, list):
                        for item in val:
                            if isinstance(item, str):
                                children_ids.add(item)
                            elif isinstance(item, dict):
                                if "componentId" in item and isinstance(
                                    item["componentId"], str
                                ):
                                    children_ids.add(item["componentId"])
                                if "child" in item and isinstance(item["child"], str):
                                    children_ids.add(item["child"])
                                if "content" in item and isinstance(
                                    item["content"], str
                                ):
                                    children_ids.add(item["content"])

            root_comps = [
                c
                for c in components
                if isinstance(c, dict) and c.get("id") not in children_ids
            ]

            # Quirk check 1: Canvas must not be a child component
            for cid in canvas_ids:
                if cid in children_ids:
                    errors.append(
                        "Quirk 'side-panel-requires-canvas-root' violated: Component"
                        f" 'Canvas' (id: '{cid}') is nested as a child component in"
                        f" surface '{surface_id}'; Canvas must be the root component."
                    )
                elif root_comps and not any(r.get("id") == cid for r in root_comps):
                    errors.append(
                        "Quirk 'side-panel-requires-canvas-root' violated: Component"
                        f" 'Canvas' (id: '{cid}') must be the root component of surface"
                        f" '{surface_id}'."
                    )

            # Quirk check 2: Side panel surfaces must have Canvas as root
            is_side_panel = any(
                term in surface_id.lower()
                for term in ("side-panel", "side_panel", "canvas-panel")
            )
            if is_side_panel:
                has_canvas_root = any(
                    r.get("component") == "Canvas" for r in root_comps
                )
                if not has_canvas_root:
                    root_name = root_comps[0].get("component") if root_comps else "None"
                    errors.append(
                        "Quirk 'side-panel-requires-canvas-root' violated: Surface"
                        f" '{surface_id}' is a side panel surface but has root"
                        f" component '{root_name}' instead of 'Canvas'."
                    )

        return errors
