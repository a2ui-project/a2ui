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
      default:
        return null;
    }
  }
}

/// Runs the shared `conformance/core/rpc_functions.yaml` suite against
/// [MessageProcessor] and its [RpcHandler].
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/rpc_functions.yaml',
  );

  group('conformance core/rpc_functions.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      final name = testCase['name']! as String;
      test(name, () => _runCase(testCase));
    }
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
      'v1.0';

  final catalog = Catalog<ComponentApi, FunctionImplementation>(
    id: catalogId,
    components: const [],
    functions: functions,
    protocolVersion: catalogVersion,
  );
  final sent = <RendererToAgentMessage>[];
  final processor = MessageProcessor<ComponentApi>(
    catalogs: [catalog],
    defaultVersion: A2uiProtocolVersion.v1_0,
    commonTypesSchema: const {},
    outboundListener: sent.add,
  );
  addTearDown(processor.dispose);

  if (message != null) {
    final errorSpec = expected?['error'] as Map<String, Object?>?;
    if (errorSpec != null) {
      final part = errorSpec['message'] as String?;
      expect(
        () => processor.processMessages(message),
        throwsA(isA<Object>().having(
          (e) => e.toString(),
          'message',
          part == null ? anything : contains(part),
        )),
      );
    } else if (expected != null && expected.containsKey('response')) {
      await processor.processMessagesAsync(
        message,
        isUserActivated: userActivation,
      );
      final Iterable<RendererFunctionResponseMessage> responses =
          sent.whereType<RendererFunctionResponseMessage>();
      final expectedResponse = expected['response'] as Map<String, Object?>?;
      if (expectedResponse == null) {
        expect(responses, isEmpty);
      } else {
        expect(responses, hasLength(1));
        final RendererFunctionResponseMessage actual = responses.single;
        expect(actual.version, expectedResponse['version']);
        final body = expectedResponse['rendererFunctionResponse']!
            as Map<String, Object?>;
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
    }
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
    final code = errorSpec['code'] as String?;
    final Matcher matcher = isA<A2uiRpcError>().having(
      (e) => e.code,
      'code',
      code ?? anything,
    );
    final secondCall = args['secondOutboundCall'] as Map<String, Object?>?;
    if (secondCall != null) {
      final Future<Object?> first = processor.callAgentFunction(
        outboundCall['surfaceId']! as String,
        _functionCall(outboundCall),
        options: CallOptions(
          functionCallId: outboundCall['functionCallId'] as String?,
        ),
      );
      // Settled with CANCELLED when the processor is disposed in tearDown.
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
    } else {
      final timeoutMs = outboundCall['timeoutMs'] as int?;
      await expectLater(
        processor.callAgentFunction(
          outboundCall['surfaceId']! as String,
          _functionCall(outboundCall),
          options: CallOptions(
            functionCallId: outboundCall['functionCallId'] as String?,
            timeout:
                timeoutMs == null ? null : Duration(milliseconds: timeoutMs),
          ),
        ),
        throwsA(matcher),
      );
    }
  }
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
