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

import 'component_implementation.dart';

/// Publishes a [SurfaceModel] to its subtree.
class SurfaceScope extends InheritedWidget {
  /// Publishes [surface] to [child].
  const SurfaceScope({super.key, required this.surface, required super.child});

  /// The published surface.
  final SurfaceModel<ComponentImplementation> surface;

  /// The surface of the nearest enclosing [SurfaceScope], if any.
  static SurfaceModel<ComponentImplementation>? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<SurfaceScope>()?.surface;

  /// The surface of the nearest enclosing [SurfaceScope].
  static SurfaceModel<ComponentImplementation> of(BuildContext context) {
    final SurfaceModel<ComponentImplementation>? surface = maybeOf(context);
    assert(surface != null, 'No A2uiSurface above this context.');
    return surface!;
  }

  @override
  bool updateShouldNotify(SurfaceScope oldWidget) =>
      !identical(surface, oldWidget.surface);
}
