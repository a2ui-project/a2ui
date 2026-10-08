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
import 'dart:convert';

import 'package:json_schema_builder/json_schema_builder.dart';

import '../primitives/errors.dart';
import '../primitives/reactivity.dart';
import '../validation/common_types.g.dart';
import '../validation/schema_resolution.dart';
import 'catalog.dart';
import 'common.dart';
import 'component_model.dart';
import 'data_model.dart';
import 'messages.dart';
import 'surface_model.dart';

/// A function that invokes a catalog function by name.
typedef FunctionInvoker = Object? Function(
  String name,
  Map<String, dynamic> args,
  DataContext context,
);

/// Returns the invoker for the catalog with [catalogId].
///
/// Throws [A2uiCatalogError] when no such catalog is available.
typedef CatalogInvokerResolver = FunctionInvoker Function(String catalogId);

/// Reports a failed function evaluation without depending on a surface.
typedef ExpressionErrorReporter = void Function(A2uiExpressionError error);

/// A dynamic value as [DataContext.resolveListenableWithPending] reports it:
/// its current `value`, and whether that value is a placeholder for an
/// agent call whose response has not arrived (`pending`).
typedef DynamicValueState = ({Object? value, bool pending});

/// Provides data access relative to a specific path in the DataModel.
///
/// Similar to a working directory: a DataContext scoped to `/users/0`
/// lets components use relative paths like `name` instead of absolute
/// paths like `/users/0/name`. Also evaluates data bindings and
/// function calls.
class DataContext {
  final DataModel dataModel;
  final FunctionInvoker _invoke;
  final CatalogInvokerResolver? _invokerForCatalog;
  final ExpressionErrorReporter? _onError;
  final AgentFunctionCaller? _callAgentFunction;
  final _AgentCallCache _agentCalls;
  final String path;
  final String? protocolVersion;

  /// Whether this context evaluates within a user activation, such as an
  /// action the user triggered. A function whose
  /// [FunctionApi.requiresUserActivation] is set runs only when this is true.
  final bool isUserActivated;

  /// With [onError], failed invocations are reported and resolve to null.
  /// Without it, the original exception is rethrown.
  ///
  /// A function call naming no `catalogId` runs through [invoke]. One that
  /// names a catalog runs through the invoker [invokerForCatalog] returns for
  /// it; without [invokerForCatalog], such a call fails with
  /// [A2uiCatalogResolutionError].
  ///
  /// On a v1.0 context with [callAgentFunction], a call that neither resolves
  /// (an [A2uiCatalogResolutionError]: no such catalog, no default catalog,
  /// or no such function) is sent to the agent instead; see
  /// [evaluateFunctionCall] and [isPendingAgentCall] for how its result
  /// arrives.
  DataContext(
    this.dataModel,
    FunctionInvoker invoke,
    this.path, {
    ExpressionErrorReporter? onError,
    this.protocolVersion,
    CatalogInvokerResolver? invokerForCatalog,
    this.isUserActivated = false,
    AgentFunctionCaller? callAgentFunction,
  })  : _invoke = invoke,
        _onError = onError,
        _invokerForCatalog = invokerForCatalog,
        _callAgentFunction = callAgentFunction,
        _agentCalls = _AgentCallCache();

  DataContext._derived(
    this.dataModel,
    this._invoke,
    this.path, {
    required ExpressionErrorReporter? onError,
    required this.protocolVersion,
    required CatalogInvokerResolver? invokerForCatalog,
    required this.isUserActivated,
    required AgentFunctionCaller? callAgentFunction,
    required _AgentCallCache agentCalls,
  })  : _onError = onError,
        _invokerForCatalog = invokerForCatalog,
        _callAgentFunction = callAgentFunction,
        _agentCalls = agentCalls;

  bool get isV10 {
    final String? v = protocolVersion;
    if (v == null) return false;
    final String core = v.startsWith('v') ? v.substring(1) : v;
    return (int.tryParse(core.split('.').first) ?? 0) >= 1;
  }

  /// Returns a data-binding map for [path] using the key required by the
  /// active protocol version (`{'@path': path}` in v1.0+, `{'path': path}` in
  /// pre-v1.0).
  Map<String, Object?> bindingFor(String path) => isV10
      ? <String, Object?>{'@path': path}
      : <String, Object?>{'path': path};

  /// Whether [value] is a data-binding object under this context's protocol
  /// version.
  ///
  /// From v1.0, a data binding is `{'@path': '<pointer>'}`. Before v1.0 it is
  /// `{'path': '<pointer>'}` without a `componentId` sibling, which would make
  /// it a `ChildListTemplate` instead.
  bool isDataBinding(Object? value) {
    if (value is! Map) return false;
    return isV10
        ? value['@path'] is String
        : value['path'] is String && !value.containsKey('componentId');
  }

  /// Whether [value] is a function-call object under this context's protocol
  /// version.
  ///
  /// From v1.0, a function call is `{'@call': '<name>', ...}`. Before v1.0 it
  /// is `{'call': '<name>', ...}`.
  bool isFunctionCall(Object? value) {
    if (value is! Map) return false;
    return isV10 ? value['@call'] is String : value['call'] is String;
  }

  /// Rewrites [part], a node of a parsed `${...}` expression, into the
  /// dynamic-value shape this context resolves.
  ///
  /// `ExpressionParser` always emits `{path}` and `{call, args, returnType}`
  /// nodes. Before v1.0 those are already the resolvable shape and [part] is
  /// returned unchanged. From v1.0 a path node becomes [bindingFor] of its
  /// path, a call node becomes `{'@call', 'args', 'returnType'}` with its
  /// arguments rewritten recursively, and lists and other maps are rewritten
  /// element by element.
  Object? adaptExpressionPart(Object? part) {
    if (!isV10) return part;
    if (part is List) {
      return [for (final Object? item in part) adaptExpressionPart(item)];
    }
    if (part is! Map) return part;
    if (part['path'] is String &&
        !part.containsKey('componentId') &&
        !part.containsKey('@path')) {
      return bindingFor(part['path'] as String);
    }
    if (part['call'] is String && !part.containsKey('@call')) {
      final Object? rawArgs = part['args'];
      return <String, Object?>{
        '@call': part['call'],
        'args': <String, Object?>{
          if (rawArgs is Map)
            for (final MapEntry<Object?, Object?> entry in rawArgs.entries)
              entry.key.toString(): adaptExpressionPart(entry.value),
        },
        'returnType': part['returnType'] ?? 'any',
      };
    }
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in part.entries)
        entry.key.toString(): adaptExpressionPart(entry.value),
    };
  }

  static const Set<String> _reservedDirectives = {'@path', '@call'};

  static bool _isSingleAtKey(String key) =>
      key.startsWith('@') && !key.startsWith('@@');

  static Map<String, dynamic> _asStringKeyedMap(Map<Object?, Object?> map) {
    if (map is Map<String, dynamic>) {
      return map;
    }
    final result = <String, dynamic>{};
    for (final MapEntry<Object?, Object?> entry in map.entries) {
      final Object? key = entry.key;
      if (key is! String) {
        throw A2uiValidationError(
          'Dynamic map keys must be Strings, got ${key.runtimeType}.',
        );
      }
      result[key] = entry.value;
    }
    return result;
  }

  void _validateReservedDirectives(Iterable<Object?> keys) {
    for (final key in keys) {
      if (key is String &&
          _isSingleAtKey(key) &&
          !_reservedDirectives.contains(key)) {
        throw A2uiValidationError(
          "Unrecognized reserved protocol directive '$key' in v1.0 dynamic "
          'object. Reserved keys must be in '
          '${_reservedDirectives.join(", ")}, '
          "or escaped with prefix doubling (e.g. '@$key').",
        );
      }
    }
  }

  String resolvePath(String relativePath) {
    if (relativePath.startsWith('/')) return relativePath;
    final String trimmedBase = path.length > 1 && path.endsWith('/')
        ? path.substring(0, path.length - 1)
        : (path.isEmpty ? '/' : path);
    if (relativePath.isEmpty || relativePath == '.') return trimmedBase;

    final base = trimmedBase == '/' ? '' : trimmedBase;
    return '$base/$relativePath';
  }

  /// Returns the evaluated result of a dynamic value (literal, data binding,
  /// or function call) at the current moment. Does not create subscriptions.
  ///
  /// An array or map payload resolves per element, since a dynamic value may
  /// be nested at any depth inside literal structure. A payload holding no
  /// bindings or calls is returned as-is rather than copied.
  Object? resolveSync(Object? value) {
    if (isV10) {
      if (value is Map && value.containsKey('@path')) {
        final binding = DataBinding.fromJson(_asStringKeyedMap(value));
        return dataModel.get(resolvePath(binding.path));
      }
      if (value is Map && value.containsKey('@call')) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value));
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = resolveSync(entry.value);
        }
        final Object? result = _evaluateFunction(call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        _validateReservedDirectives(stringMap.keys);
        if (!_containsDynamicValue(value)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in stringMap.entries) {
          final String keyStr = entry.key;
          final String unescapedKey =
              keyStr.startsWith('@@') ? keyStr.substring(1) : keyStr;
          result[unescapedKey] = resolveSync(entry.value);
        }
        return result;
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return dataModel.get(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value as Map));
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = resolveSync(entry.value);
        }
        final Object? result = _evaluateFunction(call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        if (!_containsDynamicValue(value)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in stringMap.entries) {
          result[entry.key] = resolveSync(entry.value);
        }
        return result;
      }
    }
    if (value is List) {
      if (!_containsDynamicValue(value)) {
        return value;
      }
      return value.map(resolveSync).toList();
    }
    return value;
  }

  /// Whether a value (typically an array element or map) contains any dynamic
  /// parts (path bindings, function calls, or v1.0 `@` directives/escapes)
  /// that require resolution or unescaping in the current protocol mode.
  bool _containsDynamicValue(Object? value) {
    if (value is List) {
      return value.any(_containsDynamicValue);
    }
    if (value is Map) {
      if (isDataBinding(value) || isFunctionCall(value)) {
        return true;
      }
      if (isV10 && value.keys.any((k) => k is String && k.startsWith('@'))) {
        return true;
      }
      return value.values.any(_containsDynamicValue);
    }
    return false;
  }

  /// Returns a reactive signal that re-evaluates a dynamic value
  /// whenever its underlying data dependencies change. Array and map
  /// payloads resolve per entry, mirroring [resolveSync].
  ReadonlySignal<Object?> resolveListenable(Object? value) {
    if (isV10) {
      if (value is Map && value.containsKey('@path')) {
        final binding = DataBinding.fromJson(_asStringKeyedMap(value));
        return dataModel.watch(resolvePath(binding.path));
      }
      if (value is Map && value.containsKey('@call')) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value));
        final Map<String, ReadonlySignal<Object?>> argSignals = {
          for (final MapEntry<String, dynamic> entry in call.args.entries)
            entry.key: resolveListenable(entry.value),
        };
        return computed(() {
          final args = <String, dynamic>{
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in argSignals.entries)
              entry.key: entry.value.value,
          };
          final Object? result = _evaluateFunction(call, args);
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        _validateReservedDirectives(stringMap.keys);
        if (!_containsDynamicValue(value)) {
          return signal(value);
        }
        final entries = <String, ReadonlySignal<Object?>>{
          for (final MapEntry<String, dynamic> e in stringMap.entries)
            (e.key.startsWith('@@') ? e.key.substring(1) : e.key):
                resolveListenable(e.value),
        };
        return computed(() => {
              for (final e in entries.entries) e.key: e.value.value,
            });
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return dataModel.watch(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value as Map));
        final Map<String, ReadonlySignal<Object?>> argSignals = {
          for (final MapEntry<String, dynamic> entry in call.args.entries)
            entry.key: resolveListenable(entry.value),
        };
        return computed(() {
          final args = <String, dynamic>{
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in argSignals.entries)
              entry.key: entry.value.value,
          };
          final Object? result = _evaluateFunction(call, args);
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        if (!_containsDynamicValue(value)) {
          return signal(value);
        }
        final Map<String, ReadonlySignal<Object?>> entries = {
          for (final MapEntry<String, dynamic> entry in stringMap.entries)
            entry.key: resolveListenable(entry.value),
        };
        return computed(
          () => {
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in entries.entries)
              entry.key: entry.value.value,
          },
        );
      }
    }
    if (value is List) {
      if (!_containsDynamicValue(value)) {
        return signal(value);
      }
      final List<ReadonlySignal<Object?>> items =
          value.map(resolveListenable).toList();
      return computed(() => [for (final item in items) item.value]);
    }
    return signal(value);
  }

  /// Invokes a function, reporting a failure only when a reporter was supplied.
  ///
  /// A call that cannot be resolved locally on a v1.0 context with an agent
  /// caller is sent to the agent; its value is null until the response
  /// arrives, and the signal [resolveListenable] builds updates then.
  Object? _evaluateFunction(FunctionCall call, Map<String, dynamic> args) {
    try {
      try {
        return _invokeLocally(call, args);
      } on A2uiCatalogResolutionError {
        final AgentFunctionCaller? caller = _agentCallerOrNull;
        if (caller == null) rethrow;
        return _agentCall(call, args, caller).value.value;
      }
    } catch (error) {
      if (_onError == null) rethrow;
      _report(error, call.call);
      return null;
    }
  }

  /// Runs [call] in the catalog it resolves to, with [args] already resolved.
  ///
  /// Throws [A2uiCatalogResolutionError] when no catalog or function matches,
  /// and whatever the invoker throws otherwise.
  Object? _invokeLocally(FunctionCall call, Map<String, dynamic> args) {
    final String name = call.call;
    final String? catalogId = call.catalogId;
    if (catalogId == null) return _invoke(name, args, this);
    final CatalogInvokerResolver? invokerForCatalog = _invokerForCatalog;
    if (invokerForCatalog == null) {
      throw A2uiCatalogResolutionError(
        "Function '$name' names catalog '$catalogId', but this context "
        'has no catalogs to resolve it against.',
        catalogId: catalogId,
        functionName: name,
      );
    }
    return invokerForCatalog(catalogId)(name, args, this);
  }

  /// The agent caller, when this context may fall back to it: only from
  /// v1.0, where `callAgentFunction` exists.
  AgentFunctionCaller? get _agentCallerOrNull =>
      isV10 ? _callAgentFunction : null;

  /// Reports [error], raised evaluating the function [name], through the
  /// reporter. Callers without a reporter rethrow instead.
  void _report(Object error, String name) {
    final ExpressionErrorReporter? onError = _onError;
    if (onError == null) return;
    onError(
      error is A2uiExpressionError
          ? error
          : A2uiExpressionError(
              error is A2uiError ? error.message : error.toString(),
              expression: name,
              cause: error,
            ),
    );
  }

  /// The agent call for [call] with [args], started now if no call with the
  /// same name, catalog and arguments is in flight or completed.
  ///
  /// Sharing the entry is what keeps a `computed` that re-evaluates with
  /// unchanged arguments from sending the call again. A failure evicts the
  /// entry (so a later retry or argument change can re-send it), leaves the
  /// value null, and is reported once through the reporter with the
  /// `A2uiRpcError` as its cause.
  _AgentCall _agentCall(
    FunctionCall call,
    Map<String, dynamic> args,
    AgentFunctionCaller caller,
  ) {
    final String key = _agentCallKey(call, args);
    final _AgentCall? existing = _agentCalls.entries[key];
    if (existing != null) return existing;
    _agentCalls.evictIfFull();
    final entry = _AgentCall(call.call, call.catalogId);
    _agentCalls.entries[key] = entry;
    final outbound = FunctionCall(
      call: call.call,
      args: args,
      returnType: call.returnType,
      catalogId: call.catalogId,
      reservedKeys: true,
    );
    Future<Object?> future;
    try {
      future = caller(outbound);
    } catch (error, stackTrace) {
      future = Future<Object?>.error(error, stackTrace);
    }
    future.then<void>(
      (value) {
        batch(() {
          entry.pending = false;
          entry.value.value = value;
          _agentCalls.version.value++;
        });
      },
      onError: (Object error) {
        batch(() {
          entry.pending = false;
          _agentCalls.entries.remove(key);
          _agentCalls.version.value++;
        });
        _report(error, call.call);
      },
    );
    return entry;
  }

  static Object? _canonicalize(Object? value) {
    if (value is Map) {
      final List<String> sortedKeys =
          value.keys.map((k) => k.toString()).toList()..sort();
      return <String, Object?>{
        for (final String key in sortedKeys) key: _canonicalize(value[key]),
      };
    }
    if (value is List) {
      return <Object?>[for (final Object? item in value) _canonicalize(item)];
    }
    return value;
  }

  static String _agentCallKey(FunctionCall call, Map<String, dynamic> args) =>
      jsonEncode(
        <String, Object?>{
          'name': call.call,
          'catalogId': call.catalogId,
          'args': _canonicalize(args),
        },
        toEncodable: (Object? value) => value.toString(),
      );

  /// Whether evaluating [value] now would read an agent call that is still
  /// awaiting its response.
  ///
  /// Walks [value] for function calls, resolves each call's arguments when a
  /// pending call for that function is in flight, and looks the call up among
  /// the agent calls this context has sent. A call that would resolve locally
  /// is never pending. Lets a consumer that treats a null from [resolveSync]
  /// as "not yet known" tell it from a null result.
  bool isPendingAgentCall(Object? value) {
    if (_agentCalls.entries.isEmpty) return false;
    if (value is List) return value.any(isPendingAgentCall);
    if (value is! Map) return false;
    if (isFunctionCall(value)) {
      final call = FunctionCall.fromJson(_asStringKeyedMap(value));
      if (call.args.values.any(isPendingAgentCall)) return true;
      if (!_agentCalls.hasPendingFor(call.call, call.catalogId)) {
        return false;
      }
      final args = <String, dynamic>{
        for (final MapEntry<String, dynamic> entry in call.args.entries)
          entry.key: resolveSync(entry.value),
      };
      final _AgentCall? entry = _agentCalls.entries[_agentCallKey(call, args)];
      return entry != null && entry.pending;
    }
    return value.values.any(isPendingAgentCall);
  }

  /// [resolveListenable], paired with whether the value is a placeholder for
  /// a pending agent call. The signal updates when the value changes and
  /// when a pending call settles, even if its value stays null.
  ReadonlySignal<DynamicValueState> resolveListenableWithPending(
    Object? value,
  ) {
    final ReadonlySignal<Object?> resolved = resolveListenable(value);
    return computed(() {
      // Read so a settled call re-runs this even when the value is unchanged.
      _agentCalls.version.value;
      return (value: resolved.value, pending: isPendingAgentCall(value));
    });
  }

  /// Evaluates [functionCall], a `{@call, args, catalogId}` object, as an
  /// action does: locally when a catalog implements it, otherwise through the
  /// agent on a v1.0 context, completing with the result.
  ///
  /// Arguments are resolved with [resolveSync]. A function that throws
  /// follows the reporter policy of [resolveSync] and completes with null. A
  /// function that returns a failing `Future`, and an agent call that fails
  /// (an `A2uiRpcError`), fail the returned future instead. An agent call is
  /// always sent, never shared with a dynamic value's pending call.
  Future<Object?> evaluateFunctionCall(
    Map<String, Object?> functionCall,
  ) async {
    final call = FunctionCall.fromJson(_asStringKeyedMap(functionCall));
    final args = <String, dynamic>{
      for (final MapEntry<String, dynamic> entry in call.args.entries)
        entry.key: resolveSync(entry.value),
    };
    Object? result;
    AgentFunctionCaller? agentCaller;
    try {
      try {
        result = _invokeLocally(call, args);
      } on A2uiCatalogResolutionError {
        agentCaller = _agentCallerOrNull;
        if (agentCaller == null) rethrow;
      }
    } catch (error) {
      if (_onError == null) rethrow;
      _report(error, call.call);
      return null;
    }
    if (agentCaller != null) {
      result = await agentCaller(
        FunctionCall(
          call: call.call,
          args: args,
          returnType: call.returnType,
          catalogId: call.catalogId,
          reservedKeys: true,
        ),
      );
    }
    if (result is Future) result = await result;
    if (result is ReadonlySignal) result = result.value;
    return result;
  }

  /// This context with [isUserActivated] set, for evaluation triggered by
  /// the user. Shares the data model, reporter and pending agent calls.
  DataContext withUserActivation() => DataContext._derived(
        dataModel,
        _invoke,
        path,
        onError: _onError,
        protocolVersion: protocolVersion,
        invokerForCatalog: _invokerForCatalog,
        isUserActivated: true,
        callAgentFunction: _callAgentFunction,
        agentCalls: _agentCalls,
      );

  DataContext nested(String relativePath) {
    return DataContext._derived(
      dataModel,
      _invoke,
      resolvePath(relativePath),
      onError: _onError,
      protocolVersion: protocolVersion,
      invokerForCatalog: _invokerForCatalog,
      isUserActivated: isUserActivated,
      callAgentFunction: _callAgentFunction,
      agentCalls: _agentCalls,
    );
  }

  void set(String relativePath, Object? value) {
    dataModel.set(resolvePath(relativePath), value);
  }

  /// Resolves an action payload by evaluating dynamic values in its context and
  /// userMessage.
  Map<String, dynamic>? resolveAction(Object? action) {
    if (action == null) return null;
    if (action is String) {
      if (action.isEmpty) return null;
      return {
        'event': {'name': action, 'context': <String, Object?>{}}
      };
    }
    if (action is! Map) return null;
    final map = Map<String, dynamic>.from(action);
    final Object? eventObj = map['event'];
    if (eventObj is Map) {
      final Object? name = eventObj['name'];
      if (name is! String || name.isEmpty) return null;
      final Map<String, dynamic> ev = _resolveActionFields(
        Map<String, dynamic>.from(eventObj),
      );
      return {...map, 'event': ev};
    }
    if (map.containsKey('name')) {
      final Object? name = map['name'];
      if (name is! String || name.isEmpty) return null;
      return _resolveActionFields(map);
    }
    return null;
  }

  Map<String, dynamic> _resolveActionFields(Map<String, dynamic> map) {
    final result = Map<String, dynamic>.from(map);
    final Object? ctx = result['context'];
    if (ctx is Map) {
      result['context'] = <String, Object?>{
        for (final MapEntry<Object?, Object?> e in ctx.entries)
          e.key.toString(): resolveSync(e.value),
      };
    } else {
      result['context'] = <String, Object?>{};
    }
    if (result.containsKey('userMessage')) {
      result['userMessage'] = resolveSync(result['userMessage']);
    }
    return result;
  }
}

/// One function call sent to the agent on a context's behalf.
class _AgentCall {
  _AgentCall(this.functionName, this.catalogId);

  final String functionName;
  final String? catalogId;

  /// The call's resolved value, null while pending or after a failure.
  final Signal<Object?> value = signal<Object?>(null);

  /// Whether the call is still awaiting its response.
  bool pending = true;
}

/// The agent calls a context and the contexts derived from it have sent,
/// keyed by name, catalog and resolved arguments.
class _AgentCallCache {
  static const int _maxEntries = 256;

  final Map<String, _AgentCall> entries = {};

  /// Bumped whenever a call settles, so a consumer that also needs to know
  /// about a call completing with null can depend on it.
  final Signal<int> version = signal<int>(0);

  bool hasPendingFor(String functionName, String? catalogId) {
    for (final _AgentCall call in entries.values) {
      if (call.pending &&
          call.functionName == functionName &&
          call.catalogId == catalogId) {
        return true;
      }
    }
    return false;
  }

  void evictIfFull() {
    if (entries.length < _maxEntries) return;
    for (final MapEntry<String, _AgentCall> entry in entries.entries) {
      if (!entry.value.pending) {
        entries.remove(entry.key);
        return;
      }
    }
  }
}

/// Shared [_AgentCallCache] per [SurfaceModel] so all [ComponentContext]
/// instances on a surface deduplicate in-flight agent calls.
final Expando<_AgentCallCache> _surfaceAgentCalls = Expando();

/// Context provided to components during rendering.
class ComponentContext {
  final SurfaceModel surface;
  final ComponentModel componentModel;
  final DataContext dataContext;

  /// By default, expression errors are dispatched immediately on the surface:
  /// as `EXECUTION_ERROR` naming the `functionCallId` when the cause is an
  /// [A2uiRpcError] from a call the agent answered with a failure, and as
  /// `EXPRESSION_ERROR` otherwise. Supply [onError] to control their
  /// reporting policy instead.
  ComponentContext(
    this.surface,
    this.componentModel, {
    String? basePath,
    ExpressionErrorReporter? onError,
  }) : dataContext = DataContext._derived(
          surface.dataModel,
          (name, args, context) =>
              surface.resolveCatalog(null).invoke(name, args, context),
          basePath ?? '/',
          onError: onError ?? _surfaceReporter(surface),
          protocolVersion: surface.protocolVersion,
          invokerForCatalog: (catalogId) =>
              surface.resolveCatalog(catalogId).invoke,
          isUserActivated: false,
          callAgentFunction: surface.callAgentFunction,
          agentCalls: _surfaceAgentCalls[surface] ??= _AgentCallCache(),
        );

  static ExpressionErrorReporter _surfaceReporter(SurfaceModel surface) =>
      (error) => surface.dispatchError(clientErrorFor(surface, error));

  /// Builds the [A2uiClientError] for [error] on [surface].
  ///
  /// When [error]'s cause is an [A2uiRpcError], the error code is
  /// `EXECUTION_ERROR` and `functionCallId` is set (omitting `surfaceId` when
  /// `functionCallId` is non-null to satisfy the v1.0 wire `oneOf` rule).
  static A2uiClientError clientErrorFor(
    SurfaceModel surface,
    A2uiExpressionError error,
  ) {
    final Object? cause = error.cause;
    return cause is A2uiRpcError
        ? A2uiClientError(
            code: RpcErrorCode.executionError.wireValue,
            surfaceId: cause.functionCallId == null ? surface.id : null,
            functionCallId: cause.functionCallId,
            message: error.message,
            details: error.details,
          )
        : A2uiClientError(
            code: 'EXPRESSION_ERROR',
            surfaceId: surface.id,
            message: error.message,
            details: error.details,
          );
  }

  /// Dispatches an action from the component.
  Future<void> dispatchAction(Map<String, dynamic> action) {
    return surface.dispatchAction(action, componentModel.id);
  }

  /// Returns a context for rendering a child component.
  ///
  /// Throws [A2uiStateError] if [childId] does not exist on the surface or if
  /// [basePath] is not an absolute JSON Pointer path starting with `/`.
  ComponentContext childContext(String childId, {String? basePath}) {
    if (basePath != null && !basePath.startsWith('/')) {
      throw A2uiStateError(
        "Base path for child context must be absolute (start with '/'), "
        "got '$basePath'.",
      );
    }
    final ComponentModel? childModel = surface.componentsModel.get(childId);
    if (childModel == null) {
      throw A2uiStateError('Child component not found: $childId');
    }
    return ComponentContext(
      surface,
      childModel,
      basePath: basePath ?? dataContext.path,
      onError: dataContext._onError,
    );
  }
}

/// Resolved function argument schemas, per catalog and then per function.
final Expando<Map<FunctionImplementation, Map<String, Object?>>>
    _resolvedArgumentSchemas = Expando();

/// The `common_types.json` this package embeds, decoded once.
final Map<String, Object?> _embeddedCommonTypes =
    jsonDecode(commonTypesV0_9Json) as Map<String, Object?>;

extension CatalogInvokerExtension
    on Catalog<ComponentApi, FunctionImplementation> {
  /// Invokes a catalog function by name with the given arguments.
  ///
  /// Throws [A2uiCatalogResolutionError] when the catalog has no function
  /// named [name], and [A2uiExpressionError] when [args] do not match the
  /// function's argument schema, the function is [AllowedCallers.agentOnly],
  /// or the function requires a user activation (see
  /// [FunctionApi.requiresUserActivation]) and [context] is not one; the
  /// function does not run in any of these cases.
  ///
  /// A null argument is an unresolved value, such as a binding to data that
  /// is not there yet, so it is left for the function to handle rather than
  /// checked against the schema.
  Object? invoke(String name, Map<String, dynamic> args, DataContext context) {
    final FunctionImplementation? fn = functions[name];
    if (fn == null) {
      throw A2uiCatalogResolutionError(
        'Function not found: $name',
        catalogId: id,
        functionName: name,
      );
    }
    if (fn.allowedCallers == AllowedCallers.agentOnly) {
      throw A2uiExpressionError(
        "Function '$name' cannot be called by renderer (allowedCallers is "
        'agentOnly).',
        expression: name,
      );
    }
    if (fn.requiresUserActivation && !context.isUserActivated) {
      throw A2uiExpressionError(
        "Function '$name' requires user activation context to execute.",
        expression: name,
      );
    }
    final List<ValidationError> errors = argumentErrors(fn, args);
    if (errors.isNotEmpty) {
      throw A2uiExpressionError(
        "Arguments to '$name' do not match its schema in catalog '$id': "
        '${errors.map((e) => e.toErrorString()).join('; ')}',
        expression: name,
        details: args,
      );
    }
    return fn.execute(args, context);
  }

  /// The argument schema of [fn] with its references resolved, so that a
  /// parameter typed by `common_types.json` or by a definition this catalog
  /// bundles is checked rather than left unconstrained.
  ///
  /// Resolved once per catalog and function: invoke runs on the reactive
  /// path, where resolving on every call would be noticeable.
  Map<String, Object?> _resolvedArgumentSchema(FunctionImplementation fn) {
    final Map<FunctionImplementation, Map<String, Object?>> byFunction =
        _resolvedArgumentSchemas[this] ??= Map.identity();
    return byFunction[fn] ??= resolveSchemaRefs(
      fn.argumentSchema.value,
      catalogSchema,
      commonTypes: _embeddedCommonTypes,
    );
  }

  /// The ways [args] fail [fn]'s argument schema, or an empty list when they
  /// match. Null arguments are left unchecked, as in [invoke].
  List<ValidationError> argumentErrors(
    FunctionImplementation fn,
    Map<String, dynamic> args,
  ) {
    final Set<String> unresolved = {
      for (final MapEntry<String, dynamic> entry in args.entries)
        if (entry.value == null) entry.key,
    };
    final Map<String, Object?> schema = _resolvedArgumentSchema(fn);
    if (unresolved.isEmpty) return Schema.fromMap(schema).validateSync(args);
    final Object? required = schema['required'];
    return Schema.fromMap({
      ...schema,
      if (required is List)
        'required': [
          for (final Object? key in required)
            if (!unresolved.contains(key)) key,
        ],
    }).validateSync({
      for (final MapEntry<String, dynamic> entry in args.entries)
        if (entry.value != null) entry.key: entry.value,
    });
  }
}
