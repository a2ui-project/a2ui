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

"""A2A builders and readers for the tests, on a2a-sdk 0.3 and 1.x.

a2a-sdk 0.3 has pydantic ``Part(root=TextPart|DataPart)`` and lowercase enum
members such as ``TaskState.working``. 1.x has a flat protobuf ``Part`` and
``TASK_STATE_*`` / ``ROLE_*`` enum values. These helpers let one test run on
either.
"""

from __future__ import annotations

from typing import Any

import a2a.types as _a2a_types
from a2a.types import Part, Role, TaskState

_types: Any = _a2a_types

# ``StreamResponse`` only exists in the protobuf-based 1.x types.
IS_A2A_V1 = hasattr(_types, "StreamResponse")


def make_text_part(text: str) -> Part:
    if IS_A2A_V1:
        return _types.Part(text=text)  # type: ignore[no-any-return]
    return _types.Part(root=_types.TextPart(text=text))  # type: ignore[no-any-return]


def make_data_part(
    data: dict[str, Any], metadata: dict[str, Any] | None = None
) -> Part:
    if IS_A2A_V1:
        from google.protobuf import json_format, struct_pb2

        value = struct_pb2.Value()
        json_format.ParseDict(data, value)
        part: Any = _types.Part(data=value)
        if metadata:
            part.metadata.update(metadata)
        return part  # type: ignore[no-any-return]
    return _types.Part(root=_types.DataPart(data=data, metadata=metadata))  # type: ignore[no-any-return]


def _content(part: Any) -> str | None:
    if IS_A2A_V1:
        return str(part.WhichOneof("content"))
    root = getattr(part, "root", None)
    return getattr(root, "kind", None)


def is_text_part(part: Any) -> bool:
    return part is not None and _content(part) == "text"


def is_data_part(part: Any) -> bool:
    return part is not None and _content(part) == "data"


def part_text(part: Any) -> str:
    if not is_text_part(part):
        return ""
    return str(part.text if IS_A2A_V1 else part.root.text)


def _to_python(message: Any) -> Any:
    """Reads a protobuf ``Struct`` or ``Value``, with whole numbers as ints."""
    from google.protobuf.json_format import MessageToDict

    def normalize(value: Any) -> Any:
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, dict):
            return {k: normalize(v) for k, v in value.items()}
        if isinstance(value, list):
            return [normalize(v) for v in value]
        return value

    return normalize(MessageToDict(message))


def part_metadata(part: Any) -> dict[str, Any]:
    if part is None:
        return {}
    if IS_A2A_V1:
        return _to_python(part.metadata) if part.metadata else {}
    return dict(part.root.metadata or {})


def data_part_dict(part: Any) -> dict[str, Any] | None:
    if not is_data_part(part):
        return None
    data = _to_python(part.data) if IS_A2A_V1 else part.root.data
    return data if isinstance(data, dict) else None


def user_role() -> Any:
    """a2a-sdk 0.3 uses ``Role.user``; 1.x uses ``Role.ROLE_USER``."""
    return Role.user if hasattr(Role, "user") else Role.ROLE_USER


def agent_role() -> Any:
    """a2a-sdk 0.3 uses ``Role.agent``; 1.x uses ``Role.ROLE_AGENT``."""
    return Role.agent if hasattr(Role, "agent") else Role.ROLE_AGENT


def task_state(name: str) -> Any:
    """a2a-sdk 0.3 uses ``TaskState.working``; 1.x prefixes ``TASK_STATE_``."""
    if hasattr(TaskState, name):
        return getattr(TaskState, name)
    return getattr(TaskState, "TASK_STATE_" + name.upper())


def state_name(state: Any) -> str:
    """Returns a status state as a lowercase name on both a2a-sdk generations."""
    if hasattr(state, "value") and isinstance(state.value, str):
        return state.value
    enum_name = getattr(state, "name", None)
    if isinstance(enum_name, str):
        return enum_name.removeprefix("TASK_STATE_").lower()
    try:
        tasks: Any = TaskState
        return str(tasks.Name(int(state))).removeprefix("TASK_STATE_").lower()
    except (AttributeError, ValueError):
        return str(state)
