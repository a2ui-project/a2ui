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

/// Function signature for rendering a resolved child [ComponentNode].
typedef ChildWidgetBuilder =
    Widget Function(ComponentNode<FlutterComponentImplementation> child);

/// A concrete component implementation for Flutter rendering.
///
/// Combines the component type name, JSON Schema, and Flutter widget builder
/// into a single self-contained object that can be registered into a [Catalog].
class FlutterComponentImplementation extends ComponentApi {
  /// The function constructing a Flutter widget from a resolved
  /// [ComponentNode].
  final Widget Function(
    BuildContext context,
    ComponentNode<FlutterComponentImplementation> node,
    ChildWidgetBuilder buildChild,
  )
  builder;

  const FlutterComponentImplementation({
    required super.name,
    required super.schema,
    required this.builder,
  });
}
