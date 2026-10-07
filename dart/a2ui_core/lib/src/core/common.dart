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

import '../primitives/errors.dart';
import 'validation_result.dart';

/// The type of value a function returns.
enum A2uiReturnType {
  string,
  number,
  boolean,
  array,
  object,

  /// A structured [ValidationResult] (`{valid, message?, code?, severity?}`).
  ///
  /// Defined by protocol 1.0 catalog definitions. The v0.9 wire schemas do not
  /// accept it, so a catalog whose effective protocol version is below 1.0
  /// must not declare it; a v0.9 renderer's validator rejects messages that
  /// carry it.
  validationResult,
  any,
  void_;

  /// The JSON value used in the A2UI protocol.
  String get jsonValue => this == void_ ? 'void' : name;

  /// Parses from the JSON string representation, falling back to [any] for
  /// unrecognized or extension return types (such as a name a future protocol
  /// version adds).
  static A2uiReturnType fromJson(String value) {
    if (value == 'void') return void_;
    for (final A2uiReturnType candidate in values) {
      if (candidate.name == value) return candidate;
    }
    return any;
  }
}

/// A JSON Pointer path to a value in the data model.
class DataBinding {
  /// The JSON Pointer path into the data model.
  final String path;

  /// Whether this binding was parsed from or should serialize with the v1.0+
  /// `@path` reserved prefix key.
  final bool reservedKeys;

  /// Creates a data binding for [path].
  DataBinding(this.path, {this.reservedKeys = false});

  /// Parses a [DataBinding] from [json].
  ///
  /// Throws [A2uiValidationError] if neither `path` nor `@path` is present, or
  /// if the path value is not a [String].
  factory DataBinding.fromJson(Map<String, dynamic> json) {
    final bool hasAtPath = json.containsKey('@path');
    final bool hasPath = json.containsKey('path');
    if (!hasAtPath && !hasPath) {
      throw A2uiValidationError(
        'DataBinding is missing a "path" or "@path" field.',
      );
    }
    final key = hasAtPath ? '@path' : 'path';
    final Object? rawPath = json[key];
    if (rawPath is! String) {
      throw A2uiValidationError(
        'DataBinding "$key" must be a String, got ${rawPath.runtimeType}.',
      );
    }
    return DataBinding(rawPath, reservedKeys: hasAtPath);
  }

  /// Serializes this binding to a JSON map.
  ///
  /// Uses `@path` when [reservedKeys] (or [this.reservedKeys] if omitted) is
  /// `true`, and `path` otherwise.
  Map<String, dynamic> toJson({bool? reservedKeys}) {
    final bool useReserved = reservedKeys ?? this.reservedKeys;
    return {useReserved ? '@path' : 'path': path};
  }
}

/// Invokes a named function on the client.
class FunctionCall {
  /// The name of the function to invoke.
  final String call;

  /// The named arguments passed to the function.
  final Map<String, dynamic> args;

  /// The expected return type of the function call.
  final A2uiReturnType returnType;

  /// Optional identifier of the catalog that defines [call].
  final String? catalogId;

  /// Whether this function call was parsed from or should serialize with the
  /// v1.0+ `@call` reserved prefix key.
  final bool reservedKeys;

  /// Creates a function call descriptor.
  FunctionCall({
    required this.call,
    required this.args,
    this.returnType = A2uiReturnType.any,
    this.catalogId,
    this.reservedKeys = false,
  });

  /// Parses a [FunctionCall] from [json].
  ///
  /// Throws [A2uiValidationError] if `call`/`@call` is missing or not a
  /// [String], or if `args`, `returnType`, or `catalogId` have invalid types.
  factory FunctionCall.fromJson(Map<String, dynamic> json) {
    final bool hasAtCall = json.containsKey('@call');
    final bool hasCall = json.containsKey('call');
    if (!hasAtCall && !hasCall) {
      throw A2uiValidationError(
        'FunctionCall is missing a "call" or "@call" field.',
      );
    }
    final callKey = hasAtCall ? '@call' : 'call';
    final Object? rawCall = json[callKey];
    if (rawCall is! String) {
      throw A2uiValidationError(
        'FunctionCall "$callKey" must be a String, got ${rawCall.runtimeType}.',
      );
    }

    final Map<String, dynamic> parsedArgs;
    if (json.containsKey('args')) {
      final Object? rawArgs = json['args'];
      if (rawArgs is! Map || rawArgs.keys.any((k) => k is! String)) {
        throw A2uiValidationError(
          'FunctionCall "args" must be a string-keyed Map, got '
          '${rawArgs.runtimeType}.',
        );
      }
      parsedArgs = Map<String, dynamic>.from(rawArgs);
    } else {
      parsedArgs = <String, dynamic>{};
    }

    final Object? rawReturnType = json['returnType'];
    if (rawReturnType != null && rawReturnType is! String) {
      throw A2uiValidationError(
        'FunctionCall "returnType" must be a String, got '
        '${rawReturnType.runtimeType}.',
      );
    }

    final Object? rawCatalogId = json['catalogId'];
    if (rawCatalogId != null && rawCatalogId is! String) {
      throw A2uiValidationError(
        'FunctionCall "catalogId" must be a String, got '
        '${rawCatalogId.runtimeType}.',
      );
    }

    return FunctionCall(
      call: rawCall,
      args: parsedArgs,
      returnType: A2uiReturnType.fromJson(rawReturnType as String? ?? 'any'),
      catalogId: rawCatalogId as String?,
      reservedKeys: hasAtCall,
    );
  }

  /// Serializes this function call to a JSON map.
  ///
  /// Uses `@call` when [reservedKeys] (or [this.reservedKeys] if omitted) is
  /// `true`, and `call` otherwise. `returnType` is only emitted with the
  /// legacy `call` key: the v1.0 `FunctionCall` schema declares no
  /// `returnType` property (the return type is declared by the catalog) and
  /// sets `unevaluatedProperties: false`.
  Map<String, dynamic> toJson({bool? reservedKeys}) {
    final bool useReserved = reservedKeys ?? this.reservedKeys;
    return {
      useReserved ? '@call' : 'call': call,
      'args': args,
      if (!useReserved) 'returnType': returnType.jsonValue,
      if (catalogId != null) 'catalogId': catalogId,
    };
  }
}

/// Triggers a server-side event or a local client-side function.
class Action {
  /// The server-dispatched event payload, if this action dispatches an event.
  final Map<String, dynamic>? event;

  /// The client-side function call, if this action executes a function.
  final FunctionCall? functionCall;

  /// Creates an action with either [event] or [functionCall].
  Action({this.event, this.functionCall});

  /// Parses an [Action] from [json].
  ///
  /// Throws [A2uiValidationError] if neither or both of `event` and
  /// `functionCall` are present, or if their contents are malformed.
  factory Action.fromJson(Map<String, dynamic> json) {
    final bool hasEvent = json.containsKey('event');
    final bool hasFunctionCall = json.containsKey('functionCall');
    if (hasEvent == hasFunctionCall) {
      throw A2uiValidationError(
        'Action must contain either "event" or "functionCall", got: $json',
      );
    }
    if (hasEvent) {
      final Object? rawEvent = json['event'];
      if (rawEvent is! Map || rawEvent.keys.any((k) => k is! String)) {
        throw A2uiValidationError(
          'Action "event" must be a string-keyed Map, got '
          '${rawEvent.runtimeType}.',
        );
      }
      if (rawEvent['name'] is! String) {
        throw A2uiValidationError('Action event "name" must be a String.');
      }
      if (rawEvent.containsKey('context') && rawEvent['context'] != null) {
        final Object? rawContext = rawEvent['context'];
        if (rawContext is! Map || rawContext.keys.any((k) => k is! String)) {
          throw A2uiValidationError(
            'Action event "context" must be a string-keyed Map.',
          );
        }
      }
      return Action(event: Map<String, dynamic>.from(rawEvent));
    }

    final Object? rawFunctionCall = json['functionCall'];
    if (rawFunctionCall is! Map ||
        rawFunctionCall.keys.any((k) => k is! String)) {
      throw A2uiValidationError(
        'Action "functionCall" must be a string-keyed Map, got '
        '${rawFunctionCall.runtimeType}.',
      );
    }
    return Action(
      functionCall: FunctionCall.fromJson(
        Map<String, dynamic>.from(rawFunctionCall),
      ),
    );
  }

  /// Serializes this action to a JSON map.
  Map<String, dynamic> toJson({bool? reservedKeys}) => {
        if (event != null) 'event': event,
        if (functionCall != null)
          'functionCall': functionCall!.toJson(reservedKeys: reservedKeys),
      };
}

/// A template for generating a dynamic list of children.
class ChildListTemplate {
  /// The component ID to instantiate for each item in the collection at [path].
  final String componentId;

  /// The JSON Pointer path to the list in the data model.
  final String path;

  /// Creates a dynamic child list template.
  ChildListTemplate({required this.componentId, required this.path});

  /// Parses a [ChildListTemplate] from [json].
  ///
  /// Throws [A2uiValidationError] if `componentId` or `path` is missing or not
  /// a [String].
  factory ChildListTemplate.fromJson(Map<String, dynamic> json) {
    final Object? rawComponentId = json['componentId'];
    if (rawComponentId is! String) {
      throw A2uiValidationError(
        'ChildListTemplate "componentId" must be a String, got '
        '${rawComponentId.runtimeType}.',
      );
    }
    final Object? rawPath = json['path'];
    if (rawPath is! String) {
      throw A2uiValidationError(
        'ChildListTemplate "path" must be a String, got '
        '${rawPath.runtimeType}.',
      );
    }
    return ChildListTemplate(componentId: rawComponentId, path: rawPath);
  }

  /// Serializes this template to a JSON map.
  Map<String, dynamic> toJson() => {'componentId': componentId, 'path': path};
}
