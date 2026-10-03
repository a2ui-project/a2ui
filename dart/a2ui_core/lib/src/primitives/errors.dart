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

/// Thrown when a payload violates a JSON Schema constraint.
class A2uiSchemaError extends A2uiValidationError {
  A2uiSchemaError(
    super.message, {
    super.code = 'SCHEMA_ERROR',
    super.path,
    super.errors,
    super.details,
    super.cause,
  });
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

/// Thrown when an unsupported A2UI protocol version is encountered.
class A2uiUnsupportedVersionError extends A2uiError {
  /// The unsupported version string, when known.
  final String? version;

  A2uiUnsupportedVersionError(
    super.message, {
    this.version,
    super.code = 'UNSUPPORTED_VERSION',
    super.cause,
  });
}

/// Thrown when a processor operation fails.
class A2uiOperationError extends A2uiError {
  A2uiOperationError(
    super.message, {
    super.code = 'OPERATION_ERROR',
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
