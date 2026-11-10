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
AGENT_FUNCTION_RESPONSE = "agentFunctionResponse"
RENDERER_FUNCTION_RESPONSE = "rendererFunctionResponse"

# The renderer's messages that `a2ui_rpc_callback` may answer without the
# model, and which `a2ui_rpc_interceptor` completes.
RENDERER_RPC_KINDS = frozenset({CALL_AGENT_FUNCTION, RENDERER_FUNCTION_RESPONSE})

# The agent function messages, in both directions, which `a2ui_rpc_callback`
# answers without the model. The renderer's other messages (`action`, `error`,
# `rendererFunctionResponse`) are for the model's turn.
RPC_KINDS = frozenset({CALL_AGENT_FUNCTION, AGENT_FUNCTION_RESPONSE})


def message_kind(message: Mapping[str, Any]) -> str | None:
    """The message's type key, such as `callAgentFunction`."""
    keys = [key for key in message if key != "version"]
    return keys[0] if len(keys) == 1 else None


def is_renderer_rpc_only(parts: list[a2a_types.Part]) -> bool:
    """Whether every part is a renderer message that the callback may answer."""
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
    that converter rather than ADK's format. Only inline data that holds a
    tagged A2A `DataPart` is read: other parts, such as media blobs, are
    skipped without being converted, and a malformed tagged payload holds no
    messages.
    """
    inline_data = part.inline_data
    if (
        inline_data is None
        or not inline_data.data
        or inline_data.mime_type != part_converter.A2A_DATA_PART_TEXT_MIME_TYPE
        or not inline_data.data.startswith(part_converter.A2A_DATA_PART_START_TAG)
        or not inline_data.data.endswith(part_converter.A2A_DATA_PART_END_TAG)
    ):
        return []
    try:
        a2a_part = part_converter.convert_genai_part_to_a2a_part(part)
    except ValueError:
        # Pydantic's `ValidationError` for a tagged payload that isn't a
        # `DataPart`.
        return []
    return get_a2ui_messages([a2a_part]) if a2a_part is not None else []


def is_rpc_part(part: genai_types.Part) -> bool:
    """Whether a GenAI part holds an agent function message, in either direction."""
    messages = genai_part_a2ui_messages(part)
    return bool(messages) and all(
        message_kind(message) in RPC_KINDS for message in messages
    )
