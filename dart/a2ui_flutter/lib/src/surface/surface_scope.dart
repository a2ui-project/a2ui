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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/widgets.dart';

import '../catalog/component_implementation.dart';

/// Ambient context provider for an A2UI surface.
///
/// Propagates the [SurfaceModel] and active [NodeResolver] down the
/// Flutter widget tree.
class A2uiSurfaceScope extends InheritedWidget {
  /// The active surface model.
  final SurfaceModel<FlutterComponentImplementation> surface;

  /// The node resolver managing component resolution for this surface.
  final NodeResolver<FlutterComponentImplementation> resolver;

  const A2uiSurfaceScope({
    super.key,
    required this.surface,
    required this.resolver,
    required super.child,
  });

  /// Retrieves the closest [A2uiSurfaceScope] ancestor.
  static A2uiSurfaceScope of(BuildContext context) {
    final A2uiSurfaceScope? scope = maybeOf(context);
    assert(scope != null, 'No A2uiSurfaceScope found in context');
    return scope!;
  }

  /// Retrieves the closest [A2uiSurfaceScope] ancestor, or null if none exists.
  static A2uiSurfaceScope? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<A2uiSurfaceScope>();
  }

  @override
  bool updateShouldNotify(A2uiSurfaceScope oldWidget) {
    return surface != oldWidget.surface || resolver != oldWidget.resolver;
  }
}
