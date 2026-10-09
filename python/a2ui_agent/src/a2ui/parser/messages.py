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

"""Lossless conversion between A2UI message dicts and validated message models."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, TypeAdapter, ValidationError

from a2ui.core import A2uiValidationError
from a2ui.core.schema import AgentToRendererMessage

_MESSAGE_LIST_ADAPTER: TypeAdapter[list[AgentToRendererMessage]] = TypeAdapter(
    list[AgentToRendererMessage]
)

# Envelope keys of the messages that, from v0.9 on, carry a `version` field.
_VERSIONED_OPERATION_KEYS = (
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callFunction",
    "callRendererFunction",
)
_V08_OPERATION_KEYS = ("beginRendering", "surfaceUpdate", "dataModelUpdate")
_SURFACE_OPERATION_KEYS = (
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
)


def _as_items(
    messages: (
        Sequence[AgentToRendererMessage | Mapping[str, Any]]
        | AgentToRendererMessage
        | Mapping[str, Any]
    ),
) -> list[Any]:
    if isinstance(messages, (Mapping, BaseModel)):
        return [messages]
    if isinstance(messages, (str, bytes)) or not isinstance(messages, Sequence):
        raise TypeError(
            "Expected an AgentToRendererMessage, a Mapping, or a Sequence of them,"
            f" got {type(messages).__name__}."
        )
    return list(messages)


def to_message_models(
    messages: (
        Sequence[AgentToRendererMessage | Mapping[str, Any]]
        | AgentToRendererMessage
        | Mapping[str, Any]
    ),
) -> list[AgentToRendererMessage]:
    """Validates message dicts or models into AgentToRendererMessage models.

    The conversion is lossless: it adds no field the input does not have, so a
    message without a `version`, `surfaceId` or `catalogId` that its schema
    requires fails validation rather than receiving a default.

    Args:
        messages: One message, or a sequence of messages, as wire-format dicts
            or AgentToRendererMessage models.

    Returns:
        The validated messages, in input order.

    Raises:
        A2uiValidationError: If a message does not match any protocol version's
            message schema.
        TypeError: If `messages` is neither a message nor a sequence of them.
    """
    items = _as_items(messages)
    try:
        return _MESSAGE_LIST_ADAPTER.validate_python(items)
    except ValidationError as e:
        raise A2uiValidationError(f"Invalid A2UI message payload: {e}") from e


def _message_to_dict(msg: AgentToRendererMessage | Mapping[str, Any]) -> dict[str, Any]:
    """Converts a single message model or dict into a wire-format dict."""
    if isinstance(msg, BaseModel):
        d = msg.model_dump(mode="json", by_alias=True, exclude_unset=True)
        version = getattr(msg, "version", None)
        if version == "v0.8":
            # v0.8 messages carry no `version` on the wire, even when a caller
            # set the model's constant explicitly.
            d.pop("version", None)
        elif version is not None and "version" not in d:
            # `version` is a constant with a default, so a model built without
            # it leaves it unset. v0.9 and later messages require it on the
            # wire.
            d = {"version": version, **d}
        return d
    if isinstance(msg, Mapping):
        return dict(msg)
    raise TypeError(
        f"Expected an AgentToRendererMessage or Mapping, got {type(msg).__name__}."
    )


def to_message_dicts(
    messages: (
        Sequence[AgentToRendererMessage | Mapping[str, Any]]
        | AgentToRendererMessage
        | Mapping[str, Any]
    ),
) -> list[dict[str, Any]]:
    """Converts message models (or dicts) into wire-format message dicts.

    The conversion is lossless: only the fields that were set on a model are
    emitted, by their wire alias (v1.0 keeps `@call` and `@path`), and an
    explicitly set `null`, such as an `updateDataModel` value of `null`, is
    kept. Mappings are copied unchanged.

    Args:
        messages: One message, or a sequence of messages.

    Returns:
        The messages as wire-format dicts, in input order.

    Raises:
        TypeError: If an item is neither a message model nor a Mapping.
    """
    return [_message_to_dict(item) for item in _as_items(messages)]


def normalize_prompt_example_messages(
    messages: Sequence[Mapping[str, Any]] | Mapping[str, Any],
    *,
    version: str,
    default_catalog_id: str | None,
    default_surface_id: str = "main",
) -> list[AgentToRendererMessage]:
    """Fills in the fields that catalog prompt examples leave out, then validates.

    Catalog examples are often written without the envelope fields that the
    wire format requires. This helper is meant only for turning such examples
    into models for prompt rendering; it is not a general converter. It:

    - writes a bare numeric `version` such as `"0.9"` as `"v0.9"`, and stamps
      `version` on a v0.9+ shaped message that has none;
    - gives surface operations a `surfaceId` of `default_surface_id`, and a
      `createSurface` without a `catalogId` the `default_catalog_id`, if any;
    - turns a top-level `callFunction` into a `callRendererFunction`, with the
      default catalog and a `functionCallId` of `"call_1"` when missing.

    Args:
        messages: The example messages.
        version: The protocol version to stamp on a message that has none,
            normally the version that the catalogs target.
        default_catalog_id: The catalog to assign when an example names none,
            or None to leave `catalogId` unset (with several catalogs, the
            surface has no default catalog).
        default_surface_id: The surface to assign when an example names none.

    Returns:
        The validated messages.

    Raises:
        A2uiValidationError: If an example is still invalid once filled in.
    """
    items = [messages] if isinstance(messages, Mapping) else list(messages)
    normalized: list[Any] = []
    for item in items:
        if not isinstance(item, Mapping):
            normalized.append(item)
            continue
        d = dict(item)
        if "version" in d:
            v = d["version"]
            if v is None or not v:
                raise A2uiValidationError("Version cannot be None or empty.")
            v_str = str(v)
            if v_str and v_str[0].isdigit():
                d["version"] = f"v{v_str}"
        if (
            "version" not in d
            and not any(k in d for k in _V08_OPERATION_KEYS)
            and any(k in d for k in _VERSIONED_OPERATION_KEYS)
        ):
            d["version"] = version
        for k in _SURFACE_OPERATION_KEYS:
            if k in d and isinstance(d[k], Mapping):
                sub = dict(d[k])
                sub.setdefault("surfaceId", default_surface_id)
                if (
                    k == "createSurface"
                    and not sub.get("catalogId")
                    and default_catalog_id is not None
                ):
                    sub["catalogId"] = default_catalog_id
                d[k] = sub
        if "callFunction" in d and "callRendererFunction" not in d:
            cf = d.pop("callFunction")
            if isinstance(cf, Mapping):
                cf_norm = dict(cf)
                if default_catalog_id is not None:
                    cf_norm.setdefault("catalogId", default_catalog_id)
                d["callRendererFunction"] = {
                    "functionCallId": str(d.pop("functionCallId", "call_1")),
                    "callFunction": cf_norm,
                }
        normalized.append(d)
    return to_message_models(normalized)
