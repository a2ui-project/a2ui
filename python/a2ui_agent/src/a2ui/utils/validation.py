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

"""Stateless validation of the payloads that an agent sends."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from a2ui.core import (
    A2uiCatalogError,
    A2uiError,
    A2uiValidationError,
    CatalogApi,
    MessageProcessor,
    MessageProcessorOptions,
    STRICT_VALIDATION,
    ValidationConfig,
)
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import ProtocolVersion

# The `version` values that messages for each protocol version's catalogs
# state, spelled as the specification spells them. A v0.8 message has no
# `version`. As in the core's catalog compatibility, v0.9 and v0.9.1 catalogs
# are interchangeable, so both accept either version.
_MESSAGE_VERSIONS: dict[ProtocolVersion, frozenset[str]] = {
    ProtocolVersion.V0_8: frozenset(),
    ProtocolVersion.V0_9: frozenset({"v0.9", "v0.9.1"}),
    ProtocolVersion.V0_9_1: frozenset({"v0.9", "v0.9.1"}),
    ProtocolVersion.V1_0: frozenset({"v1.0"}),
}

_CREATE_ACTIONS = ("createSurface", "beginRendering")
_UPDATE_ACTIONS = (
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "surfaceUpdate",
    "dataModelUpdate",
)

# A surface that the payload updates but doesn't create may hold components
# from earlier payloads, so references to components outside the payload, a
# missing root and unreachable components are accepted there. Unlike
# `RELAXED_VALIDATION`, unknown components are still rejected.
_UPDATED_SURFACE_VALIDATION = ValidationConfig(
    allow_dangling_references=True,
    allow_missing_root=True,
    allow_orphan_components=True,
)


def validate_payload(catalogs: Sequence[CatalogApi], payload: Any) -> None:
    """Checks a payload the way a renderer holding the catalogs would.

    The check is stateless: it sees one payload, with no record of what earlier
    payloads sent. A surface that the payload creates, with `createSurface` or
    the v0.8 `beginRendering`, is checked in full, so its components must be
    valid and reachable from the root, and their references must resolve. A
    surface that the payload only updates may already hold components, so
    references to components outside the payload and a missing root are
    accepted there. Each of its components is still checked against a catalog
    that defines all of them, and the surface passes if one such catalog
    accepts it.

    Each message must state a `version` that the catalogs' protocol version
    accepts, spelled as the specification spells it: none for v0.8, `v0.9` or
    `v0.9.1` for v0.9 and v0.9.1, and `v1.0` for v1.0.

    Args:
      catalogs: The active catalogs, which must target compatible protocol
        versions. Each surface is checked against the catalog its `catalogId`
        names. A v0.8 surface that names none uses the first catalog.
      payload: One message or a list of messages, as parsed JSON.

    Raises:
      A2uiValidationError: If a renderer holding the catalogs would reject the
        payload. The error, or a subclass such as `A2uiIntegrityError`,
        describes the first problem found.
      A2uiCatalogError: If no catalogs are given, or if their messages state
        different versions, for example v0.9 and v1.0 catalogs.
    """
    if not catalogs:
        raise A2uiCatalogError("Validating a payload requires at least one catalog.")
    protocol_version = to_protocol_version(catalogs[0].protocol_version)
    for catalog in catalogs[1:]:
        other_version = to_protocol_version(catalog.protocol_version)
        if _MESSAGE_VERSIONS[other_version] != _MESSAGE_VERSIONS[protocol_version]:
            raise A2uiCatalogError(
                "The catalogs target incompatible protocol versions:"
                f" '{catalogs[0].catalog_id}' targets {protocol_version.value} and"
                f" '{catalog.catalog_id}' targets {other_version.value}."
            )

    messages = payload if isinstance(payload, list) else [payload]
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            raise A2uiValidationError(f"Message {index} is not a JSON object.")
        _check_version(message, index, protocol_version)

    created = {
        surface_id
        for surface_id, creates in map(_target, messages)
        if creates and surface_id is not None
    }
    checked: list[dict[str, Any]] = []
    updated: dict[str, list[dict[str, Any]]] = {}
    for message in messages:
        surface_id, _ = _target(message)
        if surface_id is None or surface_id in created:
            checked.append(message)
        else:
            updated.setdefault(surface_id, []).append(message)

    if checked:
        if protocol_version is ProtocolVersion.V0_8:
            checked = _begin_rendering_first(checked)
        _process(catalogs, checked, STRICT_VALIDATION)
    for surface_id, surface_messages in updated.items():
        _check_updated_surface(catalogs, protocol_version, surface_id, surface_messages)


def _check_version(
    message: Mapping[str, Any], index: int, protocol_version: ProtocolVersion
) -> None:
    """Raises if a message's `version` isn't one its catalogs accept."""
    accepted = _MESSAGE_VERSIONS[protocol_version]
    if not accepted:
        if "version" in message:
            raise A2uiValidationError(
                f"Message {index} states a version, but {protocol_version.value}"
                " messages have none."
            )
        return
    stated = message.get("version")
    if stated is None:
        raise A2uiValidationError(
            f"Message {index} states no version, which {protocol_version.value}"
            " messages require."
        )
    if not isinstance(stated, str) or stated not in accepted:
        raise A2uiValidationError(
            f"Message {index} states version {stated!r}, but the catalogs target"
            f" {protocol_version.value}, whose messages state"
            f" {' or '.join(repr(v) for v in sorted(accepted))}."
        )


def _target(message: Mapping[str, Any]) -> tuple[str | None, bool]:
    """Returns the surface that a message targets and whether it creates it."""
    for creates, actions in ((True, _CREATE_ACTIONS), (False, _UPDATE_ACTIONS)):
        for action in actions:
            body = message.get(action)
            if isinstance(body, Mapping) and isinstance(body.get("surfaceId"), str):
                return body["surfaceId"], creates
    return None, False


def _begin_rendering_first(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Moves each surface's first `beginRendering` ahead of its other messages.

    A v0.8 renderer buffers the components and data that arrive before
    `beginRendering`, so a surface's updates may precede it.
    """
    first_creation: dict[str, int] = {}
    for index, message in enumerate(messages):
        surface_id, creates = _target(message)
        if creates and surface_id is not None:
            first_creation.setdefault(surface_id, index)

    reordered: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, message in enumerate(messages):
        surface_id, _ = _target(message)
        if surface_id is not None and surface_id in first_creation:
            if surface_id not in seen:
                seen.add(surface_id)
                reordered.append(messages[first_creation[surface_id]])
            if index == first_creation[surface_id]:
                continue
        reordered.append(message)
    return reordered


def _check_updated_surface(
    catalogs: Sequence[CatalogApi],
    protocol_version: ProtocolVersion,
    surface_id: str,
    messages: list[dict[str, Any]],
) -> None:
    """Checks the messages for a surface that the payload doesn't create.

    The surface is created empty on each catalog that defines every component
    the messages add to it, until one accepts the messages. If none does, the
    error from the first is raised.
    """
    component_types = _component_types(messages)
    candidates = [
        catalog
        for catalog in catalogs
        if all(catalog.get_component(name) is not None for name in component_types)
    ] or [catalogs[0]]

    errors: list[A2uiValidationError] = []
    for catalog in candidates:
        if protocol_version is ProtocolVersion.V0_8:
            creation: dict[str, Any] = {
                "beginRendering": {
                    "surfaceId": surface_id,
                    "root": "root",
                    "catalogId": catalog.catalog_id,
                }
            }
        else:
            creation = {
                "version": messages[0]["version"],
                "createSurface": {
                    "surfaceId": surface_id,
                    "catalogId": catalog.catalog_id,
                },
            }
        try:
            _process(catalogs, [creation, *messages], _UPDATED_SURFACE_VALIDATION)
            return
        except A2uiValidationError as e:
            errors.append(e)
    raise errors[0]


def _component_types(messages: list[dict[str, Any]]) -> set[str]:
    """Returns the component types that messages add to their surface.

    Components that name a catalog of their own are left out, since they don't
    use the surface's catalog.
    """
    component_types: set[str] = set()
    for message in messages:
        for action in ("updateComponents", "surfaceUpdate"):
            body = message.get(action)
            components = body.get("components") if isinstance(body, Mapping) else None
            if not isinstance(components, list):
                continue
            for component in components:
                if not isinstance(component, Mapping) or "catalogId" in component:
                    continue
                component_type = component.get("component")
                if isinstance(component_type, str):
                    component_types.add(component_type)
                elif isinstance(component_type, Mapping):
                    # A v0.8 component is keyed by its type.
                    component_types.update(
                        name for name in component_type if isinstance(name, str)
                    )
    return component_types


def _process(
    catalogs: Sequence[CatalogApi],
    messages: list[dict[str, Any]],
    validation_config: ValidationConfig,
) -> None:
    """Runs messages through a new processor that holds the catalogs.

    Raises:
      A2uiValidationError: If the processor rejects a message. Errors of other
        kinds, such as a catalog that the payload names but the processor
        doesn't hold, are raised as validation errors too, since they come from
        the payload.
    """
    processor = MessageProcessor(
        catalogs,
        options=MessageProcessorOptions(validation_config=validation_config),
    )
    try:
        processor.process_messages(messages)
    except A2uiValidationError:
        raise
    except A2uiError as e:
        raise A2uiValidationError(str(e), details=e.details) from e
