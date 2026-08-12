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

"""A2UI Core Schema package providing protocol version models and multi-version union types."""

from typing import Union

from .client_capabilities import (
    A2uiClientCapabilities as A2uiClientCapabilities,
    FunctionDefinition as FunctionDefinition,
    InlineCatalog as InlineCatalog,
    V09Capabilities as V09Capabilities,
)
from .client_to_server import (
    A2uiClientAction as A2uiClientAction,
    A2uiClientActionMessage as A2uiClientActionMessage,
    A2uiClientDataModel as A2uiClientDataModel,
    A2uiClientError as A2uiClientError,
    A2uiClientErrorMessage as A2uiClientErrorMessage,
    A2uiClientMessage as A2uiClientMessage,
    A2uiClientMessageList as A2uiClientMessageList,
    A2uiClientMessageListWrapper as A2uiClientMessageListWrapper,
    A2uiGenericError as A2uiGenericError,
    A2uiValidationError as A2uiValidationError,
)
from .common_types import (
    AccessibilityAttributes as AccessibilityAttributes,
    Action as Action,
    ActionEvent as ActionEvent,
    CheckRule as CheckRule,
    ComponentCommon as ComponentCommon,
    DataBinding as DataBinding,
    FunctionCall as FunctionCall,
    StrictBaseModel as StrictBaseModel,
)
from .constants import A2uiProtocolVersion as A2uiProtocolVersion
from .constants import *
from .server_to_client import (
    A2uiMessage as A2uiMessage,
    A2uiMessageListWrapper as A2uiMessageListWrapper,
    CreateSurface as CreateSurface,
    CreateSurfaceMessage as CreateSurfaceMessage,
    DeleteSurface as DeleteSurface,
    DeleteSurfaceMessage as DeleteSurfaceMessage,
    UpdateComponents as UpdateComponents,
    UpdateComponentsMessage as UpdateComponentsMessage,
    UpdateDataModel as UpdateDataModel,
    UpdateDataModelMessage as UpdateDataModelMessage,
)
from . import v1_0 as v1_0

# Aliases for v0.9 envelope types
ServerToClientMessage = A2uiMessage
ClientToServerMessage = A2uiClientMessage

# Cross-version envelope union types
AgentToRendererMessage = Union[ServerToClientMessage, v1_0.AgentToRendererMessage]
RendererToAgentMessage = Union[ClientToServerMessage, v1_0.RendererToAgentMessage]
