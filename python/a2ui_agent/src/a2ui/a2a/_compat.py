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

The installed generation decides which attributes ``a2a.types`` has, so the
version-specific code goes through ``_types`` and ``Any``: a static checker only
ever sees one of the two generations.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Optional

import a2a.types as _a2a_types
from a2a.types import AgentExtension, Part

_types: Any = _a2a_types

# ``StreamResponse`` only exists in the protobuf-based 1.x types.
IS_A2A_V1 = hasattr(_types, "StreamResponse")


def make_text_part(text: str) -> Part:
    """Builds a text Part for the installed a2a-sdk generation."""
    if IS_A2A_V1:
        return _types.Part(text=text)  # type: ignore[no-any-return]
    return _types.Part(root=_types.TextPart(text=text))  # type: ignore[no-any-return]


def make_data_part(
    data: dict[str, Any], metadata: Optional[dict[str, Any]] = None
) -> Part:
    """Builds a structured-data Part for the installed a2a-sdk generation."""
    if IS_A2A_V1:
        from google.protobuf import json_format  # type: ignore[import-untyped,unused-ignore]
        from google.protobuf import struct_pb2  # type: ignore[import-untyped,unused-ignore]

        value = struct_pb2.Value()
        json_format.ParseDict(data, value)
        part: Any = _types.Part(data=value)
        if metadata:
            part.metadata.update({k: str(v) for k, v in metadata.items()})
            mime = metadata.get("mimeType")
            if isinstance(mime, str) and mime:
                part.media_type = mime
        return part  # type: ignore[no-any-return]
    return _types.Part(root=_types.DataPart(data=data, metadata=metadata))  # type: ignore[no-any-return]


def is_data_part(part: Part) -> bool:
    """Returns True if the Part carries structured data."""
    if part is None:
        return False
    if IS_A2A_V1:
        p: Any = part
        return bool(p.WhichOneof("content") == "data")
    return isinstance(getattr(part, "root", None), _types.DataPart)


def is_text_part(part: Part) -> bool:
    """Returns True if the Part carries text."""
    if part is None:
        return False
    if IS_A2A_V1:
        p: Any = part
        return bool(p.WhichOneof("content") == "text")
    return isinstance(getattr(part, "root", None), _types.TextPart)


def part_text(part: Part) -> str:
    """Reads the text of a text Part, or an empty string if there is none."""
    if part is None:
        return ""
    p: Any = part
    # 1.x keeps ``text`` on the Part itself, 0.3 on its ``root``. A Part that is
    # not a text part has no text: "" on 1.x, no attribute at all on 0.3.
    holder = p if IS_A2A_V1 else getattr(p, "root", None)
    return str(getattr(holder, "text", "") or "")


def part_metadata(part: Part) -> dict[str, Any]:
    """Reads a Part's metadata as a plain dict."""
    if part is None:
        return {}
    if IS_A2A_V1:
        metadata = getattr(part, "metadata", None)
        if metadata is None:
            return {}
        # a2a-sdk 1.x types it as a protobuf ``Struct``; fall back to ``dict``
        # for a plain map so either shape reads the same. ``isinstance`` rather
        # than ``hasattr(..., "DESCRIPTOR")``, which a mock also satisfies.
        from google.protobuf.message import Message  # type: ignore[import-untyped,unused-ignore]

        if isinstance(metadata, Message):
            from google.protobuf.json_format import MessageToDict  # type: ignore[import-untyped,unused-ignore]

            result: dict[str, Any] = MessageToDict(metadata)
            return result
        return dict(metadata)
    return getattr(getattr(part, "root", None), "metadata", None) or {}


def data_part_dict(part: Part) -> Optional[dict[str, Any]]:
    """Returns structured data as a dict, or None if the Part is not data."""
    if not is_data_part(part):
        return None
    p: Any = part
    if IS_A2A_V1:
        from google.protobuf.json_format import MessageToDict  # type: ignore[import-untyped,unused-ignore]

        data = MessageToDict(p.data)
    else:
        data = p.root.data
    return data if isinstance(data, dict) else None


def part_media_type(part: Part) -> Optional[str]:
    """Returns the Part media type, if the installed SDK exposes one."""
    if part is None or not IS_A2A_V1:
        return None
    p: Any = part
    return str(p.media_type) if p.media_type else None


def make_agent_extension(
    *,
    uri: str,
    description: str,
    params: Optional[dict[str, Any]] = None,
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
    activated = state.get("activated_extensions")
    if isinstance(activated, set):
        activated.add(uri)
    elif isinstance(activated, list):
        if uri not in activated:
            activated.append(uri)
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
    p: Any = part
    return p.root
