// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Auto-generated Protobuf descriptor bindings. Do not edit manually.

import protobuf from 'protobufjs';
import protoJson from './a2ui-proto.json' with { type: 'json' };

export const protoRoot = protobuf.Root.fromJSON(protoJson as unknown as protobuf.INamespace);

export const AgentToRendererMessageType = protoRoot.lookupType('a2ui.v1_0.AgentToRendererMessage');
export const RendererToAgentMessageType = protoRoot.lookupType('a2ui.v1_0.RendererToAgentMessage');
export const AgentToRendererListWrapperType = protoRoot.lookupType('a2ui.v1_0.AgentToRendererListWrapper');
export const AgentToRendererMessageListType = protoRoot.lookupType('a2ui.v1_0.AgentToRendererMessageList');
export const ComponentType = protoRoot.lookupType('a2ui.v1_0.Component');

export { protoJson };
