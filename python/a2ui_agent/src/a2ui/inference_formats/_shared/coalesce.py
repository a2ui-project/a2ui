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

"""Groups split surface messages into the units that compact formats decompile."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser import to_message_dicts

_CREATE = "createSurface"
_UPDATE_COMPONENTS = "updateComponents"
_UPDATE_DATA = "updateDataModel"
_DELETE = "deleteSurface"
_SURFACE_OPERATIONS = (_CREATE, _UPDATE_COMPONENTS, _UPDATE_DATA, _DELETE)


@dataclass(frozen=True)
class CoalescedMessage:
    """One unit of a coalesced payload, with the context needed to decompile it.

    Attributes:
        message: A wire-format message dict. A `createSurface` body may carry
            `components` and `dataModel` merged in from the messages that
            followed it (see `coalesce_surface_messages`); every other message
            is copied unchanged.
        surface_catalog_id: For a surface operation, the `catalogId` of the
            `createSurface` for that surface earlier in the same payload (for a
            `createSurface`, its own `catalogId`). None when the payload does
            not create the surface, in which case the surface was created by an
            earlier payload and its catalog is not known from this one.
    """

    message: dict[str, Any]
    surface_catalog_id: str | None = None

    @property
    def operation(self) -> str | None:
        """The surface operation key of the message, or None for other messages."""
        for key in _SURFACE_OPERATIONS:
            if key in self.message:
                return key
        return None

    @property
    def surface_id(self) -> str | None:
        """The surface the message targets, or None for non-surface messages."""
        op = self.operation
        if op is None:
            return None
        body = self.message.get(op)
        return body.get("surfaceId") if isinstance(body, Mapping) else None

    @property
    def is_update(self) -> bool:
        """Whether the message updates an existing surface instead of creating one.

        True for every `updateComponents` and `updateDataModel` left in the
        coalesced output. A decompiler must render such a message as an
        explicit update of `surface_id`, never as a new surface.
        """
        return self.operation in (_UPDATE_COMPONENTS, _UPDATE_DATA)


def _is_root_path(path: Any) -> bool:
    return path is None or path in ("", "/")


def coalesce_surface_messages(
    messages: (
        Sequence[AgentToRendererMessage | Mapping[str, Any]]
        | AgentToRendererMessage
        | Mapping[str, Any]
    ),
) -> list[CoalescedMessage]:
    """Merges split surface messages into create units, keeping updates as updates.

    v0.9-style payloads split a surface's creation into a `createSurface`, an
    `updateComponents` and an `updateDataModel`. Compact formats render a
    surface as one block, so this function folds the follow-up messages into
    the `createSurface` while that does not change what the payload means.

    Contract:

    - A `createSurface` is *open* from where it appears until a message for the
      same surface cannot be merged into it, another `createSurface` or a
      `deleteSurface` for that surface arrives, or a message that is not a
      surface operation (such as `callRendererFunction`) appears.
    - An `updateComponents` for a surface with an open `createSurface` that has
      no `components` yet is merged into it as its `components`.
    - A root `updateDataModel` (`path` absent, `""` or `"/"`) with an object
      `value` for a surface with an open `createSurface` replaces that create's
      `dataModel`, as the update would replace the whole data model.
    - Every other message is kept, in order, unchanged. A `createSurface` is
      never dropped. An `updateComponents` or `updateDataModel` that is kept is
      an incremental update of an existing surface
      (`CoalescedMessage.is_update`).
    - Each surface operation carries `surface_catalog_id`, the catalog of the
      surface's `createSurface` earlier in the payload, so that a decompiler
      resolves an update's components against the surface's catalog.

    Args:
        messages: Wire-format message dicts or AgentToRendererMessage models,
            or a single message.

    Returns:
        The coalesced messages, in payload order.

    Raises:
        TypeError: If an item is neither a Mapping nor a message model.
    """
    result: list[dict[str, Any]] = []
    surface_ids: list[str | None] = []
    open_creates: dict[str, int] = {}

    for msg in to_message_dicts(messages):
        op = next(
            (k for k in _SURFACE_OPERATIONS if isinstance(msg.get(k), Mapping)), None
        )
        if op is None:
            # A message that is not a surface operation keeps its place
            # relative to every surface message around it.
            open_creates.clear()
            result.append(msg)
            surface_ids.append(None)
            continue

        body = dict(msg[op])
        msg[op] = body
        sid = body.get("surfaceId")
        open_idx = open_creates.get(sid) if isinstance(sid, str) else None

        if op == _CREATE:
            if isinstance(sid, str):
                open_creates[sid] = len(result)
            result.append(msg)
            surface_ids.append(sid)
            continue

        if open_idx is not None:
            create_body = result[open_idx][_CREATE]
            if op == _UPDATE_COMPONENTS and "components" not in create_body:
                create_body["components"] = body.get("components", [])
                continue
            if (
                op == _UPDATE_DATA
                and _is_root_path(body.get("path"))
                and isinstance(body.get("value"), Mapping)
            ):
                create_body["dataModel"] = dict(body["value"])
                continue
            del open_creates[sid]  # type: ignore[arg-type]

        if op == _DELETE and isinstance(sid, str):
            open_creates.pop(sid, None)
        result.append(msg)
        surface_ids.append(sid)

    coalesced: list[CoalescedMessage] = []
    seen_catalogs: dict[str, str] = {}
    for msg, sid in zip(result, surface_ids):
        if isinstance(sid, str) and _CREATE in msg:
            cat_id = msg[_CREATE].get("catalogId")
            if isinstance(cat_id, str) and cat_id:
                seen_catalogs[sid] = cat_id
            else:
                seen_catalogs.pop(sid, None)
        coalesced.append(
            CoalescedMessage(
                message=msg,
                surface_catalog_id=seen_catalogs.get(sid)
                if isinstance(sid, str)
                else None,
            )
        )
    return coalesced
