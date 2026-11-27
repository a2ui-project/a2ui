/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Canonical Protobuf Edition 2023 wire envelope specification for A2UI v1.0.
 *
 * Defines:
 * - All 6 `AgentToRendererMessage` variants (`create_surface`, `update_components`,
 *   `update_data_model`, `delete_surface`, `call_renderer_function`,
 *   `agent_function_response`).
 * - All 4 `RendererToAgentMessage` variants (`action`, `call_agent_function`,
 *   `renderer_function_response`, `error`).
 * - `Component` carrying collision-free `google.protobuf.Any typed_payload = 7`
 *   alongside `google.protobuf.Struct properties = 8` fallback (both validated by
 *   `CatalogModel` at runtime).
 * - `UpdateDataModel` with Edition 2023 explicit field presence (unset = delete key;
 *   `NullValue` = literal `null`) and `google.protobuf.Any typed_value = 4` for
 *   reactive branded opaque values (such as `TrustedResourceUrlProto` / `SafeHtmlProto`).
 */
export const A2UI_V1_ENVELOPE_PROTO = `edition = "2023";

package a2ui.v1_0;

import "google/protobuf/any.proto";
import "google/protobuf/struct.proto";

// ============================================================================
// Common A2UI v1.0 Wire Primitives
// ============================================================================

message DataBinding {
  string path = 1;
}

message FunctionCall {
  string call = 1;
  string catalog_id = 2;
  google.protobuf.Struct args = 3;
}

message DynamicString {
  oneof source {
    string literal = 1;
    DataBinding data_binding = 2;
    FunctionCall function_call = 3;
  }
}

message DynamicNumber {
  oneof source {
    double literal = 1;
    DataBinding data_binding = 2;
    FunctionCall function_call = 3;
  }
}

message DynamicInteger {
  oneof source {
    int64 literal = 1;
    DataBinding data_binding = 2;
    FunctionCall function_call = 3;
  }
}

message DynamicBoolean {
  oneof source {
    bool literal = 1;
    DataBinding data_binding = 2;
    FunctionCall function_call = 3;
  }
}

message DynamicValue {
  oneof source {
    google.protobuf.Value literal = 1;
    DataBinding data_binding = 2;
    FunctionCall function_call = 3;
  }
}

message StringList {
  repeated string values = 1;
}

message DynamicStringList {
  oneof source {
    StringList literal = 1;
    DataBinding data_binding = 2;
    FunctionCall function_call = 3;
  }
}

message ChildList {
  message Template {
    string component_id = 1;
    string path = 2;
  }

  oneof list {
    StringList static_list = 1;
    Template template = 2;
  }
}

message Action {
  message Event {
    string name = 1;
    DynamicString user_message = 2;
    map<string, DynamicValue> context = 3;
  }

  oneof action {
    Event event = 1;
    FunctionCall function_call = 2;
  }
}

message CheckRule {
  oneof condition {
    DataBinding data_binding = 1;
    FunctionCall function_call = 2;
  }
  string message = 3;
}

message AccessibilityAttributes {
  enum LiveRegion {
    LIVE_REGION_UNSPECIFIED = 0;
    LIVE_REGION_OFF = 1;
    LIVE_REGION_POLITE = 2;
    LIVE_REGION_ASSERTIVE = 3;
  }

  DynamicString label = 1;
  DynamicString description = 2;
  LiveRegion live = 3;
  DynamicBoolean hidden = 4;
}

message Metadata {
  google.protobuf.Struct extensions = 1;
}

message FunctionError {
  string code = 1;
  string message = 2;
}

message ErrorDetail {
  string path = 1;
  string code = 2;
  string message = 3;
}

// ============================================================================
// Component Envelope (Collision-Free Any + Struct Fallback)
// ============================================================================

message Component {
  string id = 1;
  string component = 2;
  string catalog_id = 3;
  AccessibilityAttributes accessibility = 4;
  Metadata metadata = 5;
  repeated CheckRule checks = 6;

  oneof payload {
    // Strongly typed catalog or 1P domain component proto (no global extension registry).
    google.protobuf.Any typed_payload = 7;
    // Dynamic zero-codegen fallback; always validated against CatalogModel at runtime.
    google.protobuf.Struct properties = 8;
  }
}

// ============================================================================
// Agent -> Renderer Messages (All 6 v1.0 Operations)
// ============================================================================

message CreateSurface {
  string surface_id = 1;
  string catalog_id = 2;
  bool send_data_model = 3;
  repeated Component components = 4;
  google.protobuf.Struct data_model = 5;
  Metadata metadata = 6;
  string root_id = 7;
  google.protobuf.Struct theme = 8;
}

message UpdateComponents {
  string surface_id = 1;
  repeated Component components = 2;
}

message UpdateDataModel {
  string surface_id = 1;
  string path = 2;

  // Edition 2023 explicit presence: when neither branch is set, the key at path is deleted.
  oneof data {
    google.protobuf.Value value = 3;
    google.protobuf.Any typed_value = 4;
  }
}

message DeleteSurface {
  string surface_id = 1;
}

message CallRendererFunction {
  string surface_id = 1;
  string function_call_id = 2;
  FunctionCall call_function = 3;
}

message AgentFunctionResponse {
  string function_call_id = 1;

  oneof result {
    google.protobuf.Value value = 2;
    FunctionError error = 3;
  }
}

message AgentToRendererMessage {
  string version = 1;

  oneof message {
    CreateSurface create_surface = 2;
    UpdateComponents update_components = 3;
    UpdateDataModel update_data_model = 4;
    DeleteSurface delete_surface = 5;
    CallRendererFunction call_renderer_function = 6;
    AgentFunctionResponse agent_function_response = 7;
  }
}

// ============================================================================
// Renderer -> Agent Messages (All 4 v1.0 Operations)
// ============================================================================

message ActionMessage {
  string name = 1;
  string surface_id = 2;
  string source_component_id = 3;
  string timestamp = 4;
  google.protobuf.Struct context = 5;
  string catalog_id = 6;
  string user_message = 7;
  Metadata metadata = 8;
}

message CallAgentFunction {
  string surface_id = 1;
  string function_call_id = 2;
  FunctionCall call_function = 3;
}

message RendererFunctionResponse {
  string function_call_id = 1;

  oneof result {
    google.protobuf.Value value = 2;
    FunctionError error = 3;
  }
}

message ErrorMessage {
  string code = 1;
  string message = 2;
  string surface_id = 3;
  string function_call_id = 4;
  string path = 5;
  repeated ErrorDetail details = 6;
}

message RendererToAgentMessage {
  string version = 1;

  oneof message {
    ActionMessage action = 2;
    CallAgentFunction call_agent_function = 3;
    RendererFunctionResponse renderer_function_response = 4;
    ErrorMessage error = 5;
  }
}
`;

/** Field tag constants matching {@link A2UI_V1_ENVELOPE_PROTO} tag-for-tag. */
export const ENVELOPE_TAGS = Object.freeze({
  AgentToRendererMessage: Object.freeze({
    version: 1,
    createSurface: 2,
    updateComponents: 3,
    updateDataModel: 4,
    deleteSurface: 5,
    callRendererFunction: 6,
    agentFunctionResponse: 7,
  }),
  CreateSurface: Object.freeze({
    surfaceId: 1,
    catalogId: 2,
    sendDataModel: 3,
    components: 4,
    dataModel: 5,
    metadata: 6,
    rootId: 7,
    theme: 8,
  }),
  UpdateComponents: Object.freeze({
    surfaceId: 1,
    components: 2,
  }),
  UpdateDataModel: Object.freeze({
    surfaceId: 1,
    path: 2,
    value: 3,
    typedValue: 4,
  }),
  DeleteSurface: Object.freeze({
    surfaceId: 1,
  }),
  CallRendererFunction: Object.freeze({
    surfaceId: 1,
    functionCallId: 2,
    callFunction: 3,
  }),
  AgentFunctionResponse: Object.freeze({
    functionCallId: 1,
    value: 2,
    error: 3,
  }),
  Component: Object.freeze({
    id: 1,
    component: 2,
    catalogId: 3,
    accessibility: 4,
    metadata: 5,
    checks: 6,
    typedPayload: 7,
    properties: 8,
  }),
  RendererToAgentMessage: Object.freeze({
    version: 1,
    action: 2,
    callAgentFunction: 3,
    rendererFunctionResponse: 4,
    error: 5,
  }),
  ActionMessage: Object.freeze({
    name: 1,
    surfaceId: 2,
    sourceComponentId: 3,
    timestamp: 4,
    context: 5,
    catalogId: 6,
    userMessage: 7,
    metadata: 8,
  }),
  CallAgentFunction: Object.freeze({
    surfaceId: 1,
    functionCallId: 2,
    callFunction: 3,
  }),
  RendererFunctionResponse: Object.freeze({
    functionCallId: 1,
    value: 2,
    error: 3,
  }),
  ErrorMessage: Object.freeze({
    code: 1,
    message: 2,
    surfaceId: 3,
    functionCallId: 4,
    path: 5,
    details: 6,
  }),
  ErrorDetail: Object.freeze({
    path: 1,
    code: 2,
    message: 3,
  }),
  FunctionError: Object.freeze({
    code: 1,
    message: 2,
  }),
  DataBinding: Object.freeze({
    path: 1,
  }),
  FunctionCall: Object.freeze({
    call: 1,
    catalogId: 2,
    args: 3,
  }),
  Dynamic: Object.freeze({
    literal: 1,
    dataBinding: 2,
    functionCall: 3,
  }),
  StringList: Object.freeze({
    values: 1,
  }),
  ChildList: Object.freeze({
    staticList: 1,
    template: 2,
  }),
  ChildListTemplate: Object.freeze({
    componentId: 1,
    path: 2,
  }),
  Action: Object.freeze({
    event: 1,
    functionCall: 2,
  }),
  ActionEvent: Object.freeze({
    name: 1,
    userMessage: 2,
    context: 3,
  }),
  CheckRule: Object.freeze({
    dataBinding: 1,
    functionCall: 2,
    message: 3,
  }),
  AccessibilityAttributes: Object.freeze({
    label: 1,
    description: 2,
    live: 3,
    hidden: 4,
  }),
  Metadata: Object.freeze({
    extensions: 1,
  }),
});
