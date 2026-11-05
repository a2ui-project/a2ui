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
import 'dart:developer' as developer;

import 'package:a2ui_core/a2ui_core.dart';

/// Indexes the [AgentFunction]s of a set of catalogs and answers incoming
/// `callAgentFunction` messages with them.
///
/// Internal to this package: `RendererToAgentMessageProcessor` is the public
/// entry point.
final class AgentFunctionRegistry {
  /// How long a handler may run before the call is answered with a timeout
  /// error, or null for no limit.
  final Duration? timeout;

  final Map<String, CatalogApi> _catalogs = <String, CatalogApi>{};
  final Map<(String, String), AgentFunction> _functions =
      <(String, String), AgentFunction>{};
  final Map<String, PayloadValidator<ComponentApi, FunctionApi>> _validators =
      <String, PayloadValidator<ComponentApi, FunctionApi>>{};
  final Map<(String, String), Map<String, Object?>> _resolvedArgSchemas =
      <(String, String), Map<String, Object?>>{};

  /// Indexes every [Catalog.agentFunctions] entry of [catalogs].
  ///
  /// Throws [ArgumentError] if [timeout] is not positive, and
  /// [A2uiCatalogError] if two of [catalogs] have the same id.
  AgentFunctionRegistry(Iterable<CatalogApi> catalogs, {this.timeout}) {
    if (timeout != null && timeout! <= Duration.zero) {
      throw ArgumentError.value(
        timeout,
        'agentFunctionTimeout',
        'Must be > Duration.zero or null.',
      );
    }
    for (final catalog in catalogs) {
      if (_catalogs.containsKey(catalog.id)) {
        throw A2uiCatalogError(
          "Two catalogs have the id '${catalog.id}'; give the processor each "
          'catalog once.',
          catalogId: catalog.id,
        );
      }
      _catalogs[catalog.id] = catalog;
      for (final MapEntry<String, AgentFunction> entry
          in catalog.agentFunctions.entries) {
        _functions[(catalog.id, entry.key)] = entry.value;
      }
    }
  }

  /// Validates and runs a v1.0 `callAgentFunction` [message] and returns the
  /// [AgentFunctionResponseMessage] that answers it.
  ///
  /// [message] may be a [CallAgentFunctionMessage] or a raw JSON `Map`
  /// envelope. The processor has already checked its version and that it
  /// carries no other message.
  ///
  /// Throws [A2uiValidationError] if [message] is not a `callAgentFunction`
  /// message or lacks a non-empty string `functionCallId`, since there is
  /// nothing to reply to. Every other failure is reported in the returned
  /// response's `error`.
  Future<AgentFunctionResponseMessage> handle(Object message) async {
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

    // Neither the AgentFunction constructor nor AgentFunction.fromApi builds
    // an agentOnly function; this guards against a subclass that claims it.
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
    final Future<AgentFunctionResponseMessage> response = _run(
      fn,
      validatedArgs,
      context,
    );
    final Duration? limit = timeout;
    if (limit == null) return response;
    // A Dart future can't be cancelled: on timeout the call is answered and
    // whatever the handler later returns or throws is ignored.
    return response.timeout(
      limit,
      onTimeout: () => _errorResponse(
        context.functionCallId,
        RpcErrorCode.executionError.wireValue,
        "Agent function '${fn.name}' timed out after "
        '${limit.inMilliseconds}ms.',
      ),
    );
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

    // The arguments of a callAgentFunction are already resolved: they are
    // plain JSON, in which a key such as `@type` is data rather than a
    // directive, so they are checked against the schema as values and not
    // walked as component expressions. Defaults are applied only once the
    // caller's own arguments have passed.
    _checkArgNames(fn.name, rawArgs);
    validator.validateFunctionArgs(fn.name, rawArgs);
    return _applySchemaDefaults(rawArgs, resolvedSchema);
  }

  /// The most arguments a call may pass, as `PayloadValidator` allows.
  static const int _maxFunctionCallArgs = 50;

  /// Rejects a call that passes more than [_maxFunctionCallArgs] arguments, or
  /// whose top-level argument names are not UAX #31 identifiers.
  static void _checkArgNames(String fnName, Map<String, dynamic> args) {
    if (args.length > _maxFunctionCallArgs) {
      throw A2uiValidationError(
        "Function call '$fnName' exceeds maximum allowed arguments count "
        '($_maxFunctionCallArgs)',
      );
    }
    for (final String arg in args.keys) {
      if (!isValidUax31Identifier(arg)) {
        throw A2uiValidationError(
          "Function argument '$arg' in function '$fnName' must be a valid "
          'UAX #31 identifier',
          path: '/args/${arg.replaceAll('~', '~0').replaceAll('/', '~1')}',
        );
      }
    }
  }

  static Map<String, Object?>? _resolveLocalDef(
    String ref,
    Map<String, Object?> defs,
  ) {
    const prefix = r'#/$defs/';
    if (!ref.startsWith(prefix)) return null;
    Object? current = defs;
    for (final String rawSegment in ref.substring(prefix.length).split('/')) {
      final String segment = rawSegment
          .replaceAll('~1', '/')
          .replaceAll('~0', '~');
      if (current is! Map) return null;
      current = current[segment];
    }
    return current is Map ? current.cast<String, Object?>() : null;
  }

  static Future<AgentFunctionResponseMessage> _run(
    AgentFunction fn,
    Map<String, dynamic> args,
    AgentFunctionContext context,
  ) async {
    try {
      final Object? result = await Future<Object?>.sync(
        () => fn.handler(args, context),
      );
      return AgentFunctionResponseMessage(
        version: A2uiProtocolVersion.v1_0.jsonValue,
        response: A2uiFunctionResponse.value(
          context.functionCallId,
          _serializeReturnValue(result, fn.name),
        ),
      );
    } on A2uiRpcError catch (rpcErr) {
      return _errorResponse(
        context.functionCallId,
        rpcErr.code,
        rpcErr.message,
      );
    } catch (error, stackTrace) {
      // Any other failure, an A2uiValidationError included, is the handler's
      // own error: the arguments were valid, so it isn't the call's fault.
      developer.log(
        "Agent function '${fn.name}' (call ${context.functionCallId}) failed.",
        name: 'a2ui_agent',
        error: error,
        stackTrace: stackTrace,
      );
      return _errorResponse(
        context.functionCallId,
        RpcErrorCode.executionError.wireValue,
        error is A2uiError ? error.message : '$error',
      );
    }
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

    // From this point on, functionCallId is recoverable, so any body
    // validation failure produces an INVALID_FUNCTION_CALL response.
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
    final Map<String, Object?> defs = schema[r'$defs'] is Map
        ? (schema[r'$defs']! as Map).cast<String, Object?>()
        : const <String, Object?>{};
    _populateObjectDefaults(result, schema, defs, const <String>{});
    return result;
  }

  static (bool, Object?) _extractPropertyDefault(
    Map<String, Object?> propSchema,
    Map<String, Object?> defs,
    Set<String> visited,
  ) {
    if (propSchema.containsKey('default')) {
      return (true, propSchema['default']);
    }
    if (propSchema[r'$ref'] case final String ref when !visited.contains(ref)) {
      final Map<String, Object?>? target = _resolveLocalDef(ref, defs);
      if (target != null) {
        final (bool found, Object? value) = _extractPropertyDefault(
          target,
          defs,
          <String>{...visited, ref},
        );
        if (found) return (true, value);
      }
    }
    if (propSchema['allOf'] case final List<Object?> members) {
      for (final member in members) {
        if (member is Map) {
          final (bool found, Object? value) = _extractPropertyDefault(
            member.cast<String, Object?>(),
            defs,
            visited,
          );
          if (found) return (true, value);
        }
      }
    }
    return (false, null);
  }

  static void _populateObjectDefaults(
    Map<String, dynamic> target,
    Map<String, Object?> schema,
    Map<String, Object?> defs,
    Set<String> visited,
  ) {
    final Object? props = schema['properties'];
    if (props is Map) {
      for (final MapEntry<Object?, Object?> entry in props.entries) {
        final Object? key = entry.key;
        final Object? propSchema = entry.value;
        if (key is! String || propSchema is! Map) continue;
        final Map<String, Object?> propSchemaMap = propSchema
            .cast<String, Object?>();
        if (!target.containsKey(key)) {
          final (bool hasDefault, Object? defaultVal) = _extractPropertyDefault(
            propSchemaMap,
            defs,
            const <String>{},
          );
          if (hasDefault) {
            target[key] = _deepCopyJson(defaultVal);
          }
        } else if (target[key] is Map) {
          final rawNested = target[key]! as Map<Object?, Object?>;
          final nested = <String, dynamic>{
            for (final MapEntry<Object?, Object?> e in rawNested.entries)
              '${e.key}': e.value,
          };
          target[key] = nested;
          _populateObjectDefaults(
            nested,
            propSchemaMap,
            defs,
            const <String>{},
          );
        }
      }
    }
    if (schema[r'$ref'] case final String ref when !visited.contains(ref)) {
      final Map<String, Object?>? refTarget = _resolveLocalDef(ref, defs);
      if (refTarget != null) {
        _populateObjectDefaults(target, refTarget, defs, <String>{
          ...visited,
          ref,
        });
      }
    }
    if (schema['allOf'] case final List<Object?> members) {
      for (final member in members) {
        if (member is Map) {
          _populateObjectDefaults(
            target,
            member.cast<String, Object?>(),
            defs,
            visited,
          );
        }
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
