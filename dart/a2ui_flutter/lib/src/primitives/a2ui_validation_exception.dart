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

/// Exception thrown when an A2UI message fails parsing or validation.
class A2uiValidationException implements Exception {
  /// Creates an [A2uiValidationException].
  A2uiValidationException(
    this.message, {
    this.surfaceId,
    this.path,
    this.json,
    this.cause,
  });

  /// The error message.
  final String message;

  /// The ID of the surface where the validation error occurred.
  final String? surfaceId;

  /// The path in the data or component model where the error occurred.
  final String? path;

  /// The JSON that caused the error.
  final Object? json;

  /// The underlying cause of the error.
  final Object? cause;

  @override
  String toString() {
    final buffer = StringBuffer('A2uiValidationException: $message');
    if (surfaceId != null) buffer.write(' (surface: $surfaceId)');
    if (path != null) buffer.write(' (path: $path)');
    if (cause != null) buffer.write('\nCause: $cause');
    if (json != null) buffer.write('\nJSON: $json');
    return buffer.toString();
  }
}
