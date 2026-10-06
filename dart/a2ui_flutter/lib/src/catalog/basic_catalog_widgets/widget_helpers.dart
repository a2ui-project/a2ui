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

import '../../model/catalog_item.dart';
import '../../model/data_model.dart';
import '../../primitives/logging.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';

/// Builder function for creating a widget from a template and a list of data.
///
/// This is used by [ComponentChildrenBuilder] when children are defined by a
/// `template` which includes a `dataBinding` to a list in the [DataContext].
typedef TemplateListWidgetBuilder =
    Widget Function(
      BuildContext context,
      Object? data,
      String componentId,
      String path,
    );

/// Builder function for creating a parent widget given a list of pre-built
/// [childIds].
///
/// This is used by [ComponentChildrenBuilder] when children are defined as an
/// explicit list of component IDs.
typedef ExplicitListWidgetBuilder =
    Widget Function(
      List<String> childIds,
      ChildBuilderCallback buildChild,
      GetComponentCallback getComponent,
      DataContext dataContext,
    );

/// A helper widget to build widgets from component data that contains a list
/// of children.
///
/// This widget handles two cases for defining children:
/// 1. An explicit list of child widget IDs.
/// 2. A template with a data binding to a list of data.
///
/// The `childrenData` can be a `List<String>` of child IDs, or a [JsonMap]
/// defining a template structure with `path` and `componentId` keys.
class ComponentChildrenBuilder extends StatelessWidget {
  /// Creates a new [ComponentChildrenBuilder].
  const ComponentChildrenBuilder({
    required this.childrenData,
    required this.dataContext,
    required this.buildChild,
    required this.getComponent,
    required this.explicitListBuilder,
    required this.templateListWidgetBuilder,
    super.key,
  });

  /// The data that defines the children to build.
  final Object? childrenData;

  /// The data context for the children.
  final DataContext dataContext;

  /// The callback to build a child widget.
  final ChildBuilderCallback buildChild;

  /// The callback to get a component's data by ID.
  final GetComponentCallback getComponent;

  /// The builder for an explicit list of children.
  final ExplicitListWidgetBuilder explicitListBuilder;

  /// The builder for a template-based list of children.
  final TemplateListWidgetBuilder templateListWidgetBuilder;

  @override
  Widget build(BuildContext context) {
    if (childrenData is List) {
      final List<String> explicitList = (childrenData as List).map((e) {
        if (e is String) return e;
        return e.toString();
      }).toList();

      return explicitListBuilder(
        explicitList,
        buildChild,
        getComponent,
        dataContext,
      );
    }

    if (childrenData is JsonMap) {
      final childrenMap = childrenData as JsonMap;
      if (childrenMap.containsKey('path') &&
          childrenMap.containsKey('componentId')) {
        final path = childrenMap['path'] as String;
        final componentId = childrenMap['componentId'] as String;
        genUiLogger.finest(
          'Widget $componentId subscribing to ${dataContext.path}',
        );
        return BoundObject(
          dataContext: dataContext,
          value: {'path': path},
          builder: (context, data) {
            if (data != null) {
              return templateListWidgetBuilder(
                context,
                data,
                componentId,
                path,
              );
            }
            return const SizedBox.shrink();
          },
        );
      }
    }
    return const SizedBox.shrink();
  }
}

/// Builds a child widget, wrapping it in a [Flexible] if a weight is provided
/// in the component.
Widget buildWeightedChild({
  required String componentId,
  required DataContext dataContext,
  required ChildBuilderCallback buildChild,
  required int? weight,
  Key? key,
  FlexFit flexFit = FlexFit.loose,
}) {
  final Widget childWidget = buildChild(componentId, dataContext);
  if (weight != null) {
    return Flexible(key: key, flex: weight, fit: flexFit, child: childWidget);
  }
  if (key != null) {
    return KeyedSubtree(key: key, child: childWidget);
  }
  return childWidget;
}

/// Converts a list of validation checks into a single expression that evaluates
/// to true if all checks pass.
Object? checksToExpression(List<JsonMap>? checks) {
  if (checks == null || checks.isEmpty) {
    return true;
  }

  // Combine all checks into a single 'and' condition
  return {
    'functionCall': {
      'call': 'and',
      'args': {'values': checks.map((c) => c['condition']).toList()},
    },
  };
}
