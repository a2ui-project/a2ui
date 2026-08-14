// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/// Base class for all A2UI specific errors.
class A2uiError implements Exception {
  final String message;
  final String code;

  A2uiError(this.message, [this.code = 'UNKNOWN_ERROR']);

  @override
  String toString() => '$runtimeType [$code]: $message';
}

/// Thrown when JSON validation fails or schemas are mismatched.
class A2uiValidationError extends A2uiError {
  final Object? details;

  A2uiValidationError(String message, {this.details})
    : super(message, 'VALIDATION_ERROR');
}

/// Thrown during DataModel mutations (invalid paths, type mismatches).
class A2uiDataError extends A2uiError {
  final String? path;

  A2uiDataError(String message, {this.path}) : super(message, 'DATA_ERROR');
}

/// Thrown during string interpolation and function evaluation.
class A2uiExpressionError extends A2uiError {
  final String? expression;
  final Object? details;

  A2uiExpressionError(String message, {this.expression, this.details})
    : super(message, 'EXPRESSION_ERROR');
}

/// Thrown for structural issues in the UI tree (missing surfaces, duplicate
/// components).
class A2uiStateError extends A2uiError {
  A2uiStateError(String message) : super(message, 'STATE_ERROR');
}
