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

"""The agent's mirror of a renderer's surfaces, and the payload check on it."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence
import contextlib
import copy
import dataclasses
from typing import Any, ClassVar, TypeAlias, cast

from pydantic import BaseModel

from a2ui.core import (
    A2uiCatalogError,
    A2uiError,
    A2uiIntegrityError,
    A2uiValidationError,
    CatalogApi,
    ComponentModel,
    DataModel,
    MessageProcessor,
    MessageProcessorOptions,
    STRICT_VALIDATION,
    SurfaceModel,
    ValidationConfig,
    link_catalogs,
)
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import (
    AgentToRendererMessage,
    AgentToRendererMessagePayload,
    ProtocolVersion,
)
from a2ui.core.validation import analyze_topology, validate_component_integrity

__all__ = [
    "RendererState",
    "validate_payload",
]

_MessagePayload: TypeAlias = (
    AgentToRendererMessagePayload | Iterable[AgentToRendererMessage | Mapping[str, Any]]
)

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

# Messages are applied one at a time, and a component may name a child that a
# later message adds, so references, the root and reachability are left to
# `RendererState.check_topology`. Unlike `RELAXED_VALIDATION`, unknown
# components are still rejected.
_IN_PROGRESS_VALIDATION = ValidationConfig(
    allow_dangling_references=True,
    allow_missing_root=True,
    allow_orphan_components=True,
)


@dataclasses.dataclass(frozen=True)
class _SurfaceSnapshot:
    """A surface as it was before a frame first changed it."""

    surface: SurfaceModel | None
    assumed: bool
    pending: tuple[dict[str, Any], ...] | None
    changed: frozenset[str] | None


@dataclasses.dataclass
class _Frame:
    """What a failed `apply` or transaction restores."""

    surfaces: dict[str, _SurfaceSnapshot] = dataclasses.field(default_factory=dict)


class RendererState:
    """The agent's mirror of the surfaces a renderer holds.

    The state wraps one `MessageProcessor` and runs the agent's outbound
    messages through it, so a message is checked against everything the
    renderer has already received: a reference resolves against the components
    earlier messages added, and a cycle is found across the whole surface.

    How long a state lives is the one difference between the two ways an agent
    shows UI:

    - In a chat, each turn shows new UI, so each turn uses a new state. A
      parser makes one when it is given none.
    - In a canvas, turns update the same surfaces, so one state lives for the
      whole conversation and every turn is parsed against it.

    A message is applied when it is sent. `apply` is atomic: if a message is
    rejected, the state is left as it was before the call. `transaction`
    extends that to several calls, which is how a response parsed whole is
    applied all or nothing. A streamed response cannot be rolled back, since
    the renderer has already received what was emitted.

    The state holds the surfaces as they now stand, not the messages that
    built them.

    An update to a surface the state never saw created is rejected, as the
    renderer would reject it. A v0.8 renderer buffers the updates that arrive
    before `beginRendering`, so v0.8 updates are accepted and checked again
    once the surface begins rendering.

    The state is authoritative for surfaces and their components. The data
    model values it holds can drift from the renderer's, since the user edits
    bound inputs there, but no check depends on them.
    """

    # Whether an update to a surface the state never saw created makes an
    # empty placeholder for it instead of being rejected. Only a state that
    # checks one payload on its own, with no record of earlier ones, sets it.
    _assumes_unknown_surfaces: ClassVar[bool] = False

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
    ) -> None:
        """Creates the empty state of a renderer that holds the catalogs.

        Args:
          catalogs: The active catalogs, which must target compatible protocol
            versions. Each surface is checked against the catalog its
            `catalogId` names. A v0.8 surface that names none uses the first
            catalog.

        Raises:
          A2uiCatalogError: If no catalogs are given, or if their messages
            state different versions, for example v0.9 and v1.0 catalogs.
        """
        if not catalogs:
            raise A2uiCatalogError("A renderer state requires at least one catalog.")
        catalogs = link_catalogs(catalogs)
        protocol_version = to_protocol_version(catalogs[0].protocol_version)
        for catalog in catalogs[1:]:
            other_version = to_protocol_version(catalog.protocol_version)
            if _MESSAGE_VERSIONS[other_version] != _MESSAGE_VERSIONS[protocol_version]:
                raise A2uiCatalogError(
                    "The catalogs target incompatible protocol versions:"
                    f" '{catalogs[0].catalog_id}' targets {protocol_version.value} and"
                    f" '{catalog.catalog_id}' targets {other_version.value}."
                )
        self._catalogs = catalogs
        self._protocol_version = protocol_version
        self._processor = MessageProcessor(
            self._catalogs,
            options=MessageProcessorOptions(validation_config=_IN_PROGRESS_VALIDATION),
        )
        self._assumed: set[str] = set()
        # The updates a v0.8 placeholder surface buffers until its
        # `beginRendering` arrives.
        self._pending: dict[str, list[dict[str, Any]]] = {}
        # The components each surface added or replaced since its tree was
        # last checked.
        self._changed: dict[str, set[str]] = {}
        self._frames: list[_Frame] = []

    @property
    def catalogs(self) -> list[CatalogApi]:
        """The active catalogs in priority order."""
        return list(self._catalogs)

    @property
    def surface_ids(self) -> list[str]:
        """The ids of the surfaces the renderer holds."""
        return list(self._processor.model.surfaces)

    def get_surface(self, surface_id: str) -> SurfaceModel | None:
        """Returns the surface with the id, or None. Callers must not modify it."""
        return self._processor.model.get_surface(surface_id)

    def apply(self, payload: _MessagePayload) -> list[str]:
        """Checks the messages against the state and applies them.

        Each message must state a `version` that the catalogs' protocol
        version accepts: none for v0.8, `v0.9` or `v0.9.1` for v0.9 and
        v0.9.1, and `v1.0` for v1.0. Each component and function call is
        checked against the catalog it resolves to, and component ids and
        cycles against the surface's components. References, the root and
        reachability are left to `check_topology`, since a component may name a
        child that a later message adds.

        The call is atomic: if a message is rejected, none of them is applied.

        Args:
          payload: One message or an iterable of messages, as parsed JSON
            mappings or typed schema models, which may be mixed.

        Returns:
          The ids of the surfaces the messages create, update or delete, in the
          order the messages first name them.

        Raises:
          A2uiValidationError: If a renderer in this state would reject a
            message. The error, or a subclass such as `A2uiIntegrityError`,
            describes the first problem found.
        """
        messages = _extract_messages(payload)
        for index, message in enumerate(messages):
            _check_message(message, index, self._protocol_version)
        touched: dict[str, None] = {}
        with self._frame():
            for index in range(len(messages)):
                surface_id = self._apply_message(messages, index)
                if surface_id is not None:
                    touched[surface_id] = None
        return list(touched)

    def check_topology(self, surface_ids: Iterable[str]) -> None:
        """Checks the whole tree of each surface.

        The surface must have its root, and every reference must resolve.
        Every component added or replaced since the surface's tree was last
        checked must be reachable from the root, within the depth limit. A
        component that an update left unreachable, by rewriting its parent's
        children, is accepted: the protocol has no message that removes one
        component, so replacing part of a canvas always leaves such
        components behind. A surface with no components yet passes, since its
        components may arrive later. Surfaces that are deleted or assumed are
        skipped.

        Cycles are already rejected when each message is applied, so the tree
        is walked once, from the root, to find what it reaches.

        Raises:
          A2uiValidationError: If a surface's tree is incomplete or invalid.
        """
        surface_ids = list(dict.fromkeys(surface_ids))
        for surface_id in surface_ids:
            if surface_id in self._assumed:
                continue
            surface = self._processor.model.get_surface(surface_id)
            if surface is None:
                continue
            components = surface.components_model.get_all()
            if not components:
                continue
            root_id = surface.root_id or STRICT_VALIDATION.root_id
            config = STRICT_VALIDATION.model_copy(
                update={"root_id": root_id, "allow_orphan_components": True}
            )
            with _as_validation_error():
                validate_component_integrity(components, root_id=root_id, config=config)
                # One walk from the root, which returns what it reached.
                reachable = analyze_topology(components, root_id=root_id, config=config)
            unreachable = sorted(
                self._changed.get(surface_id, set()) & (set(components) - reachable)
            )
            if unreachable:
                raise A2uiIntegrityError(
                    f"Component '{unreachable[0]}' is not reachable from '{root_id}'"
                )
        for surface_id in surface_ids:
            if self._changed.get(surface_id):
                self._save(surface_id)
                self._changed.pop(surface_id, None)

    @contextlib.contextmanager
    def transaction(self) -> Iterator[RendererState]:
        """Applies everything inside the block atomically.

        If the block raises, the state is restored to what it was when the
        block started, and the error propagates.
        """
        with self._frame():
            yield self

    @contextlib.contextmanager
    def _frame(self) -> Iterator[None]:
        frame = _Frame()
        self._frames.append(frame)
        try:
            yield
        except BaseException:
            self._rollback(frame)
            raise
        finally:
            self._frames.pop()

    def _rollback(self, frame: _Frame) -> None:
        model = self._processor.model
        for surface_id, snapshot in frame.surfaces.items():
            model.delete_surface(surface_id)
            if snapshot.surface is not None:
                # The snapshot may be shared with an outer frame, so a copy of
                # it goes live and the snapshot itself stays as it was.
                model.add_surface(_clone_surface(snapshot.surface))
            if snapshot.assumed:
                self._assumed.add(surface_id)
            else:
                self._assumed.discard(surface_id)
            if snapshot.pending is None:
                self._pending.pop(surface_id, None)
            else:
                self._pending[surface_id] = list(snapshot.pending)
            if snapshot.changed is None:
                self._changed.pop(surface_id, None)
            else:
                self._changed[surface_id] = set(snapshot.changed)

    def _save(self, surface_id: str) -> None:
        """Snapshots a surface for every open frame, before the surface changes."""
        frames = [f for f in self._frames if surface_id not in f.surfaces]
        if not frames:
            return
        surface = self._processor.model.get_surface(surface_id)
        pending = self._pending.get(surface_id)
        changed = self._changed.get(surface_id)
        snapshot = _SurfaceSnapshot(
            surface=_clone_surface(surface) if surface is not None else None,
            assumed=surface_id in self._assumed,
            pending=tuple(pending) if pending is not None else None,
            changed=frozenset(changed) if changed is not None else None,
        )
        for frame in frames:
            frame.surfaces[surface_id] = snapshot

    def _process(self, messages: list[dict[str, Any]]) -> None:
        """Runs messages through the processor."""
        with _as_validation_error():
            self._processor.process_messages(messages)

    def _apply_message(self, payload: list[dict[str, Any]], index: int) -> str | None:
        """Applies the message at an index and returns the surface it targets."""
        message = payload[index]
        surface_id, creates = _target(message)
        if surface_id is None:
            self._process([message])
            return None

        self._save(surface_id)
        model = self._processor.model
        if creates:
            pending = self._pending.pop(surface_id, None)
            if pending is not None:
                # A v0.8 renderer applies the updates it buffered for the
                # surface once `beginRendering` arrives.
                model.delete_surface(surface_id)
                self._assumed.discard(surface_id)
                self._process([message, *pending])
            else:
                self._process([message])
        elif "deleteSurface" in message:
            self._process([message])
            self._assumed.discard(surface_id)
            self._pending.pop(surface_id, None)
            self._changed.pop(surface_id, None)
        elif model.get_surface(surface_id) is None and self._assumes(
            surface_id, payload, index
        ):
            self._assume_surface(surface_id, payload, index)
        else:
            self._process([message])
            pending = self._pending.get(surface_id)
            if pending is not None:
                pending.append(message)
        if "deleteSurface" not in message:
            self._changed.setdefault(surface_id, set()).update(_component_ids(message))
        return surface_id

    def _assumes(
        self, surface_id: str, payload: list[dict[str, Any]], index: int
    ) -> bool:
        """Whether an update to a surface the state lacks assumes the surface.

        A v0.8 renderer buffers updates to a surface until its
        `beginRendering`, even after the surface is deleted. A payload state
        assumes a surface the payload never named before, but not one that an
        earlier message of the payload deleted: a renderer rejects updates to
        it.
        """
        if self._protocol_version is ProtocolVersion.V0_8:
            return True
        return self._assumes_unknown_surfaces and all(
            _target(m)[0] != surface_id for m in payload[:index]
        )

    def _assume_surface(
        self, surface_id: str, payload: list[dict[str, Any]], index: int
    ) -> None:
        """Creates a placeholder for an unknown surface and applies the update.

        The updates to the surface are the message at `index` and the messages
        after it that update the surface, up to one that creates or deletes
        it. The surface is created on each catalog that defines every
        component those updates add, until one accepts all of them, so a later
        update can rule out a catalog that the first one fits. If none does,
        the error from the first is raised. Only the first update is applied
        here; the others are applied in turn.
        """
        message = payload[index]
        updates = _surface_updates(surface_id, payload, index)
        errors: list[A2uiValidationError] = []
        for catalog in self._placeholder_catalogs(surface_id, updates):
            placeholder = self._placeholder(surface_id, catalog, message)
            try:
                self._process([placeholder, *updates])
            except A2uiValidationError as e:
                errors.append(e)
                continue
            finally:
                self._processor.model.delete_surface(surface_id)
            self._process([placeholder, message])
            self._assumed.add(surface_id)
            if self._protocol_version is ProtocolVersion.V0_8:
                self._pending[surface_id] = [message]
            return
        raise errors[0]

    def _placeholder_catalogs(
        self, surface_id: str, updates: list[dict[str, Any]]
    ) -> list[CatalogApi]:
        """The catalogs to try a placeholder for an unknown surface on, in order.

        Args:
          surface_id: The surface.
          updates: The updates to the surface that the placeholder must accept.
        """
        component_types = _component_types(updates)
        return [
            catalog
            for catalog in self._catalogs
            if all(catalog.get_component(name) is not None for name in component_types)
        ] or [self._catalogs[0]]

    def _placeholder(
        self, surface_id: str, catalog: CatalogApi, message: Mapping[str, Any]
    ) -> dict[str, Any]:
        """The message that creates an empty placeholder surface on a catalog."""
        if self._protocol_version is ProtocolVersion.V0_8:
            return {
                "beginRendering": {
                    "surfaceId": surface_id,
                    "root": STRICT_VALIDATION.root_id,
                    "catalogId": catalog.catalog_id,
                }
            }
        return {
            "version": message["version"],
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": catalog.catalog_id,
            },
        }


class _PayloadState(RendererState):
    """The state of a renderer that `validate_payload` knows nothing about.

    A surface the payload updates without creating is assumed to exist,
    holding components the check never saw. The state creates an empty
    placeholder for it, on the first catalog that defines the components of
    the payload's updates to it and accepts all of them. A surface that an
    earlier message of the payload deleted is not assumed again. Each
    component is still checked against that catalog, but the surface's tree
    is not: references to components outside the payload, a missing root and
    unreachable components are accepted there.
    """

    _assumes_unknown_surfaces = True


def validate_payload(
    catalogs: Sequence[CatalogApi],
    payload: _MessagePayload,
) -> None:
    """Checks a payload the way a renderer holding the catalogs would.

    The check is stateless: it sees one payload, with no record of what earlier
    payloads sent. A surface that the payload creates, with
    `createSurface` or the v0.8 `beginRendering`, is checked in full, so its
    components must be valid and reachable from the root, and their references
    must resolve once every message in the payload is applied: a component may
    name a child that a later message adds. A surface that the payload only
    updates may already hold components, so references to components outside
    the payload and a missing root are accepted there. Each of its components
    is still checked against a catalog that defines all of them, and the
    surface passes if one such catalog accepts it.

    To check a payload against what earlier payloads sent, keep a
    `RendererState` and call its `apply` and `check_topology` instead.

    Each message must state a `version` that the catalogs' protocol version
    accepts, spelled as the specification spells it: none for v0.8, `v0.9` or
    `v0.9.1` for v0.9 and v0.9.1, and `v1.0` for v1.0.

    Args:
      catalogs: The active catalogs, which must target compatible protocol
        versions. Each surface is checked against the catalog its `catalogId`
        names. A v0.8 surface that names none uses the first catalog.
      payload: One message or an iterable of messages, as parsed JSON mappings
        or typed schema models.

    Raises:
      A2uiValidationError: If a renderer holding the catalogs would reject the
        payload. The error, or a subclass such as `A2uiIntegrityError`,
        describes the first problem found.
      A2uiCatalogError: If no catalogs are given, or if their messages state
        different versions, for example v0.9 and v1.0 catalogs.
    """
    state = _PayloadState(catalogs)
    state.check_topology(state.apply(payload))


@contextlib.contextmanager
def _as_validation_error() -> Iterator[None]:
    """Raises the core's errors as validation errors.

    Errors of other kinds, such as a catalog that a message names but the
    processor doesn't hold, come from the payload too.
    """
    try:
        yield
    except A2uiValidationError:
        raise
    except A2uiError as e:
        raise A2uiValidationError(str(e), details=e.details) from e


def _clone_surface(surface: SurfaceModel) -> SurfaceModel:
    """Copies a surface's state into a new surface that shares its catalogs.

    `ComponentModel` deep-copies the properties it is given, so the clone's
    components share no mutable state with the surface's.
    """
    clone = SurfaceModel(
        surface_id=surface.id,
        default_catalog=surface.default_catalog,
        available_catalogs=surface.available_catalogs,
        theme=copy.deepcopy(surface.theme),
        send_data_model=surface.send_data_model,
        data_model=DataModel(copy.deepcopy(surface.data_model.get("/"))),
        root_id=surface.root_id,
        protocol_version=surface.protocol_version,
    )
    for component in surface.components_model.values:
        clone.components_model.add_component(
            ComponentModel(
                component.id, component.type, component.catalog, component.properties
            )
        )
    return clone


def _extract_messages(payload: _MessagePayload) -> list[dict[str, Any]]:
    """Normalizes a payload into a list of message dictionaries.

    Message models are converted with `to_message_dicts`, so the check sees
    exactly the dictionaries that go on the wire. The conversion keeps an
    explicitly set `None`, since a `null` can be meaningful there (v1.0
    deletes a data model key with an `updateDataModel` value of `null`), so an
    optional field set to `None` is checked as `null` rather than dropped.
    """
    # Imported here: `a2ui.parser` builds on this module.
    from a2ui.parser import to_message_dicts

    raw: Any = payload
    if hasattr(raw, "model_dump") and isinstance(getattr(raw, "messages", None), list):
        raw = raw.messages
    raw_messages: Iterable[Any] = (
        [raw]
        if isinstance(raw, (BaseModel, Mapping, str, bytes))
        or not isinstance(raw, Iterable)
        else raw
    )
    messages: list[dict[str, Any]] = []
    for index, item in enumerate(raw_messages):
        if isinstance(item, BaseModel):
            item = to_message_dicts(cast(AgentToRendererMessage, item))[0]
        if not isinstance(item, Mapping):
            raise A2uiValidationError(f"Message {index} is not a JSON object.")
        messages.append(copy.deepcopy(dict(item)))
    return messages


def _check_message(
    message: Mapping[str, Any], index: int, protocol_version: ProtocolVersion
) -> None:
    """Raises if a message states the wrong version or adds no components."""
    _check_version(message, index, protocol_version)
    for action, components in _component_lists(message):
        if not components:
            raise A2uiValidationError(
                f"Message {index} ({action}) has an empty 'components' list."
            )


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


def _actions(message: Mapping[str, Any]) -> list[str]:
    """Returns the surface actions a message holds."""
    return [a for a in (*_CREATE_ACTIONS, *_UPDATE_ACTIONS) if a in message]


def _target(message: Mapping[str, Any]) -> tuple[str | None, bool]:
    """Returns the surface that a message targets and whether it creates it.

    A message that holds more than one action is malformed. It targets no
    surface, so the processor sees it as is and rejects it.
    """
    actions = _actions(message)
    if len(actions) != 1:
        return None, False
    action = actions[0]
    body = message[action]
    if isinstance(body, Mapping) and isinstance(body.get("surfaceId"), str):
        return body["surfaceId"], action in _CREATE_ACTIONS
    return None, False


def _surface_updates(
    surface_id: str, payload: list[dict[str, Any]], index: int
) -> list[dict[str, Any]]:
    """The updates to a surface from an index of a payload on.

    They end before the next message that creates or deletes the surface.
    """
    updates: list[dict[str, Any]] = []
    for message in payload[index:]:
        target, creates = _target(message)
        if target != surface_id:
            continue
        if updates and (creates or "deleteSurface" in message):
            break
        updates.append(message)
    return updates


def _component_lists(message: Mapping[str, Any]) -> list[tuple[str, list[Any]]]:
    """Returns each action of a message that holds components, with its list."""
    lists: list[tuple[str, list[Any]]] = []
    for action in ("createSurface", "updateComponents", "surfaceUpdate"):
        body = message.get(action)
        components = body.get("components") if isinstance(body, Mapping) else None
        if isinstance(components, list):
            lists.append((action, components))
    return lists


def _component_ids(message: Mapping[str, Any]) -> set[str]:
    """Returns the ids of the components a message adds or replaces."""
    return {
        c["id"]
        for _, components in _component_lists(message)
        for c in components
        if isinstance(c, Mapping) and isinstance(c.get("id"), str)
    }


def _component_types(messages: list[dict[str, Any]]) -> set[str]:
    """Returns the component types that messages add to their surface.

    Components that name a catalog of their own are left out, since they don't
    use the surface's catalog.
    """
    component_types: set[str] = set()
    for message in messages:
        for _, components in _component_lists(message):
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
