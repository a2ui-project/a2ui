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

/// Exception thrown when client function execution fails.
class A2uiFunctionException implements Exception {
  /// Creates a [A2uiFunctionException].
  A2uiFunctionException(
    this.message, {
    required this.functionName,
    this.argumentKey,
    this.cause,
  });

  /// The sanitized diagnostic message.
  final String message;

  /// The name of the function that failed.
  final String functionName;

  /// The specific argument key that caused the error, if any.
  final String? argumentKey;

  /// The underlying cause of the error, if any.
  final Object? cause;

  @override
  String toString() {
    var result = 'A2uiFunctionException inside $functionName: $message';
    if (argumentKey != null) {
      result += ' (argument: $argumentKey)';
    }
    if (cause != null) {
      result += '\nCause: $cause';
    }
    return result;
  }
}
