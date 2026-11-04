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

import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:fake_async/fake_async.dart';
import 'package:json_schema_builder/json_schema_builder.dart' show Schema;
import 'package:test/test.dart';

import 'suites.dart';

const String _suite = 'agent/renderer_function_calls.yaml';

void main() {
  group('conformance $_suite', () {
    // The suite comes with the renderer function calls follow-up of the
    // conformance tests; until it is on this branch, there is nothing to run.
    if (!File('$conformanceRoot/$_suite').existsSync()) {
      test('suite', () {}, skip: '$_suite is not in this checkout yet.');
      return;
    }
    final List<Map<String, Object?>> cases = loadSuite(_suite);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      test(testCase['name']! as String, () {
        final action = testCase['action']! as String;
        expect(action, 'call_renderer_function');
        _runCalls(testCase);
      });
    }
  });
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
    final List<CatalogApi>? catalogs = switch (args['catalogs']) {
      final List<Object?> entries => [
        for (final Object? entry in entries)
          _catalog(entry! as Map<String, Object?>),
      ],
      _ => null,
    };
    RendererFunctionCalls build() => RendererFunctionCalls(
      defaultTimeout: defaultTimeout,
      maxPending: maxPending,
      catalogs: catalogs,
    );

    if (testCase['expect_error'] case final Map<String, Object?> expected) {
      expect(testCase, isNot(contains('steps')));
      Object? caught;
      try {
        build();
      } on Object catch (e) {
        caught = e;
      }
      expect(caught, isNotNull, reason: 'Expected building the helper to fail');
      _assertErrorMatches(caught!, expected);
      return;
    }

    final RendererFunctionCalls calls = build();
    final futures = <String, _TrackedCall>{};
    final callIds = <String, String>{};

    final steps = testCase['steps']! as List<Object?>;
    for (var index = 0; index < steps.length; index++) {
      final where = 'step $index';
      final step = steps[index]! as Map<String, Object?>;
      if (step['call'] case final Map<String, Object?> spec) {
        final catalogId = spec['catalogId']! as String;
        final name = spec['name']! as String;
        final Object? rawArgs = spec['args'];
        final surfaceId = spec['surfaceId'] as String?;
        final functionCallId = spec['functionCallId'] as String?;
        final timeoutMs = spec['timeout_ms'] as int?;
        final Duration? timeout = timeoutMs == null
            ? null
            : Duration(milliseconds: timeoutMs);

        if (rawArgs != null && rawArgs is! Map) {
          // test_call_renderer_function_with_args_that_are_not_an_object:
          // `args` is typed `Map<String, Object?>?` in Dart, so arguments that
          // aren't an object can't be given to `call` at all. The case is met
          // by showing they are unrepresentable (the cast throws a
          // TypeError) rather than by the INVALID_FUNCTION_CALL code that
          // dynamically typed SDKs return; nothing is sent or registered.
          expect(step, contains('expect_error'), reason: where);
          final int pendingBefore = calls.pendingCount;
          expect(
            () => calls.call(
              catalogId: catalogId,
              name: name,
              args: rawArgs as Map<String, Object?>,
              surfaceId: surfaceId,
              timeout: timeout,
              functionCallId: functionCallId,
            ),
            throwsA(isA<TypeError>()),
            reason: where,
          );
          expect(calls.pendingCount, pendingBefore, reason: where);
        } else if (step['expect_error']
            case final Map<String, Object?> expectedErr) {
          Object? caught;
          try {
            calls.call(
              catalogId: catalogId,
              name: name,
              args: rawArgs as Map<String, Object?>?,
              surfaceId: surfaceId,
              timeout: timeout,
              functionCallId: functionCallId,
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
            args: rawArgs as Map<String, Object?>?,
            surfaceId: surfaceId,
            timeout: timeout,
            functionCallId: functionCallId,
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

/// Builds a `catalogs` entry in code as a v1.0 catalog, so the catalog schema
/// isn't applied: each function takes any object and returns anything, and
/// declares `allowedCallers` and `requiresUserActivation` only when the
/// entry sets them.
CatalogApi _catalog(Map<String, Object?> entry) {
  final Map<String, Object?> functions =
      (entry['functions'] as Map<String, Object?>?) ??
      const <String, Object?>{};
  return Catalog(
    id: entry['catalogId']! as String,
    protocolVersion: A2uiProtocolVersion.v1_0,
    components: const <ComponentApi>[],
    functions: [
      for (final MapEntry<String, Object?> function in functions.entries)
        FunctionApi(
          name: function.key,
          argumentSchema: Schema.fromMap(const {'type': 'object'}),
          allowedCallers: switch ((function.value
              as Map<String, Object?>?)?['allowedCallers']) {
            final String callers => AllowedCallers.fromJson(callers),
            _ => null,
          },
          requiresUserActivation:
              (function.value
                      as Map<String, Object?>?)?['requiresUserActivation']
                  as bool?,
        ),
    ],
  );
}
