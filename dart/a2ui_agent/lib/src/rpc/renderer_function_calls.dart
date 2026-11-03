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
import 'dart:math';

import 'package:a2ui_core/a2ui_core.dart';

/// Default timeout for outbound `callRendererFunction` invocations (30s).
const Duration defaultRendererCallTimeout = Duration(seconds: 30);

const int _maxFunctionCallArgs = 1000;
const int _maxFunctionCallDepth = 50;

/// Builds outbound `callRendererFunction` messages, correlates them with
/// incoming `rendererFunctionResponse` messages by `functionCallId`, and
/// manages per-call timeouts and disposal.
class RendererFunctionCalls {
  final Duration? _defaultTimeout;

  /// The maximum number of concurrent pending calls, or null for no cap.
  final int? maxPending;

  final Map<String, _PendingRendererCall> _pending =
      <String, _PendingRendererCall>{};
  final Random _random = Random();
  int _nextCallCounter = 0;
  bool _disposed = false;

  /// Creates a [RendererFunctionCalls] tracker.
  ///
  /// Pass `defaultTimeout: null` to disable the default timeout.
  /// Throws [ArgumentError] if [defaultTimeout] is not positive or [maxPending]
  /// is less than 1.
  RendererFunctionCalls({
    Duration? defaultTimeout = defaultRendererCallTimeout,
    this.maxPending,
  }) : _defaultTimeout = defaultTimeout {
    if (defaultTimeout != null && defaultTimeout <= Duration.zero) {
      throw ArgumentError.value(
        defaultTimeout,
        'defaultTimeout',
        'Must be > Duration.zero or null.',
      );
    }
    if (maxPending != null && maxPending! < 1) {
      throw ArgumentError.value(
        maxPending,
        'maxPending',
        'Must be >= 1 or null.',
      );
    }
  }

  /// The default timeout applied when [call] is invoked without an explicit
  /// `timeout`, or null if no default timeout is configured.
  Duration? get defaultTimeout => _defaultTimeout;

  /// Whether [dispose] has been called.
  bool get isDisposed => _disposed;

  /// Alias for [isDisposed].
  bool get disposed => _disposed;

  /// The number of currently pending outbound renderer function calls.
  int get pendingCount => _pending.length;

  /// Constructs a v1.0 [CallRendererFunctionMessage] and registers a pending
  /// [Future] that resolves when the matching `rendererFunctionResponse`
  /// arrives via [resolve].
  ///
  /// Throws [ArgumentError] if [timeout] is not positive.
  /// Throws [A2uiRpcError] synchronously if:
  /// - this tracker is disposed ([RpcErrorCode.disposed]),
  /// - [functionCallId] is already pending ([RpcErrorCode.duplicate]),
  /// - [maxPending] would be exceeded ([RpcErrorCode.tooManyPending]), or
  /// - the call parameters are invalid ([RpcErrorCode.invalidFunctionCall]).
  (CallRendererFunctionMessage, Future<Object?>) call({
    required String catalogId,
    required String name,
    Map<String, Object?>? args,
    String? surfaceId,
    Duration? timeout,
    String? functionCallId,
  }) {
    if (timeout != null && timeout <= Duration.zero) {
      throw ArgumentError.value(
        timeout,
        'timeout',
        'Must be > Duration.zero or null.',
      );
    }
    if (_disposed) {
      throw A2uiRpcError(
        'RendererFunctionCalls has been disposed.',
        RpcErrorCode.disposed,
      );
    }

    final String callId = functionCallId ?? _generateCallId();
    if (callId.isEmpty) {
      throw A2uiRpcError(
        'functionCallId must be a non-empty string.',
        RpcErrorCode.invalidFunctionCall,
        surfaceId: surfaceId,
      );
    }
    if (_pending.containsKey(callId)) {
      throw A2uiRpcError(
        "A renderer function call with functionCallId '$callId' is already "
        'pending.',
        RpcErrorCode.duplicate,
        functionCallId: callId,
        surfaceId: surfaceId,
      );
    }
    if (maxPending != null && _pending.length >= maxPending!) {
      throw A2uiRpcError(
        'Maximum number of pending renderer function calls ($maxPending) '
        'reached.',
        RpcErrorCode.tooManyPending,
        functionCallId: callId,
        surfaceId: surfaceId,
      );
    }

    _validateCallInputs(
      callId: callId,
      catalogId: catalogId,
      name: name,
      args: args,
      surfaceId: surfaceId,
    );

    final callFunction = <String, Object?>{
      '@call': name,
      'catalogId': catalogId,
      'args': args == null ? <String, Object?>{} : _deepCopyMap(args),
    };
    final message = CallRendererFunctionMessage(
      version: A2uiProtocolVersion.v1_0.jsonValue,
      surfaceId: surfaceId,
      functionCallId: callId,
      callFunction: callFunction,
    );

    final pending = _PendingRendererCall(
      functionCallId: callId,
      surfaceId: surfaceId,
    );
    final Duration? effectiveTimeout = timeout ?? _defaultTimeout;
    if (effectiveTimeout != null) {
      pending.timer = Timer(effectiveTimeout, () {
        final _PendingRendererCall? removed = _pending.remove(callId);
        if (removed == null) return;
        removed.completeError(
          A2uiRpcError(
            "Renderer function '$name' (call '$callId') timed out after "
            '${effectiveTimeout.inMilliseconds}ms.',
            RpcErrorCode.timeout,
            functionCallId: callId,
            surfaceId: surfaceId,
          ),
        );
      });
    }
    _pending[callId] = pending;
    return (message, pending.completer.future);
  }

  /// Settles the pending call matching [message]'s `functionCallId`.
  ///
  /// [message] may be a [RendererFunctionResponseMessage] or a raw JSON `Map`
  /// envelope. Unknown, duplicate, late (post-timeout or post-dispose), or
  /// malformed responses are ignored without throwing.
  void resolve(Object message) {
    final _ParsedRendererResponse? parsed = _parseResponse(message);
    if (parsed == null) return;

    final _PendingRendererCall? pending = _pending.remove(
      parsed.functionCallId,
    );
    if (pending == null) return;
    pending.timer?.cancel();

    final A2uiFunctionResponseError? error = parsed.error;
    if (error != null) {
      pending.completeError(
        A2uiRpcError.custom(
          error.message,
          error.code,
          functionCallId: parsed.functionCallId,
          surfaceId: pending.surfaceId,
          details: error.toJson(),
        ),
      );
      return;
    }
    pending.completeValue(parsed.value);
  }

  /// Cancels all pending calls with [RpcErrorCode.cancelled] and marks this
  /// tracker as disposed so subsequent [call] invocations fail with
  /// [RpcErrorCode.disposed]. Idempotent.
  void dispose([String reason = 'RendererFunctionCalls was disposed.']) {
    if (_disposed) return;
    _disposed = true;
    final List<_PendingRendererCall> entries = _pending.values.toList();
    _pending.clear();
    for (final pending in entries) {
      pending.timer?.cancel();
      pending.completeError(
        A2uiRpcError(
          reason,
          RpcErrorCode.cancelled,
          functionCallId: pending.functionCallId,
          surfaceId: pending.surfaceId,
        ),
      );
    }
  }

  static void _validateCallInputs({
    required String callId,
    required String catalogId,
    required String name,
    required Map<String, Object?>? args,
    required String? surfaceId,
  }) {
    if (catalogId.isEmpty) {
      throw A2uiRpcError(
        'catalogId must be a non-empty string.',
        RpcErrorCode.invalidFunctionCall,
        functionCallId: callId,
        surfaceId: surfaceId,
      );
    }
    if (surfaceId != null && surfaceId.isEmpty) {
      throw A2uiRpcError(
        'surfaceId must be a non-empty string when provided.',
        RpcErrorCode.invalidFunctionCall,
        functionCallId: callId,
        surfaceId: surfaceId,
      );
    }
    if (name.isEmpty || name.startsWith('@') || !isValidUax31Identifier(name)) {
      throw A2uiRpcError(
        "Invalid renderer function name '$name': must be a non-empty UAX #31 "
        "identifier and must not start with '@'.",
        RpcErrorCode.invalidFunctionCall,
        functionCallId: callId,
        surfaceId: surfaceId,
      );
    }
    if (args != null) {
      _validateCallArgs(
        name,
        args,
        callId: callId,
        surfaceId: surfaceId,
        depth: 0,
      );
    }
  }

  static void _validateCallArgs(
    String fnName,
    Map<Object?, Object?> args, {
    required String callId,
    required String? surfaceId,
    required int depth,
  }) {
    if (args.length > _maxFunctionCallArgs) {
      throw A2uiRpcError(
        "Function call '$fnName' exceeds maximum allowed arguments count "
        '($_maxFunctionCallArgs).',
        RpcErrorCode.invalidFunctionCall,
        functionCallId: callId,
        surfaceId: surfaceId,
      );
    }
    for (final MapEntry<Object?, Object?> entry in args.entries) {
      final Object? key = entry.key;
      if (key is! String || !isValidUax31Identifier(key)) {
        throw A2uiRpcError(
          "Function argument '$key' in '$fnName' is not a valid UAX #31 "
          'identifier.',
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
      _validateArgValue(
        entry.value,
        callId: callId,
        surfaceId: surfaceId,
        depth: depth,
      );
    }
  }

  static void _validateArgValue(
    Object? value, {
    required String callId,
    required String? surfaceId,
    required int depth,
  }) {
    if (value == null || value is bool || value is int || value is String) {
      return;
    }
    if (value is double) {
      if (!value.isFinite) {
        throw A2uiRpcError(
          'Non-finite number $value in function arguments.',
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
      return;
    }
    if (value is List) {
      for (final Object? item in value) {
        _validateArgValue(
          item,
          callId: callId,
          surfaceId: surfaceId,
          depth: depth,
        );
      }
      return;
    }
    if (value is! Map) {
      throw A2uiRpcError(
        'Non-JSON value of type ${value.runtimeType} in function arguments.',
        RpcErrorCode.invalidFunctionCall,
        functionCallId: callId,
        surfaceId: surfaceId,
      );
    }

    for (final Object? rawKey in value.keys) {
      if (rawKey is! String) {
        throw A2uiRpcError(
          'Object keys in function arguments must be strings.',
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
      if (rawKey.startsWith('@') &&
          !rawKey.startsWith('@@') &&
          rawKey != '@path' &&
          rawKey != '@call') {
        throw A2uiRpcError(
          "Unrecognized reserved directive '$rawKey' in function arguments.",
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
    }

    if (value.containsKey('@path')) {
      if (value.length != 1 ||
          value['@path'] is! String ||
          (value['@path']! as String).isEmpty) {
        throw A2uiRpcError(
          'Invalid @path data binding in function arguments.',
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
      return;
    }

    if (value.containsKey('@call')) {
      final int nextDepth = depth + 1;
      if (nextDepth > _maxFunctionCallDepth) {
        throw A2uiRpcError(
          'Nested function call exceeds maximum depth '
          '($_maxFunctionCallDepth).',
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
      for (final Object? k in value.keys) {
        if (k != '@call' && k != 'catalogId' && k != 'args') {
          throw A2uiRpcError(
            "Unknown field '$k' on nested function call.",
            RpcErrorCode.invalidFunctionCall,
            functionCallId: callId,
            surfaceId: surfaceId,
          );
        }
      }
      final Object? nestedName = value['@call'];
      if (nestedName is! String || nestedName.isEmpty) {
        throw A2uiRpcError(
          "Nested function call '@call' must be a non-empty string.",
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
      if (nestedName.startsWith('@')) {
        if (nestedName != '@index' || value.containsKey('catalogId')) {
          throw A2uiRpcError(
            "Invalid system function call '$nestedName'.",
            RpcErrorCode.invalidFunctionCall,
            functionCallId: callId,
            surfaceId: surfaceId,
          );
        }
      } else if (!isValidUax31Identifier(nestedName)) {
        throw A2uiRpcError(
          "Nested function name '$nestedName' is not a valid UAX #31 "
          'identifier.',
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
      final Object? nestedCatalogId = value['catalogId'];
      if (nestedCatalogId != null &&
          (nestedCatalogId is! String || nestedCatalogId.isEmpty)) {
        throw A2uiRpcError(
          "Nested function call 'catalogId' must be a non-empty string.",
          RpcErrorCode.invalidFunctionCall,
          functionCallId: callId,
          surfaceId: surfaceId,
        );
      }
      final Object? nestedArgs = value['args'];
      if (nestedArgs != null) {
        if (nestedArgs is! Map) {
          throw A2uiRpcError(
            "Nested function call 'args' must be an object.",
            RpcErrorCode.invalidFunctionCall,
            functionCallId: callId,
            surfaceId: surfaceId,
          );
        }
        _validateCallArgs(
          nestedName,
          nestedArgs,
          callId: callId,
          surfaceId: surfaceId,
          depth: nextDepth,
        );
      }
      return;
    }

    for (final Object? entryValue in value.values) {
      _validateArgValue(
        entryValue,
        callId: callId,
        surfaceId: surfaceId,
        depth: depth,
      );
    }
  }

  static _ParsedRendererResponse? _parseResponse(Object message) {
    if (message is RendererFunctionResponseMessage) {
      final A2uiFunctionResponse resp = message.response;
      if (resp.functionCallId.isEmpty) return null;
      if (resp.error != null && resp.error!.code.isEmpty) return null;
      return _ParsedRendererResponse(
        functionCallId: resp.functionCallId,
        value: resp.value,
        error: resp.error,
      );
    }

    if (message is! Map) return null;
    if (message.length != 2 || !message.containsKey('version')) return null;
    final Object? version = message['version'];
    if (version != '1.0' && version != 'v1.0') return null;

    final Object? rawBody = message['rendererFunctionResponse'];
    if (rawBody is! Map) return null;
    for (final Object? key in rawBody.keys) {
      if (key != 'functionCallId' && key != 'value' && key != 'error') {
        return null;
      }
    }

    final Object? rawCallId = rawBody['functionCallId'];
    if (rawCallId is! String || rawCallId.isEmpty) return null;

    final bool hasValue = rawBody.containsKey('value');
    final bool hasError =
        rawBody.containsKey('error') && rawBody['error'] != null;
    if (hasValue && hasError) return null;

    if (hasError) {
      final Object? rawError = rawBody['error'];
      if (rawError is! Map) return null;
      for (final Object? key in rawError.keys) {
        if (key != 'code' && key != 'message') return null;
      }
      final Object? rawCode = rawError['code'];
      final Object? rawMessage = rawError['message'];
      if (rawCode is! String || rawCode.isEmpty || rawMessage is! String) {
        return null;
      }
      return _ParsedRendererResponse(
        functionCallId: rawCallId,
        value: null,
        error: A2uiFunctionResponseError(code: rawCode, message: rawMessage),
      );
    }

    return _ParsedRendererResponse(
      functionCallId: rawCallId,
      value: rawBody['value'],
      error: null,
    );
  }

  String _generateCallId() {
    while (true) {
      final int counter = _nextCallCounter++;
      final String rand = _random.nextInt(0x7fffffff).toRadixString(16);
      final candidate = 'rcall-$counter-$rand';
      if (!_pending.containsKey(candidate)) {
        return candidate;
      }
    }
  }

  static Map<String, Object?> _deepCopyMap(Map<String, Object?> map) =>
      <String, Object?>{
        for (final MapEntry<String, Object?> entry in map.entries)
          entry.key: _deepCopyValue(entry.value),
      };

  static Object? _deepCopyValue(Object? value) {
    if (value is Map) {
      return <String, Object?>{
        for (final MapEntry<Object?, Object?> entry in value.entries)
          '${entry.key}': _deepCopyValue(entry.value),
      };
    }
    if (value is List) {
      return <Object?>[for (final Object? item in value) _deepCopyValue(item)];
    }
    return value;
  }
}

final class _ParsedRendererResponse {
  final String functionCallId;
  final Object? value;
  final A2uiFunctionResponseError? error;

  const _ParsedRendererResponse({
    required this.functionCallId,
    required this.value,
    required this.error,
  });
}

final class _PendingRendererCall {
  final String functionCallId;
  final String? surfaceId;
  final Completer<Object?> completer = Completer<Object?>();
  Timer? timer;

  _PendingRendererCall({
    required this.functionCallId,
    required this.surfaceId,
  }) {
    completer.future.ignore();
  }

  void completeValue(Object? value) {
    if (!completer.isCompleted) {
      completer.complete(value);
    }
  }

  void completeError(Object error) {
    if (!completer.isCompleted) {
      completer.completeError(error);
    }
  }
}
