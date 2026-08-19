# Copyright 2026 Google LLC
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
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Optional

from a2a.types import AgentExtension, Part

try:
    from a2a.types import StreamResponse as _StreamResponse  # noqa: F401

    IS_A2A_V1 = True
except ImportError:
    IS_A2A_V1 = False


def make_text_part(text: str) -> Part:
    """Builds a text Part for the installed a2a-sdk generation."""
    if IS_A2A_V1:
        return Part(text=text)
    from a2a.types import TextPart  # type: ignore[attr-defined]

    return Part(root=TextPart(text=text))


def make_data_part(
    data: dict[str, Any], metadata: Optional[dict[str, Any]] = None
) -> Part:
    """Builds a structured-data Part for the installed a2a-sdk generation."""
    if IS_A2A_V1:
        from google.protobuf import json_format
        from google.protobuf import struct_pb2

        value = struct_pb2.Value()
        json_format.ParseDict(data, value)
        part = Part(data=value)
        if metadata:
            part.metadata.update(metadata)
            mime = metadata.get("mimeType")
            if isinstance(mime, str) and mime:
                part.media_type = mime
        return part
    from a2a.types import DataPart  # type: ignore[attr-defined]

    return Part(root=DataPart(data=data, metadata=metadata))


def is_data_part(part: Part) -> bool:
    """Returns True if the Part carries structured data."""
    if IS_A2A_V1:
        return part.WhichOneof("content") == "data"
    from a2a.types import DataPart  # type: ignore[attr-defined]

    return isinstance(getattr(part, "root", None), DataPart)


def is_text_part(part: Part) -> bool:
    """Returns True if the Part carries text."""
    if IS_A2A_V1:
        return part.WhichOneof("content") == "text"
    from a2a.types import TextPart  # type: ignore[attr-defined]

    return isinstance(getattr(part, "root", None), TextPart)


def part_text(part: Part) -> str:
    """Reads the text of a text Part."""
    if IS_A2A_V1:
        return part.text
    return part.root.text


def part_metadata(part: Part) -> dict[str, Any]:
    """Reads a Part's metadata as a plain dict."""
    if IS_A2A_V1:
        from google.protobuf.json_format import MessageToDict

        if part.HasField("metadata"):
            return MessageToDict(part.metadata)
        return {}
    return getattr(getattr(part, "root", None), "metadata", None) or {}


def data_part_dict(part: Part) -> Optional[dict[str, Any]]:
    """Returns structured data as a dict, or None if the Part is not data."""
    if not is_data_part(part):
        return None
    if IS_A2A_V1:
        from google.protobuf.json_format import MessageToDict

        data = MessageToDict(part.data)
        return data if isinstance(data, dict) else None
    data = part.root.data
    return data if isinstance(data, dict) else None


def part_media_type(part: Part) -> Optional[str]:
    """Returns the Part media type, if the installed SDK exposes one."""
    if IS_A2A_V1:
        return part.media_type or None
    return None


def make_agent_extension(
    *,
    uri: str,
    description: str,
    params: Optional[dict[str, Any]] = None,
) -> AgentExtension:
    """Builds an AgentExtension. 1.x ``params`` is a protobuf Struct."""
    if IS_A2A_V1:
        ext = AgentExtension(uri=uri, description=description)
        if params:
            ext.params.update(params)
        return ext
    return AgentExtension(
        uri=uri,
        description=description,
        params=params if params else None,
    )


def add_activated_extension(context: Any, uri: str) -> None:
    """Records an activated extension on 0.3 or 1.x RequestContext.

    a2a-sdk 0.3 exposes ``RequestContext.add_activated_extension``. That API is
    gone in 1.x; activation is stored on ``call_context.state`` so servers can
    still echo ``A2A-Extensions`` on the response.
    """
    add_activated = getattr(context, "add_activated_extension", None)
    if callable(add_activated):
        add_activated(uri)
        return
    call_context = getattr(context, "call_context", None)
    if call_context is None:
        return
    state = getattr(call_context, "state", None)
    if state is None:
        return
    activated = state.setdefault("activated_extensions", set())
    if isinstance(activated, set):
        activated.add(uri)
    else:
        state["activated_extensions"] = {uri}


def data_part_view(part: Part) -> Optional[Any]:
    """Returns an object with ``.data`` and ``.metadata`` dict-like fields.

    On 0.3 this is the inner ``DataPart``. On 1.x it is a lightweight view so
    existing ``get_a2ui_datapart(...).metadata.get(...)`` callers keep working.
    """
    if not is_data_part(part):
        return None
    if IS_A2A_V1:
        return SimpleNamespace(
            data=data_part_dict(part) or {},
            metadata=part_metadata(part),
        )
    return part.root
