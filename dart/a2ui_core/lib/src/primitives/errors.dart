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

/// Thrown when an LLM response cannot be tokenized into A2UI parts.
class A2uiParseError extends A2uiError {
  /// The raw content that could not be parsed.
  final String? rawContent;

  A2uiParseError(String message, {this.rawContent})
    : super(message, 'PARSE_ERROR');
}

/// Thrown when a raw format payload cannot be compiled into A2UI messages.
class A2uiCompileError extends A2uiError {
  /// The raw content that could not be compiled.
  final String? rawContent;

  /// Parts that were compiled successfully before the failure.
  final List<Object?> partialResults;

  A2uiCompileError(
    String message, {
    this.rawContent,
    this.partialResults = const [],
  }) : super(message, 'COMPILE_ERROR');
}

/// Thrown when a catalog cannot be loaded, parsed, or negotiated.
class A2uiCatalogError extends A2uiError {
  /// The catalog id involved, when known.
  final String? catalogId;

  A2uiCatalogError(String message, {this.catalogId})
    : super(message, 'CATALOG_ERROR');
}

/// Thrown for a structurally invalid component graph: unreachable roots,
/// duplicate ids, dangling references.
class A2uiIntegrityError extends A2uiError {
  /// The component ids involved, when known.
  final List<String> componentIds;

  A2uiIntegrityError(String message, {this.componentIds = const []})
    : super(message, 'INTEGRITY_ERROR');
}

/// Thrown when a component graph cycles or exceeds the depth cap.
class A2uiRecursionError extends A2uiError {
  /// The chain of component ids that produced the cycle, when known.
  final List<String> cycle;

  A2uiRecursionError(String message, {this.cycle = const []})
    : super(message, 'RECURSION_ERROR');
}
