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

"""Pydantic v2 models for Renderer-to-Agent v1.0 messages."""

from typing import Any, Dict, Literal, Optional, Union
from pydantic import Field
from .common_types import CallId, FunctionCall, FunctionResponse, StrictBaseModel
from .constants import VERSION_1_0


class ActionPayload(StrictBaseModel):
    """Payload reporting a user-initiated UI action from a component."""

    name: str = Field(..., description="Action name.")
    user_message: Optional[str] = Field(
        None,
        alias="userMessage",
        description="Human-readable description of user action.",
    )
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="Originating surface ID.",
    )
    source_component_id: str = Field(
        ...,
        alias="sourceComponentId",
        description="Component ID triggering the action.",
    )
    timestamp: str = Field(..., description="ISO 8601 timestamp.")
    context: Dict[str, Any] = Field(..., description="Resolved key-value context.")
    metadata: Optional[Dict[str, Any]] = Field(
        None,
        description="Optional client metadata.",
    )


class ActionMessage(StrictBaseModel):
    """Envelope wrapping a renderer action message."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    action: ActionPayload = Field(..., description="Action payload.")


class CallAgentFunctionPayload(StrictBaseModel):
    """Payload signaling agent to execute a remote function."""

    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="Originating surface ID.",
    )
    function_call_id: CallId = Field(
        ...,
        alias="functionCallId",
        description="Unique function call instance ID.",
    )
    call_function: FunctionCall = Field(
        ...,
        alias="callFunction",
        description="Function call definition.",
    )


class CallAgentFunctionMessage(StrictBaseModel):
    """Envelope wrapping a callAgentFunction message."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    call_agent_function: CallAgentFunctionPayload = Field(
        ...,
        alias="callAgentFunction",
        description="Call agent function payload.",
    )


class RendererFunctionResponseMessage(StrictBaseModel):
    """Envelope wrapping a renderer function execution response."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    renderer_function_response: FunctionResponse = Field(
        ...,
        alias="rendererFunctionResponse",
        description="Function response payload.",
    )


class ValidationErrorPayload(StrictBaseModel):
    """Payload for renderer layout or property validation failure."""

    code: Literal["VALIDATION_FAILED", "UNALLOWED_PARENT", "UNALLOWED_CHILD"] = Field(
        ...,
        description="Validation error category code.",
    )
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="Target surface ID.",
    )
    path: str = Field(..., description="JSON pointer path to invalid field.")
    message: str = Field(..., description="Description of validation failure.")


class GenericErrorPayload(StrictBaseModel):
    """Payload for generic renderer-side errors."""

    code: str = Field(..., description="Error code identifier.")
    message: str = Field(..., description="Error explanation message.")
    surface_id: Optional[str] = Field(
        None,
        alias="surfaceId",
        description="Target surface ID if applicable.",
    )
    function_call_id: Optional[CallId] = Field(
        None,
        alias="functionCallId",
        description="Function call ID if applicable.",
    )


ErrorPayload = Union[ValidationErrorPayload, GenericErrorPayload]


class ErrorResponseMessage(StrictBaseModel):
    """Envelope wrapping a renderer-to-agent error payload."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    error: ErrorPayload = Field(..., description="Error payload details.")


ErrorMessage = ErrorResponseMessage


RendererToAgentMessage = Union[
    ActionMessage,
    CallAgentFunctionMessage,
    RendererFunctionResponseMessage,
    ErrorResponseMessage,
]
