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

import 'component_implementation.dart';

/// Typed, non-throwing reads of a node's resolved properties.
///
/// Each accessor returns null, or an empty list, when the property is absent
/// or holds another shape. Dynamic values are read through their binding, so
/// a literal and a path binding read the same way.
extension type const ComponentProps(NodeProps _props) implements NodeProps {
  /// The value of [value] if it is a binding, otherwise [value] itself.
  static Object? unwrap(Object? value) =>
      value is ResolvedBinding<Object?> ? value.value : value;

  /// [value], unwrapped, as a string. Numbers and booleans are converted the
  /// way JavaScript's `String()` converts them. Other values give null.
  static String? asString(Object? value) => switch (unwrap(value)) {
    final String s => s,
    final num n => _numberToString(n),
    final bool b => '$b',
    _ => null,
  };

  /// [value], unwrapped, as a double, or null if it is not a number.
  static double? asNumber(Object? value) => switch (unwrap(value)) {
    final num n => n.toDouble(),
    _ => null,
  };

  /// [value], unwrapped, as a bool, or null if it is not a bool.
  static bool? asBoolean(Object? value) => switch (unwrap(value)) {
    final bool b => b,
    _ => null,
  };

  static String _numberToString(num n) {
    if (n is int) return '$n';
    if (n == 0) return '0';
    final s = n.toString();
    return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
  }

  /// The property [key], unwrapped.
  Object? value(String key) => unwrap(this[key]);

  /// The property [key] as a string, as [asString] reads it.
  String? string(String key) => asString(this[key]);

  /// The property [key] as a double, as [asNumber] reads it.
  double? number(String key) => asNumber(this[key]);

  /// The property [key] as a bool, as [asBoolean] reads it.
  bool? boolean(String key) => asBoolean(this[key]);

  /// The property [key], unwrapped, if it is a list, or else an empty list.
  List<Object?> list(String key) => switch (value(key)) {
    final List<Object?> l => l,
    _ => const [],
  };

  /// The binding of [key] if the payload bound it to a data path, the only
  /// case in which the property can be written.
  WritableBinding<Object?>? writable(String key) => switch (this[key]) {
    final WritableBinding<Object?> b => b,
    _ => null,
  };

  /// The action closure of [key]. Invoking it resolves the action's context
  /// at that moment.
  Future<void> Function()? action(String key) => switch (this[key]) {
    final Future<void> Function() a => a,
    _ => null,
  };

  /// The child node of [key], for a single child reference.
  ComponentNode<ComponentImplementation>? child(String key) =>
      switch (this[key]) {
        final ComponentNode<ComponentImplementation> n => n,
        _ => null,
      };

  /// The child nodes of [key], for a child list. Items that are not nodes are
  /// skipped.
  List<ComponentNode<ComponentImplementation>> children(String key) =>
      switch (this[key]) {
        final List<Object?> l =>
          l.whereType<ComponentNode<ComponentImplementation>>().toList(
            growable: false,
          ),
        _ => const [],
      };

  /// False when one of the component's `checks` fails.
  bool get isValid => this['isValid'] != false;

  /// The messages of the failing `checks`.
  List<String> get validationErrors => switch (this['validationErrors']) {
    final List<Object?> l => l.whereType<String>().toList(growable: false),
    _ => const [],
  };
}
