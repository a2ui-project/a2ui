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
    case 'process_renderer_message':
      await _runProcess(testCase);
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

/// Builds the agent function an `AgentFunctionDeclaration` describes.
///
/// With `from_api: true` it wraps [base]'s own declaration of the function,
/// or, when [base] declares none, one built from the case's fields, which the
/// catalog must then refuse.
AgentFunction _agentFunction(
  String key,
  Map<String, Object?> declaration,
  CatalogApi base,
) {
  final String name = (declaration['name'] as String?) ?? key;
  final behavior = declaration['behavior']! as Map<String, Object?>;
  final A2uiReturnType returnType = A2uiReturnType.fromJson(
    (declaration['returnType'] as String?) ?? 'any',
  );
  final argumentSchema = Schema.fromMap(
    (declaration['args'] as Map<String, Object?>?) ??
        const <String, Object?>{'type': 'object'},
  );
  final description = declaration['description'] as String?;
  if (declaration['from_api'] == true) {
    final FunctionApi api =
        base.functions[name] ??
        FunctionApi(
          name: name,
          argumentSchema: argumentSchema,
          returnType: returnType,
          description: description,
        );
    return AgentFunction.fromApi(api, _handler(behavior));
  }
  return AgentFunction(
    name: name,
    handler: _handler(behavior),
    returnType: returnType,
    argumentSchema: argumentSchema,
    description: description,
  );
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
        _agentFunction(
          fnEntry.key,
          fnEntry.value! as Map<String, Object?>,
          base,
        ),
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
  final processor = RendererToAgentMessageProcessor(
    catalogs: [
      for (final Object? entry in rawCatalogs)
        _catalog(entry! as Map<String, Object?>),
    ],
  );

  if (testCase['expect_error'] case final Map<String, Object?> expectedError) {
    Object? caught;
    try {
      await processor.processMessage(args['message']);
    } on Object catch (e) {
      caught = e;
    }
    expect(caught, isNotNull, reason: 'Expected processMessage to throw');
    _assertErrorMatches(caught!, expectedError);
    return;
  }

  final ProcessResult result = await processor.processMessage(args['message']);
  expect(result.handled, isTrue);
  expect(result.replies, hasLength(1));
  final Map<String, dynamic> dumped = result.replies.single.toJson();
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

Future<void> _runProcess(Map<String, Object?> testCase) async {
  final args = testCase['args']! as Map<String, Object?>;
  final recorded = <(String, RendererToAgentMessage)>[];
  final Set<String> callbacks = {
    for (final Object? kind
        in (args['callbacks'] as List<Object?>?) ?? const <Object?>[])
      kind! as String,
  };
  final processor = RendererToAgentMessageProcessor(
    catalogs: [
      if (args['catalog'] case final Map<String, Object?> entry)
        _catalog(entry),
    ],
    onAction: callbacks.contains('action')
        ? (message) {
            recorded.add(('action', message));
          }
        : null,
    onError: callbacks.contains('error')
        ? (message) {
            recorded.add(('error', message));
          }
        : null,
    onRendererFunctionResponse: callbacks.contains('rendererFunctionResponse')
        ? (message) {
            recorded.add(('rendererFunctionResponse', message));
          }
        : null,
  );

  if (testCase['expect_error'] case final Map<String, Object?> expectedError) {
    Object? caught;
    try {
      await processor.processMessage(args['message']);
    } on Object catch (e) {
      caught = e;
    }
    expect(caught, isNotNull, reason: 'Expected processMessage to throw');
    _assertErrorMatches(caught!, expectedError);
    expect(recorded, isEmpty, reason: 'No callback runs when processing fails');
    return;
  }

  final ProcessResult result = await processor.processMessage(args['message']);
  final expected = testCase['expect']! as Map<String, Object?>;
  expect(result.handled, expected['handled']);

  final List<Object?> expectedReplies =
      (expected['replies'] as List<Object?>?) ?? const <Object?>[];
  expect(result.replies, hasLength(expectedReplies.length));
  for (var i = 0; i < expectedReplies.length; i++) {
    _expectReply(
      result.replies[i].toJson(),
      expectedReplies[i]! as Map<String, Object?>,
    );
  }

  if (expected['callback'] case final Map<String, Object?> expectedCallback) {
    expect(recorded, hasLength(1));
    final (String kind, RendererToAgentMessage message) = recorded.single;
    expect(kind, expectedCallback['kind']);
    expect(
      _normalizeTimestamps(message.toJson()),
      equals(_normalizeTimestamps(expectedCallback['message'])),
    );
  } else {
    expect(recorded, isEmpty, reason: 'No callback should have run');
  }
}

/// Compares a serialized reply with the expected one exactly, except that an
/// expected `error.message` is a substring of the one sent and may be left
/// out.
void _expectReply(Map<String, dynamic> actual, Map<String, Object?> expected) {
  final copy = _deepCopy(actual)! as Map<String, Object?>;
  for (final MapEntry<String, Object?> entry in copy.entries) {
    final Object? body = entry.value;
    final Object? expectedBody = expected[entry.key];
    if (body is! Map<String, Object?> || expectedBody is! Map) continue;
    final Object? error = body['error'];
    final Object? expectedError = expectedBody['error'];
    if (error is! Map<String, Object?> || expectedError is! Map) continue;
    if (expectedError['message'] case final String substring) {
      expect(error['message']! as String, contains(substring));
      error['message'] = substring;
    } else {
      error.remove('message');
    }
  }
  expect(copy, equals(expected));
}

Object? _deepCopy(Object? value) => switch (value) {
  final Map<Object?, Object?> map => <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in map.entries)
      '${entry.key}': _deepCopy(entry.value),
  },
  final List<Object?> list => [
    for (final Object? item in list) _deepCopy(item),
  ],
  _ => value,
};

/// Writes every `timestamp` that is an ISO 8601 instant in one spelling, so
/// `2026-01-01T00:00:00Z` and the `2026-01-01T00:00:00.000Z` that Dart writes
/// compare equal.
Object? _normalizeTimestamps(Object? value) => switch (value) {
  final Map<Object?, Object?> map => <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in map.entries)
      '${entry.key}': entry.key == 'timestamp' && entry.value is String
          ? (DateTime.tryParse(
                  entry.value! as String,
                )?.toUtc().toIso8601String() ??
                entry.value)
          : _normalizeTimestamps(entry.value),
  },
  final List<Object?> list => [
    for (final Object? item in list) _normalizeTimestamps(item),
  ],
  _ => value,
};
