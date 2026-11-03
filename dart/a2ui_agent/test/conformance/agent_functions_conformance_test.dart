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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:fake_async/fake_async.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import 'suites.dart';

void main() {
  group('conformance agent/agent_functions.yaml', () {
    final List<Map<String, Object?>> cases = loadSuite(
      'agent/agent_functions.yaml',
    );
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      test(testCase['name']! as String, () => _runCase(testCase));
    }
  });
}

Future<void> _runCase(Map<String, Object?> testCase) async {
  final action = testCase['action']! as String;
  switch (action) {
    case 'declare_agent_functions':
      _runDeclare(testCase);
    case 'handle_agent_function':
      await _runHandle(testCase);
    case 'validate_payload':
      _runValidate(testCase);
    case 'call_renderer_function':
      _runCalls(testCase);
    case 'renderer_state_tracking':
      _runRendererStateTracking(testCase);
    default:
      fail('Unhandled conformance action: $action');
  }
}

AgentFunctionHandler _handler(Map<String, Object?> behavior) {
  if (behavior.containsKey('returns')) {
    final Object? value = behavior['returns'];
    return (Map<String, dynamic> args, AgentFunctionContext context) async =>
        value;
  }
  if (behavior['returns_args'] == true) {
    return (Map<String, dynamic> args, AgentFunctionContext context) async =>
        args;
  }
  if (behavior['returns_context'] == true) {
    return (Map<String, dynamic> args, AgentFunctionContext context) async =>
        <String, Object?>{
          'catalogId': context.catalogId,
          'surfaceId': context.surfaceId,
          'functionCallId': context.functionCallId,
        };
  }
  if (behavior['raises'] case final Map<String, Object?> failure) {
    return (Map<String, dynamic> args, AgentFunctionContext context) async {
      final message = failure['message']! as String;
      if (failure['code'] case final String code) {
        throw A2uiRpcError.custom(message, code);
      }
      throw StateError(message);
    };
  }
  throw ArgumentError.value(
    behavior,
    'behavior',
    'Unknown agent function behavior',
  );
}

AgentFunction _agentFunction(String name, Map<String, Object?> declaration) {
  final String returnTypeStr = (declaration['returnType'] as String?) ?? 'any';
  final String allowedCallersStr =
      (declaration['allowedCallers'] as String?) ?? 'rendererOnly';
  final rawArgs = declaration['args']! as Map<String, Object?>;
  final behavior = declaration['behavior']! as Map<String, Object?>;
  return AgentFunction(
    name: name,
    handler: _handler(behavior),
    returnType: A2uiReturnType.fromJson(returnTypeStr),
    argumentSchema: Schema.fromMap(rawArgs),
    allowedCallers: AllowedCallers.fromJson(allowedCallersStr),
    description: declaration['description'] as String?,
  );
}

List<CatalogApi>? _catalogs(Map<String, Object?>? args) {
  if (args == null || !args.containsKey('catalogs')) return null;
  final rawList = args['catalogs']! as List<Object?>;
  return [for (final item in rawList) _catalog(item! as Map<String, Object?>)];
}

void _runRendererStateTracking(Map<String, Object?> testCase) {
  final catalogs = _catalogs(testCase['args'] as Map<String, Object?>?) ?? [];
  final calls = RendererFunctionCalls();
  final state = RendererState(catalogs, rendererCalls: calls);
  final steps = testCase['steps']! as List<Object?>;
  List<AgentToRendererMessage> parseMsgs(Object? raw) => [
    for (final Object? msg in raw! as List<Object?>)
      AgentToRendererMessage.fromJson(msg! as Map<String, Object?>),
  ];
  for (final step in steps) {
    final map = step! as Map<String, Object?>;
    if (map.containsKey('apply')) {
      state.apply(parseMsgs(map['apply']));
    } else if (map.containsKey('apply_fail')) {
      expect(
        () => state.apply(parseMsgs(map['apply_fail'])),
        throwsA(anything),
      );
    }
    if (map.containsKey('expect_tracked_count')) {
      expect(calls.pendingCount, map['expect_tracked_count']);
    }
  }
}

CatalogApi _catalog(Map<String, Object?> entry) {
  final Object? ref = entry['catalog'];
  final CatalogApi base = switch (ref) {
    final String path => loadCatalogUnlowered(path),
    final Map<String, Object?> doc => InMemoryCatalogProvider(
      doc,
      catalogId: doc.containsKey('catalogId') ? null : 'inline',
      protocolVersion: doc.containsKey('protocolVersion')
          ? null
          : A2uiProtocolVersion.v1_0,
    ).load(),
    _ => throw ArgumentError.value(ref, 'catalog', 'Invalid catalog reference'),
  };
  final Map<String, Object?> rawAgentFns =
      (entry['agent_functions'] as Map<String, Object?>?) ??
      const <String, Object?>{};
  return base.copyWith(
    agentFunctions: [
      for (final MapEntry<String, Object?> fnEntry in rawAgentFns.entries)
        _agentFunction(fnEntry.key, fnEntry.value! as Map<String, Object?>),
    ],
  );
}

void _assertErrorMatches(Object error, Map<String, Object?> expected) {
  if (expected['category'] case final String category) {
    switch (category) {
      case 'CatalogError':
        expect(error, isA<A2uiCatalogError>());
      case 'ValidationError':
        expect(error, isA<A2uiValidationError>());
      default:
        fail('Unknown error category: $category');
    }
  }
  if (expected['code'] case final String code) {
    expect(error, isA<A2uiError>());
    expect((error as A2uiError).code, code);
  }
  if (expected['message'] case final String msg) {
    expect(error.toString(), contains(msg));
  }
}

void _runDeclare(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final entry = args['catalog']! as Map<String, Object?>;
  if (testCase['expect_error'] case final Map<String, Object?> expectedError) {
    Object? caught;
    try {
      _catalog(entry);
    } on Object catch (e) {
      caught = e;
    }
    expect(caught, isNotNull, reason: 'Expected _catalog to throw');
    _assertErrorMatches(caught!, expectedError);
    return;
  }
  final CatalogApi catalog = _catalog(entry);
  final expected = testCase['expect']! as Map<String, Object?>;
  expect(
    catalog.functions.keys.toList()..sort(),
    equals(
      (expected['functions']! as List<Object?>).cast<String>().toList()..sort(),
    ),
  );
  expect(
    catalog.agentFunctions.keys.toList()..sort(),
    equals(
      (expected['agent_functions']! as List<Object?>).cast<String>().toList()
        ..sort(),
    ),
  );
  final Map<String, Object?> docFunctions =
      (catalog.toJson()['functions'] as Map<String, Object?>?) ??
      const <String, Object?>{};
  expect(
    docFunctions.keys.toList()..sort(),
    equals(
      (expected['document_functions']! as List<Object?>).cast<String>().toList()
        ..sort(),
    ),
  );
}

Future<void> _runHandle(Map<String, Object?> testCase) async {
  final args = testCase['args']! as Map<String, Object?>;
  final rawCatalogs = args['catalogs']! as List<Object?>;
  final registry = AgentFunctionRegistry([
    for (final Object? entry in rawCatalogs)
      _catalog(entry! as Map<String, Object?>),
  ]);

  if (testCase['expect_error'] case final Map<String, Object?> expectedError) {
    Object? caught;
    try {
      await registry.handle(args['message']!);
    } on Object catch (e) {
      caught = e;
    }
    expect(caught, isNotNull, reason: 'Expected registry.handle to throw');
    _assertErrorMatches(caught!, expectedError);
    return;
  }

  final AgentFunctionResponseMessage message = await registry.handle(
    args['message']!,
  );
  final Map<String, dynamic> dumped = message.toJson();
  expect(dumped['version'], '1.0');
  final response = dumped['agentFunctionResponse']! as Map<String, Object?>;
  final expected = testCase['expect']! as Map<String, Object?>;
  expect(response['functionCallId'], expected['functionCallId']);
  if (expected['error'] case final Map<String, Object?> expectedErr) {
    expect(response, isNot(contains('value')));
    final error = response['error']! as Map<String, Object?>;
    expect(error['code'], expectedErr['code']);
    if (expectedErr['message'] case final String substr) {
      expect(error['message']! as String, contains(substr));
    }
  } else {
    expect(response, isNot(contains('error')));
    expect(response, contains('value'));
    expect(response['value'], equals(expected['value']));
  }
}

void _runValidate(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final rawCatalogs = args['catalogs']! as List<Object?>;
  final catalogs = <CatalogApi>[
    for (final Object? entry in rawCatalogs)
      _catalog(entry! as Map<String, Object?>),
  ];
  final rawMessages = args['messages']! as List<Object?>;

  void runValidation() {
    final messages = <AgentToRendererMessage>[
      for (final Object? msg in rawMessages)
        AgentToRendererMessage.fromJson(msg! as Map<String, Object?>),
    ];
    validatePayload(catalogs, messages);
  }

  if (testCase['expect_error'] case final Map<String, Object?> expectedError) {
    Object? caught;
    try {
      runValidation();
    } on Object catch (e) {
      caught = e;
    }
    expect(caught, isNotNull, reason: 'Expected validatePayload to throw');
    _assertErrorMatches(caught!, expectedError);
    return;
  }
  expect(testCase['expect_valid'], isTrue);
  runValidation();
}

final class _TrackedCall {
  bool settled = false;
  Object? value;
  Object? error;
}

Object _callState(_TrackedCall tracked) {
  if (!tracked.settled) return 'pending';
  if (tracked.error case final Object err) {
    expect(err, isA<A2uiRpcError>());
    final rpcErr = err as A2uiRpcError;
    return <String, Object?>{
      'error': <String, Object?>{
        'code': rpcErr.code,
        'message': rpcErr.message,
      },
    };
  }
  return <String, Object?>{'value': tracked.value};
}

void _assertCallState(String label, Object actual, Object? expected) {
  if (expected == 'pending' || actual == 'pending') {
    expect(actual, equals(expected), reason: 'call $label: $actual');
    return;
  }
  final expectedMap = expected! as Map<String, Object?>;
  if (expectedMap.containsKey('value')) {
    expect(actual, equals(expectedMap), reason: 'call $label: $actual');
    return;
  }
  final actualMap = actual as Map<String, Object?>;
  expect(actualMap, contains('error'), reason: 'call $label: $actual');
  final actualErr = actualMap['error']! as Map<String, Object?>;
  final expectedErr = expectedMap['error']! as Map<String, Object?>;
  expect(actualErr['code'], expectedErr['code'], reason: 'call $label');
  if (expectedErr['message'] case final String substr) {
    expect(actualErr['message']! as String, contains(substr));
  }
}

void _runCalls(Map<String, Object?> testCase) {
  fakeAsync((FakeAsync async) {
    final Map<String, Object?> args =
        (testCase['args'] as Map<String, Object?>?) ??
        const <String, Object?>{};
    final Duration? defaultTimeout;
    if (!args.containsKey('default_timeout_ms')) {
      defaultTimeout = defaultRendererCallTimeout;
    } else if (args['default_timeout_ms'] == null) {
      defaultTimeout = null;
    } else {
      defaultTimeout = Duration(
        milliseconds: args['default_timeout_ms']! as int,
      );
    }
    final maxPending = args['max_pending'] as int?;
    final catalogs = _catalogs(testCase['args'] as Map<String, Object?>?);
    final calls = RendererFunctionCalls(
      defaultTimeout: defaultTimeout,
      maxPending: maxPending,
      catalogs: catalogs,
    );
    final futures = <String, _TrackedCall>{};
    final callIds = <String, String>{};

    final steps = testCase['steps']! as List<Object?>;
    for (var index = 0; index < steps.length; index++) {
      final where = 'step $index';
      final step = steps[index]! as Map<String, Object?>;
      if (step['call'] case final Map<String, Object?> spec) {
        final catalogId = spec['catalogId']! as String;
        final name = spec['name']! as String;
        final callArgs = spec['args'] as Map<String, Object?>?;
        final surfaceId = spec['surfaceId'] as String?;
        final timeoutMs = spec['timeout_ms'] as int?;
        final Duration? timeout = timeoutMs == null
            ? null
            : Duration(milliseconds: timeoutMs);

        if (step['expect_error'] case final Map<String, Object?> expectedErr) {
          Object? caught;
          try {
            calls.call(
              catalogId: catalogId,
              name: name,
              args: callArgs,
              surfaceId: surfaceId,
              timeout: timeout,
            );
          } on Object catch (e) {
            caught = e;
          }
          expect(caught, isA<A2uiRpcError>(), reason: where);
          _assertErrorMatches(caught!, expectedErr);
        } else {
          final (
            CallRendererFunctionMessage message,
            Future<Object?> future,
          ) = calls.call(
            catalogId: catalogId,
            name: name,
            args: callArgs,
            surfaceId: surfaceId,
            timeout: timeout,
          );
          final tracked = _TrackedCall();
          future.then(
            (Object? val) {
              tracked.settled = true;
              tracked.value = val;
            },
            onError: (Object err) {
              tracked.settled = true;
              tracked.error = err;
            },
          );
          final Map<String, dynamic> dumped = message.toJson();
          final body = dumped['callRendererFunction']! as Map<String, Object?>;
          final callId = body.remove('functionCallId') as String?;
          expect(callId, isNotNull, reason: where);
          expect(callId, isNotEmpty, reason: where);
          expect(
            callIds.values,
            isNot(contains(callId)),
            reason: '$where: reused $callId',
          );
          final label = spec['label']! as String;
          callIds[label] = callId!;
          futures[label] = tracked;
          if (step['expect_message']
              case final Map<String, Object?> expectedMsg) {
            expect(dumped, equals(expectedMsg), reason: where);
          }
        }
      } else if (step['respond'] case final Map<String, Object?> spec) {
        final String callId = spec.containsKey('call')
            ? callIds[spec['call']! as String]!
            : spec['functionCallId']! as String;
        final response = <String, Object?>{'functionCallId': callId};
        if (spec.containsKey('error')) {
          response['error'] = spec['error'];
        } else {
          response['value'] = spec['value'];
        }
        calls.resolve(<String, Object?>{
          'version': '1.0',
          'rendererFunctionResponse': response,
        });
      } else if (step['advance_ms'] case final int ms) {
        async.elapse(Duration(milliseconds: ms));
      } else if (step['dispose'] case final Map<String, Object?> disposeSpec) {
        final reason = disposeSpec['reason'] as String?;
        if (reason == null) {
          calls.dispose();
        } else {
          calls.dispose(reason);
        }
      } else {
        fail('$where: unknown step $step');
      }

      async.flushMicrotasks();
      if (step['expect_calls'] case final Map<String, Object?> expectCalls) {
        for (final MapEntry<String, Object?> entry in expectCalls.entries) {
          _assertCallState(
            entry.key,
            _callState(futures[entry.key]!),
            entry.value,
          );
        }
      }
      if (step['expect_pending_count'] case final int expPending) {
        expect(calls.pendingCount, expPending, reason: where);
      }
    }

    calls.dispose();
    async.flushMicrotasks();
  });
}
