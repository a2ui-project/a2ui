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

"""Recognizes A2UI RPC messages in A2A and GenAI parts."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from a2a import types as a2a_types
from google.adk.a2a.converters import part_converter
from google.genai import types as genai_types

from a2ui.a2a import get_a2ui_messages

CALL_AGENT_FUNCTION = "callAgentFunction"
RENDERER_FUNCTION_RESPONSE = "rendererFunctionResponse"

# The RPC messages a renderer sends, which `a2ui_rpc_callback` answers.
RENDERER_RPC_KINDS = frozenset({CALL_AGENT_FUNCTION, RENDERER_FUNCTION_RESPONSE})
# Every RPC message, in both directions.
RPC_KINDS = RENDERER_RPC_KINDS | {"agentFunctionResponse", "callRendererFunction"}


def message_kind(message: Mapping[str, Any]) -> str | None:
    """The message's type key, such as `callAgentFunction`."""
    keys = [key for key in message if key != "version"]
    return keys[0] if len(keys) == 1 else None


def is_renderer_rpc_only(parts: list[a2a_types.Part]) -> bool:
    """Whether every part is an RPC message that a renderer sends."""
    messages = get_a2ui_messages(parts)
    return (
        bool(messages)
        and len(messages) == len(parts)
        and all(message_kind(message) in RENDERER_RPC_KINDS for message in messages)
    )


def genai_part_a2ui_messages(part: genai_types.Part) -> list[dict[str, Any]]:
    """The A2UI messages in a GenAI part that ADK converted from an A2A part.

    `A2aAgentExecutor` turns an A2A `DataPart` into inline data that ADK's
    `convert_genai_part_to_a2a_part` turns back, so this reads the part through
    that converter rather than ADK's format.
    """
    a2a_part = part_converter.convert_genai_part_to_a2a_part(part)
    return get_a2ui_messages([a2a_part]) if a2a_part is not None else []


def is_rpc_part(part: genai_types.Part) -> bool:
    """Whether a GenAI part holds an A2UI RPC message, in either direction."""
    if part.inline_data is None:
        # ADK carries A2A data parts as inline data; skip the rest cheaply.
        return False
    messages = genai_part_a2ui_messages(part)
    return bool(messages) and all(
        message_kind(message) in RPC_KINDS for message in messages
    )
