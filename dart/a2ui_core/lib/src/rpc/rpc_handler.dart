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

import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/catalog.dart';
import '../core/common.dart';
import '../core/contexts.dart';
import '../core/data_model.dart';
import '../core/messages.dart';
import '../core/surface_model.dart';
import '../primitives/cancellation.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/reactivity.dart';
import '../primitives/semver.dart';

/// Receives every message the RPC layer sends to the agent: the
/// `callAgentFunction` requests a renderer makes and the
/// `rendererFunctionResponse` answers it gives. A transport forwards them.
///
/// A listener may return a `Future`. For an outbound call, a listener that
/// throws or whose future fails fails the call with that error. For a
/// response, a listener failure is ignored: the response is still returned
/// to the processor that asked for it.
typedef OutboundMessageListener = FutureOr<void> Function(
  RendererToAgentMessage message,
);

/// Options for one [RpcHandler.callAgentFunction].
class CallOptions {
  const CallOptions({
    this.functionCallId,
    this.timeout,
    this.version,
    this.signal,
  });

  /// The `functionCallId` to send, or null to generate one unique to this
  /// handler.
  final String? functionCallId;

  /// How long to wait for the agent's response before failing the call with
  /// [RpcErrorCode.timeout]. Null uses [RpcHandler.defaultTimeout];
  /// [Duration.zero] or a negative duration waits indefinitely.
  final Duration? timeout;

  /// The protocol version of the outbound envelope. Defaults to
  /// [A2uiProtocolVersion.v1_0], the first version that defines the message.
  final A2uiProtocolVersion? version;

  /// Cancelling this signal fails the call with [RpcErrorCode.cancelled].
  final CancellationSignal? signal;
}

/// What the renderer knows about the circumstances of an inbound call.
class ExecutionContext {
  const ExecutionContext({this.isUserActivated = false});

  /// Whether the call is being handled within a user activation, which a
  /// function with [FunctionApi.requiresUserActivation] needs to run.
  final bool isUserActivated;
}

/// Coordinates function calls across the wire, in both directions.
///
/// Outbound, [callAgentFunction] sends a `callAgentFunction` message through
/// the [OutboundMessageListener] and completes when the matching
/// `agentFunctionResponse` arrives through [handleAgentFunctionResponse], or
/// fails when the call times out, is cancelled, or the handler is disposed.
///
/// Inbound, [handleCallRendererFunction] resolves the function the agent
/// named, checks who may call it, runs it, and answers with a
/// `rendererFunctionResponse`, which it both returns and sends through the
/// listener. It never throws: every failure becomes an error response.
///
/// `MessageProcessor` owns one of these as `rpc` and routes the inbound
/// messages to it; a renderer calls [callAgentFunction] through the
/// processor or directly.
class RpcHandler {
  RpcHandler({
    required this.catalogs,
    OutboundMessageListener? outboundListener,
    this.defaultTimeout = const Duration(seconds: 30),
  }) : _outboundListener = outboundListener;

  /// Catalogs an inbound call may name when the target surface does not
  /// hold the catalog itself.
  final List<Catalog<ComponentApi, FunctionImplementation>> catalogs;

  /// How long [callAgentFunction] waits when [CallOptions.timeout] is null.
  final Duration defaultTimeout;

  OutboundMessageListener? _outboundListener;
  final Map<String, _PendingCall> _pending = {};
  final Random _random = Random();
  int _nextCallNumber = 0;
  bool _disposed = false;

  /// Whether [dispose] has run.
  bool get isDisposed => _disposed;

  /// How many outbound calls are awaiting a response.
  int get pendingCallCount => _pending.length;

  /// Sends [call] to the agent on behalf of [surfaceId] and completes with
  /// the value the agent returns.
  ///
  /// The returned future fails with an [A2uiRpcError] whose code is
  /// [RpcErrorCode.disposed] after [dispose], [RpcErrorCode.noListener] when
  /// no listener was given, [RpcErrorCode.invalidFunctionCall] for a call
  /// without a name, [RpcErrorCode.duplicate] when a call with the same
  /// `functionCallId` is pending, [RpcErrorCode.timeout] when no response
  /// arrives in time, [RpcErrorCode.cancelled] when the signal fires or the
  /// handler is disposed, and the agent's own code when it reports an
  /// error. A failure of the listener fails the future with that error.
  /// Nothing is thrown synchronously.
  Future<Object?> callAgentFunction(
    String surfaceId,
    FunctionCall call, {
    CallOptions? options,
  }) {
    final CallOptions resolved = options ?? const CallOptions();
    if (_disposed) {
      return Future.error(
        A2uiRpcError('RpcHandler is disposed.', RpcErrorCode.disposed),
      );
    }
    final OutboundMessageListener? listener = _outboundListener;
    if (listener == null) {
      return Future.error(
        A2uiRpcError(
          'No outbound listener is attached, so the agent cannot be called.',
          RpcErrorCode.noListener,
        ),
      );
    }
    if (call.call.isEmpty) {
      return Future.error(
        A2uiRpcError(
          'A function call must name a function.',
          RpcErrorCode.invalidFunctionCall,
        ),
      );
    }
    final String functionCallId =
        resolved.functionCallId ?? _generateFunctionCallId();
    if (_pending.containsKey(functionCallId)) {
      return Future.error(
        A2uiRpcError(
          "A call with functionCallId '$functionCallId' is already pending.",
          RpcErrorCode.duplicate,
          functionCallId: functionCallId,
        ),
      );
    }

    final pending = _PendingCall(functionCallId);
    _pending[functionCallId] = pending;

    final Duration timeout = resolved.timeout ?? defaultTimeout;
    if (timeout > Duration.zero) {
      pending.timer = Timer(timeout, () {
        _settle(
          functionCallId,
          error: A2uiRpcError(
            "Call to '${call.call}' timed out after "
            '${timeout.inMilliseconds} ms.',
            RpcErrorCode.timeout,
            functionCallId: functionCallId,
          ),
        );
      });
    }

    final CancellationSignal? signal = resolved.signal;
    if (signal != null) {
      void onCancel() {
        _settle(
          functionCallId,
          error: A2uiRpcError(
            "Call to '${call.call}' was cancelled.",
            RpcErrorCode.cancelled,
            functionCallId: functionCallId,
          ),
        );
      }

      if (signal.isCancelled) {
        onCancel();
        return pending.completer.future;
      }
      signal.addListener(onCancel);
      pending.removeCancelListener = () => signal.removeListener(onCancel);
    }

    final message = CallAgentFunctionMessage(
      version: (resolved.version ?? A2uiProtocolVersion.v1_0).jsonValue,
      surfaceId: surfaceId,
      functionCallId: functionCallId,
      callFunction: call.toJson(reservedKeys: true),
    );
    try {
      final FutureOr<void> delivery = listener(message);
      if (delivery is Future<void>) {
        delivery.then<void>(
          (_) {},
          onError: (Object error, StackTrace stackTrace) {
            _settle(functionCallId, error: error, stackTrace: stackTrace);
          },
        );
      }
    } catch (error, stackTrace) {
      _settle(functionCallId, error: error, stackTrace: stackTrace);
    }
    return pending.completer.future;
  }

  /// Settles the pending call an `agentFunctionResponse` answers.
  ///
  /// A response for an unknown or already settled `functionCallId` is
  /// ignored. An error whose code this SDK does not define settles the call
  /// with [RpcErrorCode.unknownError] and the raw error as
  /// [A2uiRpcError.details].
  void handleAgentFunctionResponse(AgentFunctionResponseMessage message) {
    final A2uiFunctionResponse response = message.response;
    final String functionCallId = response.functionCallId;
    if (!_pending.containsKey(functionCallId)) return;
    final A2uiFunctionResponseError? error = response.error;
    if (error != null) {
      _settle(
        functionCallId,
        error: A2uiRpcError(
          error.message,
          RpcErrorCode.tryParse(error.code) ?? RpcErrorCode.unknownError,
          functionCallId: functionCallId,
          details: error.toJson(),
        ),
      );
      return;
    }
    _settle(functionCallId, value: response.value);
  }

  /// Runs the function an agent's `callRendererFunction` names and answers
  /// it.
  ///
  /// The function is looked up in the catalog the call names, first among
  /// [surface]'s `availableCatalogs` and then among [catalogs], or in
  /// [surface]'s default catalog when the call names none. It runs against
  /// [surface]'s data model, or a fresh one when there is no surface.
  ///
  /// The response is returned and also sent through the outbound listener;
  /// a listener failure is ignored so it cannot hide the response. Its
  /// `error.code` is [RpcErrorCode.invalidFunctionCall] when the catalog or
  /// function is missing, the catalog's protocol version does not match the
  /// message's, [context] does not allow the call, or the arguments fail the
  /// function's schema; [RpcErrorCode.executionError] when the function
  /// throws; and [RpcErrorCode.disposed] after [dispose].
  Future<RendererFunctionResponseMessage> handleCallRendererFunction(
    CallRendererFunctionMessage message, {
    SurfaceModel<ComponentApi>? surface,
    ExecutionContext? context,
  }) async {
    final ExecutionContext execution = context ?? const ExecutionContext();
    final String functionCallId = message.functionCallId;
    A2uiFunctionResponse response;
    try {
      response = await _execute(message, surface, execution);
    } on A2uiRpcError catch (error) {
      response = A2uiFunctionResponse.error(
        functionCallId,
        A2uiFunctionResponseError(
          code: error.rpcCode.wireValue,
          message: error.message,
        ),
      );
    } catch (error) {
      final String errorMessage =
          error is A2uiError ? error.message : error.toString();
      response = A2uiFunctionResponse.error(
        functionCallId,
        A2uiFunctionResponseError(
          code: RpcErrorCode.executionError.wireValue,
          message: errorMessage.isEmpty
              ? 'An error occurred during function execution.'
              : errorMessage,
        ),
      );
    }
    final reply = RendererFunctionResponseMessage(
      version: message.version,
      response: response,
    );
    await _emitIgnoringFailure(reply);
    return reply;
  }

  Future<A2uiFunctionResponse> _execute(
    CallRendererFunctionMessage message,
    SurfaceModel<ComponentApi>? surface,
    ExecutionContext execution,
  ) async {
    final String functionCallId = message.functionCallId;
    if (_disposed) {
      throw A2uiRpcError('RpcHandler is disposed.', RpcErrorCode.disposed);
    }
    final FunctionCall call;
    try {
      call = FunctionCall.fromJson(message.callFunction);
    } on A2uiError catch (error) {
      throw A2uiRpcError(error.message, RpcErrorCode.invalidFunctionCall);
    }
    final String name = call.call;
    final Catalog<ComponentApi, FunctionImplementation> catalog =
        _resolveCatalog(call.catalogId, surface);
    if (!isCatalogVersionCompatible(catalog.protocolVersion, message.version)) {
      throw A2uiRpcError(
        "Catalog '${catalog.id}' protocol version "
        "'${catalog.protocolVersion ?? 'unversioned'}' does not match message "
        "protocol version '${message.version}'.",
        RpcErrorCode.invalidFunctionCall,
      );
    }
    final FunctionImplementation? fn = catalog.functions[name];
    if (fn == null) {
      throw A2uiRpcError(
        'Function not found: $name',
        RpcErrorCode.invalidFunctionCall,
      );
    }
    if (fn.allowedCallers == AllowedCallers.rendererOnly) {
      throw A2uiRpcError(
        "Function '$name' cannot be called by agent (allowedCallers is "
        'rendererOnly).',
        RpcErrorCode.invalidFunctionCall,
      );
    }
    if (fn.requiresUserActivation && !execution.isUserActivated) {
      throw A2uiRpcError(
        "Function '$name' requires user activation context to execute.",
        RpcErrorCode.invalidFunctionCall,
      );
    }
    final Map<String, dynamic> args = call.args;
    final List<ValidationError> errors = catalog.argumentErrors(fn, args);
    if (errors.isNotEmpty) {
      throw A2uiRpcError(
        "Invalid function arguments for '$name': "
        '${errors.map((e) => e.toErrorString()).join('; ')}',
        RpcErrorCode.invalidFunctionCall,
      );
    }

    final DataContext dataContext = _dataContextFor(
      surface,
      catalog,
      message.version,
      execution,
    );
    try {
      Object? result = fn.execute(args, dataContext);
      if (result is Future) result = await result;
      if (result is ReadonlySignal) result = result.value;
      return A2uiFunctionResponse.value(functionCallId, result);
    } catch (error) {
      final String message =
          error is A2uiError ? error.message : error.toString();
      throw A2uiRpcError(
        message.isEmpty
            ? 'An error occurred during function execution.'
            : message,
        RpcErrorCode.executionError,
        cause: error,
      );
    }
  }

  Catalog<ComponentApi, FunctionImplementation> _resolveCatalog(
    String? catalogId,
    SurfaceModel<ComponentApi>? surface,
  ) {
    if (catalogId != null) {
      final Catalog<ComponentApi, FunctionImplementation>? fromSurface =
          surface?.availableCatalogs[catalogId];
      if (fromSurface != null) return fromSurface;
      for (final Catalog<ComponentApi, FunctionImplementation> candidate
          in catalogs) {
        if (candidate.id == catalogId) return candidate;
      }
      throw A2uiRpcError(
        'Catalog not found: $catalogId',
        RpcErrorCode.invalidFunctionCall,
      );
    }
    final Catalog<ComponentApi, FunctionImplementation>? fallback =
        surface?.defaultCatalog;
    if (fallback != null) return fallback;
    throw A2uiRpcError(
      'No catalog available for function resolution.',
      RpcErrorCode.invalidFunctionCall,
    );
  }

  /// The context the function runs in: the surface's data model at its root,
  /// or a headless one over a fresh model that resolves only [catalog].
  DataContext _dataContextFor(
    SurfaceModel<ComponentApi>? surface,
    Catalog<ComponentApi, FunctionImplementation> catalog,
    String version,
    ExecutionContext execution,
  ) {
    if (surface != null) {
      return DataContext(
        surface.dataModel,
        (name, args, context) =>
            surface.resolveCatalog(null).invoke(name, args, context),
        '/',
        protocolVersion: surface.protocolVersion,
        invokerForCatalog: (catalogId) =>
            surface.resolveCatalog(catalogId).invoke,
        isUserActivated: execution.isUserActivated,
        callAgentFunction: surface.callAgentFunction,
      );
    }
    return DataContext(
      DataModel(),
      catalog.invoke,
      '/',
      protocolVersion: version,
      invokerForCatalog: (catalogId) {
        if (catalogId == catalog.id) return catalog.invoke;
        throw A2uiCatalogResolutionError(
          'Catalog not found: $catalogId',
          catalogId: catalogId,
        );
      },
      isUserActivated: execution.isUserActivated,
    );
  }

  Future<void> _emitIgnoringFailure(RendererToAgentMessage message) async {
    final OutboundMessageListener? listener = _outboundListener;
    if (listener == null) return;
    try {
      await listener(message);
    } catch (_) {
      // The response is returned to the caller regardless; a transport
      // failure is the transport's to report.
    }
  }

  /// Fails every pending call with [RpcErrorCode.cancelled], drops the
  /// listener, and makes later calls fail with [RpcErrorCode.disposed].
  /// Idempotent.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    for (final functionCallId in List<String>.of(_pending.keys)) {
      _settle(
        functionCallId,
        error: A2uiRpcError(
          "Call '$functionCallId' was cancelled because the RpcHandler was "
          'disposed.',
          RpcErrorCode.cancelled,
          functionCallId: functionCallId,
        ),
      );
    }
    _outboundListener = null;
  }

  /// Completes the pending call [functionCallId] and forgets it. A call that
  /// is no longer pending is left alone, so a late timer or response after a
  /// cancellation is harmless.
  void _settle(
    String functionCallId, {
    Object? value,
    Object? error,
    StackTrace? stackTrace,
  }) {
    final _PendingCall? pending = _pending.remove(functionCallId);
    if (pending == null) return;
    pending.timer?.cancel();
    pending.removeCancelListener?.call();
    if (error != null) {
      pending.completer.completeError(error, stackTrace);
    } else {
      pending.completer.complete(value);
    }
  }

  String _generateFunctionCallId() {
    final int number = _nextCallNumber++;
    final String suffix = _random.nextInt(0x7fffffff).toRadixString(16);
    return 'call-$number-$suffix';
  }
}

/// An outbound call awaiting its response.
class _PendingCall {
  _PendingCall(this.functionCallId);

  final String functionCallId;
  final Completer<Object?> completer = Completer<Object?>();
  Timer? timer;
  void Function()? removeCancelListener;
}
