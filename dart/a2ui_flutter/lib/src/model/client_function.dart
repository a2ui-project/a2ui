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

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../primitives/simple_items.dart';
import 'data_path.dart';

/// An execution context for client functions, providing access to data and
/// other functions.
abstract interface class ExecutionContext {
  /// The path associated with this context.
  DataPath get path;

  /// Retrieves a function by name from this context.
  ClientFunction? getFunction(String name);

  /// Subscribes to a path, resolving it against the current context.
  ValueListenable<T?> subscribe<T>(DataPath path);

  /// Subscribes to a path and returns a [Stream].
  Stream<T?> subscribeStream<T>(DataPath path);

  /// Gets a value, resolving the path against the current context.
  T? getValue<T>(DataPath path);

  /// Updates the data model, resolving the path against the current context.
  void update(DataPath path, Object? contents);

  /// Creates a new, nested ExecutionContext for a child widget.
  ExecutionContext nested(DataPath relativePath);

  /// Resolves a path against the current context's path.
  DataPath resolvePath(DataPath pathToResolve);

  /// Resolves any dynamic values (bindings or function calls) in the given
  /// value.
  Stream<Object?> resolve(Object? value);

  /// Evaluates a dynamic boolean condition and returns a [Stream<bool>].
  Stream<bool> evaluateConditionStream(Object? condition);
}

/// A function that can be invoked by the GenUI expression system.
///
/// Functions are reactive, returning a [Stream] of values.
/// This allows functions to push updates to the UI (e.g. a clock or network
/// status).
/// The type of value a client function returns.
enum ClientFunctionReturnType {
  string('string'),
  number('number'),
  boolean('boolean'),
  array('array'),
  object('object'),
  any('any'),
  empty('void'); // Called empty because void is a keyword.

  const ClientFunctionReturnType(this.value);
  final String value;
}

abstract interface class ClientFunction {
  /// The name of the function as used in expressions (e.g. 'stringFormat').
  String get name;

  /// A human-readable description of what the function does and how to use it.
  String get description;

  /// The schema for the arguments this function accepts.
  /// Used for validation and tool definition generation for the LLM.
  Schema get argumentSchema;

  /// The type of value this function returns.
  /// Defaults to [ClientFunctionReturnType.any].
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.any;

  /// Invokes the function with the given [args].
  ///
  /// Returns a stream of values.
  ///
  /// **Reactivity:**
  /// - **Argument Changes:** If the input [args] change (e.g. because they were
  ///   bound to a changing data path), the `ExpressionParser` will
  ///   **re-invoke** this function with the new arguments. The previous stream
  ///   will be cancelled, and the new stream subscribed to. Therefore, a single
  ///   stream instance does *not* need to handle argument changes.
  /// - **Internal Changes:** The stream *should* emit new values if the
  ///   function's internal sources change (e.g. a clock tick, a network status
  ///   change, or a subscription to a data path looked up via [context]).
  ///
  /// The [context] is provided to allow the function to resolve other paths
  /// or interact with the `DataModel` if necessary (e.g. `subscribeToValue`).
  Stream<Object?> execute(JsonMap args, ExecutionContext context);
}

/// A base class for synchronous client functions.
///
/// Implementers should override [executeSync] to provide the synchronous logic.
abstract class SynchronousClientFunction implements ClientFunction {
  const SynchronousClientFunction();

  @override
  Stream<Object?> execute(JsonMap args, ExecutionContext context) {
    try {
      return Stream.value(executeSync(args, context));
    } catch (exception, stackTrace) {
      return Stream.error(exception, stackTrace);
    }
  }

  /// Executes the function synchronously.
  Object? executeSync(JsonMap args, ExecutionContext context);
}
