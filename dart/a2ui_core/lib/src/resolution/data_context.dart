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

import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;

import '../core/catalog.dart';
import '../core/common.dart';
import '../core/data_model.dart';
import '../core/surface_model.dart';
import '../core/validation_result.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/reactivity.dart';
import '../validation/component_graph.dart' show maxFunctionCallArgs;
import '../validation/schema_resolution.dart';
import 'validation_result_coercion.dart';

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
///
/// The error's [A2uiError.code] is `CATALOG_ERROR` when the call's catalog
/// could not be resolved, and `EXPRESSION_ERROR` for any other failure.
typedef ExpressionErrorReporter = void Function(A2uiExpressionError error);

/// Reports a data binding whose absolute [path] does not exist in the data
/// model when the binding is resolved.
typedef MissingDataReporter = void Function(String path);

/// The deepest nesting of lists, maps, and function arguments that
/// [DataContext] resolves inside one dynamic value. Deeper payloads fail with
/// an [A2uiExpressionError] instead of exhausting the call stack.
const int maxDynamicValueDepth = 1000;

class _SignalDataSubscription<T extends Object?>
    implements DataSubscription<T> {
  final ReadonlySignal<Object?> _signal;
  void Function()? _dispose;

  _SignalDataSubscription(this._signal);

  @override
  T? get value {
    final Object? val = _signal.peek();
    return val as T?;
  }

  @override
  void unsubscribe() {
    final void Function()? dispose = _dispose;
    _dispose = null;
    dispose?.call();
  }
}

/// A dynamic value as [DataContext.resolveSignalWithPending] reports it:
/// its current `value`, and whether that value is a placeholder for an
/// agent call whose response has not arrived (`pending`).
typedef DynamicValueState = ({Object? value, bool pending});

/// Provides data access relative to a specific path in the DataModel.
///
/// Similar to a working directory: a DataContext scoped to `/users/0`
/// lets components use relative paths like `name` instead of absolute
/// paths like `/users/0/name`. Also evaluates data bindings and
/// function calls.
///
/// Contexts form a chain through [parent]: a component's context links to
/// the context of the component that references it, and a template child's
/// context records its iteration [index]. The v1.0 `@index` system function
/// reads that chain.
class DataContext {
  final DataModel dataModel;
  final FunctionInvoker _invoke;
  final CatalogInvokerResolver? _invokerForCatalog;
  final ExpressionErrorReporter? _onError;
  final MissingDataReporter? _onMissingData;
  final Set<String> _warnedPaths;
  final AgentFunctionCaller? _callAgentFunction;
  final _AgentCallCache _agentCalls;
  final String path;
  final A2uiProtocolVersion? protocolVersion;

  /// The context this one was derived from, or null for a root context.
  final DataContext? parent;

  final int? _explicitIndex;

  /// Set while an action invokes a function locally, so that
  /// [CatalogInvokerExtension.invoke] marks a failure of the function itself
  /// as an [_ExecutionFailure]. Cleared before the function runs, so calls
  /// it makes are not marked.
  bool _marksExecutionFailures = false;

  /// Whether this context evaluates within a user activation, such as an
  /// action the user triggered. A function whose
  /// [FunctionApi.requiresUserActivation] is set runs only when this is true.
  final bool isUserActivated;

  /// With [onError], failed invocations are reported and resolve to null.
  /// Without it, the original exception is rethrown.
  ///
  /// A function call naming no `catalogId` runs through [invoke]. From v1.0
  /// one that names a catalog runs through the invoker [invokerForCatalog]
  /// returns for it; without [invokerForCatalog], such a call fails with
  /// [A2uiCatalogError]. Before v1.0 a call carries no `catalogId`, so every
  /// call runs through [invoke].
  ///
  /// On a v1.0 context with [callAgentFunction], a call whose catalog
  /// resolves but has no function of that name is sent to the agent instead,
  /// naming the catalog it resolved to, wherever its result can wait: in a
  /// [resolveSignal] binding, a check, or an action; see
  /// [evaluateFunctionCall] and [isPendingAgentCall] for how its result
  /// arrives. A one-shot [resolveDynamicValue] never sends a call. A call
  /// whose catalog cannot be resolved (no such catalog, or no default
  /// catalog) is never sent: it fails with an [A2uiCatalogResolutionError]
  /// as without a caller.
  ///
  /// [index] is the collection iteration index when this context scopes a
  /// template child. [onMissingData] is called once per absolute path, per
  /// chain of contexts sharing a root, when a data binding names a path that
  /// does not exist; it defaults to [parent]'s reporter. A context with a
  /// [parent] also shares its pending agent calls.
  DataContext(
    this.dataModel,
    FunctionInvoker invoke,
    this.path, {
    ExpressionErrorReporter? onError,
    this.protocolVersion,
    CatalogInvokerResolver? invokerForCatalog,
    this.parent,
    int? index,
    MissingDataReporter? onMissingData,
    this.isUserActivated = false,
    AgentFunctionCaller? callAgentFunction,
  })  : _invoke = invoke,
        _onError = onError,
        _invokerForCatalog = invokerForCatalog,
        _explicitIndex = index,
        _onMissingData = onMissingData ?? parent?._onMissingData,
        _warnedPaths = parent?._warnedPaths ?? <String>{},
        _callAgentFunction = callAgentFunction,
        _agentCalls = parent?._agentCalls ?? _AgentCallCache();

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
    this.parent,
    int? index,
    MissingDataReporter? onMissingData,
    Set<String>? warnedPaths,
  })  : _onError = onError,
        _invokerForCatalog = invokerForCatalog,
        _callAgentFunction = callAgentFunction,
        _agentCalls = agentCalls,
        _explicitIndex = index,
        _onMissingData = onMissingData ?? parent?._onMissingData,
        _warnedPaths = warnedPaths ?? parent?._warnedPaths ?? <String>{};

  /// The 0-based iteration index of the nearest enclosing collection
  /// template, or null outside any template.
  ///
  /// Walks this context and its ancestors, taking the first explicit index,
  /// or else the first path whose last segment is a non-negative integer.
  int? get index {
    for (DataContext? ctx = this; ctx != null; ctx = ctx.parent) {
      final int? explicit = ctx._explicitIndex;
      if (explicit != null) return explicit;
      final String last = ctx.path.split('/').lastWhere(
            (segment) => segment.isNotEmpty,
            orElse: () => '',
          );
      // tryParse: a digit run too long for an int is not an index.
      final int? parsed = _digits.hasMatch(last) ? int.tryParse(last) : null;
      if (parsed != null) return parsed;
    }
    return null;
  }

  static final RegExp _digits = RegExp(r'^\d+$');

  /// Whether this context targets protocol v1.0 or any later version.
  bool get atLeastV10 =>
      protocolVersion != null &&
      protocolVersion!.isAtLeast(A2uiProtocolVersion.v1_0);

  /// Alias for [atLeastV10] indicating whether this context uses `@`-prefixed
  /// directives (`@path`, `@call`, `@index`, and `@@` escaping).
  bool get usesDirectives => atLeastV10;

  /// Returns a data-binding map for [path] using the key required by the
  /// active protocol version (`{'@path': path}` in v1.0+, `{'path': path}` in
  /// pre-v1.0).
  Map<String, Object?> bindingFor(String path) => atLeastV10
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
    return atLeastV10
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
    return atLeastV10 ? value['@call'] is String : value['call'] is String;
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
    if (!atLeastV10) return part;
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
  ///
  /// The result cannot wait, so a function no catalog implements is not sent
  /// to the agent: it reads an answer the context already received, null
  /// while a binding still awaits one, and otherwise fails as a missing
  /// function.
  Object? resolveDynamicValue(Object? value) => _resolveDynamicValue(value, 0);

  Object? _resolveDynamicValue(
    Object? value,
    int depth, {
    bool keepFailed = false,
  }) {
    if (depth > maxDynamicValueDepth) {
      _reportDepthExceeded();
      return keepFailed ? _failedArg : null;
    }
    if (atLeastV10) {
      if (value is Map && value.containsKey('@path')) {
        final binding = DataBinding.fromJson(_asStringKeyedMap(value));
        return _readBinding(resolvePath(binding.path));
      }
      if (value is Map && value.containsKey('@call')) {
        if (_systemCallNamingCatalog(value)
            case final A2uiExpressionError error) {
          _reportSync(error);
          return keepFailed ? _failedArg : null;
        }
        final call = FunctionCall.fromJson(_asStringKeyedMap(value));
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = _resolveDynamicValue(
            entry.value,
            depth + 1,
            keepFailed: true,
          );
        }
        if (_containsFailedArg(args)) return keepFailed ? _failedArg : null;
        if (_containsPendingArg(args)) return keepFailed ? _pendingArg : null;
        // A one-shot read cannot wait for an answer, so it never sends a
        // call to the agent; it can still read an answer already received.
        final Object? result = _evaluateFunction(
          call,
          args,
          keepFailed: keepFailed,
        );
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        _validateReservedDirectives(stringMap.keys);
        if (!_containsDynamicValue(value, depth)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in stringMap.entries) {
          final String keyStr = entry.key;
          final String unescapedKey =
              keyStr.startsWith('@@') ? keyStr.substring(1) : keyStr;
          result[unescapedKey] = _resolveDynamicValue(
            entry.value,
            depth + 1,
            keepFailed: keepFailed,
          );
        }
        return result;
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return _readBinding(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value as Map));
        final args = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in call.args.entries) {
          args[entry.key] = _resolveDynamicValue(entry.value, depth + 1);
        }
        final Object? result = _evaluateFunction(call, args);
        if (result is ReadonlySignal) {
          return result.value;
        }
        return result;
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        if (!_containsDynamicValue(value, depth)) return value;
        final result = <String, dynamic>{};
        for (final MapEntry<String, dynamic> entry in stringMap.entries) {
          result[entry.key] = _resolveDynamicValue(entry.value, depth + 1);
        }
        return result;
      }
    }
    if (value is List) {
      if (!_containsDynamicValue(value, depth)) {
        return value;
      }
      return [
        for (final item in value)
          _resolveDynamicValue(item, depth + 1, keepFailed: keepFailed),
      ];
    }
    return value;
  }

  /// Whether a value (typically an array element or map) contains any dynamic
  /// parts (path bindings, function calls, or v1.0 `@` directives/escapes)
  /// that require resolution or unescaping in the current protocol mode.
  ///
  /// Past [maxDynamicValueDepth] it reports true, so resolution reaches the
  /// depth guard instead of returning the payload unchecked.
  bool _containsDynamicValue(Object? value, int depth) {
    if (depth > maxDynamicValueDepth) return true;
    if (value is List) {
      return value.any((item) => _containsDynamicValue(item, depth + 1));
    }
    if (value is Map) {
      if (isDataBinding(value) || isFunctionCall(value)) {
        return true;
      }
      if (atLeastV10 &&
          value.keys.any((k) => k is String && k.startsWith('@'))) {
        return true;
      }
      return value.values.any((item) => _containsDynamicValue(item, depth + 1));
    }
    return false;
  }

  /// Returns a reactive signal that re-evaluates a dynamic value
  /// whenever its underlying data dependencies change. Array and map
  /// payloads resolve per entry, mirroring [resolveDynamicValue].
  ReadonlySignal<Object?> resolveSignal(Object? value) =>
      _resolveSignal(value, 0);

  ReadonlySignal<Object?> _resolveSignal(
    Object? value,
    int depth, {
    bool keepFailed = false,
  }) {
    if (depth > maxDynamicValueDepth) {
      _reportDepthExceeded();
      return signal(keepFailed ? _failedArg : null);
    }
    if (atLeastV10) {
      if (value is Map && value.containsKey('@path')) {
        final binding = DataBinding.fromJson(_asStringKeyedMap(value));
        return _watchBinding(resolvePath(binding.path));
      }
      if (value is Map && value.containsKey('@call')) {
        if (_systemCallNamingCatalog(value)
            case final A2uiExpressionError error) {
          return computed(() {
            _reportSync(error);
            return keepFailed ? _failedArg : null;
          });
        }
        final call = FunctionCall.fromJson(_asStringKeyedMap(value));
        final Map<String, ReadonlySignal<Object?>> argSignals = {
          for (final MapEntry<String, dynamic> entry in call.args.entries)
            entry.key: _resolveSignal(
              entry.value,
              depth + 1,
              keepFailed: true,
            ),
        };
        String? lastAgentKey;
        _AgentCall? lastAgentCall;
        return computed(() {
          final args = <String, dynamic>{
            for (final MapEntry<String, ReadonlySignal<Object?>> entry
                in argSignals.entries)
              entry.key: entry.value.value,
          };
          if (_containsFailedArg(args)) return keepFailed ? _failedArg : null;
          if (_containsPendingArg(args)) {
            return keepFailed ? _pendingArg : null;
          }
          final Object? result = _evaluateFunction(
            call,
            args,
            keepFailed: keepFailed,
            canSend: true,
            lastAgentKey: lastAgentKey,
            lastAgentCall: lastAgentCall,
            onAgentCall: (key, entry) {
              lastAgentKey = key;
              lastAgentCall = entry;
            },
          );
          if (result is ReadonlySignal) {
            return result.value;
          }
          return result;
        });
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        _validateReservedDirectives(stringMap.keys);
        if (!_containsDynamicValue(value, depth)) {
          return signal(value);
        }
        final entries = <String, ReadonlySignal<Object?>>{
          for (final MapEntry<String, dynamic> e in stringMap.entries)
            (e.key.startsWith('@@') ? e.key.substring(1) : e.key):
                _resolveSignal(e.value, depth + 1, keepFailed: keepFailed),
        };
        return computed(() => {
              for (final e in entries.entries) e.key: e.value.value,
            });
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return _watchBinding(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        final call = FunctionCall.fromJson(_asStringKeyedMap(value as Map));
        final Map<String, ReadonlySignal<Object?>> argSignals = {
          for (final MapEntry<String, dynamic> entry in call.args.entries)
            entry.key: _resolveSignal(entry.value, depth + 1),
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
        if (!_containsDynamicValue(value, depth)) {
          return signal(value);
        }
        final Map<String, ReadonlySignal<Object?>> entries = {
          for (final MapEntry<String, dynamic> entry in stringMap.entries)
            entry.key: _resolveSignal(entry.value, depth + 1),
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
      if (!_containsDynamicValue(value, depth)) {
        return signal(value);
      }
      final List<ReadonlySignal<Object?>> items = [
        for (final item in value)
          _resolveSignal(item, depth + 1, keepFailed: keepFailed),
      ];
      return computed(() => [for (final item in items) item.value]);
    }
    return signal(value);
  }

  /// The error for a v1.0 call to a reserved `@` system function that has a
  /// `catalogId` key, whatever its value, or null for any other call.
  ///
  /// A system function belongs to no catalog, so such a call is a malformed
  /// expression: it is reported as `EXPRESSION_ERROR` and not run. Checked
  /// before the call is parsed, so a non-string `catalogId` is reported the
  /// same way.
  A2uiExpressionError? _systemCallNamingCatalog(Map<Object?, Object?> call) {
    final Object? name = call['@call'];
    if (!atLeastV10 ||
        name is! String ||
        !name.startsWith('@') ||
        !call.containsKey('catalogId')) {
      return null;
    }
    return A2uiExpressionError(
      "System function '$name' belongs to no catalog and must not name a "
      'catalogId.',
      expression: name,
    );
  }

  /// Reports [error] and resolves to null, or throws it when no reporter
  /// was supplied, as a failed invocation does.
  Object? _reportSync(A2uiExpressionError error) {
    final ExpressionErrorReporter? onError = _onError;
    if (onError == null) throw error;
    onError(error);
    return null;
  }

  /// Invokes a function, reporting a failure only when a reporter was supplied.
  ///
  /// From v1.0 a name in the reserved `@` namespace, such as `@index`, is a
  /// system function that belongs to no catalog, so no catalog is consulted
  /// for it. `@index` is the only system function this SDK evaluates; a call
  /// to any other fails with an [A2uiExpressionError]. A `catalogId` on the
  /// call is honored only from v1.0; before it, every call runs in the
  /// default catalog.
  ///
  /// A call to a function its resolved catalog does not have, on a v1.0
  /// context with an agent caller, is sent to the agent; its value is null
  /// until the response arrives, and the signal [resolveSignal] builds
  /// updates then. A call whose catalog cannot be resolved is not sent.
  ///
  /// The reported error carries code `CATALOG_ERROR` when the call's catalog
  /// can't be resolved (the invoker threw [A2uiCatalogError]): the expression
  /// may be fine, and the function may exist in a catalog the surface does
  /// not have. Every other failure, including a function missing from the
  /// catalog the call resolved to, carries `EXPRESSION_ERROR`.
  Object? _evaluateFunction(
    FunctionCall call,
    Map<String, dynamic> args, {
    bool keepFailed = false,
    bool canSend = false,
    String? lastAgentKey,
    _AgentCall? lastAgentCall,
    void Function(String key, _AgentCall entry)? onAgentCall,
  }) {
    final String name = call.call;
    try {
      if (atLeastV10 && name.startsWith('@') && name != _indexFunctionName) {
        throw A2uiExpressionError(
          "System function '$name' is not supported by this renderer.",
          expression: name,
        );
      }
      try {
        return _invokeLocally(call, args);
      } on A2uiCatalogResolutionError catch (error) {
        final String? catalogId = _routableCatalogId(error, name);
        if (catalogId == null) rethrow;
        final AgentFunctionCaller? caller = canSend ? _agentCallerOrNull : null;
        if (!_isPlainJson(args)) {
          if (caller == null) rethrow;
          _checkJsonArguments(call.call, args);
        }
        final String key = _agentCallKey(call.call, catalogId, args);
        // The binding keeps the call it made for these arguments, answered
        // or failed, even after the shared cache evicts it, so a failing
        // agent is not asked again in a loop. A cancelled call is not kept:
        // it is sent again the next time the binding evaluates.
        final _AgentCall? own = lastAgentKey == key &&
                lastAgentCall != null &&
                !lastAgentCall.cancelled
            ? lastAgentCall
            : null;
        final _AgentCall? existing =
            own ?? _agentCalls.lookup(call, catalogId, args);
        if (existing != null) {
          onAgentCall?.call(key, existing);
          return _agentCallValue(existing, keepFailed: keepFailed);
        }
        if (caller == null) rethrow;
        final _AgentCall entry = _agentCall(call, catalogId, args, caller);
        onAgentCall?.call(key, entry);
        return _agentCallValue(entry, keepFailed: keepFailed);
      }
    } catch (error) {
      if (_onError == null) rethrow;
      _report(error, call.call);
      return keepFailed ? _failedArg : null;
    }
  }

  /// The value [entry] gives a binding, which depends on it: the answer, or,
  /// while it is pending or after it failed, null, or with [keepFailed] the
  /// [_pendingArg] or [_failedArg] marker that holds the enclosing call.
  static Object? _agentCallValue(_AgentCall entry, {required bool keepFailed}) {
    entry.version.value;
    if (entry.pending) return keepFailed ? _pendingArg : null;
    if (entry.failed) return keepFailed ? _failedArg : null;
    return entry.value.value;
  }

  static const String _indexFunctionName = '@index';

  /// Evaluates `@index`: the iteration [index] plus the optional `offset`.
  Object? _evaluateIndex(Map<String, dynamic> args) {
    final Object? offset = args['offset'];
    if (offset != null && (offset is! num || !offset.isFinite)) {
      throw A2uiExpressionError(
        "Argument 'offset' of '$_indexFunctionName' must be a finite number, "
        'got $offset.',
        expression: _indexFunctionName,
      );
    }
    final int? current = index;
    if (current == null) {
      throw A2uiValidationError(
        '$_indexFunctionName function can only be evaluated inside a '
        'collection template iteration scope.',
      );
    }
    return offset == null ? current : current + (offset as num);
  }

  void _reportDepthExceeded() {
    final error = A2uiExpressionError(
      'Maximum dynamic value nesting depth exceeded ($maxDynamicValueDepth).',
    );
    final ExpressionErrorReporter? onError = _onError;
    if (onError == null) throw error;
    onError(error);
  }

  Object? _readBinding(String absolutePath) {
    _checkMissing(absolutePath);
    return dataModel.get(absolutePath);
  }

  ReadonlySignal<Object?> _watchBinding(String absolutePath) {
    _checkMissing(absolutePath);
    return dataModel.watch(absolutePath);
  }

  void _checkMissing(String absolutePath) {
    final MissingDataReporter? report = _onMissingData;
    if (report == null ||
        dataModel.has(absolutePath) ||
        !_warnedPaths.add(absolutePath)) {
      return;
    }
    report(absolutePath);
  }

  /// Resolves [value] like [resolveSignal] and calls [onChange] with each
  /// later value until [DataSubscription.unsubscribe]. The current value is
  /// available from [DataSubscription.value]; [onChange] is not called for
  /// it.
  DataSubscription<T> subscribeDynamicValue<T extends Object?>(
    Object? value,
    void Function(T? value) onChange,
  ) {
    final ReadonlySignal<Object?> source = resolveSignal(value);
    final subscription = _SignalDataSubscription<T>(source);
    var initial = true;
    subscription._dispose = source.subscribe((next) {
      if (!initial) onChange(next as T?);
    });
    initial = false;
    return subscription;
  }

  /// Runs [call] in the catalog it resolves to, with [args] already resolved.
  ///
  /// The v1.0 `@index` system function is evaluated here, before any catalog
  /// lookup: catalogs cannot define `@` names.
  ///
  /// Throws [A2uiCatalogResolutionError] when no catalog or function matches,
  /// and whatever the invoker throws otherwise.
  Object? _invokeLocally(FunctionCall call, Map<String, dynamic> args) {
    final String name = call.call;
    if (atLeastV10 && name == _indexFunctionName) {
      return _evaluateIndex(args);
    }
    if (args.length > maxFunctionCallArgs) {
      throw A2uiExpressionError(
        "Function call '$name' exceeds maximum allowed arguments count "
        '($maxFunctionCallArgs)',
        expression: name,
      );
    }
    final String? catalogId = atLeastV10 ? call.catalogId : null;
    if (catalogId == null) return _invoke(name, args, this);
    final CatalogInvokerResolver? invokerForCatalog = _invokerForCatalog;
    if (invokerForCatalog == null) {
      throw A2uiCatalogResolutionError(
        "Function '$name' names catalog '$catalogId', but this context "
        'has no catalogs to resolve it against.',
        catalogId: catalogId,
      );
    }
    return invokerForCatalog(catalogId)(name, args, this);
  }

  /// The agent caller, when this context may fall back to it: only from
  /// v1.0, where `callAgentFunction` exists.
  AgentFunctionCaller? get _agentCallerOrNull =>
      atLeastV10 ? _callAgentFunction : null;

  /// The id of the catalog a call to [name] resolved to when [error] reports
  /// that the catalog has no such function, or null when the call may not go
  /// to the agent: before v1.0, for a reserved `@` system function, and when
  /// the catalog itself could not be resolved.
  ///
  /// The returned id is the one the outbound `callAgentFunction` names, even
  /// when the call itself relied on the surface's default catalog.
  String? _routableCatalogId(A2uiCatalogResolutionError error, String name) {
    if (!atLeastV10 || name.startsWith('@')) return null;
    if (error.functionName != name) return null;
    return error.catalogId;
  }

  /// Reports [error], raised evaluating the function [name], through the
  /// reporter. Callers without a reporter rethrow instead.
  void _report(Object error, String name) {
    final ExpressionErrorReporter? onError = _onError;
    if (onError == null) return;
    onError(
      switch (error) {
        _ExecutionFailure(error: final Object cause) => A2uiExpressionError(
            "Function '$name' failed: "
            '${cause is A2uiError ? cause.message : cause}',
            expression: name,
            code: 'EXECUTION_ERROR',
            cause: cause,
          ),
        A2uiExpressionError() => error,
        A2uiCatalogError() => A2uiExpressionError(
            error.message,
            expression: name,
            code: error is A2uiCatalogResolutionError &&
                    error.functionName != null
                ? 'EXPRESSION_ERROR'
                : 'CATALOG_ERROR',
            cause: error,
          ),
        A2uiError() => A2uiExpressionError(
            error.message,
            expression: name,
            cause: error,
          ),
        _ => A2uiExpressionError(
            error.toString(),
            expression: name,
            cause: error,
          ),
      },
    );
  }

  /// The agent call for [call] with [args], started now if no call with the
  /// same name, catalog and arguments is in flight or completed.
  ///
  /// Sharing the entry is what keeps a `computed` that re-evaluates with
  /// unchanged arguments from sending the call again. Settling bumps only
  /// the entry's own version, so only the bindings that read it evaluate
  /// again. A failure evicts the entry (so a new evaluation can send it
  /// again), leaves the value null, and is reported once through the
  /// reporter with the `A2uiRpcError` as its cause. A cancellation evicts
  /// the entry without notifying or reporting anything.
  ///
  /// [catalogId] is the catalog the call resolved to: the outbound call names
  /// it, and calls that resolve to the same catalog share one entry whether
  /// or not they named it.
  ///
  /// [args] must be plain JSON (see [_checkJsonArguments]).
  _AgentCall _agentCall(
    FunctionCall call,
    String catalogId,
    Map<String, dynamic> args,
    AgentFunctionCaller caller,
  ) {
    final _AgentCall? existing = _agentCalls.lookup(call, catalogId, args);
    if (existing != null) return existing;
    _agentCalls.evictIfFull();
    // A call that names no catalog is filed under the one it resolved to,
    // which a later lookup that does not know it falls back on.
    if (call.catalogId == null) _agentCalls.defaultCatalogId ??= catalogId;
    final String key = _agentCallKey(call.call, catalogId, args);
    final entry = _AgentCall(call.call, catalogId);
    _agentCalls.entries[key] = entry;
    void evict() {
      if (identical(_agentCalls.entries[key], entry)) {
        _agentCalls.entries.remove(key);
      }
    }

    final outbound = FunctionCall(
      call: call.call,
      args: args,
      returnType: call.returnType,
      catalogId: catalogId,
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
          // Frozen, so no reader of a shared answer can change it for the
          // others.
          entry.value.value = _frozen(value);
          entry.version.value++;
        });
      },
      onError: (Object error) {
        if (_isCancellation(error)) {
          // Not a failure: nothing is reported or remembered, and the
          // bindings that read the call are not woken, so a deleted surface
          // does not send it again. A binding that evaluates again sends it.
          evict();
          entry.pending = false;
          entry.cancelled = true;
          return;
        }
        batch(() {
          // Evicted before the flush, so a listener that re-reads the call as
          // it settles sends it again rather than finding the failed entry.
          evict();
          entry.pending = false;
          entry.failed = true;
          entry.version.value++;
        });
        _report(error, call.call);
      },
    );
    return entry;
  }

  /// Whether [error] reports a call that was cancelled, as when its surface
  /// is deleted. Cancellation is not a failure of the expression, so it is
  /// never reported.
  static bool _isCancellation(Object error) =>
      error is A2uiRpcError && error.rpcCode == RpcErrorCode.cancelled;

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

  /// The key that calls to [name] in [catalogId] with [args] share, built
  /// from the arguments with map keys sorted at every depth. Only called
  /// with arguments [_checkJsonArguments] accepts, so every value has one
  /// JSON form.
  static String _agentCallKey(
    String name,
    String? catalogId,
    Map<String, dynamic> args,
  ) =>
      jsonEncode(<String, Object?>{
        'name': name,
        'catalogId': catalogId,
        'args': _canonicalize(args),
      });

  /// Throws an [A2uiExpressionError] when [args] of a call to [name] that is
  /// about to go to the agent hold a value with no faithful JSON form, such
  /// as a non-finite number or an arbitrary object. Such a call fails
  /// locally rather than being sent with altered data.
  static void _checkJsonArguments(String name, Map<String, dynamic> args) {
    if (_isPlainJson(args)) return;
    throw A2uiExpressionError(
      "Arguments to '$name' are not valid JSON, so the call cannot be sent "
      'to the agent.',
      expression: name,
    );
  }

  /// Whether [value] has a faithful JSON form: whether `jsonEncode` accepts
  /// it. That is null, a bool, a string, a finite number, a list, a map with
  /// string keys, and an object with a `toJson` (such as a
  /// [ValidationResult]) of those; `jsonEncode` rejects NaN and infinities.
  static bool _isPlainJson(Object? value) {
    try {
      jsonEncode(value);
      return true;
      // The encoder's own verdict is the definition being checked.
      // ignore: avoid_catching_errors
    } on JsonUnsupportedObjectError {
      return false;
    }
  }

  /// [value] with every map and list in it, at any depth, made unmodifiable.
  static Object? _frozen(Object? value) => switch (value) {
        final List<Object?> list =>
          List<Object?>.unmodifiable(list.map(_frozen)),
        final Map<String, Object?> map => Map<String, Object?>.unmodifiable(
            map.map((key, item) => MapEntry(key, _frozen(item))),
          ),
        final Map<Object?, Object?> map => Map<Object?, Object?>.unmodifiable(
            map.map((key, item) => MapEntry(key, _frozen(item))),
          ),
        _ => value,
      };

  /// Whether evaluating [value] now would read an agent call that is still
  /// awaiting its response.
  ///
  /// Walks [value] for function calls, resolves each call's arguments when a
  /// pending call for that function is in flight, and looks the call up among
  /// the agent calls this context has sent. A call that would resolve locally
  /// is never pending. Lets a consumer that treats a null from
  /// [resolveDynamicValue] as "not yet known" tell it from a null result.
  bool isPendingAgentCall(Object? value) {
    if (_agentCalls.entries.isEmpty) return false;
    if (value is List) return value.any(isPendingAgentCall);
    if (value is! Map) return false;
    if (isFunctionCall(value)) {
      final call = FunctionCall.fromJson(_asStringKeyedMap(value));
      if (call.args.values.any(isPendingAgentCall)) return true;
      if (!_agentCalls.hasPendingFor(call.call)) return false;
      final _AgentCall? entry =
          _agentCalls.lookup(call, null, _peekArguments(call));
      return entry != null && entry.pending;
    }
    return value.values.any(isPendingAgentCall);
  }

  /// The arguments of [call] resolved without sending any agent call.
  Map<String, dynamic> _peekArguments(FunctionCall call) {
    final peek = DataContext._derived(
      dataModel,
      _invoke,
      path,
      onError: (_) {},
      protocolVersion: protocolVersion,
      invokerForCatalog: _invokerForCatalog,
      isUserActivated: isUserActivated,
      callAgentFunction: null,
      agentCalls: _agentCalls,
      parent: parent,
      index: _explicitIndex,
      onMissingData: _onMissingData,
      warnedPaths: _warnedPaths,
    );
    return <String, dynamic>{
      for (final MapEntry<String, dynamic> entry in call.args.entries)
        entry.key: peek.resolveDynamicValue(entry.value),
    };
  }

  /// [resolveSignal], paired with whether the value is a placeholder for
  /// a pending agent call. The signal updates when the value changes and
  /// when a pending call it reads settles, even if its value stays null.
  ReadonlySignal<DynamicValueState> resolveSignalWithPending(
    Object? value,
  ) {
    final ReadonlySignal<Object?> resolved =
        _resolveSignal(value, 0, keepFailed: true);
    return computed(() {
      final Object? current = resolved.value;
      final bool pending = _containsPendingArg(current);
      return (
        value: pending ? null : _withoutMarkers(current),
        pending: pending
      );
    });
  }

  /// Evaluates [functionCall], a `{@call, args, catalogId}` object, as an
  /// action does: locally when a catalog implements it, otherwise through the
  /// agent on a v1.0 context, completing with the result.
  ///
  /// Arguments are resolved independently (never reading or populating the
  /// reactive value cache), together, awaiting any nested agent or async
  /// function calls before invoking the outer function. A function that
  /// throws is reported as `EXECUTION_ERROR` when a catalog runs it (other
  /// failures, such as invalid arguments, as `EXPRESSION_ERROR`), following
  /// the reporter policy of [resolveDynamicValue], and completes with null.
  /// A function that returns a failing `Future`, and an outer agent call that
  /// fails (an `A2uiRpcError`), fail the returned future instead. If a nested
  /// argument fails, its error is reported once through the reporter, its
  /// siblings that have not run yet do not run, and the outer call completes
  /// with null without running. A nested agent call
  /// that is cancelled (an [A2uiRpcError] with [RpcErrorCode.cancelled]), as
  /// when its surface is deleted, does the same without a report.
  Future<Object?> evaluateFunctionCall(
    Map<String, Object?> functionCall,
  ) =>
      _evaluateActionCall(functionCall, 0, reportTopLevelAgentError: false);

  Future<Object?> _evaluateActionCall(
    Map<String, Object?> functionCall,
    int depth, {
    required bool reportTopLevelAgentError,
    _ActionGroup? group,
  }) async {
    final Object? failed = reportTopLevelAgentError ? _failedArg : null;
    if (depth > maxDynamicValueDepth) {
      _reportDepthExceeded();
      return failed;
    }
    if (_systemCallNamingCatalog(functionCall)
        case final A2uiExpressionError error) {
      _reportSync(error);
      return failed;
    }
    final call = FunctionCall.fromJson(_asStringKeyedMap(functionCall));
    final List<MapEntry<String, dynamic>> argEntries =
        call.args.entries.toList();
    final List<Object?> argValues;
    try {
      final FutureOr<List<Object?>> pendingArgs = _resolveActionValuesTogether(
        [for (final MapEntry<String, dynamic> entry in argEntries) entry.value],
        depth + 1,
        keepFailed: atLeastV10,
        group: group,
      );
      argValues = pendingArgs is Future<List<Object?>>
          ? await pendingArgs
          : pendingArgs;
    } catch (error) {
      // With a reporter, nested calls report their own failures, so what
      // arrives here is a malformed argument, such as an unknown directive.
      if (_onError == null) rethrow;
      _report(error, call.call);
      return failed;
    }
    // A failed argument, or a failed sibling of this call, stops it.
    if (atLeastV10 &&
        (argValues.any(_containsFailedArg) || (group?.aborted ?? false))) {
      return failed;
    }
    final args = <String, dynamic>{
      for (var i = 0; i < argEntries.length; i++)
        argEntries[i].key: argValues[i],
    };
    Object? result;
    AgentFunctionCaller? agentCaller;
    String? agentCatalogId;
    try {
      if (atLeastV10 &&
          call.call.startsWith('@') &&
          call.call != _indexFunctionName) {
        throw A2uiExpressionError(
          "System function '${call.call}' is not supported by this renderer.",
          expression: call.call,
        );
      }
      try {
        _marksExecutionFailures = true;
        result = _invokeLocally(call, args);
      } on A2uiCatalogResolutionError catch (error) {
        agentCatalogId = _routableCatalogId(error, call.call);
        agentCaller = agentCatalogId == null ? null : _agentCallerOrNull;
        if (agentCaller == null) rethrow;
        _checkJsonArguments(call.call, args);
      } finally {
        _marksExecutionFailures = false;
      }
    } catch (error, stackTrace) {
      if (_onError == null) _rethrowUnwrapped(error, stackTrace);
      _report(error, call.call);
      return failed;
    }
    try {
      if (agentCaller != null) {
        result = await agentCaller(
          FunctionCall(
            call: call.call,
            args: args,
            returnType: call.returnType,
            catalogId: agentCatalogId,
            reservedKeys: true,
          ),
        );
      } else if (result is Future) {
        result = await result;
      }
    } catch (error, stackTrace) {
      if (!reportTopLevelAgentError) rethrow;
      // Cancellation and failures after a sibling failed are silent.
      if (_isCancellation(error) || (group?.aborted ?? false)) {
        return _failedArg;
      }
      if (_onError == null) rethrow;
      _report(
        agentCaller != null ? error : _ExecutionFailure(error, stackTrace),
        call.call,
      );
      return _failedArg;
    }
    if (result is ReadonlySignal) result = result.value;
    return result;
  }

  /// Rethrows [error], or the error an [_ExecutionFailure] wraps.
  static Never _rethrowUnwrapped(Object error, StackTrace stackTrace) {
    if (error is _ExecutionFailure) {
      Error.throwWithStackTrace(error.error, error.stackTrace);
    }
    Error.throwWithStackTrace(error, stackTrace);
  }

  /// Resolves [value], a dynamic value inside an action, awaiting any
  /// function calls it contains.
  ///
  /// Returns the value itself, not a `Future`, when [value] calls no
  /// function: data bindings, nested or not, resolve synchronously. With
  /// [keepFailed], a call that failed (and was reported) resolves to
  /// [_failedArg], which stops the enclosing call or action; otherwise it
  /// resolves to null. [group] holds the siblings [value] resolves with.
  Object? _resolveActionValue(
    Object? value,
    int depth, {
    required bool keepFailed,
    _ActionGroup? group,
  }) {
    if (depth > maxDynamicValueDepth) {
      _reportDepthExceeded();
      return keepFailed ? _failedArg : null;
    }
    if (atLeastV10) {
      if (value is Map && value.containsKey('@path')) {
        final binding = DataBinding.fromJson(_asStringKeyedMap(value));
        return _readBinding(resolvePath(binding.path));
      }
      if (value is Map && value.containsKey('@call')) {
        return _resolveActionCall(
          value,
          depth,
          keepFailed: keepFailed,
          group: group,
        );
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        _validateReservedDirectives(stringMap.keys);
        if (!_containsDynamicValue(value, depth)) return value;
        return _resolveActionMap(
          stringMap,
          depth,
          keepFailed: keepFailed,
          unescapeKeys: true,
          group: group,
        );
      }
    } else {
      if (isDataBinding(value)) {
        final pathVal = (value as Map)['path'] as String;
        return _readBinding(resolvePath(pathVal));
      }
      if (isFunctionCall(value)) {
        return _resolveActionCall(value as Map, depth, keepFailed: false);
      }
      if (value is Map) {
        final Map<String, dynamic> stringMap = _asStringKeyedMap(value);
        if (!_containsDynamicValue(value, depth)) return value;
        return _resolveActionMap(
          stringMap,
          depth,
          keepFailed: false,
          unescapeKeys: false,
        );
      }
    }
    if (value is List) {
      if (!_containsDynamicValue(value, depth)) return value;
      return _resolveActionValuesTogether(
        value,
        depth + 1,
        keepFailed: keepFailed,
        group: group,
      );
    }
    return value;
  }

  /// Evaluates the function call [value] inside an action. Without
  /// [keepFailed], as before v1.0, a failed call resolves to null.
  Future<Object?> _resolveActionCall(
    Map<Object?, Object?> value,
    int depth, {
    required bool keepFailed,
    _ActionGroup? group,
  }) {
    final Future<Object?> result = _evaluateActionCall(
      _asStringKeyedMap(value),
      depth,
      reportTopLevelAgentError: true,
      group: group,
    );
    if (keepFailed) return result;
    return result.then((res) => identical(res, _failedArg) ? null : res);
  }

  /// Resolves the values of [map] like [_resolveActionValuesTogether].
  FutureOr<Map<String, dynamic>> _resolveActionMap(
    Map<String, dynamic> map,
    int depth, {
    required bool keepFailed,
    required bool unescapeKeys,
    _ActionGroup? group,
  }) {
    final List<String> keys = map.keys.toList();
    Map<String, dynamic> build(List<Object?> values) => <String, dynamic>{
          for (var i = 0; i < values.length; i++)
            unescapeKeys && keys[i].startsWith('@@')
                ? keys[i].substring(1)
                : keys[i]: values[i],
        };
    final FutureOr<List<Object?>> values = _resolveActionValuesTogether(
      map.values.toList(),
      depth + 1,
      keepFailed: keepFailed,
      group: group,
    );
    return values is Future<List<Object?>> ? values.then(build) : build(values);
  }

  /// Resolves [values], the sibling arguments of one call or the items of
  /// one map or list, together, as the TypeScript `settleDeep` does.
  ///
  /// Returns a list, not a `Future`, when no value calls a function.
  /// Otherwise every value starts at once, in order, and the returned
  /// `Future` completes once all have settled, so no started evaluation is
  /// left unhandled. With [keepFailed], the first value that fails aborts
  /// the group: values not yet started are skipped, calls in it that have
  /// not run yet do not run, and failures after it are not reported. The
  /// list then holds the [_failedArg].
  FutureOr<List<Object?>> _resolveActionValuesTogether(
    List<Object?> values,
    int depth, {
    required bool keepFailed,
    _ActionGroup? group,
  }) {
    final siblings = _ActionGroup(group);
    final results = List<Object?>.filled(values.length, null);
    final pending = <Future<void>>[];
    void settle(int index, Object? value) {
      results[index] = value;
      if (keepFailed && _containsFailedArg(value)) siblings.abort();
    }

    for (var i = 0; i < values.length; i++) {
      if (keepFailed && siblings.aborted) break;
      final Object? value;
      try {
        value = _resolveActionValue(
          values[i],
          depth,
          keepFailed: keepFailed,
          group: siblings,
        );
      } catch (error, stackTrace) {
        // A malformed value: stop the group, and fail only once the values
        // already started have settled, so none is left unhandled.
        siblings.abort();
        if (pending.isEmpty) rethrow;
        return Future.wait<void>(pending).then<List<Object?>>(
          (_) => Error.throwWithStackTrace(error, stackTrace),
        );
      }
      if (value is Future) {
        final index = i;
        pending.add(
          value.then<void>(
            (Object? settled) => settle(index, settled),
            onError: (Object error, StackTrace stackTrace) {
              siblings.abort();
              Error.throwWithStackTrace(error, stackTrace);
            },
          ),
        );
      } else {
        settle(i, value);
      }
    }
    if (pending.isEmpty) return results;
    return Future.wait<void>(pending).then((_) => results);
  }

  /// Resolves [values], the entries of an event action, in order.
  ///
  /// Returns a list, not a `Future`, when no value calls a function.
  /// Otherwise each value is evaluated only after the one before it has
  /// settled, so every evaluation that starts is awaited, and a failure
  /// surfaces through the returned `Future`. With [keepFailed], resolution
  /// stops at the first value that failed: the list then ends with it, and
  /// the values after it, which may call the agent, are never evaluated.
  ///
  /// A malformed value is reported as `EXPRESSION_ERROR`, with a message
  /// starting with its entry's label from [labels], and counts as failed;
  /// without a reporter it is thrown.
  FutureOr<List<Object?>> _resolveActionValuesInOrder(
    List<Object?> values,
    int depth, {
    required bool keepFailed,
    required List<String> labels,
  }) {
    final resolved = <Object?>[];
    bool add(Object? value) {
      resolved.add(value);
      return keepFailed && _containsFailedArg(value);
    }

    Object? invalid(int index, Object error, StackTrace stackTrace) {
      final ExpressionErrorReporter? onError = _onError;
      if (onError == null) Error.throwWithStackTrace(error, stackTrace);
      onError(
        A2uiExpressionError(
          '${labels[index]} is invalid: '
          '${error is A2uiError ? error.message : error}',
          cause: error,
        ),
      );
      return keepFailed ? _failedArg : null;
    }

    Object? resolveAt(int index) {
      final Object? value;
      try {
        value = _resolveActionValue(
          values[index],
          depth,
          keepFailed: keepFailed,
        );
      } catch (error, stackTrace) {
        return invalid(index, error, stackTrace);
      }
      if (value is! Future) return value;
      // With a reporter, calls report their own failures, so an error that
      // arrives here is a malformed value nested in the entry.
      return value.then<Object?>(
        (Object? settled) => settled,
        onError: (Object error, StackTrace stackTrace) =>
            invalid(index, error, stackTrace),
      );
    }

    for (var i = 0; i < values.length; i++) {
      final Object? value = resolveAt(i);
      if (value is Future) {
        return () async {
          if (add(await value)) return resolved;
          for (int j = i + 1; j < values.length; j++) {
            final Object? next = resolveAt(j);
            if (add(next is Future ? await next : next)) break;
          }
          return resolved;
        }();
      }
      if (add(value)) break;
    }
    return resolved;
  }

  /// This context with [isUserActivated] set, for evaluation triggered by
  /// the user. Shares the data model, reporter, parent chain, missing-data
  /// reporter and pending agent calls.
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
        parent: parent,
        index: _explicitIndex,
        onMissingData: _onMissingData,
        warnedPaths: _warnedPaths,
      );

  /// Returns a context scoped to [relativePath] whose [parent] is this
  /// context. Pass [index] when the new context scopes a collection template
  /// item.
  DataContext childContext(String relativePath, {int? index}) {
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
      parent: this,
      index: index,
    );
  }

  /// Returns a child context scoped to [relativePath], without an index.
  DataContext nested(String relativePath) => childContext(relativePath);

  void set(String relativePath, Object? value) {
    dataModel.set(resolvePath(relativePath), value);
  }

  /// Resolves an action payload like [resolveAction], awaiting any function
  /// calls, local or sent to the agent, in its `context` and `userMessage`.
  ///
  /// Returns the payload synchronously, not a `Future`, when no value calls
  /// a function; data bindings, nested or not, resolve synchronously.
  /// Otherwise the `context` entries, then `userMessage`, are evaluated one
  /// after another, each once the one before it has settled; the arguments
  /// and items inside one entry resolve together. Returns null for an
  /// invalid payload.
  ///
  /// A function a catalog runs that throws is reported as `EXECUTION_ERROR`.
  /// A malformed value is reported as `EXPRESSION_ERROR`, like a failed call.
  ///
  /// From v1.0, if a function call fails, its error is reported through the
  /// reporter, the values after it are not evaluated, [onExpressionFailed]
  /// is called, and the result is null. A cancelled agent call (an
  /// [A2uiRpcError] with [RpcErrorCode.cancelled]) gives the same result
  /// without a report. Before v1.0 a failed call resolves to null and the
  /// action is still resolved.
  FutureOr<Map<String, dynamic>?> resolveActionAsync(
    Object? action, {
    void Function()? onExpressionFailed,
  }) {
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
      final FutureOr<Map<String, dynamic>?> ev = _resolveActionFieldsAsync(
        Map<String, dynamic>.from(eventObj),
        onExpressionFailed: onExpressionFailed,
      );
      if (ev is Future<Map<String, dynamic>?>) {
        return ev.then((resolvedEv) {
          if (resolvedEv == null) return null;
          return {...map, 'event': resolvedEv};
        });
      }
      if (ev == null) return null;
      return {...map, 'event': ev};
    }
    if (map.containsKey('name')) {
      final Object? name = map['name'];
      if (name is! String || name.isEmpty) return null;
      return _resolveActionFieldsAsync(
        map,
        onExpressionFailed: onExpressionFailed,
      );
    }
    return null;
  }

  FutureOr<Map<String, dynamic>?> _resolveActionFieldsAsync(
    Map<String, dynamic> map, {
    void Function()? onExpressionFailed,
  }) {
    final result = Map<String, dynamic>.from(map);
    final Object? ctx = result['context'];
    final List<String> contextKeys = ctx is Map
        ? [for (final Object? key in ctx.keys) key.toString()]
        : const <String>[];
    final bool hasUserMessage = result.containsKey('userMessage');
    Map<String, dynamic>? finish(List<Object?> values) {
      if (atLeastV10 && values.any(_containsFailedArg)) {
        onExpressionFailed?.call();
        return null;
      }
      result['context'] = <String, Object?>{
        for (var i = 0; i < contextKeys.length; i++) contextKeys[i]: values[i],
      };
      if (hasUserMessage) {
        final Object? msg = values.last;
        if (msg != null && msg is! String) return null;
        result['userMessage'] = msg;
      }
      return result;
    }

    final FutureOr<List<Object?>> values = _resolveActionValuesInOrder(
      [
        if (ctx is Map) ...ctx.values,
        if (hasUserMessage) result['userMessage'],
      ],
      0,
      keepFailed: atLeastV10,
      labels: [
        for (final String key in contextKeys)
          "Action event context entry '$key'",
        if (hasUserMessage) 'Action event userMessage',
      ],
    );
    return values is Future<List<Object?>>
        ? values.then(finish)
        : finish(values);
  }

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
      final Map<String, dynamic>? ev = _resolveActionFields(
        Map<String, dynamic>.from(eventObj),
      );
      if (ev == null) return null;
      return {...map, 'event': ev};
    }
    if (map.containsKey('name')) {
      final Object? name = map['name'];
      if (name is! String || name.isEmpty) return null;
      return _resolveActionFields(map);
    }
    return null;
  }

  Map<String, dynamic>? _resolveActionFields(Map<String, dynamic> map) {
    final result = Map<String, dynamic>.from(map);
    final Object? ctx = result['context'];
    if (ctx is Map) {
      result['context'] = <String, Object?>{
        for (final MapEntry<Object?, Object?> e in ctx.entries)
          e.key.toString(): resolveDynamicValue(e.value),
      };
    } else {
      result['context'] = <String, Object?>{};
    }
    if (result.containsKey('userMessage')) {
      final Object? msg = resolveDynamicValue(result['userMessage']);
      if (msg != null && msg is! String) return null;
      result['userMessage'] = msg;
    }
    return result;
  }
}

/// Sentinel marking a function argument whose synchronous evaluation failed and
/// was already reported on the surface.
const Object _failedArg = _Marker('failed');

/// Sentinel marking a function argument that reads an agent call still
/// awaiting its answer, so the enclosing call waits instead of running.
const Object _pendingArg = _Marker('pending');

/// A distinct marker object. Two `const Object()` are the same instance.
class _Marker {
  const _Marker(this.name);

  final String name;

  @override
  String toString() => '<$name>';
}

bool _containsFailedArg(Object? value) => _containsMarker(value, _failedArg);

bool _containsPendingArg(Object? value) => _containsMarker(value, _pendingArg);

bool _containsMarker(Object? value, Object marker) {
  if (identical(value, marker)) return true;
  if (value is List) return value.any((item) => _containsMarker(item, marker));
  if (value is Map) {
    return value.values.any((item) => _containsMarker(item, marker));
  }
  return false;
}

/// [value] with each [_failedArg] or [_pendingArg] in it replaced by null.
Object? _withoutMarkers(Object? value) {
  if (identical(value, _failedArg) || identical(value, _pendingArg)) {
    return null;
  }
  if (!_containsFailedArg(value) && !_containsPendingArg(value)) return value;
  if (value is List) {
    return [for (final Object? item in value) _withoutMarkers(item)];
  }
  if (value is Map<String, Object?>) {
    return <String, Object?>{
      for (final MapEntry<String, Object?> entry in value.entries)
        entry.key: _withoutMarkers(entry.value),
    };
  }
  if (value is Map) {
    return <Object?, Object?>{
      for (final MapEntry<Object?, Object?> entry in value.entries)
        entry.key: _withoutMarkers(entry.value),
    };
  }
  return value;
}

/// A local function that threw, or whose `Future` failed, while an action
/// ran it, so that the failure is reported as `EXECUTION_ERROR` rather than
/// as a failed expression.
class _ExecutionFailure implements Exception {
  _ExecutionFailure(this.error, this.stackTrace);

  final Object error;
  final StackTrace stackTrace;
}

/// The sibling values of one function call, map or list in an action, which
/// resolve together. Once one fails, the group is aborted: the calls in it
/// (and in groups nested in it) that have not run yet do not run, and later
/// failures in it are not reported.
class _ActionGroup {
  _ActionGroup(this._parent);

  final _ActionGroup? _parent;
  bool _aborted = false;

  bool get aborted => _aborted || (_parent?.aborted ?? false);

  void abort() => _aborted = true;
}

/// One function call sent to the agent on a context's behalf.
class _AgentCall {
  _AgentCall(this.functionName, this.catalogId);

  final String functionName;
  final String? catalogId;

  /// The call's resolved value, null while pending or after a failure.
  final Signal<Object?> value = signal<Object?>(null);

  /// Bumped when this call settles (with a value, including null, or an error).
  final Signal<int> version = signal<int>(0);

  /// Whether the call is still awaiting its response.
  bool pending = true;

  /// Whether the call settled with an error.
  bool failed = false;

  /// Whether the call was cancelled, as when its surface was deleted. A
  /// cancelled call is not a failure: a binding that evaluates again sends
  /// it again.
  bool cancelled = false;
}

/// The agent calls a context and the contexts derived from it have sent,
/// keyed by name, catalog and resolved arguments.
class _AgentCallCache {
  _AgentCallCache({this.defaultCatalogId});

  static const int _maxEntries = 256;

  String? defaultCatalogId;

  final Map<String, _AgentCall> entries = {};

  bool hasPendingFor(String functionName) {
    for (final _AgentCall call in entries.values) {
      if (call.pending && call.functionName == functionName) return true;
    }
    return false;
  }

  /// The entry for [call] with [args], filed under the catalog the call
  /// resolved to: [resolvedCatalogId] when known, otherwise the catalog the
  /// call names, or else [defaultCatalogId].
  _AgentCall? lookup(
    FunctionCall call,
    String? resolvedCatalogId,
    Map<String, dynamic> args,
  ) {
    if (!DataContext._isPlainJson(args)) return null;
    return entries[DataContext._agentCallKey(
      call.call,
      resolvedCatalogId ?? call.catalogId ?? defaultCatalogId,
      args,
    )];
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

/// Package-internal: [context] without its agent caller, for evaluations
/// whose result cannot wait for an agent's answer, such as the `${...}`
/// parts of a `formatString` template. A function no catalog implements
/// fails there with `EXPRESSION_ERROR`, as before fallback routing, instead
/// of being sent, even when the surface already holds its answer: the
/// context does not share the surface's agent calls.
DataContext dataContextWithoutAgentCalls(DataContext context) =>
    DataContext._derived(
      context.dataModel,
      context._invoke,
      context.path,
      onError: context._onError,
      protocolVersion: context.protocolVersion,
      invokerForCatalog: context._invokerForCatalog,
      isUserActivated: context.isUserActivated,
      callAgentFunction: null,
      agentCalls: _AgentCallCache(),
      parent: context.parent,
      index: context._explicitIndex,
      onMissingData: context._onMissingData,
      warnedPaths: context._warnedPaths,
    );

/// Shared [_AgentCallCache] per [SurfaceModel] so all component contexts on a
/// surface deduplicate in-flight agent calls.
final Expando<_AgentCallCache> _surfaceAgentCalls = Expando();

/// Package-internal helper used by `ComponentContext` to construct a
/// [DataContext] bound to [surface] and sharing its [_AgentCallCache].
DataContext createSurfaceDataContext(
  SurfaceModel surface, {
  String? basePath,
  ExpressionErrorReporter? onError,
  DataContext? parentDataContext,
  int? index,
  MissingDataReporter? onMissingData,
  required ExpressionErrorReporter defaultErrorReporter,
}) =>
    DataContext._derived(
      surface.dataModel,
      (name, args, context) =>
          surface.resolveCatalog(null).invoke(name, args, context),
      basePath ?? '/',
      onError: onError ?? parentDataContext?._onError ?? defaultErrorReporter,
      protocolVersion: surface.protocolVersion == null
          ? null
          : A2uiProtocolVersion.tryParseSemVer(surface.protocolVersion!),
      invokerForCatalog: (catalogId) =>
          surface.resolveCatalog(catalogId).invoke,
      isUserActivated: false,
      callAgentFunction: surface.callAgentFunction,
      agentCalls: _surfaceAgentCalls[surface] ??=
          _AgentCallCache(defaultCatalogId: surface.defaultCatalog?.id),
      parent: parentDataContext,
      index: index,
      onMissingData: onMissingData ??
          (parentDataContext == null
              ? (path) {
                  surface.dispatchWarning(missingDataBindingWarning(path));
                }
              : null),
    );

/// The `MISSING_DATA_BINDING` warning for a binding to the absent [path].
A2uiWarning missingDataBindingWarning(String path) => A2uiWarning(
      code: 'MISSING_DATA_BINDING',
      path: path,
      message: "Data binding path '$path' does not exist in the data model; "
          'it resolves to null.',
    );

/// Resolved function argument schemas, per catalog and then per function.
final Expando<Map<FunctionImplementation, Map<String, Object?>>>
    _resolvedArgumentSchemas = Expando();

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
  ///
  /// From v1.0 an argument the schema types as `DynamicBoolean` may resolve
  /// to the `ValidationResult` a validation function returns; it is read by
  /// its validity, as the specification defines the type (see
  /// [coerceValidationResults]).
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
    final bool atLeastV10 =
        protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;
    final Map<String, dynamic> callArgs = atLeastV10
        ? coerceValidationResultArgs(fn.argumentSchema.value, args)
        : args;
    final List<ValidationError> errors = argumentErrors(fn, callArgs);
    if (errors.isNotEmpty) {
      throw A2uiExpressionError(
        "Arguments to '$name' do not match its schema in catalog '$id': "
        '${errors.map((e) => e.toErrorString()).join('; ')}',
        expression: name,
        details: callArgs,
      );
    }
    if (!context._marksExecutionFailures) return fn.execute(callArgs, context);
    context._marksExecutionFailures = false;
    try {
      return fn.execute(callArgs, context);
    } catch (error, stackTrace) {
      throw _ExecutionFailure(error, stackTrace);
    }
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
    return byFunction[fn] ??= _resolveArgumentSchema(fn);
  }

  /// The argument schema of [fn] with its references resolved and, in a
  /// catalog for v1.0 or later, each boolean position also accepting an
  /// object with a boolean `valid`, as a DynamicBoolean coerces one to that
  /// boolean.
  Map<String, Object?> _resolveArgumentSchema(FunctionImplementation fn) {
    final Map<String, Object?> schema = resolveSchemaRefs(
      fn.argumentSchema.value,
      validationSchema,
      commonTypes: commonTypesSchema,
    );
    final A2uiProtocolVersion? version = protocolVersion;
    if (version == null || !version.isAtLeast(A2uiProtocolVersion.v1_0)) {
      return schema;
    }
    return _withValidityInBooleans(schema) as Map<String, Object?>;
  }

  /// The ways [args] fail [fn]'s argument schema, or an empty list when they
  /// match. Null arguments are left unchecked, as in [invoke], and a
  /// [ValidationResult] is checked as its JSON object.
  List<ValidationError> argumentErrors(
    FunctionImplementation fn,
    Map<String, dynamic> args,
  ) =>
      _errorsOf(fn, {
        for (final MapEntry<String, dynamic> entry in args.entries)
          entry.key: _asJson(entry.value),
      });

  /// The ways [args] fail [fn]'s argument schema, leaving null arguments
  /// unchecked.
  List<ValidationError> _errorsOf(
    FunctionImplementation fn,
    Map<String, Object?> args,
  ) {
    final Set<String> unresolved = {
      for (final MapEntry<String, Object?> entry in args.entries)
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
      for (final MapEntry<String, Object?> entry in args.entries)
        if (entry.value != null) entry.key: entry.value,
    });
  }

  /// [value] with each [ValidationResult] in it, at any depth, replaced by its
  /// JSON object.
  static Object? _asJson(Object? value) => switch (value) {
        final ValidationResult result => result.toJson(),
        final List<Object?> list => [
            for (final Object? item in list) _asJson(item),
          ],
        final Map<String, Object?> map => <String, Object?>{
            for (final MapEntry<String, Object?> entry in map.entries)
              entry.key: _asJson(entry.value),
          },
        _ => value,
      };

  /// [schema] with each boolean position in it, at any depth, also accepting
  /// an object with a boolean `valid`, unless it is a branch of a `oneOf`
  /// that already accepts any `object` (such as `DynamicValue`).
  static Object? _withValidityInBooleans(Object? schema) => switch (schema) {
        {'type': 'boolean'} => {
            'anyOf': [schema, _validityObject],
          },
        final Map<String, Object?> map => <String, Object?>{
            for (final MapEntry<String, Object?> entry in map.entries)
              entry.key: entry.key == 'oneOf' &&
                      entry.value is List<Object?> &&
                      _acceptsAnyObject(entry.value! as List<Object?>)
                  ? entry.value
                  : _withValidityInBooleans(entry.value),
          },
        final List<Object?> list => [
            for (final Object? item in list) _withValidityInBooleans(item),
          ],
        _ => schema,
      };

  static bool _acceptsAnyObject(List<Object?> branches) => branches.any(
        (Object? branch) =>
            branch is Map &&
            branch['type'] == 'object' &&
            !branch.containsKey('properties') &&
            !branch.containsKey('required'),
      );
}

/// The schema of an object with a boolean `valid`, which a DynamicBoolean
/// coerces to that boolean.
const Map<String, Object?> _validityObject = {
  'type': 'object',
  'properties': {
    'valid': {'type': 'boolean'},
  },
  'required': ['valid'],
};
