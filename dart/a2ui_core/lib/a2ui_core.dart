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
/// Implements protocol v0.9.
library;

// Protocol models.
export 'src/core/catalog.dart';
export 'src/core/common.dart';
export 'src/core/common_schemas.dart';
export 'src/core/component_model.dart';
// Rendering support.
export 'src/core/contexts.dart';
// State management.
export 'src/core/data_model.dart';
export 'src/core/messages.dart';
export 'src/core/minimal_catalog.dart';
export 'src/core/renderer_capabilities.dart';
export 'src/core/surface_group_model.dart';
export 'src/core/surface_model.dart';
export 'src/primitives/cancellation.dart';
export 'src/primitives/data_path.dart';
export 'src/primitives/errors.dart';
// Event notifications for discrete lifecycle events.
export 'src/primitives/event_notifier.dart';
// Protocol version gating (v0.9 only).
export 'src/primitives/protocol_version.dart';
// Reactivity (re-exports preact_signals primitives).
export 'src/primitives/reactivity.dart';
export 'src/processing/basic_functions.dart';
export 'src/processing/expressions.dart';
// Processing & expressions.
export 'src/processing/processor.dart';
export 'src/rendering/binder.dart';
// Payload validation. The component-graph and reference helpers behind the
// validator stay package-private: `A2uiValidator` is the entry point.
export 'src/validation/validator.dart';
