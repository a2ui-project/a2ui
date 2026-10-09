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

/// A structured validation or diagnostic error entry.
class A2uiErrorDetail {
  /// Creates an [A2uiErrorDetail].
  const A2uiErrorDetail({
    required this.path,
    required this.code,
    required this.message,
  });

  /// The JSON Pointer or field path where the error occurred.
  final String path;

  /// Machine-readable error code.
  final String code;

  /// Human-readable error description.
  final String message;

  /// Serializes this error detail as a JSON map.
  Map<String, Object?> toJson() => {
        'path': path,
        'code': code,
        'message': message,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is A2uiErrorDetail &&
          other.path == path &&
          other.code == code &&
          other.message == message;

  @override
  int get hashCode => Object.hash(path, code, message);

  @override
  String toString() => 'A2uiErrorDetail($path [$code]: $message)';
}

/// Base class for all A2UI specific errors.
class A2uiError implements Exception {
  final String message;
  final String code;
  final Object? cause;

  A2uiError(
    this.message, {
    this.code = 'UNKNOWN_ERROR',
    this.cause,
  });

  @override
  String toString() {
    final causeSuffix = cause != null ? ' (cause: $cause)' : '';
    return '$runtimeType [$code]: $message$causeSuffix';
  }
}

/// Thrown when JSON validation fails or schemas are mismatched.
class A2uiValidationError extends A2uiError {
  final String? path;

  /// The surface the failing payload targets, when the check knows it.
  ///
  /// A v1.0 `UNALLOWED_PARENT` or `UNALLOWED_CHILD` client error must name
  /// both the surface and the [path].
  final String? surfaceId;
  final List<A2uiErrorDetail> errors;
  final Object? details;

  A2uiValidationError(
    super.message, {
    super.code = 'VALIDATION_FAILED',
    this.path,
    List<A2uiErrorDetail> errors = const <A2uiErrorDetail>[],
    this.details,
    super.cause,
    this.surfaceId,
  }) : errors = List.unmodifiable(errors);

  @override
  String toString() {
    final location = (path != null && path!.isNotEmpty) ? ' ($path)' : '';
    final causeSuffix = cause != null ? ' (cause: $cause)' : '';
    return '$runtimeType [$code]$location: $message$causeSuffix';
  }
}

/// Thrown during DataModel mutations (invalid paths, type mismatches).
class A2uiDataError extends A2uiError {
  final String? path;

  A2uiDataError(
    super.message, {
    this.path,
    super.code = 'DATA_ERROR',
    super.cause,
  });

  @override
  String toString() {
    final location = (path != null && path!.isNotEmpty) ? ' ($path)' : '';
    final causeSuffix = cause != null ? ' (cause: $cause)' : '';
    return '$runtimeType [$code]$location: $message$causeSuffix';
  }
}

/// Thrown during string interpolation and function evaluation.
class A2uiExpressionError extends A2uiError {
  final String? expression;
  final Object? details;

  A2uiExpressionError(
    super.message, {
    this.expression,
    this.details,
    super.code = 'EXPRESSION_ERROR',
    super.cause,
  });
}

/// Thrown for structural issues in the UI tree (missing surfaces, duplicate
/// components).
class A2uiStateError extends A2uiError {
  A2uiStateError(
    super.message, {
    super.code = 'STATE_ERROR',
    super.cause,
  });
}

/// Thrown when an LLM response cannot be tokenized into A2UI parts.
class A2uiParseError extends A2uiError {
  /// The raw content that could not be parsed.
  final String? rawContent;

  A2uiParseError(
    super.message, {
    this.rawContent,
    super.code = 'PARSE_ERROR',
    super.cause,
  });
}

/// Thrown when a catalog cannot be loaded, parsed, or negotiated.
class A2uiCatalogError extends A2uiError {
  /// The catalog id involved, when known.
  final String? catalogId;

  A2uiCatalogError(
    super.message, {
    this.catalogId,
    super.code = 'CATALOG_ERROR',
    super.cause,
  });
}

/// Thrown for a structurally invalid component graph: unreachable roots,
/// duplicate ids, dangling references.
/// A function call that could not be resolved to an implementation: the
/// catalog it names is not available, there is no default catalog for a call
/// that names none, or the catalog has no function of that name.
///
/// Distinct from other [A2uiCatalogError]s so a v1.0 surface can tell a
/// function it does not have, which it forwards to the agent as
/// `callAgentFunction`, from a function it has that failed.
class A2uiCatalogResolutionError extends A2uiCatalogError {
  /// The function the call named, when the failure was a function lookup.
  final String? functionName;

  A2uiCatalogResolutionError(
    super.message, {
    super.catalogId,
    this.functionName,
    super.code = 'CATALOG_ERROR',
    super.cause,
  });
}

/// Why a function call across the wire failed, in the form both directions
/// of the protocol's `error.code` carry.
enum RpcErrorCode {
  /// The call named a function, catalog, caller or arguments the receiver
  /// cannot accept.
  invalidFunctionCall('INVALID_FUNCTION_CALL'),

  /// The function ran and threw.
  executionError('EXECUTION_ERROR'),

  /// Reported by an agent for a function it does not know. The renderer
  /// never emits it: a lookup miss is an [invalidFunctionCall].
  unknownFunction('UNKNOWN_FUNCTION'),

  /// An agent-reported code this SDK does not define. The renderer never
  /// emits it.
  unknownError('UNKNOWN_ERROR'),

  /// No response arrived before the call's timeout.
  timeout('TIMEOUT'),

  /// The call was cancelled, through its signal or by disposing the handler.
  cancelled('CANCELLED'),

  /// The handler was already disposed when the call was made.
  disposed('DISPOSED'),

  /// A call with the same `functionCallId` is still pending.
  duplicate('DUPLICATE'),

  /// No outbound listener is attached, so the call cannot be sent.
  noListener('NO_LISTENER');

  const RpcErrorCode(this.wireValue);

  /// The code as it appears on the wire, such as `INVALID_FUNCTION_CALL`.
  final String wireValue;

  /// The code whose [wireValue] is [wireValue], or null for any other string.
  static RpcErrorCode? tryParse(String wireValue) {
    for (final RpcErrorCode code in values) {
      if (code.wireValue == wireValue) return code;
    }
    return null;
  }
}

/// A function call across the wire that failed, in either direction.
///
/// [code] is [rpcCode]'s wire value, so a listener keyed on [A2uiError.code]
/// reads the same string the protocol carries.
class A2uiRpcError extends A2uiError {
  /// Why the call failed.
  final RpcErrorCode rpcCode;

  /// The `functionCallId` of the call, when it had one.
  final String? functionCallId;

  /// Further detail, such as the raw `{code, message}` an agent reported.
  final Object? details;

  A2uiRpcError(
    super.message,
    this.rpcCode, {
    this.functionCallId,
    this.details,
    super.cause,
  }) : super(code: rpcCode.wireValue);

  @override
  String toString() {
    final call = functionCallId != null ? ' ($functionCallId)' : '';
    final causeSuffix = cause != null ? ' (cause: $cause)' : '';
    return '$runtimeType [$code]$call: $message$causeSuffix';
  }
}

class A2uiIntegrityError extends A2uiValidationError {
  /// The component ids involved, when known.
  final List<String> componentIds;

  A2uiIntegrityError(
    super.message, {
    List<String> componentIds = const <String>[],
    super.code = 'INTEGRITY_ERROR',
    super.path,
    super.errors,
    super.details,
    super.cause,
  }) : componentIds = List.unmodifiable(componentIds);
}

/// Thrown when a component graph cycles or exceeds the depth cap.
class A2uiRecursionError extends A2uiValidationError {
  /// The chain of component ids that produced the cycle, when known.
  final List<String> cycle;

  A2uiRecursionError(
    super.message, {
    List<String> cycle = const <String>[],
    super.code = 'RECURSION_ERROR',
    super.path,
    super.errors,
    super.details,
    super.cause,
  }) : cycle = List.unmodifiable(cycle);
}
