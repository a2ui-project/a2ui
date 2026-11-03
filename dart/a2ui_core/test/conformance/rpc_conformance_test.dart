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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import 'conformance_harness.dart';

/// A function with canned behavior, declared with the metadata a case gives.
class _CannedFunction extends FunctionImplementation {
  _CannedFunction({
    required super.name,
    required super.argumentSchema,
    required super.allowedCallers,
    required super.requiresUserActivation,
  });

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    switch (name) {
      case 'playMedia':
        return {'playing': true, 'timestamp': 0};
      case 'openExternalUrl':
        return {'opened': true};
      case 'syncState':
        return null;
      case 'failingFunction':
        throw StateError('An error occurred during function execution.');
      case 'calculateTax':
        return ((args['amount'] as num?) ?? 0) * 0.1;
      case 'echoArgs':
        return Map<String, Object?>.from(args);
      default:
        return null;
    }
  }
}

const Map<String, Set<String>> _knownKeys = {
  'case:handle_rpc': {
    ...caseMetadataKeys,
    'args',
    'catalog',
    'expect',
    'expectError',
    'protocolVersion',
  },
  'args:handle_rpc': {
    'catalogId',
    'catalogVersion',
    'dataModel',
    'functionMetadata',
    'inboundResponse',
    'message',
    'outboundCall',
    'secondOutboundCall',
    'surfaceId',
    'uiActionFallbackScenario',
    'uiBindingScenario',
    'userActivationPresent',
  },
  'expect:handle_rpc': {
    'correlatedCallId',
    'error',
    'initialValue',
    'outboundCall',
    'resolvedValue',
    'response',
    'result',
  },
};

/// Runs the shared `conformance/core/rpc_functions.yaml` suite against
/// [MessageProcessor] and its [RpcHandler].
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/rpc_functions.yaml',
  );

  group('conformance core/rpc_functions.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    runConformanceSuite(
      cases,
      _runCase,
      suite: 'core/rpc_functions.yaml',
    );
  });
}

Future<void> _runCase(Map<String, Object?> testCase) async {
  final action = testCase['action']! as String;
  if (action != 'handle_rpc') {
    throw StateError('Unsupported rpc_functions action: $action');
  }
  final args = testCase['args']! as Map<String, Object?>;
  final expected = testCase['expect'] as Map<String, Object?>?;
  final expectError = testCase['expectError'] as Map<String, Object?>?;
  _assertRpcKeys(testCase, args, expected, expectError);
  if (expected == null && expectError == null) {
    throw StateError('handle_rpc test requires "expect" or "expectError".');
  }

  final message = args['message'] as Map<String, Object?>?;
  final outboundCall = args['outboundCall'] as Map<String, Object?>?;
  final inboundResponse = args['inboundResponse'] as Map<String, Object?>?;
  final Map<String, Object?> metadata =
      args['functionMetadata'] as Map<String, Object?>? ?? const {};
  final userActivation = args['userActivationPresent'] == true;

  final functions = <FunctionImplementation>[
    for (final MapEntry<String, Object?> entry in metadata.entries)
      _cannedFunction(entry.key, entry.value as Map<String, Object?>? ?? {}),
  ];

  final String catalogId = _catalogIdFor(
    args,
    message,
    outboundCall,
    expected,
    expectError,
  );
  final String catalogVersion = args['catalogVersion'] as String? ??
      (testCase['catalog'] as Map<String, Object?>?)?['protocolVersion']
          as String? ??
      testCase['protocolVersion'] as String? ??
      '1.0';

  final A2uiProtocolVersion? parsedCatalogVersion =
      A2uiProtocolVersion.tryParseSemVer(catalogVersion);
  final Catalog<ComponentApi, FunctionImplementation> basic =
      BasicCatalog.v1_0(openUrl: (_) {});
  final catalog = Catalog<ComponentApi, FunctionImplementation>(
    id: catalogId,
    components: const [],
    functions: functions,
    protocolVersion: parsedCatalogVersion,
  );
  final catalogs = <Catalog<ComponentApi, FunctionImplementation>>[
    catalog,
    if (catalogId != 'basic')
      Catalog<ComponentApi, FunctionImplementation>(
        id: 'basic',
        components: basic.components.values.toList(),
        functions: basic.functions.values.toList(),
        protocolVersion: A2uiProtocolVersion.v1_0,
      ),
  ];
  final sent = <RendererToAgentMessage>[];
  final processor = MessageProcessor<ComponentApi>(
    catalogs: catalogs,
    defaultVersion: A2uiProtocolVersion.v1_0,
    outboundListener: sent.add,
  );
  addTearDown(processor.dispose);

  if (args['surfaceId'] case final String surfaceId) {
    final surface = SurfaceModel<ComponentApi>(
      surfaceId,
      defaultCatalog: catalog,
      availableCatalogs: catalogs,
      protocolVersion: catalogVersion,
      callAgentFunction: (call) => processor.callAgentFunction(surfaceId, call),
    );
    if (args['dataModel'] case final Map<String, Object?> dataModel) {
      surface.dataModel.set('/', dataModel);
    }
    processor.model.addSurface(surface);
  }

  if (message != null) {
    await _runInboundMessageScenario(
      message,
      expected,
      expectError,
      userActivation,
      processor,
      sent,
    );
  }

  if (outboundCall != null && inboundResponse != null) {
    final correlatedId = expected!['correlatedCallId']! as String;
    final response =
        inboundResponse['agentFunctionResponse']! as Map<String, Object?>;
    expect(response['functionCallId'], correlatedId);

    final FunctionCall call = _functionCall(outboundCall);
    final Future<Object?> future = processor.callAgentFunction(
      outboundCall['surfaceId']! as String,
      call,
      options: CallOptions(
        functionCallId: outboundCall['functionCallId'] as String?,
      ),
    );
    final CallAgentFunctionMessage outbound =
        sent.whereType<CallAgentFunctionMessage>().single;
    expect(outbound.functionCallId, correlatedId);
    expect(outbound.callFunction['@call'], call.call);

    processor.processMessages(inboundResponse);
    expect(await future, expected['result']);
  } else if (outboundCall != null) {
    final errorSpec =
        (expected?['error'] ?? expectError)! as Map<String, Object?>;
    await _runOutboundErrorScenario(
      outboundCall,
      args['secondOutboundCall'] as Map<String, Object?>?,
      errorSpec,
      processor,
    );
  }

  if (args['uiBindingScenario'] case final Map<String, Object?> scenario) {
    await _runUiBindingScenario(scenario, expected!, processor, basic, sent);
  }

  if (args['uiActionFallbackScenario']
      case final Map<String, Object?> scenario) {
    await _runUiActionFallbackScenario(scenario, expected!, processor, sent);
  }
}

void _assertRpcKeys(
  Map<String, Object?> testCase,
  Map<String, Object?> args,
  Map<String, Object?>? expected,
  Map<String, Object?>? expectError,
) {
  assertKnownKeys(testCase, _knownKeys['case:handle_rpc']!, 'case:handle_rpc');
  assertKnownKeys(args, _knownKeys['args:handle_rpc']!, 'args:handle_rpc');
  if (expected != null) {
    assertKnownKeys(
      expected,
      _knownKeys['expect:handle_rpc']!,
      'expect:handle_rpc',
    );
  }
  if (expectError != null) {
    assertKnownKeys(expectError, knownExpectErrorKeys, 'expectError');
  }
}

Future<void> _runInboundMessageScenario(
  Map<String, Object?> message,
  Map<String, Object?>? expected,
  Map<String, Object?>? expectError,
  bool userActivation,
  MessageProcessor<ComponentApi> processor,
  List<RendererToAgentMessage> sent,
) async {
  final errorSpec = expected?['error'] as Map<String, Object?>?;
  if (errorSpec != null || expectError != null) {
    // Run first: the processor emits the outbound error before it throws,
    // and the field matcher reads that emitted message.
    Object? thrown;
    try {
      processor.processMessages(message);
    } catch (e) {
      thrown = e;
    }
    expect(thrown, isNotNull, reason: 'expected processMessages to throw');

    final part = errorSpec?['message'] as String?;
    expect(
      thrown,
      allOf([
        if (expectError != null)
          categoryMatches(expectError['category'] as String?),
        if (part != null)
          isA<Object>().having((e) => e.toString(), 'message', contains(part)),
        if (expectError != null)
          matchesErrorFields(
            expectError,
            rawMessage: message,
            defaultVersion: '1.0',
            emittedErrors: sent.whereType<ErrorMessage>().toList(),
          ),
      ]),
    );
    // `expect.error` describes the outbound error the processor emits for
    // the call, so its code and functionCallId are read from that message.
    if (errorSpec != null) {
      final ErrorMessage? emitted = sent.whereType<ErrorMessage>().lastOrNull;
      expect(emitted, isNotNull, reason: 'expected an outbound error message');
      if (errorSpec['code'] case final String code) {
        expect(emitted!.error.code, code);
      }
      if (errorSpec['functionCallId'] case final String callId) {
        expect(emitted!.error.functionCallId, callId);
      }
    }
    return;
  }
  if (expected == null || !expected.containsKey('response')) return;

  await processor.processMessagesAsync(
    message,
    isUserActivated: userActivation,
  );
  final Iterable<RendererFunctionResponseMessage> responses =
      sent.whereType<RendererFunctionResponseMessage>();
  final expectedResponse = expected['response'] as Map<String, Object?>?;
  if (expectedResponse == null) {
    expect(responses, isEmpty);
    return;
  }
  expect(responses, hasLength(1));
  final RendererFunctionResponseMessage actual = responses.single;
  expect(actual.version, expectedResponse['version']);
  final body =
      expectedResponse['rendererFunctionResponse']! as Map<String, Object?>;
  expect(actual.response.functionCallId, body['functionCallId']);
  if (body.containsKey('value')) {
    expect(actual.response.error, isNull);
    expect(actual.response.value, body['value']);
  }
  final errorBody = body['error'] as Map<String, Object?>?;
  if (errorBody != null) {
    expect(actual.response.error, isNotNull);
    expect(actual.response.error!.code, errorBody['code']);
    final part = errorBody['message'] as String?;
    if (part != null) {
      expect(actual.response.error!.message, contains(part));
    }
  }
}

Future<void> _runOutboundErrorScenario(
  Map<String, Object?> outboundCall,
  Map<String, Object?>? secondCall,
  Map<String, Object?> errorSpec,
  MessageProcessor<ComponentApi> processor,
) async {
  final code = errorSpec['code'] as String?;
  final Matcher matcher = isA<A2uiRpcError>().having(
    (e) => e.code,
    'code',
    code ?? anything,
  );
  if (secondCall != null) {
    final Future<Object?> first = processor.callAgentFunction(
      outboundCall['surfaceId']! as String,
      _functionCall(outboundCall),
      options: CallOptions(
        functionCallId: outboundCall['functionCallId'] as String?,
      ),
    );
    first.ignore();
    await expectLater(
      processor.callAgentFunction(
        secondCall['surfaceId']! as String,
        _functionCall(secondCall),
        options: CallOptions(
          functionCallId: secondCall['functionCallId'] as String?,
        ),
      ),
      throwsA(matcher),
    );
    return;
  }
  final timeoutMs = outboundCall['timeoutMs'] as int?;
  await expectLater(
    processor.callAgentFunction(
      outboundCall['surfaceId']! as String,
      _functionCall(outboundCall),
      options: CallOptions(
        functionCallId: outboundCall['functionCallId'] as String?,
        timeout: timeoutMs == null ? null : Duration(milliseconds: timeoutMs),
      ),
    ),
    throwsA(matcher),
  );
}

Future<void> _runUiBindingScenario(
  Map<String, Object?> scenario,
  Map<String, Object?> expected,
  MessageProcessor<ComponentApi> processor,
  Catalog<ComponentApi, FunctionImplementation> basic,
  List<RendererToAgentMessage> sent,
) async {
  final surfaceId = scenario['surfaceId']! as String;
  final scenarioCatalogId = scenario['catalogId']! as String;
  final scenarioCatalog = Catalog<ComponentApi, FunctionImplementation>(
    id: scenarioCatalogId,
    components: basic.components.values.toList(),
    functions: const [],
    protocolVersion: A2uiProtocolVersion.v1_0,
  );
  final surface = SurfaceModel<ComponentApi>(
    surfaceId,
    defaultCatalog: scenarioCatalog,
    availableCatalogs: [scenarioCatalog],
    protocolVersion: '1.0',
    callAgentFunction: (call) => processor.callAgentFunction(surfaceId, call),
  );
  processor.model.addSurface(surface);
  final comp = Map<String, Object?>.from(scenario['component']! as Map);
  final compId = comp.remove('id')! as String;
  final compType = comp.remove('component')! as String;
  surface.componentsModel.addComponent(
    ComponentModel(compId, compType, comp),
  );
  final resolver = NodeResolver<ComponentApi>(surface);
  addTearDown(resolver.dispose);

  final ComponentNode<ComponentApi> root = resolver.rootNode.value!;
  final initialBinding = root.props.value['text']! as ResolvedBinding<Object?>;
  expect(initialBinding.value, expected['initialValue']);

  final CallAgentFunctionMessage outbound =
      sent.whereType<CallAgentFunctionMessage>().single;
  final expectedOutbound = expected['outboundCall']! as Map<String, Object?>;
  expect(outbound.version, expectedOutbound['version']);
  final expectedCall =
      expectedOutbound['callAgentFunction']! as Map<String, Object?>;
  expect(outbound.surfaceId, expectedCall['surfaceId']);
  expect(outbound.callFunction, expectedCall['callFunction']);

  processor.processMessages({
    'version': '1.0',
    'agentFunctionResponse': {
      'functionCallId': outbound.functionCallId,
      'value': scenario['inboundResponseValue'],
    },
  });
  await Future<void>.delayed(Duration.zero);
  final resolvedBinding = root.props.value['text']! as ResolvedBinding<Object?>;
  expect(resolvedBinding.value, expected['resolvedValue']);
}

Future<void> _runUiActionFallbackScenario(
  Map<String, Object?> scenario,
  Map<String, Object?> expected,
  MessageProcessor<ComponentApi> processor,
  List<RendererToAgentMessage> sent,
) async {
  final surfaceId = scenario['surfaceId']! as String;
  final scenarioCatalogId = scenario['catalogId']! as String;
  final scenarioCatalog = Catalog<ComponentApi, FunctionImplementation>(
    id: scenarioCatalogId,
    components: const [],
    functions: const [],
    protocolVersion: A2uiProtocolVersion.v1_0,
  );
  final context = DataContext(
    DataModel(),
    scenarioCatalog.invoke,
    '/',
    protocolVersion: A2uiProtocolVersion.v1_0,
    invokerForCatalog: (id) {
      if (id == scenarioCatalogId) return scenarioCatalog.invoke;
      throw A2uiCatalogResolutionError(
        'Catalog not found: $id',
        catalogId: id,
      );
    },
    callAgentFunction: (call) => processor.callAgentFunction(surfaceId, call),
  );
  final actionPayload = scenario['actionPayload']! as Map<String, Object?>;
  final functionCall = actionPayload['functionCall']! as Map<String, Object?>;
  final Future<Object?> resultFuture =
      context.evaluateFunctionCall(functionCall);

  final CallAgentFunctionMessage outbound =
      sent.whereType<CallAgentFunctionMessage>().single;
  final expectedOutbound = expected['outboundCall']! as Map<String, Object?>;
  expect(outbound.version, expectedOutbound['version']);
  final expectedCall =
      expectedOutbound['callAgentFunction']! as Map<String, Object?>;
  expect(outbound.surfaceId, expectedCall['surfaceId']);
  expect(outbound.callFunction, expectedCall['callFunction']);

  processor.processMessages({
    'version': '1.0',
    'agentFunctionResponse': {
      'functionCallId': outbound.functionCallId,
      'value': scenario['inboundResponseValue'],
    },
  });
  expect(await resultFuture, expected['result']);
}

FunctionCall _functionCall(Map<String, Object?> outboundCall) {
  final callFunction = outboundCall['callFunction']! as Map<String, Object?>;
  final Object? rawArgs = callFunction['args'];
  return FunctionCall(
    call: (callFunction['@call'] ?? callFunction['call'])! as String,
    catalogId: callFunction['catalogId'] as String?,
    args: rawArgs is Map
        ? Map<String, dynamic>.from(rawArgs)
        : <String, dynamic>{},
    reservedKeys: true,
  );
}

_CannedFunction _cannedFunction(String name, Map<String, Object?> meta) {
  final Object? schema = meta['schema'] ?? meta['parameters'];
  return _CannedFunction(
    name: name,
    argumentSchema: schema is Map
        ? Schema.fromMap(schema.cast<String, Object?>())
        : Schema.fromMap({'type': 'object'}),
    allowedCallers: AllowedCallers.fromJson(
      meta['allowedCallers'] as String? ?? 'rendererOrAgent',
    ),
    requiresUserActivation: meta['requiresUserActivation'] == true,
  );
}

/// The catalog id the processor is given: the case's `catalogId`, else the
/// inbound call's `catalogId` unless the case expects it to be missing, else
/// the outbound call's, else `basic`.
String _catalogIdFor(
  Map<String, Object?> args,
  Map<String, Object?>? message,
  Map<String, Object?>? outboundCall,
  Map<String, Object?>? expected,
  Map<String, Object?>? expectError,
) {
  var catalogId = args['catalogId'] as String?;
  final inbound = message?['callRendererFunction'] as Map<String, Object?>?;
  if (catalogId == null && inbound != null) {
    final callFunction = inbound['callFunction'] as Map<String, Object?>?;
    final response = expected?['response'] as Map<String, Object?>?;
    final body = response?['rendererFunctionResponse'] as Map<String, Object?>?;
    final error = body?['error'] as Map<String, Object?>?;
    final String expectedMessage = error?['message'] as String? ??
        (expected?['error'] as Map<String, Object?>?)?['message'] as String? ??
        expectError?['message'] as String? ??
        '';
    if (!expectedMessage.contains('Catalog not found')) {
      catalogId = callFunction?['catalogId'] as String?;
    }
  }
  if (catalogId == null && outboundCall != null) {
    final callFunction = outboundCall['callFunction'] as Map<String, Object?>?;
    catalogId = callFunction?['catalogId'] as String?;
  }
  return catalogId ?? 'basic';
}
