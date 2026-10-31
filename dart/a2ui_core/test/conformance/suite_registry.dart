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

/// Maps each supported `core/*.yaml` conformance suite and `action` to the test
/// file in `test/conformance/` that executes it.
const Map<String, Map<String, String>> coreSuiteActions = {
  'core/actions.yaml': {
    'dispatch_action': 'actions_conformance_test.dart',
  },
  'core/catalog.yaml': {
    'derive': 'catalog_schema_conformance_test.dart',
    'from_json': 'catalog_schema_conformance_test.dart',
    'round_trip': 'catalog_schema_conformance_test.dart',
    'to_json': 'catalog_schema_conformance_test.dart',
    'validation_schema': 'catalog_schema_conformance_test.dart',
  },
  'core/composition_constraints.yaml': {
    'process_messages': 'message_processor_conformance_test.dart',
    'validate': 'message_processor_conformance_test.dart',
  },
  'core/data_context.yaml': {
    'resolve_path': 'data_model_conformance_test.dart',
  },
  'core/data_deletion.yaml': {
    'validate': 'data_model_conformance_test.dart',
  },
  'core/data_model.yaml': {
    'data_model': 'data_model_conformance_test.dart',
  },
  'core/data_model_pointers.yaml': {
    'validate': 'data_model_conformance_test.dart',
  },
  'core/error_responses.yaml': {
    'validate': 'validator_conformance_test.dart',
  },
  'core/expressions.yaml': {
    'parse_expression_template': 'expressions_conformance_test.dart',
    'validate': 'message_processor_conformance_test.dart',
  },
  'core/functions.yaml': {
    'evaluate_function': 'functions_conformance_test.dart',
    'validate': 'message_processor_conformance_test.dart',
  },
  'core/index_function.yaml': {
    'validate': 'message_processor_conformance_test.dart',
  },
  'core/message_processor_scaling.yaml': {
    'measure_growth': 'message_processor_scaling_conformance_test.dart',
  },
  'core/message_processor_v0_9.yaml': {
    'get_renderer_capabilities': 'message_processor_conformance_test.dart',
    'get_renderer_data_model': 'message_processor_conformance_test.dart',
    'process_messages': 'message_processor_conformance_test.dart',
    'resolve_path': 'message_processor_conformance_test.dart',
  },
  'core/message_processor_v1_0.yaml': {
    'get_renderer_capabilities': 'message_processor_conformance_test.dart',
    'get_renderer_data_model': 'message_processor_conformance_test.dart',
    'process_messages': 'message_processor_conformance_test.dart',
    'validate': 'message_processor_conformance_test.dart',
  },
  'core/multi_catalog.yaml': {
    'select_catalog': 'multi_catalog_conformance_test.dart',
    'validate': 'message_processor_conformance_test.dart',
  },
  'core/node_resolution.yaml': {
    'resolve_nodes': 'node_resolution_conformance_test.dart',
  },
  'core/reserved_keys.yaml': {
    'process_messages': 'message_processor_conformance_test.dart',
    'validate': 'validator_conformance_test.dart',
  },
  'core/rpc_functions.yaml': {
    'handle_rpc': 'rpc_conformance_test.dart',
  },
  'core/validation_result.yaml': {
    'validate': 'validator_conformance_test.dart',
  },
  'core/validator_v0_9.yaml': {
    'validate': 'validator_conformance_test.dart',
  },
  'core/validator_v1_0.yaml': {
    'validate': 'validator_conformance_test.dart',
  },
};

/// `core/*.yaml` suites that `a2ui_core` intentionally does not execute, paired
/// with the reason recorded in the executed-case manifest.
const Map<String, String> unsupportedCoreSuites = {
  'core/accessibility.yaml':
      'Accessibility checks require a rendered UI tree and run in the '
          'framework adapter harness.',
  'core/adapter_conformance.yaml':
      'Adapter conformance cases require a UI framework renderer and run in '
          'the framework adapter harness.',
  'core/agent_to_renderer.yaml':
      'Protocol envelope schema generation is not implemented in a2ui_core.',
  'core/common_types.yaml':
      'Common-type schema generation and validation are not implemented in '
          'a2ui_core.',
  'core/message_processor_v0_8.yaml':
      'Targets protocol v0.8, which a2ui_core does not implement.',
  'core/validator_v0_8.yaml':
      'Targets protocol v0.8, which a2ui_core does not implement.',
};
