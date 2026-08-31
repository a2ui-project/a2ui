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
from __future__ import annotations
from enum import Enum
from typing import Any

# Versioned schema namespaces
from . import v0_8
from . import v0_9
from . import v1_0


# Multi-version Protocol Version Enum
class A2uiProtocolVersion(str, Enum):
    V0_8 = "v0.8"
    V0_9 = "v0.9"
    V0_9_1 = "v0.9.1"
    V1_0 = "v1.0"


ProtocolVersion = A2uiProtocolVersion


# Multi-version envelope unions (v1.0+ primary terminology)
AgentToRendererMessage = (
    v0_8.ServerToClientMessage
    | v0_9.ServerToClientMessage
    | v1_0.AgentToRendererMessage
)

RendererToAgentMessage = (
    v0_8.ClientToServerMessage
    | v0_9.ClientToServerMessage
    | v1_0.RendererToAgentMessage
)

# Aliases for cross-version consistency
ServerToClientMessage = AgentToRendererMessage
ClientToServerMessage = RendererToAgentMessage
A2uiMessage = AgentToRendererMessage
A2uiClientMessage = RendererToAgentMessage
A2uiRendererAction = v0_9.A2uiRendererAction
A2uiClientAction = A2uiRendererAction
A2uiClientUserAction = A2uiRendererAction

AgentToRendererMessagePayload = (
    AgentToRendererMessage | list[AgentToRendererMessage] | dict[str, Any]
)
ServerToClientMessagePayload = AgentToRendererMessagePayload
RendererToAgentMessagePayload = (
    RendererToAgentMessage | list[RendererToAgentMessage] | dict[str, Any]
)
ClientToServerMessagePayload = RendererToAgentMessagePayload

# Re-exports from primary schema namespace for backwards compatibility
from .v0_9.common_types import *
from .v0_9.constants import *
from .v0_9.server_to_client import *
from .v0_9.client_to_server import *
from .v0_9.client_capabilities import *
