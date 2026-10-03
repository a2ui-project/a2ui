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

import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import 'data_model.dart';
import 'ui_models.dart';

/// A callback to get a component definition by its ID.
typedef GetComponentCallback = Component? Function(String componentId);

/// A callback that builds a child widget for a catalog item.
typedef ChildBuilderCallback =
    Widget Function(String id, [DataContext? dataContext]);

/// A callback that builds an example of a catalog item.
///
/// The returned string must be a valid JSON representation of a list of
/// component objects. One of the components in the list must have the `id`
/// 'root'.
typedef ExampleBuilderCallback = String Function();

/// A callback that builds a widget for a catalog item.
typedef CatalogWidgetBuilder = Widget Function(CatalogItemContext itemContext);

/// Context provided to a [CatalogItem]'s widget builder.
final class CatalogItemContext {
  /// Creates a [CatalogItemContext] with the required parameters.
  ///
  /// All parameters are required to ensure the widget builder has complete
  /// context for rendering and interaction.
  CatalogItemContext({
    required this.data,
    required this.id,
    required this.type,
    required this.buildChild,
    required this.dispatchEvent,
    required this.buildContext,
    required this.dataContext,
    required this.getComponent,
    required this.getCatalogItem,
    required this.surfaceId,
    required this.reportError,
  });

  /// The parsed data for this component from the AI-generated definition.
  final Object data;

  /// The unique identifier for this component instance.
  final String id;

  /// The type of this component.
  final String type;

  /// Callback to build a child widget by its component ID.
  final ChildBuilderCallback buildChild;

  /// Callback to dispatch UI events (e.g., button taps) back to the system.
  final DispatchEventCallback dispatchEvent;

  /// The Flutter [BuildContext] for this widget.
  final BuildContext buildContext;

  /// The [DataContext] for accessing and modifying the data model.
  final DataContext dataContext;

  /// Callback to retrieve a component definition by its ID.
  final GetComponentCallback getComponent;

  /// Callback to retrieve a catalog item definition by its type name.
  final CatalogItem? Function(String type) getCatalogItem;

  /// The ID of the surface this component belongs to.
  final String surfaceId;

  /// Callback to report an error that occurred within this component.
  final void Function(Object error, StackTrace? stack) reportError;
}

/// Defines a UI layout type, its schema, and how to build its widget.
@immutable
final class CatalogItem {
  /// Creates a new [CatalogItem].
  const CatalogItem({
    required this.name,
    required Schema dataSchema,
    required this.widgetBuilder,
    this.exampleData = const [],
    this.isImplicitlyFlexible = false,
  }) : _originalSchema = dataSchema;

  /// The widget type name used in JSON, e.g., 'TextChatMessage'.
  final String name;

  final Schema _originalSchema;

  /// The schema definition for this widget's data.
  ///
  /// It should contain all of the component specific properties, but not the
  /// `component` discriminator property, which will be automatically injected
  /// using the [name]. If the `component` property is already defined in the
  /// schema, it will be ignored.
  ObjectSchema get dataSchema {
    final Map<String, Object?> originalMap = _originalSchema.value;
    final Map<String, Object?> properties =
        originalMap['properties'] as Map<String, Object?>? ??
        <String, Object?>{};
    final List<Object?> requiredProps =
        originalMap['required'] as List<Object?>? ?? <Object?>[];

    final schema = ObjectSchema.fromMap(<String, Object?>{
      ...originalMap,
      'properties': <String, Object?>{
        ...properties,
        'component': <String, Object?>{
          'type': 'string',
          'enum': <String>[name],
        },
      },
      'required': <Object?>['component', ...requiredProps],
      'additionalProperties': true,
    });
    return schema;
  }

  /// The builder for this widget.
  final CatalogWidgetBuilder widgetBuilder;

  /// Whether this component should be implicitly flexible when placed in a flex
  /// container (like Row/Column).
  ///
  /// If true, a [Row] or [Column] will automatically assign a flex weight to
  /// this component if one is not explicitly provided, wrapping it in a
  /// [Flexible] widget.
  /// This is useful for components that require bounded constraints, like
  /// [TextField] or [ListView].
  final bool isImplicitlyFlexible;

  /// A list of builder functions that each return a JSON string representing an
  /// example usage of this widget.
  ///
  /// Each returned string must be a valid JSON representation of a list of
  /// component objects. For the example to be renderable, one of the
  /// components in the list must have the `id` 'root', which will be used as
  /// the entry point for rendering.
  ///
  /// To catch real data returned by the AI for debugging or creating new
  /// examples, [configure logging](https://github.com/flutter/genui/blob/main/packages/genui/README.md#how-can-i-configure-logging)
  /// to `Level.ALL` and search for the string `"definition": {` in the logs.
  final List<ExampleBuilderCallback> exampleData;
}
