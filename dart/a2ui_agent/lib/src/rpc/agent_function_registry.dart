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
import 'dart:collection';

import 'package:a2ui_core/a2ui_core.dart';

/// Indexes [AgentFunction] declarations across catalogs and executes incoming
/// `callAgentFunction` messages on the agent.
class AgentFunctionRegistry {
  /// The maximum number of concurrent handler executions, or null for
  /// unbounded concurrency.
  final int? maxConcurrency;

  /// The default per-invocation timeout, or null for no default timeout.
  final Duration? timeout;

  final Map<String, CatalogApi> _catalogs = <String, CatalogApi>{};
  final Map<(String, String), AgentFunction> _functions =
      <(String, String), AgentFunction>{};
  final Map<String, PayloadValidator<ComponentApi, FunctionApi>> _validators =
      <String, PayloadValidator<ComponentApi, FunctionApi>>{};
  final Map<(String, String), Map<String, Object?>> _resolvedArgSchemas =
      <(String, String), Map<String, Object?>>{};

  final Queue<_SemaphoreWaiter> _waitQueue = Queue<_SemaphoreWaiter>();
  final Set<_InFlightCall> _inFlight = <_InFlightCall>{};
  int _activeCount = 0;
  bool _disposed = false;

  /// Creates an [AgentFunctionRegistry] indexing all [Catalog.agentFunctions]
  /// declared on [catalogs].
  ///
  /// Throws [ArgumentError] if [maxConcurrency] is less than 1 or [timeout] is
  /// not positive. Throws [A2uiCatalogError] if any catalog declaring agent
  /// functions targets a protocol version below 1.0.
  AgentFunctionRegistry(
    Iterable<CatalogApi> catalogs, {
    this.maxConcurrency,
    this.timeout,
  }) {
    if (maxConcurrency != null && maxConcurrency! < 1) {
      throw ArgumentError.value(
        maxConcurrency,
        'maxConcurrency',
        'Must be >= 1 or null.',
      );
    }
    if (timeout != null && timeout! <= Duration.zero) {
      throw ArgumentError.value(
        timeout,
        'timeout',
        'Must be > Duration.zero or null.',
      );
    }

    for (final catalog in catalogs) {
      _catalogs[catalog.id] = catalog;
      if (catalog.agentFunctions.isEmpty) continue;
      if (!(catalog.protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ??
          false)) {
        throw A2uiCatalogError(
          "Agent functions on catalog '${catalog.id}' require "
          'protocolVersion 1.0 or later.',
          catalogId: catalog.id,
        );
      }
      for (final MapEntry<String, AgentFunction> entry
          in catalog.agentFunctions.entries) {
        _functions[(catalog.id, entry.key)] = entry.value;
      }
    }
  }

  /// An unmodifiable view of all registered agent functions keyed by
  /// `(catalogId, functionName)`.
  Map<(String, String), AgentFunction> get functions =>
      Map<(String, String), AgentFunction>.unmodifiable(_functions);

  /// Whether [dispose] has been called.
  bool get isDisposed => _disposed;

  /// Alias for [isDisposed].
  bool get disposed => _disposed;

  /// Looks up the [AgentFunction] registered under [catalogId] and [name], or
  /// returns null if none is registered.
  AgentFunction? get(String catalogId, String name) =>
      _functions[(catalogId, name)];

  /// Marks the registry as disposed and cancels all in-flight [handle] calls
  /// with [RpcErrorCode.disposed]. Idempotent.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    for (final _SemaphoreWaiter waiter in _waitQueue) {
      waiter.cancel();
    }
    _waitQueue.clear();
    final List<_InFlightCall> active = _inFlight.toList();
    _inFlight.clear();
    for (final call in active) {
      call.failWithDisposed();
    }
  }

  /// Validates and executes a v1.0 `callAgentFunction` [message] and returns
  /// the corresponding [AgentFunctionResponseMessage].
  ///
  /// [message] may be a [CallAgentFunctionMessage] or a raw JSON `Map`
  /// envelope.
  ///
  /// Throws [ArgumentError] if [timeout] is not positive.
  /// Throws [A2uiRpcError] with [RpcErrorCode.disposed] if this registry is
  /// disposed before or during execution.
  /// Throws [A2uiValidationError] if [message] is not a `callAgentFunction`
  /// message or lacks a non-empty string `functionCallId`. All other validation
  /// and execution failures are captured in the returned
  /// [AgentFunctionResponseMessage]'s `error` payload.
  Future<AgentFunctionResponseMessage> handle(
    Object message, {
    Duration? timeout,
  }) async {
    if (timeout != null && timeout <= Duration.zero) {
      throw ArgumentError.value(
        timeout,
        'timeout',
        'Must be > Duration.zero or null.',
      );
    }
    if (_disposed) {
      throw A2uiRpcError(
        'AgentFunctionRegistry has been disposed.',
        RpcErrorCode.disposed,
      );
    }

    final _ParsedCallResult parsed = _parseCall(message);
    if (parsed.errorResponse != null) {
      return parsed.errorResponse!;
    }
    final _ParsedCall call = parsed.call!;

    String? catalogId = call.catalogId;
    if (catalogId == null) {
      final matches = <String>[
        for (final (String cid, String fnName) in _functions.keys)
          if (fnName == call.name) cid,
      ];
      if (matches.length > 1) {
        return _errorResponse(
          call.functionCallId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          "The call to '${call.name}' has no catalogId, and several catalogs "
          'have an agent function of that name: $matches.',
        );
      }
      if (matches.isEmpty) {
        return _errorResponse(
          call.functionCallId,
          RpcErrorCode.unknownFunction.wireValue,
          "No catalog of the agent has an agent function '${call.name}'.",
        );
      }
      catalogId = matches.first;
    }

    final CatalogApi? catalog = _catalogs[catalogId];
    final AgentFunction? fn = _functions[(catalogId, call.name)];
    if (catalog == null || fn == null) {
      final detail = catalog == null
          ? "Unknown catalog '$catalogId' for agent function "
                "'${call.name}'."
          : "Unknown agent function '${call.name}' in catalog "
                "'$catalogId'.";
      return _errorResponse(
        call.functionCallId,
        RpcErrorCode.unknownFunction.wireValue,
        detail,
      );
    }

    if (fn.allowedCallers == AllowedCallers.agentOnly) {
      return _errorResponse(
        call.functionCallId,
        RpcErrorCode.invalidFunctionCall.wireValue,
        "Function '${call.name}' can't be called by the renderer "
        '(allowedCallers is agentOnly).',
      );
    }

    final Map<String, dynamic> validatedArgs;
    try {
      validatedArgs = _validateAndApplyDefaults(catalog, fn, call.args);
    } on A2uiValidationError catch (error) {
      return _errorResponse(
        call.functionCallId,
        RpcErrorCode.invalidFunctionCall.wireValue,
        error.message,
      );
    }

    final context = AgentFunctionContext(
      catalogId: catalogId,
      surfaceId: call.surfaceId,
      functionCallId: call.functionCallId,
    );
    final Duration? effectiveTimeout = timeout ?? this.timeout;
    return _invoke(fn, validatedArgs, context, effectiveTimeout);
  }

  Map<String, dynamic> _validateAndApplyDefaults(
    CatalogApi catalog,
    AgentFunction fn,
    Map<String, dynamic> rawArgs,
  ) {
    final PayloadValidator<ComponentApi, FunctionApi> validator = _validators
        .putIfAbsent(
          catalog.id,
          () => PayloadValidator<ComponentApi, FunctionApi>(
            catalog: catalog,
            config: ValidationConfig.strict,
          ),
        );
    final Map<String, Object?> resolvedSchema = _resolvedArgSchemas.putIfAbsent(
      (catalog.id, fn.name),
      () => resolveSchemaRefs(
        fn.argumentSchema.value,
        catalog.validationSchema,
        commonTypes: PayloadValidator.commonTypesFor(A2uiProtocolVersion.v1_0),
      ),
    );

    final Map<String, dynamic> argsWithDefaults = _applySchemaDefaults(
      rawArgs,
      resolvedSchema,
    );
    validator.validateFunction(fn.name, argsWithDefaults);
    _checkUndeclaredObjectArgs(
      fn.name,
      catalog.id,
      argsWithDefaults,
      resolvedSchema,
    );
    return argsWithDefaults;
  }

  static void _checkUndeclaredObjectArgs(
    String fnName,
    String catalogId,
    Map<String, dynamic> args,
    Map<String, Object?> schema,
  ) {
    if (schema['type'] != 'object') return;
    final Object? additional =
        schema['additionalProperties'] ?? schema['unevaluatedProperties'];
    if (additional == true || additional is Map) return;
    final Object? props = schema['properties'];
    final Set<String> allowed = props is Map
        ? props.keys.whereType<String>().toSet()
        : const <String>{};
    for (final String key in args.keys) {
      if (!allowed.contains(key)) {
        throw A2uiValidationError(
          "Call to '$fnName' in catalog '$catalogId' has unknown argument "
          "'$key'.",
          path: '/args/$key',
        );
      }
    }
  }

  Future<AgentFunctionResponseMessage> _invoke(
    AgentFunction fn,
    Map<String, dynamic> args,
    AgentFunctionContext context,
    Duration? effectiveTimeout,
  ) {
    if (_disposed) {
      return Future<AgentFunctionResponseMessage>.error(
        A2uiRpcError(
          'AgentFunctionRegistry has been disposed.',
          RpcErrorCode.disposed,
          functionCallId: context.functionCallId,
          surfaceId: context.surfaceId,
        ),
      );
    }

    final inFlight = _InFlightCall(
      functionCallId: context.functionCallId,
      surfaceId: context.surfaceId,
    );
    _inFlight.add(inFlight);

    if (effectiveTimeout != null) {
      inFlight.timer = Timer(effectiveTimeout, () {
        if (!_inFlight.remove(inFlight)) return;
        final _SemaphoreWaiter? waiter = inFlight.waiter;
        if (waiter != null) {
          _waitQueue.remove(waiter);
          waiter.cancel();
        }
        inFlight.complete(
          _errorResponse(
            context.functionCallId,
            RpcErrorCode.executionError.wireValue,
            "Agent function '${fn.name}' timed out after "
            '${effectiveTimeout.inMilliseconds}ms.',
          ),
        );
      });
    }

    unawaited(_runWithSemaphore(fn, args, context, inFlight));
    return inFlight.completer.future;
  }

  Future<void> _runWithSemaphore(
    AgentFunction fn,
    Map<String, dynamic> args,
    AgentFunctionContext context,
    _InFlightCall inFlight,
  ) async {
    var acquiredSlot = false;
    try {
      if (maxConcurrency != null) {
        if (_activeCount < maxConcurrency!) {
          _activeCount++;
          acquiredSlot = true;
        } else {
          final waiter = _SemaphoreWaiter();
          inFlight.waiter = waiter;
          _waitQueue.addLast(waiter);
          await waiter.completer.future;
          inFlight.waiter = null;
          acquiredSlot = waiter.granted;
          if (!acquiredSlot || inFlight.isSettled || _disposed) {
            return;
          }
        }
      }

      if (inFlight.isSettled || _disposed) {
        return;
      }

      final Object? result = await Future<Object?>.sync(
        () => fn.handler(args, context),
      );
      if (inFlight.isSettled) {
        return;
      }
      final Object? serialized = _serializeReturnValue(result, fn.name);
      if (!_inFlight.remove(inFlight)) {
        return;
      }
      inFlight.complete(
        AgentFunctionResponseMessage(
          version: A2uiProtocolVersion.v1_0.jsonValue,
          response: A2uiFunctionResponse.value(
            context.functionCallId,
            serialized,
          ),
        ),
      );
    } on A2uiRpcError catch (rpcErr) {
      if (inFlight.isSettled || !_inFlight.remove(inFlight)) return;
      inFlight.complete(
        _errorResponse(context.functionCallId, rpcErr.code, rpcErr.message),
      );
    } on A2uiValidationError catch (valErr) {
      if (inFlight.isSettled || !_inFlight.remove(inFlight)) return;
      inFlight.complete(
        _errorResponse(
          context.functionCallId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          valErr.message,
        ),
      );
    } catch (error) {
      if (inFlight.isSettled || !_inFlight.remove(inFlight)) return;
      inFlight.complete(
        _errorResponse(
          context.functionCallId,
          RpcErrorCode.executionError.wireValue,
          '$error',
        ),
      );
    } finally {
      if (acquiredSlot) {
        _releaseSlot();
      }
    }
  }

  void _releaseSlot() {
    while (_waitQueue.isNotEmpty) {
      final _SemaphoreWaiter next = _waitQueue.removeFirst();
      if (next.grant()) {
        return;
      }
    }
    _activeCount--;
  }

  static _ParsedCallResult _parseCall(Object message) {
    if (message is CallAgentFunctionMessage) {
      final String callId = message.functionCallId;
      if (callId.isEmpty) {
        throw A2uiValidationError(
          "Field 'callAgentFunction.functionCallId' must be a non-empty "
          'string.',
        );
      }
      if (message.surfaceId.isEmpty) {
        return _ParsedCallResult.failure(
          _errorResponse(
            callId,
            RpcErrorCode.invalidFunctionCall.wireValue,
            "Field 'callAgentFunction.surfaceId' must be a non-empty string.",
          ),
        );
      }
      return _parseCallFunctionMap(
        callId: callId,
        surfaceId: message.surfaceId,
        rawCallFunction: message.callFunction,
      );
    }

    if (message is! Map) {
      throw A2uiValidationError(
        'Expected a CallAgentFunctionMessage or Map, got '
        '${message.runtimeType}.',
      );
    }

    final Object? rawBody = message['callAgentFunction'];
    if (rawBody is! Map) {
      throw A2uiValidationError(
        "Expected a 'callAgentFunction' message envelope.",
      );
    }
    final Object? rawCallId = rawBody['functionCallId'];
    if (rawCallId is! String || rawCallId.isEmpty) {
      throw A2uiValidationError(
        "Field 'callAgentFunction.functionCallId' must be a non-empty string.",
      );
    }
    final String callId = rawCallId;

    // From this point on, functionCallId is recoverable, so any envelope or
    // body validation failure produces an INVALID_FUNCTION_CALL response.
    if (message.length != 2 || !message.containsKey('version')) {
      return _ParsedCallResult.failure(
        _errorResponse(
          callId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          'Invalid callAgentFunction message envelope.',
        ),
      );
    }
    final Object? rawVersion = message['version'];
    if (rawVersion != '1.0' && rawVersion != 'v1.0') {
      return _ParsedCallResult.failure(
        _errorResponse(
          callId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          "Unsupported protocol version '$rawVersion' for callAgentFunction.",
        ),
      );
    }

    for (final Object? key in rawBody.keys) {
      if (key != 'surfaceId' &&
          key != 'functionCallId' &&
          key != 'callFunction') {
        return _ParsedCallResult.failure(
          _errorResponse(
            callId,
            RpcErrorCode.invalidFunctionCall.wireValue,
            "Unknown field 'callAgentFunction.$key'.",
          ),
        );
      }
    }

    final Object? rawSurfaceId = rawBody['surfaceId'];
    if (rawSurfaceId is! String || rawSurfaceId.isEmpty) {
      return _ParsedCallResult.failure(
        _errorResponse(
          callId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          "Field 'callAgentFunction.surfaceId' must be a non-empty string.",
        ),
      );
    }

    final Object? rawCallFn = rawBody['callFunction'];
    if (rawCallFn is! Map) {
      return _ParsedCallResult.failure(
        _errorResponse(
          callId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          "Field 'callAgentFunction.callFunction' must be an object.",
        ),
      );
    }

    return _parseCallFunctionMap(
      callId: callId,
      surfaceId: rawSurfaceId,
      rawCallFunction: rawCallFn,
    );
  }

  static _ParsedCallResult _parseCallFunctionMap({
    required String callId,
    required String surfaceId,
    required Map<Object?, Object?> rawCallFunction,
  }) {
    for (final Object? key in rawCallFunction.keys) {
      if (key != '@call' && key != 'catalogId' && key != 'args') {
        return _ParsedCallResult.failure(
          _errorResponse(
            callId,
            RpcErrorCode.invalidFunctionCall.wireValue,
            "Unknown field 'callAgentFunction.callFunction.$key'.",
          ),
        );
      }
    }

    final Object? rawName = rawCallFunction['@call'];
    if (rawName is! String || rawName.isEmpty) {
      return _ParsedCallResult.failure(
        _errorResponse(
          callId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          "Field 'callAgentFunction.callFunction.@call' must be a non-empty "
          'string.',
        ),
      );
    }

    final Object? rawCatalogId = rawCallFunction['catalogId'];
    final String? catalogId;
    if (!rawCallFunction.containsKey('catalogId') || rawCatalogId == null) {
      catalogId = null;
    } else if (rawCatalogId is String && rawCatalogId.isNotEmpty) {
      catalogId = rawCatalogId;
    } else {
      return _ParsedCallResult.failure(
        _errorResponse(
          callId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          "Field 'callAgentFunction.callFunction.catalogId' must be a "
          'non-empty string.',
        ),
      );
    }

    final Object? rawArgs = rawCallFunction['args'];
    final Map<String, dynamic> args;
    if (rawArgs == null) {
      args = <String, dynamic>{};
    } else if (rawArgs is Map && rawArgs.keys.every((k) => k is String)) {
      args = <String, dynamic>{
        for (final MapEntry<Object?, Object?> entry in rawArgs.entries)
          entry.key! as String: entry.value,
      };
    } else {
      return _ParsedCallResult.failure(
        _errorResponse(
          callId,
          RpcErrorCode.invalidFunctionCall.wireValue,
          "Field 'callAgentFunction.callFunction.args' must be an object.",
        ),
      );
    }

    return _ParsedCallResult.success(
      _ParsedCall(
        functionCallId: callId,
        surfaceId: surfaceId,
        catalogId: catalogId,
        name: rawName,
        args: args,
      ),
    );
  }

  static AgentFunctionResponseMessage _errorResponse(
    String functionCallId,
    String code,
    String message,
  ) => AgentFunctionResponseMessage(
    version: A2uiProtocolVersion.v1_0.jsonValue,
    response: A2uiFunctionResponse.error(
      functionCallId,
      A2uiFunctionResponseError(code: code, message: message),
    ),
  );

  static Map<String, dynamic> _applySchemaDefaults(
    Map<String, dynamic> args,
    Map<String, Object?> schema,
  ) {
    final result = <String, dynamic>{
      for (final MapEntry<String, dynamic> entry in args.entries)
        entry.key: _deepCopyJson(entry.value),
    };
    _populateObjectDefaults(result, schema);
    return result;
  }

  static void _populateObjectDefaults(
    Map<String, dynamic> target,
    Map<String, Object?> schema,
  ) {
    final Object? props = schema['properties'];
    if (props is! Map) return;
    for (final MapEntry<Object?, Object?> entry in props.entries) {
      final Object? key = entry.key;
      final Object? propSchema = entry.value;
      if (key is! String || propSchema is! Map) continue;
      final Map<String, Object?> propSchemaMap = propSchema
          .cast<String, Object?>();
      if (!target.containsKey(key)) {
        if (propSchemaMap.containsKey('default')) {
          target[key] = _deepCopyJson(propSchemaMap['default']);
        }
      } else if (target[key] is Map) {
        final rawNested = target[key]! as Map<Object?, Object?>;
        final nested = <String, dynamic>{
          for (final MapEntry<Object?, Object?> e in rawNested.entries)
            '${e.key}': e.value,
        };
        target[key] = nested;
        _populateObjectDefaults(nested, propSchemaMap);
      }
    }
  }

  static Object? _deepCopyJson(Object? value) {
    if (value is Map) {
      return <String, Object?>{
        for (final MapEntry<Object?, Object?> entry in value.entries)
          '${entry.key}': _deepCopyJson(entry.value),
      };
    }
    if (value is List) {
      return <Object?>[for (final Object? item in value) _deepCopyJson(item)];
    }
    return value;
  }

  static Object? _serializeReturnValue(Object? value, String fnName) {
    if (value == null || value is bool || value is int || value is String) {
      return value;
    }
    if (value is double) {
      if (!value.isFinite) {
        throw FormatException(
          "Agent function '$fnName' returned non-finite number $value.",
        );
      }
      return value;
    }
    if (value is ValidationResult) {
      return value.toJson();
    }
    if (value is List) {
      return <Object?>[
        for (final Object? item in value) _serializeReturnValue(item, fnName),
      ];
    }
    if (value is Map) {
      final result = <String, Object?>{};
      for (final MapEntry<Object?, Object?> entry in value.entries) {
        final Object? key = entry.key;
        if (key is! String) {
          throw FormatException(
            "Agent function '$fnName' returned a Map with non-string key "
            '${key.runtimeType}.',
          );
        }
        result[key] = _serializeReturnValue(entry.value, fnName);
      }
      return result;
    }
    throw FormatException(
      "Agent function '$fnName' returned non-JSON-serializable value of type "
      '${value.runtimeType}.',
    );
  }
}

final class _ParsedCall {
  final String functionCallId;
  final String surfaceId;
  final String? catalogId;
  final String name;
  final Map<String, dynamic> args;

  const _ParsedCall({
    required this.functionCallId,
    required this.surfaceId,
    required this.catalogId,
    required this.name,
    required this.args,
  });
}

final class _ParsedCallResult {
  final _ParsedCall? call;
  final AgentFunctionResponseMessage? errorResponse;

  const _ParsedCallResult.success(this.call) : errorResponse = null;
  const _ParsedCallResult.failure(this.errorResponse) : call = null;
}

final class _SemaphoreWaiter {
  final Completer<void> completer = Completer<void>();
  bool granted = false;
  bool cancelled = false;

  bool grant() {
    if (cancelled || completer.isCompleted) return false;
    granted = true;
    completer.complete();
    return true;
  }

  void cancel() {
    if (granted || cancelled) return;
    cancelled = true;
    if (!completer.isCompleted) {
      completer.complete();
    }
  }
}

final class _InFlightCall {
  final String functionCallId;
  final String surfaceId;
  final Completer<AgentFunctionResponseMessage> completer =
      Completer<AgentFunctionResponseMessage>();
  Timer? timer;
  _SemaphoreWaiter? waiter;
  bool isSettled = false;

  _InFlightCall({required this.functionCallId, required this.surfaceId}) {
    completer.future.ignore();
  }

  void complete(AgentFunctionResponseMessage response) {
    if (isSettled) return;
    isSettled = true;
    timer?.cancel();
    completer.complete(response);
  }

  void failWithDisposed() {
    if (isSettled) return;
    isSettled = true;
    timer?.cancel();
    completer.completeError(
      A2uiRpcError(
        'AgentFunctionRegistry was disposed while handling call '
        "'$functionCallId'.",
        RpcErrorCode.disposed,
        functionCallId: functionCallId,
        surfaceId: surfaceId,
      ),
    );
  }
}
