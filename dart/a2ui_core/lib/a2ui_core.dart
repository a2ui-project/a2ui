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

/// The A2UI core SDK: protocol messages, catalogs, reactive state models and
/// payload validation, shared by renderers and agents.
///
/// Implements protocol v0.9, v0.9.1 and v1.0 message envelopes.
library;

// Basic catalog with evaluable functions.
export 'src/basic_catalog/basic_catalog.dart';
// Protocol models.
export 'src/core/catalog.dart';
export 'src/core/common.dart';
export 'src/core/common_schemas.dart';
export 'src/core/component_model.dart';
// State management.
export 'src/core/data_model.dart';
export 'src/core/messages.dart';
export 'src/core/renderer_capabilities.dart';
export 'src/core/surface_group_model.dart';
export 'src/core/surface_model.dart';
export 'src/core/validation_result.dart';
export 'src/expressions/expression_parser.dart';
export 'src/primitives/cancellation.dart';
export 'src/primitives/errors.dart';
// Event notifications for discrete lifecycle events.
export 'src/primitives/event_notifier.dart';
// Protocol versions and version compatibility.
export 'src/primitives/protocol_version.dart';
// Reactivity (re-exports preact_signals primitives).
export 'src/primitives/reactivity.dart';
export 'src/primitives/reference_schema.dart'
    show ComponentRefMap, ListRef, NestedRef, RefFields, RefKind, SingleRef;
export 'src/primitives/semver.dart' hide releaseNumbers;
export 'src/primitives/uax31.dart';
export 'src/processing/adapters/v0_9_adapter.dart';
export 'src/processing/adapters/v1_0_adapter.dart';
export 'src/processing/adapters/version_adapter.dart';
// Processing & expressions.
export 'src/processing/operations.dart';
export 'src/processing/processor.dart';
// Resolution & rendering support.
export 'src/resolution/component_context.dart';
export 'src/resolution/component_node.dart'
    hide MutableComponentNode, sameValue;
export 'src/resolution/data_context.dart' hide createSurfaceDataContext;
export 'src/resolution/generic_binder.dart';
export 'src/resolution/node_resolver.dart';
export 'src/resolution/resolved_binding.dart';
export 'src/rpc/rpc_handler.dart';
// Payload validation.
export 'src/validation/schema_resolution.dart'
    show inlineLocalRefs, resolveSchemaRefs;
export 'src/validation/validation_config.dart';
export 'src/validation/validator.dart';
