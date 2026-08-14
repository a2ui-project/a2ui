// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'package:json_schema_builder/json_schema_builder.dart';
import '../primitives/cancellation.dart';
import '../primitives/reactivity.dart';
import 'contexts.dart';

/// A definition of a UI component's API.
abstract class ComponentApi {
  String get name;
  Schema get schema;
}

/// The type of value a function returns.
enum A2uiReturnType {
  string,
  number,
  boolean,
  array,
  object,
  any,
  void_;

  /// The JSON value used in the A2UI protocol.
  String get jsonValue => this == void_ ? 'void' : name;

  /// Parses from the JSON string representation.
  static A2uiReturnType fromJson(String value) {
    if (value == 'void') return void_;
    return values.byName(value);
  }
}

/// A definition of a UI function's API.
abstract class FunctionApi {
  String get name;
  A2uiReturnType get returnType;
  Schema get argumentSchema;
}

/// A function implementation that can be registered with a catalog.
abstract class FunctionImplementation extends FunctionApi {
  /// Executes the function. Can return a static value or a [ReadonlySignal].
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]);
}

/// A collection of available components and functions.
class Catalog<T extends ComponentApi> {
  final String id;
  final Map<String, T> components;
  final Map<String, FunctionImplementation> functions;
  final Schema? themeSchema;

  Catalog({
    required this.id,
    required List<T> components,
    List<FunctionImplementation> functions = const [],
    this.themeSchema,
  }) : components = {for (var c in components) c.name: c},
       functions = {for (var f in functions) f.name: f};
}
