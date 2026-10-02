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

import '../catalog/component_implementation.dart';

/// Convenience property accessors for [ComponentNode].
extension NodePropsAccessors on ComponentNode<FlutterComponentImplementation> {
  /// Unpacks the raw property value for [key] from [props].
  Object? rawProp(String key) => props.peek()[key];

  /// Unpacks a dynamic or literal value for [key].
  ///
  /// If the property is a [ResolvedBinding], unwraps [ResolvedBinding.value];
  /// otherwise returns the raw property object.
  Object? value(String key) {
    final Object? val = rawProp(key);
    if (val is ResolvedBinding) {
      return val.value;
    }
    return val;
  }

  /// Reads a resolved string value for [key].
  String? stringValue(String key) {
    final Object? val = value(key);
    return val?.toString();
  }

  /// Reads a resolved boolean value for [key].
  bool? boolValue(String key) {
    final Object? val = value(key);
    if (val is bool) return val;
    if (val is String) {
      if (val.toLowerCase() == 'true') return true;
      if (val.toLowerCase() == 'false') return false;
    }
    return null;
  }

  /// Reads a resolved numeric value for [key].
  num? numValue(String key) {
    final Object? val = value(key);
    if (val is num) return val;
    if (val is String) return num.tryParse(val);
    return null;
  }

  /// Reads a resolved double value for [key].
  double? doubleValue(String key) => numValue(key)?.toDouble();

  /// Reads a resolved int value for [key].
  int? intValue(String key) => numValue(key)?.toInt();

  /// Returns the [ResolvedBinding] for [key], or null if not bound.
  ResolvedBinding<T>? resolvedBinding<T>(String key) {
    final Object? val = rawProp(key);
    return val is ResolvedBinding<T> ? val : null;
  }

  /// Returns the [WritableBinding] for [key], or null if not two-way writable.
  WritableBinding<T>? writableBinding<T>(String key) {
    final Object? val = rawProp(key);
    return val is WritableBinding<T> ? val : null;
  }

  /// Returns the resolved action closure for [key], or null if not an action.
  Future<void> Function()? action(String key) {
    final Object? val = rawProp(key);
    return val is Future<void> Function() ? val : null;
  }

  /// Returns the single child [ComponentNode] for [key], or null.
  ComponentNode<FlutterComponentImplementation>? childNode(String key) {
    final Object? val = rawProp(key);
    return val is ComponentNode<FlutterComponentImplementation> ? val : null;
  }

  /// Returns the resolved list of child [ComponentNode]s for [key].
  List<ComponentNode<FlutterComponentImplementation>> childNodes(String key) {
    final Object? val = rawProp(key);
    if (val is List) {
      return val
          .whereType<ComponentNode<FlutterComponentImplementation>>()
          .toList();
    }
    return const [];
  }
}
