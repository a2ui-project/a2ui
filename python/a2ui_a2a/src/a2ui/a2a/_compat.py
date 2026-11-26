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

"""Version-agnostic A2A Part / extension helpers for a2a-sdk 0.3.x and 1.x.

a2a-sdk 0.3 uses pydantic ``Part(root=DataPart|TextPart)``. a2a-sdk 1.x uses a
flat protobuf ``Part`` with a ``content`` oneof. ADK 2.x's ``[a2a]`` extra
accepts both generations; these helpers let A2UI do the same.

The installed generation decides which attributes ``a2a.types`` has, so the
version-specific code goes through ``_types`` and ``Any``: a static checker only
ever sees one of the two generations.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import math
from typing import Any

import a2a.types as _a2a_types
from a2a.types import AgentExtension, Message, Part

_types: Any = _a2a_types

# ``StreamResponse`` only exists in the protobuf-based 1.x types.
IS_A2A_V1 = hasattr(_types, "StreamResponse")


@dataclass(frozen=True)
class DataPartView:
    """The ``data`` and ``metadata`` of a 1.x data Part, read as plain dicts.

    It is a copy: changing its dicts doesn't change the Part.
    """

    data: dict[str, Any]
    metadata: dict[str, Any]


def _normalize_protobuf_numbers(value: Any) -> Any:
    """Turns the whole floats that ``MessageToDict`` returns back into ints.

    A protobuf ``Value`` holds every JSON number as a double, so ``3`` reads
    back as ``3.0`` on 1.x while 0.3 keeps it an ``int``. Integers beyond 2**53
    still lose precision, as in any JSON double.
    """
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _normalize_protobuf_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_protobuf_numbers(v) for v in value]
    return value


def _message_to_python(message: Any) -> Any:
    """Reads a protobuf ``Struct`` or ``Value`` as Python-native JSON values."""
    from google.protobuf.json_format import MessageToDict  # type: ignore[import-untyped,unused-ignore]

    return _normalize_protobuf_numbers(MessageToDict(message))


def _is_protobuf_message(value: Any) -> bool:
    # ``isinstance`` rather than ``hasattr(..., "DESCRIPTOR")``, which a mock
    # also satisfies.
    from google.protobuf.message import Message as ProtobufMessage  # type: ignore[import-untyped,unused-ignore]

    return isinstance(value, ProtobufMessage)


def _to_json_value(value: Any, path: str) -> Any:
    """Returns ``value`` as JSON values that a protobuf ``Struct`` can hold.

    Mappings become dicts and tuples become lists.

    Raises:
        ValueError: If ``value`` holds anything else, such as a non-finite float,
            a non-string key or an arbitrary object, so it isn't sent as its
            ``str()``.
    """
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        raise ValueError(f"Part metadata {path} is not a finite number: {value!r}.")
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for k, v in value.items():
            if not isinstance(k, str):
                raise ValueError(f"Part metadata {path} has a non-string key: {k!r}.")
            result[k] = _to_json_value(v, f"{path}.{k}")
        return result
    if isinstance(value, (list, tuple)):
        return [_to_json_value(v, f"{path}[{i}]") for i, v in enumerate(value)]
    raise ValueError(
        f"Part metadata {path} is not a JSON value: {type(value).__name__}."
    )


def make_text_part(text: str) -> Part:
    """Builds a text Part for the installed a2a-sdk generation."""
    if IS_A2A_V1:
        return _types.Part(text=text)  # type: ignore[no-any-return]
    return _types.Part(root=_types.TextPart(text=text))  # type: ignore[no-any-return]


def make_data_part(
    data: dict[str, Any], metadata: dict[str, Any] | None = None
) -> Part:
    """Builds a structured-data Part for the installed a2a-sdk generation.

    Raises:
        ValueError: On 1.x, if ``metadata`` holds a value that isn't JSON.
    """
    if IS_A2A_V1:
        from google.protobuf import json_format  # type: ignore[import-untyped,unused-ignore]
        from google.protobuf import struct_pb2  # type: ignore[import-untyped,unused-ignore]

        value = struct_pb2.Value()
        json_format.ParseDict(data, value)
        part: Any = _types.Part(data=value)
        if metadata:
            part.metadata.update(_to_json_value(metadata, "metadata"))
            mime = metadata.get("mimeType")
            if isinstance(mime, str) and mime:
                part.media_type = mime
        return part  # type: ignore[no-any-return]
    return _types.Part(root=_types.DataPart(data=data, metadata=metadata))  # type: ignore[no-any-return]


def is_data_part(part: Part | None) -> bool:
    """Returns True if the Part carries structured data."""
    if part is None:
        return False
    if IS_A2A_V1:
        p: Any = part
        return bool(p.WhichOneof("content") == "data")
    return isinstance(getattr(part, "root", None), _types.DataPart)


def is_text_part(part: Part | None) -> bool:
    """Returns True if the Part carries text."""
    if part is None:
        return False
    if IS_A2A_V1:
        p: Any = part
        return bool(p.WhichOneof("content") == "text")
    return isinstance(getattr(part, "root", None), _types.TextPart)


def part_text(part: Part | None) -> str:
    """Reads the text of a text Part, or an empty string if there is none."""
    if part is None:
        return ""
    p: Any = part
    # 1.x keeps ``text`` on the Part itself, 0.3 on its ``root``. A Part that is
    # not a text part has no text: "" on 1.x, no attribute at all on 0.3.
    holder = p if IS_A2A_V1 else getattr(p, "root", None)
    return str(getattr(holder, "text", "") or "")


def part_metadata(part: Part | None) -> dict[str, Any]:
    """Reads a Part's metadata as a plain dict."""
    if part is None:
        return {}
    if IS_A2A_V1:
        metadata = getattr(part, "metadata", None)
        if metadata is None:
            return {}
        # a2a-sdk 1.x types it as a protobuf ``Struct``; fall back to ``dict``
        # for a plain map so either shape reads the same.
        if _is_protobuf_message(metadata):
            result = _message_to_python(metadata)
            return result if isinstance(result, dict) else {}
        return dict(metadata)
    return getattr(getattr(part, "root", None), "metadata", None) or {}


def metadata_dict(metadata: Any) -> Any:
    """Reads 1.x protobuf ``Struct`` metadata as a plain dict.

    Any other value, such as 0.3 dict metadata or None, is returned unchanged,
    so a validator still rejects metadata that isn't a mapping. On 1.x an unset
    ``Struct`` reads as an empty dict.
    """
    # Checked before anything else: protobuf registers ``Struct`` as a
    # ``MutableMapping``, but its values are protobuf ``Value``s.
    if IS_A2A_V1 and _is_protobuf_message(metadata):
        return _message_to_python(metadata)
    return metadata


def data_part_dict(part: Part | None) -> dict[str, Any] | None:
    """Returns structured data as a dict, or None if the Part holds no object."""
    if not is_data_part(part):
        return None
    p: Any = part
    data = _message_to_python(p.data) if IS_A2A_V1 else p.root.data
    return data if isinstance(data, dict) else None


def data_parts_of(message: Message) -> list[tuple[Any, Any]]:
    """Returns the ``(data, metadata)`` of each data part in a message.

    On 0.3 a bare ``DataPart`` in ``parts`` counts too. Metadata goes through
    :func:`metadata_dict`, so malformed metadata is kept for the caller to
    reject.
    """
    result: list[tuple[Any, Any]] = []
    for part in message.parts or []:
        if IS_A2A_V1:
            if is_data_part(part):
                result.append((data_part_dict(part), part_metadata(part)))
            continue
        # a2a-sdk 0.3: a ``Part`` wraps its ``DataPart`` in ``root``.
        inner: Any = getattr(part, "root", part)
        if isinstance(inner, _types.DataPart):
            result.append((inner.data, metadata_dict(inner.metadata)))
    return result


def part_media_type(part: Part | None) -> str | None:
    """Returns the Part media type, if the installed SDK exposes one."""
    if part is None or not IS_A2A_V1:
        return None
    p: Any = part
    return str(p.media_type) if p.media_type else None


def make_agent_extension(
    *,
    uri: str,
    description: str,
    params: dict[str, Any] | None = None,
) -> AgentExtension:
    """Builds an AgentExtension. 1.x ``params`` is a protobuf Struct."""
    if IS_A2A_V1:
        ext: Any = AgentExtension(uri=uri, description=description)
        if params:
            ext.params.update(params)
        return ext  # type: ignore[no-any-return]
    return AgentExtension(
        uri=uri,
        description=description,
        params=params if params else None,
    )


def add_activated_extension(context: Any, uri: str) -> None:
    """Records an activated extension on a 0.3 RequestContext.

    a2a-sdk 0.3 exposes ``RequestContext.add_activated_extension``. 1.x has no
    such API (extensions propagate through message metadata), so this is a
    no-op there, as in ADK's own compatibility layer.
    """
    add_activated = getattr(context, "add_activated_extension", None)
    if callable(add_activated):
        add_activated(uri)


def data_part_view(part: Part | None) -> Any | None:
    """Returns an object with ``.data`` and ``.metadata`` dicts, if any.

    On 0.3 this is the inner ``DataPart``. On 1.x it is a read-only
    :class:`DataPartView` copy, with the Part's ``media_type`` as its
    ``mimeType`` metadata when the metadata has none. A 1.x Part whose data is
    not an object has no view.
    """
    if not is_data_part(part):
        return None
    if IS_A2A_V1:
        data = data_part_dict(part)
        if data is None:
            return None
        metadata = part_metadata(part)
        media_type = part_media_type(part)
        if media_type and "mimeType" not in metadata:
            metadata["mimeType"] = media_type
        return DataPartView(data=data, metadata=metadata)
    p: Any = part
    return p.root
