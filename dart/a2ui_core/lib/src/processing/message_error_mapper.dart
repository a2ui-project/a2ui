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

import '../core/messages.dart';
import '../primitives/errors.dart';

/// Maps internal [A2uiError] exceptions thrown during message validation or
/// processing into wire-format [ErrorMessage] envelopes.
class MessageErrorMapper {
  const MessageErrorMapper._();

  static const Set<String> _knownVersions = {
    'v0.8',
    'v0.9',
    'v0.9.1',
    'v1.0',
  };

  static const List<String> _envelopeBodyKeys = [
    'createSurface',
    'updateComponents',
    'updateDataModel',
    'deleteSurface',
    'callRendererFunction',
    'agentFunctionResponse',
  ];

  /// Converts [error] and optional raw envelope context into an [ErrorMessage].
  static ErrorMessage map(
    A2uiError error, {
    Object? rawMessage,
    String defaultVersion = 'v0.9',
    String? surfaceId,
    String? functionCallId,
    bool isCallRendererFunction = false,
  }) {
    final String version = _resolveVersion(rawMessage, defaultVersion);
    final bool isCallFn =
        isCallRendererFunction || _hasKey(rawMessage, 'callRendererFunction');
    final String? resolvedSurfaceId = _nonEmpty(error.surfaceId) ??
        _nonEmpty(surfaceId) ??
        _extractBodyString(rawMessage, 'surfaceId');
    final String? resolvedFunctionCallId = _nonEmpty(error.functionCallId) ??
        _nonEmpty(functionCallId) ??
        _extractBodyString(rawMessage, 'functionCallId');
    final String code = _mapCode(error, version, isCallFn);
    final String? path = _resolvePath(error, code);
    final bool useFunctionCallId = isCallFn && resolvedFunctionCallId != null;

    return ErrorMessage(
      version: version,
      error: A2uiRendererError(
        code: code,
        surfaceId: useFunctionCallId ? null : (resolvedSurfaceId ?? ''),
        functionCallId: useFunctionCallId ? resolvedFunctionCallId : null,
        path: path,
        message: error.message,
      ),
    );
  }

  static String _resolveVersion(Object? rawMessage, String defaultVersion) {
    if (rawMessage is Map) {
      final Object? rawVersion = rawMessage['version'];
      if (rawVersion is String && _knownVersions.contains(rawVersion)) {
        return rawVersion;
      }
    }
    return defaultVersion;
  }

  static bool _hasKey(Object? rawMessage, String key) =>
      rawMessage is Map && rawMessage.containsKey(key);

  static String? _nonEmpty(String? value) =>
      (value != null && value.isNotEmpty) ? value : null;

  static String? _extractBodyString(Object? rawMessage, String field) {
    if (rawMessage is! Map) return null;
    for (final String bodyKey in _envelopeBodyKeys) {
      final Object? body = rawMessage[bodyKey];
      if (body is Map) {
        final Object? value = body[field];
        if (value is String && value.isNotEmpty) return value;
      }
    }
    return null;
  }

  static String _mapCode(A2uiError error, String version, bool isCallFn) {
    if (isCallFn) {
      return error is A2uiRpcError ? error.code : 'INVALID_FUNCTION_CALL';
    }
    if (error is A2uiCatalogError) return 'CATALOG_NOT_FOUND';
    if (error is A2uiRecursionError || _isCircularError(error)) {
      return 'RECURSION_LIMIT_EXCEEDED';
    }
    if (error is A2uiIntegrityError) return 'INTEGRITY_ERROR';
    if (error is A2uiStateError) return 'STATE_ERROR';
    if (error is A2uiExpressionError) return 'EXECUTION_ERROR';
    if (error is A2uiValidationError) {
      return _mapValidationCode(error, version);
    }
    return error.code;
  }

  static bool _isCircularError(A2uiError error) =>
      error is A2uiIntegrityError &&
      (error.message.contains('Circular reference') ||
          error.message.contains('Self-reference'));

  static String _mapValidationCode(A2uiValidationError error, String version) {
    final bool isCompositionCode =
        error.code == A2uiRendererError.unallowedParentCode ||
            error.code == A2uiRendererError.unallowedChildCode;
    if (isCompositionCode) {
      return version == 'v1.0'
          ? error.code
          : A2uiRendererError.validationFailedCode;
    }
    return _nonEmpty(error.path) != null
        ? A2uiRendererError.validationFailedCode
        : 'SCHEMA_VALIDATION_FAILED';
  }

  static String? _resolvePath(A2uiError error, String code) {
    if (!A2uiRendererError.pathErrorCodes.contains(code)) return null;
    if (error is A2uiValidationError) return _nonEmpty(error.path) ?? '/';
    if (error is A2uiDataError) return _nonEmpty(error.path) ?? '/';
    return '/';
  }
}
