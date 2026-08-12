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

"""A2UI Protocol v1.0 Schema Package."""

from .agent_capabilities import (
    AgentCapabilities as AgentCapabilities,
    V10AgentCapabilities as V10AgentCapabilities,
)
from .agent_to_renderer import (
    AgentFunctionResponseMessage as AgentFunctionResponseMessage,
    AgentToRendererMessage as AgentToRendererMessage,
    CallRendererFunction as CallRendererFunction,
    CallRendererFunctionMessage as CallRendererFunctionMessage,
    CreateSurface as CreateSurface,
    CreateSurfaceMessage as CreateSurfaceMessage,
    DeleteSurface as DeleteSurface,
    DeleteSurfaceMessage as DeleteSurfaceMessage,
    UpdateComponents as UpdateComponents,
    UpdateComponentsMessage as UpdateComponentsMessage,
    UpdateDataModel as UpdateDataModel,
    UpdateDataModelMessage as UpdateDataModelMessage,
    UpdateSurface as UpdateSurface,
    UpdateSurfaceMessage as UpdateSurfaceMessage,
)
from .common_types import (
    Action as Action,
    ActionEvent as ActionEvent,
    ActionEventWrapper as ActionEventWrapper,
    ActionFunctionCallWrapper as ActionFunctionCallWrapper,
    AccessibilityAttributes as AccessibilityAttributes,
    CallId as CallId,
    Checkable as Checkable,
    CheckRule as CheckRule,
    Child as Child,
    ChildList as ChildList,
    ComponentCommon as ComponentCommon,
    ComponentId as ComponentId,
    ComponentMetadata as ComponentMetadata,
    DataBinding as DataBinding,
    DataModelUpdate as DataModelUpdate,
    DynamicBoolean as DynamicBoolean,
    DynamicNumber as DynamicNumber,
    DynamicString as DynamicString,
    DynamicStringList as DynamicStringList,
    DynamicValue as DynamicValue,
    Extensions as Extensions,
    FunctionCall as FunctionCall,
    FunctionCommon as FunctionCommon,
    FunctionError as FunctionError,
    FunctionResponse as FunctionResponse,
    IndexSystemFunction as IndexSystemFunction,
    IndexSystemFunctionArgs as IndexSystemFunctionArgs,
    StrictBaseModel as StrictBaseModel,
    Surface as Surface,
    TemplateChildList as TemplateChildList,
    ValidationResult as ValidationResult,
)
from .constants import *
from .renderer_capabilities import (
    RendererCapabilities as RendererCapabilities,
    RendererCapabilitiesMessage as RendererCapabilitiesMessage,
    V10RendererCapabilities as V10RendererCapabilities,
)
from .renderer_to_agent import (
    ActionMessage as ActionMessage,
    ActionPayload as ActionPayload,
    CallAgentFunctionMessage as CallAgentFunctionMessage,
    CallAgentFunctionPayload as CallAgentFunctionPayload,
    ErrorMessage as ErrorMessage,
    ErrorPayload as ErrorPayload,
    ErrorResponseMessage as ErrorResponseMessage,
    GenericErrorPayload as GenericErrorPayload,
    RendererFunctionResponseMessage as RendererFunctionResponseMessage,
    RendererToAgentMessage as RendererToAgentMessage,
    ValidationErrorPayload as ValidationErrorPayload,
)
