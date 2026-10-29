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
import json
from pathlib import Path
from typing import Any

from a2ui.core import A2uiValidationError
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser.messages import to_message_dicts, to_message_models

from .models import SynthesisOutput


def _normalize_wire_version(protocol_version: str) -> str:
    """Returns the wire envelope version string for a given protocol version."""
    clean = protocol_version.strip().lstrip("v")
    if clean == "1" or clean.startswith("1."):
        return "1.0"
    if clean in ("0.8", "0.9", "0.9.1"):
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


@dataclass(frozen=True)
class _SurfaceEnvelopes:
    """Surface-defining fields collected from a message batch, any wire version."""

    surface_id: str | None
    catalog_id: str | None
    components: list[Mapping[str, Any]]
    protocol_version: str | None


def _mapping_or_none(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


# Envelope keys whose body may carry a `components` list, by wire version:
# v1.0 `createSurface`, v0.9 `updateComponents`, v0.8 `surfaceUpdate`.
_COMPONENT_ENVELOPES = ("createSurface", "updateComponents", "surfaceUpdate")


def _surface_body(msg: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """Returns the surface-creating body (`createSurface` or v0.8 `beginRendering`)."""
    return _mapping_or_none(msg.get("createSurface")) or _mapping_or_none(
        msg.get("beginRendering")
    )


def _normalize_extracted_component(comp: Mapping[str, Any]) -> dict[str, Any]:
    """Normalizes a component dict, flattening v0.8 `{id, component: {Type: props}}`."""
    raw_comp = comp.get("component")
    if isinstance(raw_comp, Mapping) and len(raw_comp) == 1:
        comp_type, props = next(iter(raw_comp.items()))
        out: dict[str, Any] = {"id": comp.get("id"), "component": str(comp_type)}
        if isinstance(props, Mapping):
            out.update(props)
        return out
    return dict(comp)


def _components_in(msg: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Returns the component dicts the message carries, in order."""
    found: list[Mapping[str, Any]] = []
    for key in _COMPONENT_ENVELOPES:
        body = _mapping_or_none(msg.get(key))
        raw = body.get("components") if body is not None else None
        if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
            found.extend(
                _normalize_extracted_component(c) for c in raw if isinstance(c, Mapping)
            )
    return found


def _surface_id_in(msg: Mapping[str, Any]) -> str | None:
    """Returns the first `surfaceId` any envelope body in the message names."""
    for body in msg.values():
        if isinstance(body, Mapping) and isinstance(body.get("surfaceId"), str):
            return str(body["surfaceId"])
    return None


def _catalog_id_in(msg: Mapping[str, Any]) -> str | None:
    """Returns the `catalogId` of the surface-creating envelope, if any."""
    surface = _surface_body(msg)
    raw = surface.get("catalogId") if surface is not None else None
    return str(raw) if raw is not None else None


def _extract_envelopes(msg_dicts: Sequence[Mapping[str, Any]]) -> _SurfaceEnvelopes:
    """Collects the surface id, catalog id, components, and wire version.

    Understands the three envelope shapes a synthesized or hand-written batch
    may use: v0.9 `createSurface` + `updateComponents`, v1.0 `createSurface`
    with embedded `components` (optionally followed by `updateComponents`),
    and v0.8 `beginRendering` + `surfaceUpdate`. Components from every
    component-bearing envelope are concatenated in message order.
    """
    surface_id: str | None = None
    catalog_id: str | None = None
    components: list[Mapping[str, Any]] = []
    protocol_version: str | None = None

    for msg in msg_dicts:
        version = msg.get("version")
        protocol_version = (
            protocol_version
            if protocol_version is not None or not isinstance(version, str)
            else version
        )
        catalog_id = catalog_id if catalog_id is not None else _catalog_id_in(msg)
        surface_id = surface_id if surface_id is not None else _surface_id_in(msg)
        components.extend(_components_in(msg))

    return _SurfaceEnvelopes(surface_id, catalog_id, components, protocol_version)


def _parse_template_components(
    template_id: str, raw_components: Any
) -> tuple[dict[str, Any], ...]:
    """Validates and deep-copies the `components` list for a template."""
    if not isinstance(raw_components, Sequence) or isinstance(
        raw_components, (str, bytes)
    ):
        raise A2uiValidationError(
            f"Template '{template_id}' must define a 'components' list."
        )
    components: list[dict[str, Any]] = []
    for comp in raw_components:
        _validate_component_dict(comp)
        components.append(copy.deepcopy(dict(comp)))
    if not components:
        raise A2uiValidationError(
            f"Template '{template_id}' must define at least one component."
        )
    return tuple(components)


def _parse_required_pointers(template_id: str, raw_pointers: Any) -> tuple[str, ...]:
    """Validates the `requiredPointers` sequence for a template."""
    if not isinstance(raw_pointers, Sequence) or isinstance(raw_pointers, (str, bytes)):
        raise A2uiValidationError(
            f"Template '{template_id}' 'requiredPointers' must be a list of strings."
        )
    required_pointers: list[str] = []
    for ptr in raw_pointers:
        if not isinstance(ptr, str) or not ptr.startswith("/"):
            raise A2uiValidationError(
                f"Template '{template_id}' required pointer {ptr!r} must start with"
                " '/'."
            )
        required_pointers.append(ptr)
    return tuple(required_pointers)


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
            raw_messages.append({
                "version": wire_version,
                "updateDataModel": {
                    "surfaceId": target_surface_id,
                    "path": "/",
                    "value": dict(payload),
                },
            })

        return to_message_models(raw_messages)

    @classmethod
    def from_json(
        cls,
        template_id: str,
        data: Mapping[str, Any],
        *,
        default_catalog_id: str | None = None,
        default_protocol_version: str = "1.0",
    ) -> SurfaceTemplate:
        """Constructs a `SurfaceTemplate` from a JSON object."""
        if not isinstance(template_id, str) or not template_id.strip():
            raise A2uiValidationError("Template ID must be a non-empty string.")
        if not isinstance(data, Mapping):
            raise A2uiValidationError(
                f"Template '{template_id}' definition must be a mapping."
            )
        description = data.get("description")
        if not isinstance(description, str) or not description.strip():
            raise A2uiValidationError(
                f"Template '{template_id}' must define a non-empty 'description'."
            )
        components = _parse_template_components(template_id, data.get("components"))
        raw_pointers = (
            data.get("requiredPointers")
            if "requiredPointers" in data
            else data.get("required_pointers", ())
        )
        required_pointers = _parse_required_pointers(template_id, raw_pointers)

        surface_id = str(data.get("surfaceId") or data.get("surface_id") or template_id)
        raw_catalog_id = (
            data.get("catalogId")
            if "catalogId" in data
            else data.get("catalog_id", default_catalog_id)
        )
        catalog_id = str(raw_catalog_id) if raw_catalog_id is not None else None
        protocol_version = str(
            data.get("protocolVersion")
            or data.get("protocol_version")
            or default_protocol_version
        )
        is_mutable = bool(
            data.get("isMutable")
            if "isMutable" in data
            else data.get("is_mutable", False)
        )
        return cls(
            template_id=template_id,
            description=description,
            surface_id=surface_id,
            catalog_id=catalog_id,
            protocol_version=protocol_version,
            components=tuple(components),
            required_pointers=tuple(required_pointers),
            is_mutable=is_mutable,
        )

    def to_dict(self) -> dict[str, Any]:
        """Serializes this template into a JSON-compatible dictionary."""
        out: dict[str, Any] = {
            "description": self.description,
            "surfaceId": self.surface_id,
            "protocolVersion": self.protocol_version,
            "requiredPointers": list(self.required_pointers),
            "isMutable": self.is_mutable,
            "components": [copy.deepcopy(c) for c in self.components],
        }
        if self.catalog_id is not None:
            out["catalogId"] = self.catalog_id
        return out


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
        """Promotes a synthesized UI output into a reusable registered template.

        Accepts v0.9, v1.0, and v0.8 message envelopes (see `_extract_envelopes`).

        Raises:
            ValueError: If the messages define no components.
        """
        envelopes = _extract_envelopes(to_message_dicts(output.messages))
        if not envelopes.components:
            raise ValueError(
                "SynthesisOutput messages must define components in a createSurface,"
                " updateComponents, or surfaceUpdate envelope."
            )

        template = SurfaceTemplate(
            template_id=template_id,
            description=description,
            surface_id=envelopes.surface_id or "default_surface",
            catalog_id=envelopes.catalog_id,
            protocol_version=envelopes.protocol_version or "v0.9",
            components=tuple(copy.deepcopy(dict(c)) for c in envelopes.components),
            required_pointers=tuple(required_pointers),
            is_mutable=is_mutable,
        )
        self.register(template)
        return template

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> TemplateRegistry:
        """Loads and validates a `TemplateRegistry` from a `templates.json` object."""
        if not isinstance(data, Mapping):
            raise A2uiValidationError("Template registry JSON must be an object.")
        raw_templates = data.get("templates")
        if not isinstance(raw_templates, Mapping) or not raw_templates:
            raise A2uiValidationError(
                "Template registry JSON must define a non-empty 'templates' mapping."
            )
        raw_cat_id = (
            data.get("catalogId") if "catalogId" in data else data.get("catalog_id")
        )
        default_catalog_id = str(raw_cat_id) if raw_cat_id is not None else None
        default_protocol_version = str(
            data.get("protocolVersion") or data.get("protocol_version") or "1.0"
        )
        registry = cls()
        for template_id, spec in raw_templates.items():
            template = SurfaceTemplate.from_json(
                str(template_id),
                spec,
                default_catalog_id=default_catalog_id,
                default_protocol_version=default_protocol_version,
            )
            registry.register(template)
        return registry

    @classmethod
    def from_file(cls, path: str | Path) -> TemplateRegistry:
        """Loads a `TemplateRegistry` from a `templates.json` file or directory."""
        resolved = Path(path)
        if resolved.is_dir():
            resolved = resolved / "templates.json"
        raw = json.loads(resolved.read_text(encoding="utf-8"))
        return cls.from_json(raw)

    def to_dict(
        self,
        *,
        catalog_id: str | None = None,
        protocol_version: str = "1.0",
        version: str = "1.0",
    ) -> dict[str, Any]:
        """Serializes this registry into a `templates.json` dictionary."""
        out: dict[str, Any] = {
            "version": version,
            "protocolVersion": protocol_version,
            "templates": {t.template_id: t.to_dict() for t in self._templates.values()},
        }
        if catalog_id is not None:
            out["catalogId"] = catalog_id
        return out
