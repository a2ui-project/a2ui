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
from .common_types import (
    StrictBaseModel as StrictBaseModel,
    DataBinding as DataBinding,
    FunctionCall as FunctionCall,
    AccessibilityAttributes as AccessibilityAttributes,
    CheckRule as CheckRule,
    ActionEvent as ActionEvent,
    Action as Action,
    ComponentCommon as ComponentCommon,
)
from .constants import *
from .server_to_client import (
    CreateSurfaceMessage as CreateSurfaceMessage,
    CreateSurface as CreateSurface,
    UpdateComponentsMessage as UpdateComponentsMessage,
    UpdateComponents as UpdateComponents,
    UpdateDataModelMessage as UpdateDataModelMessage,
    UpdateDataModel as UpdateDataModel,
    DeleteSurfaceMessage as DeleteSurfaceMessage,
    DeleteSurface as DeleteSurface,
    A2uiMessage as A2uiMessage,
    A2uiMessageListWrapper as A2uiMessageListWrapper,
)
from .client_capabilities import (
    A2uiClientCapabilities as A2uiClientCapabilities,
    V09Capabilities as V09Capabilities,
    InlineCatalog as InlineCatalog,
    FunctionDefinition as FunctionDefinition,
)
from .client_to_server import (
    A2uiClientMessage as A2uiClientMessage,
    A2uiClientActionMessage as A2uiClientActionMessage,
    A2uiClientErrorMessage as A2uiClientErrorMessage,
    A2uiClientAction as A2uiClientAction,
    A2uiValidationError as A2uiValidationError,
    A2uiGenericError as A2uiGenericError,
    A2uiClientError as A2uiClientError,
    A2uiClientDataModel as A2uiClientDataModel,
    A2uiClientMessageList as A2uiClientMessageList,
    A2uiClientMessageListWrapper as A2uiClientMessageListWrapper,
)
from enum import Enum


class ProtocolVersion(str, Enum):
    V0_8 = "v0.8"
    V0_9 = "v0.9"
    V0_9_1 = "v0.9.1"
    V1_0 = "v1.0"
