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
      test(
        testCase['name']! as String,
        () => _runCase(testCase),
        skip: testCase['action'] == 'call_renderer_function'
            ? 'Renderer function calls move to a follow-up pull request.'
            : null,
      );
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
  final AllowedCallers allowedCallers = AllowedCallers.fromJson(
    allowedCallersStr,
  );
  if (allowedCallers == AllowedCallers.agentOnly) {
    return _AgentOnlyFunction(
      name: name,
      handler: _handler(behavior),
      returnType: A2uiReturnType.fromJson(returnTypeStr),
      argumentSchema: Schema.fromMap(rawArgs),
      description: declaration['description'] as String?,
    );
  }
  return AgentFunction(
    name: name,
    handler: _handler(behavior),
    returnType: A2uiReturnType.fromJson(returnTypeStr),
    argumentSchema: Schema.fromMap(rawArgs),
    description: declaration['description'] as String?,
  );
}

/// An agent function that claims `allowedCallers: agentOnly`, which neither
/// the constructor nor [AgentFunction.fromApi] can build.
final class _AgentOnlyFunction extends AgentFunction {
  const _AgentOnlyFunction({
    required super.name,
    required super.handler,
    required super.returnType,
    required super.argumentSchema,
    super.description,
  });

  @override
  AllowedCallers get allowedCallers => AllowedCallers.agentOnly;
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
