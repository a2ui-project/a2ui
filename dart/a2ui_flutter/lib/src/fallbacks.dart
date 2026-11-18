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

import 'a2ui_surface.dart';
import 'component_implementation.dart';
import 'node_view.dart';

/// Builds the widget shown for an unresolved node described by [info], or
/// returns null to show nothing.
///
/// It may run more than once per build (see [buildChildOrNull]), so keep it
/// free of side effects. An exception it throws is logged, and the node
/// shows nothing.
typedef A2uiFallbackBuilder<I> = Widget? Function(BuildContext context, I info);

/// The widgets an [A2uiSurface] shows for nodes that cannot render yet, or
/// cannot render at all.
///
/// A missing builder, or one that returns null, shows nothing, which takes no
/// layout space. Fallbacks only change what users see: the surface reports
/// unknown types and cycles to its error listeners either way.
@immutable
class A2uiFallbacks {
  const A2uiFallbacks({this.pending, this.error});

  /// The widget for a component that has not arrived yet, including the root
  /// before it arrives. The component's own widget replaces it in place when
  /// the component arrives.
  final A2uiFallbackBuilder<A2uiPendingInfo>? pending;

  /// The widget for a component that will not render unless the agent
  /// changes it, such as one of an unknown type or one that repeats an
  /// ancestor.
  final A2uiFallbackBuilder<A2uiErrorInfo>? error;

  @override
  bool operator ==(Object other) =>
      other is A2uiFallbacks &&
      other.pending == pending &&
      other.error == error;

  @override
  int get hashCode => Object.hash(pending, error);
}

/// Describes a component that has not arrived yet.
@immutable
class A2uiPendingInfo {
  const A2uiPendingInfo({required this.componentId, this.parentComponentType});

  /// The id of the component that has not arrived: the surface's root id
  /// before the root arrives.
  final String componentId;

  /// The type of the component whose child this is; null for the root.
  final String? parentComponentType;

  @override
  bool operator ==(Object other) =>
      other is A2uiPendingInfo &&
      other.componentId == componentId &&
      other.parentComponentType == parentComponentType;

  @override
  int get hashCode => Object.hash(componentId, parentComponentType);

  @override
  String toString() =>
      'A2uiPendingInfo(componentId: $componentId, '
      'parentComponentType: $parentComponentType)';
}

/// Describes a component that will not render unless the agent changes it.
@immutable
class A2uiErrorInfo {
  const A2uiErrorInfo({
    required this.componentId,
    this.parentComponentType,
    required this.error,
  });

  /// The id of the component.
  final String componentId;

  /// The type of the component whose child this is; null for the root.
  final String? parentComponentType;

  /// Why the component does not render.
  final A2uiFallbackError error;

  @override
  bool operator ==(Object other) =>
      other is A2uiErrorInfo &&
      other.componentId == componentId &&
      other.parentComponentType == parentComponentType &&
      other.error == error;

  @override
  int get hashCode => Object.hash(componentId, parentComponentType, error);

  @override
  String toString() =>
      'A2uiErrorInfo(componentId: $componentId, '
      'parentComponentType: $parentComponentType, error: $error)';
}

/// Why a component does not render.
@immutable
class A2uiFallbackError {
  const A2uiFallbackError({required this.type, this.componentType});

  /// The kind of error: [unknownType], [cyclic], or a kind added later.
  final String type;

  /// The declared type, for [unknownType].
  final String? componentType;

  /// The component's type, or the catalog it names, is not available.
  static const String unknownType = 'unknown-type';

  /// The component repeats one of its ancestors.
  static const String cyclic = 'cyclic';

  @override
  bool operator ==(Object other) =>
      other is A2uiFallbackError &&
      other.type == type &&
      other.componentType == componentType;

  @override
  int get hashCode => Object.hash(type, componentType);

  @override
  String toString() =>
      'A2uiFallbackError(type: $type, componentType: $componentType)';
}

/// Builds [child] with [buildChild], or returns null when it shows nothing.
///
/// [child] shows nothing while it is unresolved and the surface's fallback
/// for it is missing or returns null. A container that gives each child a
/// widget of its own, such as a slot in a [Flex], lays out only the non-null
/// results, so a child that shows nothing gets no slot, gap or flex share,
/// while a fallback takes a slot like any other child:
///
/// ```dart
/// Row(
///   children: [
///     for (final child in children)
///       ?buildChildOrNull(context, child, buildChild),
///   ],
/// )
/// ```
Widget? buildChildOrNull(
  BuildContext context,
  ComponentNode<ComponentImplementation> child,
  ChildWidgetBuilder buildChild,
) {
  final Widget built = buildChild(child);
  // A builder that wraps each child puts a KeyedSubtree outermost, so look
  // through those to the child's NodeView.
  var inner = built;
  while (inner is KeyedSubtree) {
    inner = inner.child;
  }
  if (inner is NodeView &&
      identical(inner.node, child) &&
      child.isPlaceholder &&
      inner.buildFallback(context) == null) {
    return null;
  }
  return built;
}
