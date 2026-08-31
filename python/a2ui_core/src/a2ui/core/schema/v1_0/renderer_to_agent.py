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

# Auto-generated. Do not edit manually.
from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field, ConfigDict
from .common_types import StrictBaseModel, CallId, Extensions, FunctionCall, FunctionResponse
from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE


class A2uiRendererAction(StrictBaseModel):
    """Reports a user-initiated action from a component."""

    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(
        ...,
        description=(
            "The name of the action, taken from the component's action.event.name"
            " property."
        ),
    )
    user_message: str | None = Field(
        None,
        alias="userMessage",
        description=(
            "An optional human-readable string describing the action performed by the"
            " user, taken from the component's action.event.userMessage property after"
            " resolving bindings."
        ),
    )
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The id of the surface where the event originated. It must be globally"
            " unique for the renderer's lifetime."
        ),
    )
    source_component_id: str = Field(
        ...,
        alias="sourceComponentId",
        description="The id of the component that triggered the event.",
    )
    timestamp: str = Field(
        ..., description="An ISO 8601 timestamp of when the event occurred."
    )
    context: dict[str, Any] = Field(
        ...,
        description=(
            "A JSON object containing the key-value pairs from the component's"
            " action.event.context, after resolving all data bindings."
        ),
    )
    metadata: Extensions | None = Field(
        None,
        description=(
            "Optional renderer-side metadata to send back to the agent with the action."
        ),
    )


ActionPayload = A2uiRendererAction


class A2uiRendererActionMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    action: A2uiRendererAction = Field(...)


class CallAgentFunction(StrictBaseModel):
    """Signals the agent to execute a function remotely on behalf of the renderer."""

    model_config = ConfigDict(populate_by_name=True)
    surface_id: str = Field(
        ..., alias="surfaceId", description="The surface ID where the call originated."
    )
    function_call_id: str = Field(
        ...,
        alias="functionCallId",
        description=(
            "Unique ID for this instance of the function call. The agent MUST copy this"
            " ID into the return response."
        ),
    )
    call_function: FunctionCall = Field(..., alias="callFunction")


class CallAgentFunctionMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    call_agent_function: CallAgentFunction = Field(..., alias="callAgentFunction")


class RendererFunctionResponseMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    renderer_function_response: FunctionResponse = Field(
        ..., alias="rendererFunctionResponse"
    )


class A2uiValidationError(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: Literal["VALIDATION_FAILED", "UNALLOWED_PARENT", "UNALLOWED_CHILD"] = Field(
        ...
    )
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The id of the surface where the error occurred. It must be globally unique"
            " for the renderer's lifetime."
        ),
    )
    path: str = Field(
        ...,
        description=(
            "The JSON pointer to the field that failed validation (e.g."
            " '/components/0/text')."
        ),
    )
    message: str = Field(
        ...,
        description="A short one or two sentence description of why validation failed.",
    )


class A2uiGenericError(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    code: str = Field(...)
    message: str = Field(
        ...,
        description=(
            "A short one or two sentence description of why the error occurred."
        ),
    )
    surface_id: str | None = Field(
        None,
        alias="surfaceId",
        description=(
            "The id of the surface where the error occurred. It must be globally unique"
            " for the renderer's lifetime."
        ),
    )
    function_call_id: str | None = Field(
        None,
        alias="functionCallId",
        description=(
            "The unique ID of the function invocation, which must be identical to the"
            " value specified in the function invocation."
        ),
    )


A2uiRendererError = A2uiValidationError | A2uiGenericError


class A2uiRendererErrorMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    error: A2uiRendererError = Field(...)


RendererToAgentMessage = (
    A2uiRendererActionMessage
    | CallAgentFunctionMessage
    | RendererFunctionResponseMessage
    | A2uiRendererErrorMessage
)


class A2uiRendererDataModel(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    surfaces: dict[str, dict[str, Any]] = Field(
        ..., description="A map of surface IDs to data models."
    )


RendererToAgentMessageList = list[RendererToAgentMessage]


class RendererToAgentMessageListWrapper(StrictBaseModel):
    messages: RendererToAgentMessageList = Field(
        ..., description="An object wrapping a list of A2UI Renderer-to-Agent messages."
    )
