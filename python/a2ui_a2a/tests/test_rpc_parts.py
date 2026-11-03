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

"""Tests for the A2UI RPC part helpers."""

from __future__ import annotations

from a2a.types import DataPart, Message, Part, Role, TextPart

from a2ui.a2a import (
    A2UI_MIME_TYPE,
    create_a2ui_part,
    create_a2ui_parts,
    get_a2ui_messages,
)
from a2ui.core.schema.v1_0 import AgentFunctionResponseMessage

CALL = {
    "version": "1.0",
    "callAgentFunction": {
        "functionCallId": "call-1",
        "surfaceId": "s1",
        "callFunction": {"@call": "fetchFxRate", "args": {"base": "EUR"}},
    },
}
ACTION = {
    "version": "1.0",
    "action": {
        "name": "submit",
        "surfaceId": "s1",
        "sourceComponentId": "b",
        "timestamp": "2026-01-01T00:00:00Z",
        "context": {},
    },
}


def test_get_a2ui_messages_reads_each_a2ui_part_of_a_message() -> None:
    message = Message(
        message_id="m1",
        role=Role.user,
        parts=[
            Part(root=TextPart(text="hello")),
            create_a2ui_part(CALL),
            Part(root=DataPart(data={"not": "a2ui"})),
            create_a2ui_part(ACTION),
        ],
    )

    assert get_a2ui_messages(message) == [CALL, ACTION]


def test_get_a2ui_messages_accepts_parts() -> None:
    assert get_a2ui_messages([create_a2ui_part(CALL)]) == [CALL]
    assert get_a2ui_messages([Part(root=TextPart(text="hello"))]) == []
    assert get_a2ui_messages([]) == []


def test_create_a2ui_parts_keeps_a_null_value() -> None:
    reply = AgentFunctionResponseMessage.model_validate({
        "version": "1.0",
        "agentFunctionResponse": {"functionCallId": "c1", "value": None},
    })

    (part,) = create_a2ui_parts([reply])

    assert isinstance(part.root, DataPart)
    assert part.root.metadata == {"mimeType": A2UI_MIME_TYPE}
    assert part.root.data == {
        "version": "1.0",
        "agentFunctionResponse": {"functionCallId": "c1", "value": None},
    }


def test_create_a2ui_parts_takes_dicts_in_order() -> None:
    parts = create_a2ui_parts([CALL, ACTION])

    assert get_a2ui_messages(parts) == [CALL, ACTION]


def test_create_a2ui_parts_round_trips_through_get_a2ui_messages() -> None:
    reply = AgentFunctionResponseMessage.model_validate({
        "version": "1.0",
        "agentFunctionResponse": {"functionCallId": "c1", "value": 3},
    })

    assert get_a2ui_messages(create_a2ui_parts([reply])) == [
        reply.model_dump(by_alias=True, exclude_unset=True)
    ]
