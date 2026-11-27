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

import 'component_props.dart';

/// Builds the widget for one child node of the component being built.
typedef ChildWidgetBuilder = Widget Function(
  ComponentNode<ComponentImplementation> child,
);

/// Builds the widget for a resolved [node].
///
/// [props] is the node's current resolved properties. Render child nodes
/// through [buildChild]. A builder that wraps each child in another widget
/// puts `KeyedSubtree(key: NodeKey(child.instanceId), ...)` outermost.
typedef ComponentWidgetBuilder = Widget Function(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
);

/// The key of the widget built for the node with the instance id [value].
///
/// Never equal to a [ValueKey] with the same value, so an app's own keys
/// match none of these widgets.
class NodeKey extends ValueKey<String> {
  const NodeKey(super.value);
}

/// A catalog component with a Flutter implementation.
///
/// Authors can define components directly with typed [ParameterDefinition]s
/// using [ComponentImplementation.define] or
/// [ComponentImplementation.fromDefinition] (requiring no `json_schema_builder`
/// import), or pass a legacy JSON Schema via [ComponentImplementation].
/// [builder] turns a resolved node of this component into a widget.
class ComponentImplementation extends ComponentApi {
  /// Builds the widget for a resolved node of this component.
  final ComponentWidgetBuilder builder;

  const ComponentImplementation({
    required super.name,
    required super.schema,
    required this.builder,
    super.allowedParents,
    super.allowedChildren,
    super.metadata,
  });

  /// Creates a [ComponentImplementation] backed directly by a canonical
  /// [ComponentDefinition] with no `json_schema_builder` dependency.
  const ComponentImplementation.fromDefinition(
    super.definition, {
    required this.builder,
  }) : super.fromDefinition();

  /// Ergonomically defines a Flutter component implementation using typed
  /// [ParameterDefinition]s without importing `json_schema_builder`.
  ComponentImplementation.define({
    required super.name,
    super.description,
    super.checkable,
    super.parameters,
    super.atLeastOneOf,
    super.allowedParents,
    super.allowedChildren,
    super.metadata,
    super.deprecated,
    super.deprecatedReason,
    required this.builder,
  }) : super.define();
}

/// A catalog whose components carry Flutter implementations.
typedef CatalogImplementation =
    Catalog<ComponentImplementation, FunctionImplementation>;
