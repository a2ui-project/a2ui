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

import 'package:flutter/widgets.dart';

import 'fallbacks.dart';

/// Publishes a surface's [A2uiFallbacks] to its nodes.
class FallbacksScope extends InheritedWidget {
  const FallbacksScope({
    super.key,
    required this.fallbacks,
    required super.child,
  });

  /// The published fallbacks; null when the surface has none.
  final A2uiFallbacks? fallbacks;

  /// The fallbacks of the nearest enclosing surface, if any.
  static A2uiFallbacks? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<FallbacksScope>()?.fallbacks;

  @override
  bool updateShouldNotify(FallbacksScope oldWidget) =>
      fallbacks != oldWidget.fallbacks;
}
