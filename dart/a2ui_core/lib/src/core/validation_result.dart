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

import 'package:meta/meta.dart';

/// Structured outcome of a client-side validation check rule.
///
/// Returned by v1.0 validation functions and exposed in `validationResults` on
/// resolved component properties for `Checkable` components.
@immutable
class ValidationResult {
  /// Whether the check passed.
  final bool valid;

  /// Human-readable message describing why validation failed (or a warning/info
  /// note).
  final String? message;

  /// Optional machine-readable error or warning code.
  final String? code;

  /// Severity of the validation finding (`'error'`, `'warning'`, or `'info'`).
  final String? severity;

  const ValidationResult({
    required this.valid,
    this.message,
    this.code,
    this.severity,
  });

  /// Parses a [ValidationResult] from a JSON map.
  factory ValidationResult.fromJson(Map<String, Object?> json) {
    final Object? rawMessage = json['message'];
    return ValidationResult(
      valid: json['valid'] == true,
      message: rawMessage?.toString(),
      code: json['code'] is String ? json['code'] as String : null,
      severity: json['severity'] is String ? json['severity'] as String : null,
    );
  }

  /// Coerces the evaluated result of a check `condition` into a normalized
  /// [ValidationResult], using [fallbackMessage] when no message is supplied by
  /// the function result.
  factory ValidationResult.fromEvaluation(
    Object? value, {
    String fallbackMessage = 'Validation failed',
  }) {
    if (value is ValidationResult) {
      final bool hasCustomMessage =
          value.message != null && value.message!.isNotEmpty;
      final String? resolvedMessage = hasCustomMessage
          ? value.message
          : (value.valid ? null : fallbackMessage);
      final String? resolvedSeverity =
          (value.severity == 'warning' || value.severity == 'info')
              ? value.severity!
              : (value.valid ? null : 'error');
      return ValidationResult(
        valid: value.valid,
        message: resolvedMessage,
        code: value.code,
        severity: resolvedSeverity,
      );
    }

    if (value is Map && value.containsKey('valid')) {
      final isValid = value['valid'] == true;
      final Object? rawMessage = value['message'];
      final customMessage = rawMessage?.toString();
      final String? resolvedMessage =
          (customMessage != null && customMessage.isNotEmpty)
              ? customMessage
              : (isValid ? null : fallbackMessage);
      final String? code =
          value['code'] is String ? value['code'] as String : null;
      final Object? rawSeverity = value['severity'];
      final String? resolvedSeverity =
          (rawSeverity == 'warning' || rawSeverity == 'info')
              ? rawSeverity! as String
              : (isValid ? null : 'error');
      return ValidationResult(
        valid: isValid,
        message: resolvedMessage,
        code: code,
        severity: resolvedSeverity,
      );
    }

    final isValid = value == true;
    return ValidationResult(
      valid: isValid,
      message: isValid ? null : fallbackMessage,
      severity: isValid ? null : 'error',
    );
  }

  /// Serializes this [ValidationResult] to a JSON map.
  Map<String, Object?> toJson() => <String, Object?>{
        'valid': valid,
        if (message != null) 'message': message,
        if (code != null) 'code': code,
        if (severity != null) 'severity': severity,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ValidationResult &&
          other.valid == valid &&
          other.message == message &&
          other.code == code &&
          other.severity == severity;

  @override
  int get hashCode => Object.hash(valid, message, code, severity);

  @override
  String toString() =>
      'ValidationResult(valid: $valid, message: $message, code: $code, '
      'severity: $severity)';
}
