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

"""Pre-validated A2UI surface templates and registry for decision-model synthesis."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
import copy
from dataclasses import dataclass
from typing import Any

from a2ui.core import A2uiValidationError
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser.messages import to_message_dicts, to_message_models

from .models import SynthesisOutput


def _normalize_wire_version(protocol_version: str) -> str:
    """Returns the wire envelope version string for a given protocol version."""
    clean = protocol_version.strip().lstrip("v")
    if clean == "1" or clean.startswith("1."):
        return "v1.0"
    if clean in ("0.9", "0.9.1"):
        return "v0.9"
    return protocol_version


def _validate_component_dict(component: Mapping[str, Any]) -> None:
    """Validates that a raw component dictionary has required A2UI keys."""
    if not isinstance(component, Mapping):
        raise A2uiValidationError("Component definition must be a mapping.")
    comp_id = component.get("id")
    if not isinstance(comp_id, str) or not comp_id.strip():
        raise A2uiValidationError(
            "Component definition must include a non-empty string 'id'."
        )
    comp_type = component.get("component")
    if not isinstance(comp_type, str) or not comp_type.strip():
        raise A2uiValidationError(
            "Component definition must include a non-empty string 'component'."
        )


def _extract_envelopes(
    msg_dicts: Sequence[Mapping[str, Any]],
) -> tuple[Mapping[str, Any] | None, Mapping[str, Any] | None, str | None]:
    """Extracts createSurface, updateComponents, and wire version from message dicts."""
    create_surface: Mapping[str, Any] | None = None
    update_components: Mapping[str, Any] | None = None
    protocol_version: str | None = None

    for msg in msg_dicts:
        version = msg.get("version")
        if protocol_version is None and isinstance(version, str):
            protocol_version = version
        cs = msg.get("createSurface")
        if create_surface is None and isinstance(cs, Mapping):
            create_surface = cs
        uc = msg.get("updateComponents")
        if update_components is None and isinstance(uc, Mapping):
            update_components = uc

    return create_surface, update_components, protocol_version


@dataclass(frozen=True)
class SurfaceTemplate:
    """Pre-validated A2UI surface template parameterized by JSON Pointer paths."""

    template_id: str
    description: str
    surface_id: str
    catalog_id: str | None
    protocol_version: str
    components: tuple[dict[str, Any], ...]
    required_pointers: tuple[str, ...] = ()
    is_mutable: bool = False

    def matches_payload(self, available_pointers: Collection[str]) -> bool:
        """Returns whether all required JSON Pointers are present in the payload."""
        return all(req in available_pointers for req in self.required_pointers)

    def root_component(self) -> str | None:
        """Returns the component type name of the root component in this template."""
        if not self.components:
            return None
        for comp in self.components:
            if comp.get("id") == "root" and isinstance(comp.get("component"), str):
                return str(comp["component"])
        first_comp = self.components[0].get("component")
        return str(first_comp) if isinstance(first_comp, str) else None

    def render_messages(
        self,
        payload: Mapping[str, Any],
        *,
        surface_id: str | None = None,
    ) -> list[AgentToRendererMessage]:
        """Renders and validates A2UI wire messages for this surface template."""
        target_surface_id = surface_id if surface_id is not None else self.surface_id
        if not isinstance(target_surface_id, str) or not target_surface_id.strip():
            raise A2uiValidationError("Surface ID must be a non-empty string.")
        if not self.components:
            raise A2uiValidationError(
                "SurfaceTemplate must define at least one component."
            )
        for comp in self.components:
            _validate_component_dict(comp)

        wire_version = _normalize_wire_version(self.protocol_version)
        create_surface_body: dict[str, Any] = {"surfaceId": target_surface_id}
        if self.catalog_id is not None:
            create_surface_body["catalogId"] = self.catalog_id

        raw_messages: list[dict[str, Any]] = [
            {
                "version": wire_version,
                "createSurface": create_surface_body,
            },
            {
                "version": wire_version,
                "updateComponents": {
                    "surfaceId": target_surface_id,
                    "components": [copy.deepcopy(c) for c in self.components],
                },
            },
        ]
        if payload:
            raw_messages.append(
                {
                    "version": wire_version,
                    "updateDataModel": {
                        "surfaceId": target_surface_id,
                        "path": "/",
                        "value": dict(payload),
                    },
                }
            )

        return to_message_models(raw_messages)


class TemplateRegistry:
    """Registry of pre-validated A2UI surface templates for Stage 1 selection."""

    def __init__(self) -> None:
        """Initializes an empty surface template registry."""
        self._templates: dict[str, SurfaceTemplate] = {}

    def register(self, template: SurfaceTemplate) -> None:
        """Validates and registers a surface template by its template ID."""
        template.render_messages({})
        self._templates[template.template_id] = template

    def get(self, template_id: str) -> SurfaceTemplate | None:
        """Returns the registered template for `template_id`, or None if absent."""
        return self._templates.get(template_id)

    def list_templates(self) -> tuple[SurfaceTemplate, ...]:
        """Returns all registered surface templates in registration order."""
        return tuple(self._templates.values())

    def matching_templates(
        self, available_pointers: Collection[str]
    ) -> tuple[SurfaceTemplate, ...]:
        """Returns registered templates whose required pointers match the payload."""
        return tuple(
            template
            for template in self._templates.values()
            if template.matches_payload(available_pointers)
        )

    def promote_synthesized(
        self,
        template_id: str,
        description: str,
        output: SynthesisOutput,
        *,
        required_pointers: Sequence[str] = (),
        is_mutable: bool = False,
    ) -> SurfaceTemplate:
        """Promotes a synthesized UI output into a reusable registered template."""
        msg_dicts = to_message_dicts(output.messages)
        create_surface, update_components, protocol_version = _extract_envelopes(
            msg_dicts
        )
        if update_components is None:
            raise ValueError(
                "SynthesisOutput messages must include an updateComponents envelope."
            )

        raw_components = update_components.get("components")
        if not isinstance(raw_components, Sequence) or not raw_components:
            raise ValueError("updateComponents envelope must contain components.")

        surface_id = str(
            (create_surface or {}).get("surfaceId")
            or update_components.get("surfaceId")
            or "default_surface"
        )
        raw_catalog_id = (create_surface or {}).get("catalogId")
        catalog_id = str(raw_catalog_id) if raw_catalog_id is not None else None

        template = SurfaceTemplate(
            template_id=template_id,
            description=description,
            surface_id=surface_id,
            catalog_id=catalog_id,
            protocol_version=protocol_version or "v0.9",
            components=tuple(
                copy.deepcopy(dict(c)) for c in raw_components if isinstance(c, Mapping)
            ),
            required_pointers=tuple(required_pointers),
            is_mutable=is_mutable,
        )
        self.register(template)
        return template
