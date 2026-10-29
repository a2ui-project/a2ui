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

from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
import contextlib
import copy
import logging
import re
import sys
from typing import Any, ClassVar, TypeAlias, cast

from pydantic import BaseModel

from a2ui.core import (
    A2uiCatalogError,
    A2uiError,
    A2uiIntegrityError,
    A2uiValidationError,
    CatalogApi,
    ComponentModel,
    MessageProcessor,
    MessageProcessorOptions,
    STRICT_VALIDATION,
    SurfaceModel,
    ValidationConfig,
)
from a2ui.core.common import is_at_least_version, to_protocol_version
from a2ui.core.processing import (
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
    VersionAdapterFactory,
)
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
    ProtocolVersion.V1_0: frozenset({"1.0"}),
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


# Undoes one change to a state. The state's undo log is a list of these.
_Undo: TypeAlias = Callable[[], None]

_logger = logging.getLogger(__name__)

# A list index in a JSON Pointer, as `DataModel` reads one.
_INDEX = re.compile(r"^(?:0|[1-9][0-9]*)$")


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

    Rolling back costs what the undone messages changed, not the size of the
    surfaces they touched. The state keeps an undo log: each applied message
    records what it replaced (the components it added or replaced, with a
    copy of the properties of a component updated in place, and the data
    model value at its path), and so does each change to the state's own
    bookkeeping. A deleted surface is recorded whole and restored straight
    into the model. Components come back in their order, which checks such
    as `allowedParents` read. An `apply` or transaction is a position in the
    log, and a failed one reverts the log to its position, finishing even if
    one undo fails, so that the caller's error propagates.
    No surface is copied when a message is applied or a transaction opens.

    The state holds the surfaces as they now stand, not the messages that
    built them.

    An update to a surface the state never saw created is rejected, as the
    renderer would reject it. A v0.8 renderer buffers the updates that arrive
    before `beginRendering`, so v0.8 updates are accepted and checked again
    once the surface begins rendering. A v0.8 renderer also accepts a second
    `beginRendering` for a surface it holds, but the state rejects it, so a
    v0.8 canvas must begin each surface once.

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
        protocol_version = to_protocol_version(catalogs[0].protocol_version)
        for catalog in catalogs[1:]:
            other_version = to_protocol_version(catalog.protocol_version)
            if _MESSAGE_VERSIONS[other_version] != _MESSAGE_VERSIONS[protocol_version]:
                raise A2uiCatalogError(
                    "The catalogs target incompatible protocol versions:"
                    f" '{catalogs[0].catalog_id}' targets {protocol_version.value} and"
                    f" '{catalog.catalog_id}' targets {other_version.value}."
                )
        self._catalogs = list(catalogs)
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
        # What each change made inside an open `apply` or transaction
        # replaced, in the order of the changes. An `apply` or transaction is
        # a position in the log, and undoing one reverts the log to it.
        self._log: list[_Undo] = []
        self._open = 0

    @property
    def catalogs(self) -> list[CatalogApi]:
        """The active catalogs in priority order."""
        return list(self._catalogs)

    @property
    def surface_ids(self) -> list[str]:
        """The ids of the surfaces the renderer holds, in no particular order."""
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
        Undoing a rejected call costs what its messages changed, not the size
        of the surfaces they touched.

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
        components may arrive later. Surfaces that are deleted are skipped.

        A v0.8 surface whose updates are still buffered, waiting for its
        `beginRendering`, is rejected, as a v0.9 update to a surface that was
        never created is. `validate_payload` is the exception: it assumes such
        a surface and skips its tree.

        Cycles are already rejected when each message is applied, so the tree
        is walked once, from the root, to find what it reaches.

        Raises:
          A2uiValidationError: If a surface's tree is incomplete or invalid.
        """
        surface_ids = list(dict.fromkeys(surface_ids))
        for surface_id in surface_ids:
            if surface_id in self._assumed:
                if not self._assumes_unknown_surfaces:
                    raise A2uiIntegrityError(
                        f"Surface '{surface_id}' received updates but no"
                        " beginRendering."
                    )
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
        # An assumed surface was not checked, so what changed on it stays
        # recorded for the check after its v0.8 `beginRendering`.
        self.mark_checked(s for s in surface_ids if s not in self._assumed)

    def mark_checked(self, surface_ids: Iterable[str]) -> None:
        """Stops holding the components each surface changed against later checks.

        `check_topology` calls this for the surfaces it checks. A caller calls
        it for the surfaces of messages the renderer received that failed a
        check, such as a stream that failed after it emitted them: no message
        removes a component, so a component the renderer already holds can't
        be made reachable later, and the later turns are not held to it.
        Dangling references and a missing root are still reported, since
        `check_topology` checks those on the whole surface. Like any other
        change, it is undone when the transaction it was made in fails.
        """
        for surface_id in dict.fromkeys(surface_ids):
            self._forget_changed(surface_id)

    @contextlib.contextmanager
    def transaction(self) -> Iterator[RendererState]:
        """Applies everything inside the block atomically.

        If the block raises, the state is restored to what it was when the
        block started, and the error propagates. Opening a transaction copies
        nothing, and undoing one costs what was applied inside it.
        Transactions nest: an inner transaction that fails restores the state
        to where the inner one started.
        """
        with self._frame():
            yield self

    @contextlib.contextmanager
    def _frame(self) -> Iterator[None]:
        """Undoes what the block changed if it raises.

        The frame is a position in the undo log. A failure reverts the log to
        it, so a failed inner frame undoes only what was changed inside it.
        Once the outermost frame ends, nothing can be undone any more, and the
        log is cleared.
        """
        mark = len(self._log)
        self._open += 1
        try:
            yield
        except BaseException:
            self._revert(mark)
            raise
        finally:
            self._open -= 1
            if not self._open:
                self._log.clear()

    def _revert(self, mark: int) -> None:
        """Undoes the changes logged after a position, latest first.

        It never stops part way: an undo that fails is logged and skipped,
        and the others still run, so that the caller's error propagates
        rather than the undo's.
        """
        while len(self._log) > mark:
            _undo_now(self._log.pop())

    def _record(self, undo: _Undo) -> None:
        """Logs how to undo a change, if an `apply` or transaction is open."""
        if self._open:
            self._log.append(undo)

    # The state's own bookkeeping. Each change goes through one of these, so
    # that it is logged.

    def _set_assumed(self, surface_id: str, assumed: bool) -> None:
        was_assumed = surface_id in self._assumed
        if was_assumed == assumed:
            return
        if assumed:
            self._assumed.add(surface_id)
            self._record(lambda: self._assumed.discard(surface_id))
        else:
            self._assumed.discard(surface_id)
            self._record(lambda: self._assumed.add(surface_id))

    def _set_pending(
        self, surface_id: str, pending: list[dict[str, Any]] | None
    ) -> list[dict[str, Any]] | None:
        """Sets or clears a surface's v0.8 buffer and returns the one it had."""
        previous = self._pending.pop(surface_id, None)
        if pending is not None:
            self._pending[surface_id] = pending

        def undo() -> None:
            if previous is None:
                self._pending.pop(surface_id, None)
            else:
                self._pending[surface_id] = previous

        self._record(undo)
        return previous

    def _buffer(self, surface_id: str, message: dict[str, Any]) -> None:
        """Appends an update to a v0.8 surface's buffer."""
        pending = self._pending[surface_id]
        pending.append(message)
        self._record(lambda: _discard(pending.pop()))

    def _note_changed(self, surface_id: str, component_ids: set[str]) -> None:
        """Records components a surface added or replaced since its last check."""
        changed = self._changed.get(surface_id)
        if changed is None:
            changed = self._changed[surface_id] = set()
            self._record(lambda: _discard(self._changed.pop(surface_id, None)))
        added = component_ids - changed
        if added:
            changed.update(added)
            self._record(lambda: changed.difference_update(added))

    def _forget_changed(self, surface_id: str) -> None:
        """Stops holding what a surface changed against its next check."""
        changed = self._changed.pop(surface_id, None)
        if changed is not None:
            self._record(lambda: self._changed.__setitem__(surface_id, changed))

    def _process(self, messages: list[dict[str, Any]], *, log: bool = True) -> None:
        """Runs messages through the processor, logging what each one replaces.

        Args:
          messages: The messages, which state one protocol version.
          log: False for a trial whose surface is deleted right after, which
            needs no undo.
        """
        with _as_validation_error():
            adapter = VersionAdapterFactory.resolve_from_payload(messages)
            for op in adapter.extract_operations(messages):
                if log:
                    self._process_operation(op)
                else:
                    self._processor.process_operation(op)

    def _process_operation(self, op: InternalOperation) -> None:
        """Applies one operation and logs how to undo it.

        The processor checks an operation before it changes a surface, so a
        rejected operation leaves nothing to undo. The exceptions are a
        `createSurface` whose components or data model are rejected after the
        surface is added, and a data model path that fails part way, so those
        are undone at once.
        """
        model = self._processor.model
        if isinstance(op, InternalCreateSurfaceOp):
            existed = model.get_surface(op.surface_id) is not None
            surface_id = op.surface_id

            def undo() -> None:
                model.delete_surface(surface_id)

            try:
                self._processor.process_operation(op)
            except BaseException:
                if not existed:
                    _undo_now(undo)
                raise
            self._record(undo)
        elif isinstance(op, InternalDeleteSurfaceOp):
            self._delete_surface(op.surface_id)
        elif isinstance(op, InternalUpdateComponentsOp):
            undo = self._components_undo(op)
            self._processor.process_operation(op)
            self._record(undo)
        elif isinstance(op, InternalUpdateDataModelOp):
            undo = self._data_model_undo(op)
            try:
                self._processor.process_operation(op)
            except BaseException:
                _undo_now(undo)
                raise
            self._record(undo)
        else:
            # Function calls and responses change no surface.
            self._processor.process_operation(op)

    def _components_undo(self, op: InternalUpdateComponentsOp) -> _Undo:
        """Records the components an `updateComponents` adds or replaces.

        The core updates a component in place when the update keeps its type
        and catalog, so the record holds a copy of the component's previous
        properties, not the object the update changes. An update that changes
        the type or catalog removes the component and adds the new one at the
        end, as a renderer does. The order matters to checks that read it
        (`allowedParents` takes a component's last parent in that order), so
        the record also holds the position of each component the update may
        replace. Finding it costs time in proportion to the surface, but only
        for such an update.
        """
        model = self._processor.model
        surface_id = op.surface_id
        surface = model.get_surface(surface_id)
        if surface is None:
            return lambda: None
        components_model = surface.components_model
        previous: dict[str, tuple[ComponentModel | None, dict[str, Any] | None]] = {}
        replaced: list[str] = []
        for comp in op.components:
            comp_id = comp.get("id") if isinstance(comp, Mapping) else None
            if not isinstance(comp_id, str) or comp_id in previous:
                continue
            existing = components_model.get(comp_id)
            properties = None
            if existing is not None:
                properties = copy.deepcopy(existing.properties)
                if _may_replace(surface, existing, comp):
                    replaced.append(comp_id)
            previous[comp_id] = (existing, properties)
        positions: dict[str, int] = {}
        if replaced:
            wanted = set(replaced)
            for position, comp_id in enumerate(components_model.keys):
                if comp_id in wanted:
                    positions[comp_id] = position

        def undo() -> None:
            # Found again by id: undoing a later delete restores the surface
            # into new objects.
            surface = model.get_surface(surface_id)
            if surface is None:
                return
            components_model = surface.components_model
            restored: list[tuple[int, ComponentModel]] = []
            for comp_id, (existing, properties) in previous.items():
                current = components_model.get(comp_id)
                if existing is None:
                    components_model.remove_component(comp_id)
                elif current is not None and _same_kind(current, existing):
                    current.properties = cast(dict[str, Any], properties)
                else:
                    # The update replaced the component with one of another
                    # type or catalog, and the core disposed of the old one.
                    components_model.remove_component(comp_id)
                    restored.append((
                        positions.get(comp_id, sys.maxsize),
                        ComponentModel(
                            comp_id, existing.type, existing.catalog, properties
                        ),
                    ))
            # The other components kept their order, so putting each one back
            # at its position, in the order of the positions, restores the
            # order before the update.
            restored.sort(key=lambda entry: entry[0])
            for position, component in restored:
                components_model.insert_component(position, component)

        return undo

    def _data_model_undo(self, op: InternalUpdateDataModelOp) -> _Undo:
        """Records the data model value an `updateDataModel` replaces.

        Setting a path creates the containers above it that are missing, and
        pads a list up to the index it sets, so the record is taken at the
        first segment of the path that does not exist yet, if any.
        """
        model = self._processor.model
        surface_id = op.surface_id
        surface = model.get_surface(surface_id)
        if surface is None:
            return lambda: None
        data_model = surface.data_model
        tokens = _pointer_tokens(op.path or "/")
        if not tokens:
            root = copy.deepcopy(data_model.get("/"))

            def undo() -> None:
                surface = model.get_surface(surface_id)
                if surface is not None:
                    surface.data_model.set("/", root)

            return undo
        parent: Any = data_model.get("/")
        for depth, token in enumerate(tokens):
            exists, child = _child(parent, token)
            if exists and depth < len(tokens) - 1 and isinstance(child, (dict, list)):
                parent = child
                continue
            if not isinstance(parent, (dict, list)):
                # Setting the path fails before it changes anything.
                break
            return _child_restorer(
                lambda: model.get_surface(surface_id),
                tokens[:depth],
                parent,
                token,
                exists,
                child,
                deletes=op.value is None and depth == len(tokens) - 1,
            )
        return lambda: None

    def _delete_surface(self, surface_id: str) -> None:
        """Deletes a surface, logging it whole.

        A deleted surface is the one change recorded whole. It is restored
        straight into the model, with each component's own catalog and in its
        order, rather than replayed through the processor, whose checks could
        reject a surface that many messages built, such as a data model deeper
        than one message may carry. The v0.8 buffer and the bookkeeping are
        restored by their own records.
        """
        model = self._processor.model
        surface = model.get_surface(surface_id)
        if surface is None:
            return
        restore = _surface_restorer(surface)
        model.delete_surface(surface_id)
        self._record(lambda: model.add_surface(restore()))

    def _apply_message(self, payload: list[dict[str, Any]], index: int) -> str | None:
        """Applies the message at an index and returns the surface it targets."""
        message = payload[index]
        surface_id, creates = _target(message)
        if surface_id is None:
            self._process([message])
            return None

        model = self._processor.model
        if creates:
            pending = self._set_pending(surface_id, None)
            if pending is not None:
                # A v0.8 renderer applies the updates it buffered for the
                # surface once `beginRendering` arrives.
                self._delete_surface(surface_id)
                self._set_assumed(surface_id, False)
                self._process([message, *pending])
            else:
                self._process([message])
        elif "deleteSurface" in message:
            self._process([message])
            self._set_assumed(surface_id, False)
            self._set_pending(surface_id, None)
            self._forget_changed(surface_id)
        elif model.get_surface(surface_id) is None and self._assumes(
            surface_id, payload, index
        ):
            self._assume_surface(surface_id, payload, index)
        else:
            self._process([message])
            if surface_id in self._pending:
                self._buffer(surface_id, message)
        if "deleteSurface" not in message:
            self._note_changed(surface_id, _component_ids(message))
        return surface_id

    def _assumes(
        self, surface_id: str, payload: list[dict[str, Any]], index: int
    ) -> bool:
        """Whether an update to a surface the state lacks assumes the surface.

        A v0.8 renderer buffers updates to a surface until its
        `beginRendering`, even after the surface is deleted. A payload state
        assumes a surface the payload never named before, but not one that an
        earlier message of the payload deleted, nor one that a later message
        creates before any message deletes it: a renderer rejects updates to
        either, since the surface does not exist yet when they arrive.
        """
        if self._protocol_version is ProtocolVersion.V0_8:
            return True
        if not self._assumes_unknown_surfaces:
            return False
        if any(_target(m)[0] == surface_id for m in payload[:index]):
            return False
        for later in payload[index + 1 :]:
            target, creates = _target(later)
            if target != surface_id:
                continue
            if creates:
                return False
            if "deleteSurface" in later:
                break
        return True

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
                # A trial: the surface is deleted right after, so nothing it
                # changes needs undoing.
                self._process([placeholder, *updates], log=False)
            except A2uiValidationError as e:
                errors.append(e)
                continue
            finally:
                self._processor.model.delete_surface(surface_id)
            self._process([placeholder, message])
            self._set_assumed(surface_id, True)
            if self._protocol_version is ProtocolVersion.V0_8:
                self._set_pending(surface_id, [message])
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
    A surface whose catalog the caller knows is created on that catalog only.
    """

    _assumes_unknown_surfaces = True

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        surface_catalog_ids: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(catalogs)
        self._surface_catalog_ids = dict(surface_catalog_ids or {})

    def _placeholder_catalogs(
        self, surface_id: str, updates: list[dict[str, Any]]
    ) -> list[CatalogApi]:
        catalog_id = self._surface_catalog_ids.get(surface_id)
        if catalog_id is None:
            return super()._placeholder_catalogs(surface_id, updates)
        candidates = [c for c in self.catalogs if c.catalog_id == catalog_id]
        if not candidates:
            raise A2uiValidationError(
                f"Surface '{surface_id}' uses catalog '{catalog_id}', which"
                " isn't one of the active catalogs."
            )
        return candidates


def validate_payload(
    catalogs: Sequence[CatalogApi],
    payload: _MessagePayload,
    *,
    surface_catalog_ids: Mapping[str, str] | None = None,
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
    surface passes if one such catalog accepts it. A caller that knows the
    catalog an earlier payload created the surface with passes it in
    `surface_catalog_ids`, and the surface is then checked against that
    catalog only.

    To check a payload against what earlier payloads sent, keep a
    `RendererState` and call its `apply` and `check_topology` inside
    `with state.transaction():`, so a rejected response is rolled back whole.

    Each message must state a `version` that the catalogs' protocol version
    accepts, spelled as the specification spells it: none for v0.8, `v0.9` or
    `v0.9.1` for v0.9 and v0.9.1, and `v1.0` for v1.0.

    Args:
      catalogs: The active catalogs, which must target compatible protocol
        versions. Each surface is checked against the catalog its `catalogId`
        names. A v0.8 surface that names none uses the first catalog.
      payload: One message or an iterable of messages, as parsed JSON mappings
        or typed schema models.
      surface_catalog_ids: The catalog ids that earlier payloads created
        surfaces with, keyed by surface id. A surface that the payload creates
        uses the catalog that the payload names instead.

    Raises:
      A2uiValidationError: If a renderer holding the catalogs would reject the
        payload. The error, or a subclass such as `A2uiIntegrityError`,
        describes the first problem found.
      A2uiCatalogError: If no catalogs are given, or if their messages state
        different versions, for example v0.9 and v1.0 catalogs.
    """
    state = _PayloadState(catalogs, surface_catalog_ids)
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


def _surface_restorer(surface: SurfaceModel) -> Callable[[], SurfaceModel]:
    """Returns how to build a surface again as it now stands.

    The properties, the theme and the data model are copied, since deleting
    the surface disposes of it. The data model root is restored whatever it
    is, including a falsy one such as `[]` or `0`. Nothing is checked again:
    the processor accepted all of it when it arrived.
    """
    surface_id = surface.id
    default_catalog = surface.default_catalog
    available_catalogs = dict(surface.available_catalogs)
    theme = copy.deepcopy(surface.theme)
    send_data_model = surface.send_data_model
    root_id = surface.root_id
    protocol_version = surface.protocol_version
    components = [
        (c.id, c.type, c.catalog, copy.deepcopy(c.properties))
        for c in surface.components_model.values
    ]
    data = copy.deepcopy(surface.data_model.get("/"))

    def restore() -> SurfaceModel:
        restored = SurfaceModel(
            surface_id=surface_id,
            default_catalog=default_catalog,
            available_catalogs=available_catalogs,
            theme=theme,
            send_data_model=send_data_model,
            root_id=root_id,
            protocol_version=protocol_version,
        )
        restored.data_model.set("/", data)
        for comp_id, comp_type, catalog, properties in components:
            restored.components_model.add_component(
                ComponentModel(comp_id, comp_type, catalog, properties)
            )
        return restored

    return restore


def _undo_now(undo: _Undo) -> None:
    """Runs one undo while an error propagates, logging the undo's own error.

    The caller re-raises the error that made it undo, so an undo that fails
    must not replace it, nor stop the undos after it.
    """
    try:
        undo()
    except Exception:  # pylint: disable=broad-exception-caught
        _logger.exception("A RendererState rollback step failed.")


def _discard(_: object) -> None:
    """Drops a value, so that an undo that pops returns nothing."""


def _may_replace(
    surface: SurfaceModel, existing: ComponentModel, update: Mapping[str, Any]
) -> bool:
    """Whether an update may replace a component rather than update it in place.

    The core replaces a component when the update changes its type or its
    catalog. This follows how the core resolves both, and errs toward True.
    """
    new_type = update.get("component")
    if new_type and new_type != existing.type:
        return True
    catalog_id = update.get("catalogId")
    if catalog_id is not None:
        return bool(catalog_id != existing.catalog.catalog_id)
    version = surface.protocol_version
    if not version or not is_at_least_version(version, ProtocolVersion.V1_0):
        # Before v1.0, an update that names no catalog keeps the component's.
        return False
    # From v1.0, it resolves to the surface's default catalog.
    return existing.catalog is not surface.default_catalog


def _same_kind(current: ComponentModel, previous: ComponentModel) -> bool:
    """Whether the core would update one component into the other in place."""
    return current.type == previous.type and current.catalog is previous.catalog


def _pointer_tokens(path: str) -> list[str]:
    """Splits a JSON Pointer into its unescaped segments, as `DataModel` does."""
    return [t.replace("~1", "/").replace("~0", "~") for t in path.split("/") if t]


def _child(container: Any, token: str) -> tuple[bool, Any]:
    """Returns whether a container holds a segment of a path, and its value."""
    if isinstance(container, dict):
        return token in container, container.get(token)
    if isinstance(container, list) and _INDEX.match(token):
        index = int(token)
        if index < len(container):
            return True, container[index]
    return False, None


def _child_restorer(
    get_surface: Callable[[], SurfaceModel | None],
    parent_tokens: list[str],
    parent: dict[str, Any] | list[Any],
    token: str,
    exists: bool,
    value: Any,
    *,
    deletes: bool = False,
) -> _Undo:
    """Returns how to restore one entry of a data model container.

    The undo finds the surface again by its id and the container by its
    path, since a change undone before it may have put a copy in its place.

    Args:
      get_surface: Returns the surface whose data model holds the container.
      parent_tokens: The path of the container.
      parent: The container now.
      token: The entry's key or list index.
      exists: Whether the container holds the entry now.
      value: The entry's value now, which is copied.
      deletes: Whether the change deletes the entry. A deleted key is put
        back at its position among its siblings, which is found now, at a
        cost in proportion to their number.
    """
    old_value = copy.deepcopy(value) if exists else None
    # Setting an index past the end pads the list up to it.
    length = len(parent) if isinstance(parent, list) else 0
    position = (
        list(parent).index(token)
        if deletes and exists and isinstance(parent, dict)
        else None
    )

    def undo() -> None:
        surface = get_surface()
        if surface is None:
            return
        container: Any = surface.data_model.get("/")
        for parent_token in parent_tokens:
            container = _child(container, parent_token)[1]
        if isinstance(container, dict):
            if position is not None and token not in container:
                _insert_key(container, position, token, old_value)
            elif exists:
                container[token] = old_value
            else:
                container.pop(token, None)
        elif isinstance(container, list):
            if exists:
                container[int(token)] = old_value
            else:
                del container[length:]

    return undo


def _insert_key(container: dict[str, Any], position: int, key: str, value: Any) -> None:
    """Adds a key to a dict at a position in its order, keeping the dict object."""
    entries = list(container.items())
    entries.insert(position, (key, value))
    container.clear()
    container.update(entries)


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
