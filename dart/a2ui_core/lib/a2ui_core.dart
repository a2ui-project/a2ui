// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/// Core A2UI protocol implementation for Dart.
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
export 'src/core/surface_group_model.dart';
export 'src/core/surface_model.dart';
export 'src/primitives/cancellation.dart';
export 'src/primitives/data_path.dart';
export 'src/primitives/errors.dart';
// Event notifications for discrete lifecycle events.
export 'src/primitives/event_notifier.dart';
// Reactivity (re-exports preact_signals primitives).
export 'src/primitives/reactivity.dart';
export 'src/processing/basic_functions.dart';
export 'src/processing/expressions.dart';
// Processing & expressions.
export 'src/processing/processor.dart';
export 'src/rendering/binder.dart';
