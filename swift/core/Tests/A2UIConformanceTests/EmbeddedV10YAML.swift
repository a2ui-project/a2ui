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

enum EmbeddedV10YAML {
  static let compositionConstraints = """
    - name: test_composition_surface_implicit_parent_container
      description: Verifies root components treating Surface as canonical parent container when allowedParents includes Surface.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "s1"
                catalogId: "basic"
                components:
                  - id: root
                    component: Column
                    children: [t1]
                  - id: t1
                    component: Text
                    text: "Hello World"
      expect:
        surfaces:
          s1:
            components:
              root:
                component: Column
                children: [t1]
              t1:
                component: Text
                text: "Hello World"

    - name: test_composition_unallowed_parent_error
      description: Verifies validation error thrown when component is placed under an unallowed parent component type.
      catalog:
        protocolVersion: "v1.0"
        catalogSchema:
          catalogId: "custom"
          components:
            ColumnHeader:
              allowedParents: ["Column"]
            Row:
              type: "object"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "s1"
                catalogId: "custom"
                components:
                  - id: root
                    component: Row
                    children: [invalid_header]
                  - id: invalid_header
                    component: ColumnHeader
      expectError:
        category: "ValidationError"
        code: "UNALLOWED_PARENT"
        message: "Component 'invalid_header' (ColumnHeader) cannot be placed under parent 'root' (Row). Allowed parents: ['Column']."

    - name: test_composition_unallowed_child_error
      description: Verifies validation error thrown when container contains an unallowed child component type.
      catalog:
        protocolVersion: "v1.0"
        catalogSchema:
          catalogId: "custom"
          components:
            RestrictedBox:
              allowedChildren: ["Text", "Button"]
            Video:
              type: "object"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "s1"
                catalogId: "custom"
                components:
                  - id: root
                    component: RestrictedBox
                    children: [v1]
                  - id: v1
                    component: Video
      expectError:
        category: "ValidationError"
        code: "UNALLOWED_CHILD"
        message: "Container 'root' (RestrictedBox) cannot contain child 'v1' (Video). Allowed children: ['Text', 'Button']."
    """

  static let dataDeletion = """
    - name: test_data_deletion_value_null
      description: Verifies that updateDataModel with value=null deletes the specified JSON Pointer path.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "s1"
                catalogId: "basic"
                dataModel:
                  user:
                    profile:
                      name: "Alice"
                      bio: "Software Engineer"
        - payload:
            - version: "v1.0"
              updateDataModel:
                surfaceId: "s1"
                path: "/user/profile/bio"
                value: null
      expect:
        surfaces:
          s1:
            dataModel:
              user:
                profile:
                  name: "Alice"

    - name: test_data_deletion_nested_pointer_sibling_preservation
      description: Verifies deleting a child property via value=null preserves sibling keys in parent object.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "s1"
                catalogId: "basic"
                dataModel:
                  settings:
                    notifications:
                      email: true
                      push: false
                      sms: true
        - payload:
            - version: "v1.0"
              updateDataModel:
                surfaceId: "s1"
                path: "/settings/notifications/email"
                value: null
      expect:
        surfaces:
          s1:
            dataModel:
              settings:
                notifications:
                  push: false
                  sms: true

    - name: test_data_deletion_top_level_key
      description: Verifies deleting a top-level JSON Pointer path via value=null.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "s1"
                catalogId: "basic"
                dataModel:
                  persistentData: "keep"
                  transientData: "remove"
        - payload:
            - version: "v1.0"
              updateDataModel:
                surfaceId: "s1"
                path: "/transientData"
                value: null
      expect:
        surfaces:
          s1:
            dataModel:
              persistentData: "keep"

    - name: test_data_deletion_parent_object_recursive
      description: Verifies deleting an intermediate parent object key via value=null recursively removes all nested child properties.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "s1"
                catalogId: "basic"
                dataModel:
                  settings:
                    notifications:
                      email: true
                      push: false
                      sms: true
                    theme: "dark"
        - payload:
            - version: "v1.0"
              updateDataModel:
                surfaceId: "s1"
                path: "/settings/notifications"
                value: null
      expect:
        surfaces:
          s1:
            dataModel:
              settings:
                theme: "dark"

    - name: test_data_deletion_all_keys_empty_data_model
      description: Verifies deleting the only top-level key via value=null results in an empty dataModel.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "s1"
                catalogId: "basic"
                dataModel:
                  user:
                    profile:
                      name: "Alice"
        - payload:
            - version: "v1.0"
              updateDataModel:
                surfaceId: "s1"
                path: "/user"
                value: null
      expect:
        surfaces:
          s1:
            dataModel: {}
    """

  static let indexFunction = """
    - name: test_index_function_in_collection_loop
      description: Verifies built-in @index function evaluation during collection template iteration.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: main
                catalogId: basic
                dataModel:
                  tasks: ["Buy Milk", "Clean Kitchen", "Pay Bills"]
                components:
                  - id: root
                    component: Column
                    children: [list]
                  - id: list
                    component: List
                    children:
                      path: "/tasks"
                      componentId: row
                  - id: row
                    component: Row
                    children: [item_index, item_text]
                  - id: item_index
                    component: Text
                    text:
                      call: "@index"
                      args: {}
                  - id: item_text
                    component: Text
                    text:
                      path: ""
      expect:
        surfaces:
          main:
            components:
              item_index_0:
                text: "0"
              item_text_0:
                text: "Buy Milk"
              item_index_1:
                text: "1"
              item_text_1:
                text: "Clean Kitchen"
              item_index_2:
                text: "2"
              item_text_2:
                text: "Pay Bills"

    - name: test_index_function_with_offset
      description: Verifies built-in @index function with offset argument (@index(1) for 1-based indexing).
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: main
                catalogId: basic
                dataModel:
                  players: ["Alice", "Bob"]
                components:
                  - id: root
                    component: List
                    children:
                      path: "/players"
                      componentId: text
                  - id: text
                    component: Text
                    text:
                      call: "@index"
                      args:
                        offset: 1
      expect:
        surfaces:
          main:
            components:
              text_0:
                text: "1"
              text_1:
                text: "2"

    - name: test_index_function_nested_path
      description: Verifies built-in @index function evaluation inside a deeply nested child property path of a template list.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: main
                catalogId: basic
                dataModel:
                  users:
                    - name: Alice
                      address:
                        city: Seattle
                    - name: Bob
                      address:
                        city: Portland
                components:
                  - id: root
                    component: List
                    children:
                      path: "/users"
                      componentId: col
                  - id: col
                    component: Column
                    children: [nested_text]
                  - id: nested_text
                    component: Text
                    text:
                      call: "@index"
                      args:
                        offset: 1
      expect:
        surfaces:
          main:
            components:
              nested_text_0:
                text: "1"
              nested_text_1:
                text: "2"

    - name: test_index_function_outside_loop_error
      description: Verifies error thrown when @index function is called outside a collection iteration scope.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "main"
                catalogId: "basic"
                components:
                  - id: root
                    component: Text
                    text:
                      call: "@index"
                      args: {}
          expectError:
            category: "ValidationError"
            message: "@index function can only be evaluated inside a collection template iteration scope."
    """

  static let validationResult = """
    - name: test_validation_result_dynamic_object_return
      description: Verifies CheckRule evaluation capturing dynamic ValidationResult object returned from custom validation function.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "form_surface"
                catalogId: "basic"
                dataModel:
                  email: "invalid-email-address"
                components:
                  - id: root
                    component: TextField
                    label: "Email"
                    value:
                      path: "/email"
                    checks:
                      - condition:
                          call: "email"
                          args:
                            value:
                              path: "/email"
      expect:
        surfaces:
          form_surface:
            validationResult:
              root:
                valid: false
                code: "INVALID_EMAIL"
                message: "Please enter a valid email address (e.g. user@example.com)."
                severity: "error"

    - name: test_validation_result_boolean_fallback
      description: Verifies CheckRule evaluation when validation function returns primitive boolean, falling back to CheckRule message.
      catalog:
        protocolVersion: "v1.0"
      action: validate
      steps:
        - payload:
            - version: "v1.0"
              createSurface:
                surfaceId: "form_surface"
                catalogId: "basic"
                dataModel:
                  age: 15
                components:
                  - id: root
                    component: TextField
                    label: "Age"
                    value:
                      path: "/age"
                    checks:
                      - condition:
                          call: "numeric"
                          args:
                            value:
                              path: "/age"
                            min: 18
                        message: "Must be 18 or older."
      expect:
        surfaces:
          form_surface:
            validationResult:
              root:
                valid: false
                message: "Must be 18 or older."
                severity: "error"
    """

  static let rpcFunctions = """
    - name: test_rpc_call_renderer_function_success
      description: Verifies agent-initiated callRendererFunction on a function with allowedCallers=rendererOrAgent.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-101"
            callFunction:
              call: "playMedia"
              catalogId: "media_catalog"
              args:
                mediaId: "video-789"
                autoplay: true
        functionMetadata:
          playMedia:
            allowedCallers: "rendererOrAgent"
            requiresUserActivation: false
      expect:
        response:
          version: "v1.0"
          rendererFunctionResponse:
            functionCallId: "call-101"
            value:
              playing: true
              timestamp: 0

    - name: test_rpc_call_renderer_function_unauthorized_caller
      description: Verifies callRendererFunction fails with INVALID_FUNCTION_CALL when allowedCallers is rendererOnly.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-102"
            callFunction:
              call: "internalStateReset"
              catalogId: "system_catalog"
              args: {}
        functionMetadata:
          internalStateReset:
            allowedCallers: "rendererOnly"
            requiresUserActivation: false
      expect:
        response:
          version: "v1.0"
          rendererFunctionResponse:
            functionCallId: "call-102"
            error:
              code: "INVALID_FUNCTION_CALL"
              message: "Function 'internalStateReset' cannot be called by agent (allowedCallers is rendererOnly)."

    - name: test_rpc_call_renderer_function_requires_user_activation
      description: Verifies callRendererFunction execution when requiresUserActivation is true and user gesture is present.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        userActivationPresent: true
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-103"
            callFunction:
              call: "openExternalUrl"
              catalogId: "basic"
              args:
                url: "https://example.com/details"
        functionMetadata:
          openExternalUrl:
            allowedCallers: "rendererOrAgent"
            requiresUserActivation: true
      expect:
        response:
          version: "v1.0"
          rendererFunctionResponse:
            functionCallId: "call-103"
            value:
              opened: true

    - name: test_rpc_call_agent_function_dispatch
      description: Verifies renderer-initiated callAgentFunction message generation and response correlation via functionCallId.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        outboundCall:
          surfaceId: "main_surface"
          functionCallId: "agent-call-55"
          callFunction:
            call: "queryInventory"
            catalogId: "store_catalog"
            args:
              sku: "ITEM-404"
        inboundResponse:
          version: "v1.0"
          agentFunctionResponse:
            functionCallId: "agent-call-55"
            value:
              inStock: 12
              price: "$29.99"
      expect:
        correlatedCallId: "agent-call-55"
        result:
          inStock: 12
          price: "$29.99"

    - name: test_rpc_call_renderer_function_user_activation_denied
      description: Verifies callRendererFunction fails with INVALID_FUNCTION_CALL when requiresUserActivation is true but user gesture context is absent.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        userActivationPresent: false
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-104"
            callFunction:
              call: "openExternalUrl"
              catalogId: "basic"
              args:
                url: "https://example.com/details"
        functionMetadata:
          openExternalUrl:
            allowedCallers: "rendererOrAgent"
            requiresUserActivation: true
      expect:
        response:
          version: "v1.0"
          rendererFunctionResponse:
            functionCallId: "call-104"
            error:
              code: "INVALID_FUNCTION_CALL"
              message: "Function 'openExternalUrl' requires user activation context to execute."

    - name: test_rpc_call_renderer_function_execution_exception
      description: Verifies callRendererFunction handles runtime function execution exceptions and returns EXECUTION_ERROR.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-105"
            callFunction:
              call: "failingFunction"
              catalogId: "basic"
              args: {}
        functionMetadata:
          failingFunction:
            allowedCallers: "rendererOrAgent"
            requiresUserActivation: false
      expect:
        response:
          version: "v1.0"
          rendererFunctionResponse:
            functionCallId: "call-105"
            error:
              code: "EXECUTION_ERROR"
              message: "An error occurred during function execution."

    - name: test_rpc_call_renderer_function_agent_only_boundary
      description: Verifies agent-initiated callRendererFunction on a function with allowedCallers=agentOnly.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-106"
            callFunction:
              call: "syncState"
              catalogId: "basic"
              args: {}
        functionMetadata:
          syncState:
            allowedCallers: "agentOnly"
            requiresUserActivation: false
      expect:
        response:
          version: "v1.0"
          rendererFunctionResponse:
            functionCallId: "call-106"
            value: null

    - name: test_rpc_call_renderer_function_unregistered_function
      description: Verifies callRendererFunction fails with INVALID_FUNCTION_CALL when calling an unregistered function.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-107"
            callFunction:
              call: "unknownFunc"
              catalogId: "basic"
              args: {}
        functionMetadata: {}
      expect:
        response:
          version: "v1.0"
          rendererFunctionResponse:
            functionCallId: "call-107"
            error:
              code: "INVALID_FUNCTION_CALL"
              message: "Function not found: unknownFunc"

    - name: test_rpc_call_renderer_function_unregistered_catalog
      description: Verifies callRendererFunction fails with INVALID_FUNCTION_CALL when specifying an unregistered catalogId.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-108"
            callFunction:
              call: "playMedia"
              catalogId: "non_existent_catalog"
              args: {}
        functionMetadata:
          playMedia:
            allowedCallers: "rendererOrAgent"
      expect:
        response:
          version: "v1.0"
          rendererFunctionResponse:
            functionCallId: "call-108"
            error:
              code: "INVALID_FUNCTION_CALL"
              message: "Catalog not found: non_existent_catalog"

    - name: test_rpc_call_renderer_function_invalid_payload_missing_call_function
      description: Verifies envelope/schema validation error when callRendererFunction is missing required callFunction property.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        message:
          version: "v1.0"
          callRendererFunction:
            functionCallId: "call-109"
      expect:
        error:
          message: "callFunction"

    - name: test_rpc_agent_function_response_inbound
      description: Verifies inbound agentFunctionResponse message processing by MessageProcessor.
      catalog:
        protocolVersion: "v1.0"
      action: handle_rpc
      args:
        message:
          version: "v1.0"
          agentFunctionResponse:
            functionCallId: "call-201"
            value:
              status: "verified"
      expect:
        response: null
    """

  static let embedded: [String: String] = [
    "core/composition_constraints.yaml": compositionConstraints,
    "core/data_deletion.yaml": dataDeletion,
    "core/index_function.yaml": indexFunction,
    "core/validation_result.yaml": validationResult,
    "core/rpc_functions.yaml": rpcFunctions,
  ]
}
