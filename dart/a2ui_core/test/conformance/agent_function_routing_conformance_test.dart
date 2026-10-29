// Copyright 2026 Google LLC
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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import 'conformance_harness.dart';

typedef _RendererCatalog = Catalog<ComponentApi, FunctionImplementation>;

/// Runs the shared suite `conformance/core/agent_function_routing.yaml`: the
/// v1.0 fallback routing of function calls to the agent with
/// `callAgentFunction`.
void main() {
  final List<ConformanceTestCase> cases = loadConformanceSuite(
    'core/agent_function_routing.yaml',
  );

  group('conformance core/agent_function_routing.yaml', () {
    test('suite has cases', () => expect(cases, isNotEmpty));

    runConformanceSuite(
      cases,
      _runCase,
      expectedFailures: _knownDivergences,
      skipReason: (testCase) {
        final List<Object?> catalogs =
            testCase['catalogs'] as List<Object?>? ?? const [];
        final bool declaresAgentFunctions = catalogs.any(
          (catalog) =>
              (catalog! as Map<String, Object?>).containsKey('agentFunctions'),
        );
        return declaresAgentFunctions ? _noSchemaOnlyFunctions : null;
      },
    );
  });
}

/// Cases whose expected outcome Dart does not produce, with the reason.
const Map<String, String> _knownDivergences = {
  'test_agent_routing_agent_result_feeds_local_function':
      'A local function runs while an agent call in its arguments is still '
          'pending, with that argument null, instead of waiting for it.',
};

/// Why a case that declares `agentFunctions` is skipped: a known divergence.
const String _noSchemaOnlyFunctions =
    'Known divergence: a Dart catalog holds FunctionImplementations, so it '
    'cannot declare a function without an implementation (schema-only).';

/// The component that check rules and actions are bound to, resolved by a
/// [GenericBinder] as a renderer's component would be.
final Schema _probeSchema = Schema.combined(
  allOf: [
    CommonSchemas.checkable,
    Schema.object(properties: {'action': CommonSchemas.action}),
  ],
);

/// Builds the catalogs of a case. `localFunctions` take this SDK's basic
/// catalog implementations for the case's protocol version.
List<_RendererCatalog> _catalogs(
  ConformanceTestCase testCase,
  A2uiProtocolVersion version,
) {
  final _RendererCatalog basic = version.isAtLeast(A2uiProtocolVersion.v1_0)
      ? BasicCatalog.v1_0()
      : BasicCatalog.v0_9();
  return [
    for (final Map<String, Object?> raw
        in (testCase['catalogs'] as List<Object?>).cast())
      _RendererCatalog(
        id: raw['catalogId']! as String,
        protocolVersion: version,
        components: const [],
        functions: [
          for (final Object? name
              in raw['localFunctions'] as List<Object?>? ?? const [])
            basic.functions[name]!,
        ],
      ),
  ];
}

/// Lets futures that already completed, and those they schedule, run.
Future<void> _flush() async {
  for (var i = 0; i < 5; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

/// The outcome of a check rule bound by [binder], or null while the rule
/// awaits the agent's answer.
Object? _checkOutcome(GenericBinder binder) {
  final Map<String, dynamic> props = binder.resolvedProps.value;
  return props['validationPending'] == true ? null : props['isValid'];
}

Future<void> _runCase(ConformanceTestCase testCase) async {
  final A2uiProtocolVersion version =
      A2uiProtocolVersion.tryParseSemVer(caseVersion(testCase)!)!;
  final Map<String, Object?> surfaceBlock =
      testCase['surface'] as Map<String, Object?>? ?? const {};
  final outbound = <CallAgentFunctionMessage>[];
  final processor = MessageProcessor<ComponentApi>(
    catalogs: _catalogs(testCase, version),
    defaultVersion: version,
    outboundListener: surfaceBlock['outboundListener'] == false
        ? null
        : (message) {
            if (message is! CallAgentFunctionMessage) {
              fail('Unexpected outbound message $message.');
            }
            outbound.add(message);
          },
  );
  addTearDown(processor.dispose);
  processor.processMessages({
    'version': version.jsonValue,
    'createSurface': {
      'surfaceId': 'main',
      if (surfaceBlock['catalogId'] case final String catalogId)
        'catalogId': catalogId,
    },
  });
  final SurfaceModel<ComponentApi> surface = processor.model.getSurface(
    'main',
  )!;
  if (testCase['dataModel'] case final Map<String, Object?> data) {
    for (final MapEntry<String, Object?> entry in data.entries) {
      surface.dataModel.set('/${entry.key}', entry.value);
    }
  }
  final errors = <A2uiRendererError>[];
  surface.onError.subscribe(errors.add);

  // Reads the current value of each binding and check evaluation, in order.
  final evaluations = <Object? Function()>[];
  var probes = 0;
  var outboundSeen = 0;
  var errorsSeen = 0;

  final steps = testCase['steps']! as List<Object?>;
  for (var index = 0; index < steps.length; index++) {
    final step = steps[index]! as Map<String, Object?>;
    final label = 'step $index';
    if (step['evaluate'] case final Map<String, Object?> call) {
      final String kind = step['as'] as String? ?? 'binding';
      final id = 'probe${probes++}';
      switch (kind) {
        case 'binding':
          // A component binding resolves its value through its data context.
          final ReadonlySignal<Object?> value = ComponentContext(
            surface,
            ComponentModel(id, 'Probe', {}),
          ).dataContext.resolveSignal(call);
          evaluations.add(() => value.value);
        case 'check' || 'action':
          final component = ComponentModel(id, 'Probe', {
            if (kind == 'check')
              'checks': [
                {'condition': call, 'message': 'Check failed'},
              ]
            else
              'action': {'functionCall': call},
          });
          surface.componentsModel.addComponent(component);
          final binder = GenericBinder(
            ComponentContext(surface, component),
            _probeSchema,
          );
          addTearDown(binder.dispose);
          if (kind == 'check') {
            evaluations.add(() => _checkOutcome(binder));
          } else {
            final callback =
                binder.resolvedProps.value['action'] as Future<void> Function();
            unawaited(callback());
          }
        default:
          fail('$label: unknown evaluation kind $kind.');
      }
      // Reading a value evaluates it, which is what makes the call.
      if (kind != 'action') evaluations.last();
    } else if (step['respond'] case final Map<String, Object?> respond) {
      final CallAgentFunctionMessage message =
          outbound[respond['call']! as int];
      processor.processMessages({
        'version': '1.0',
        'agentFunctionResponse': {
          'functionCallId': message.functionCallId,
          for (final MapEntry<String, Object?> entry in respond.entries)
            if (entry.key != 'call') entry.key: entry.value,
        },
      });
    } else {
      fail("$label: a step needs 'evaluate' or 'respond'.");
    }
    await _flush();

    final List<CallAgentFunctionMessage> sent = outbound.sublist(outboundSeen);
    outboundSeen = outbound.length;
    for (final message in sent) {
      expect(message.surfaceId, 'main', reason: '$label: surfaceId');
    }
    expect(
      [for (final message in sent) message.callFunction],
      step['expectOutbound'] ?? const <Object?>[],
      reason: '$label: outbound callFunction payloads',
    );

    final List<A2uiRendererError> reported = errors.sublist(errorsSeen);
    errorsSeen = errors.length;
    final List<Object?> expectedErrors =
        step['expectErrors'] as List<Object?>? ?? const [];
    expect(
      reported,
      hasLength(expectedErrors.length),
      reason: '$label: reported errors '
          '${[for (final e in reported) '${e.code}: ${e.message}']}',
    );
    for (var i = 0; i < expectedErrors.length; i++) {
      final expected = expectedErrors[i]! as Map<String, Object?>;
      expect(reported[i].code, expected['code'], reason: '$label: code');
      if (expected['message'] case final String message) {
        expect(reported[i].message, contains(message), reason: label);
      }
    }

    if (step.containsKey('expectValues')) {
      expect(
        [for (final read in evaluations) read()],
        step['expectValues'],
        reason: '$label: values',
      );
    }
  }
}
