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

class _TestActionFunction extends FunctionImplementation {
  _TestActionFunction(String name)
      : super(
          name: name,
          argumentSchema: Schema.fromMap({'type': 'object'}),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    switch (name) {
      case 'incrementCounter':
        final path = args['path']! as String;
        final num step = (args['step'] as num?) ?? 1;
        final num current = (context.dataModel.get(path) as num?) ?? 0;
        context.dataModel.set(path, current + step);
        return null;
      case 'failingAction':
        throw StateError('Action execution failed.');
      default:
        return null;
    }
  }
}

/// Runs the shared `conformance/core/actions.yaml` suite against
/// [DataContext] and [SurfaceModel].
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/actions.yaml',
  );

  group('conformance core/actions.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      test(testCase['name']! as String, () async {
        await _runCase(testCase);
      });
    }
  });
}

Future<void> _runCase(Map<String, Object?> testCase) async {
  final String action = testCase['action'] as String? ?? 'dispatch_action';
  switch (action) {
    case 'dispatch_action':
      await _runDispatchActionCase(testCase);
    default:
      throw StateError('Unsupported action: $action');
  }
}

Future<void> _runDispatchActionCase(Map<String, Object?> testCase) async {
  final (SurfaceModel<ComponentApi> surface, DataContext context) =
      _createActionTestFixture(testCase);

  A2uiRendererAction? dispatched;
  surface.onAction.subscribe((action) {
    dispatched = action;
  });
  A2uiRendererError? dispatchedError;
  surface.onError.subscribe((err) {
    dispatchedError = err;
  });

  final String sourceComponentId =
      testCase['sourceComponentId'] as String? ?? 'test_component';
  final Object? rawAction =
      testCase['actionPayload'] ?? testCase['action_data'];
  await _executeActionPayload(surface, context, rawAction, sourceComponentId);

  _assertDispatchedAction(testCase, dispatched);
  _assertDispatchedError(testCase, dispatchedError);

  final expectDataModel = testCase['expectDataModel'] as Map<String, Object?>?;
  if (expectDataModel != null) {
    expect(surface.dataModel.get('/'), equals(expectDataModel));
  }
}

(SurfaceModel<ComponentApi>, DataContext) _createActionTestFixture(
  Map<String, Object?> testCase,
) {
  final initialData = (testCase['dataModel'] ?? testCase['data_model'])
      as Map<String, Object?>?;
  final versionStr = testCase['protocolVersion'] as String?;
  final A2uiProtocolVersion? protocolVersion = versionStr == null
      ? null
      : A2uiProtocolVersion.tryParseSemVer(versionStr);
  final Catalog<ComponentApi, FunctionImplementation> basic =
      (protocolVersion != null &&
              protocolVersion.isAtLeast(A2uiProtocolVersion.v1_0))
          ? BasicCatalog.v1_0(openUrl: (_) {})
          : BasicCatalog.v0_9(openUrl: (_) {});
  final catalog = Catalog<ComponentApi, FunctionImplementation>(
    id: 'test_catalog',
    components: basic.components.values.toList(),
    functions: [
      ...basic.functions.values,
      _TestActionFunction('incrementCounter'),
      _TestActionFunction('failingAction'),
    ],
    protocolVersion: protocolVersion,
  );
  final SurfaceModel<ComponentApi> surface = SurfaceModel(
    testCase['surfaceId'] as String? ?? 'test_surface',
    defaultCatalog: catalog,
    protocolVersion: versionStr,
  );
  if (initialData != null) {
    surface.dataModel.set('/', initialData);
  }
  final context = DataContext(
    surface.dataModel,
    catalog.invoke,
    testCase['scope'] as String? ?? '/',
    protocolVersion: protocolVersion,
    invokerForCatalog: (id) => surface.resolveCatalog(id).invoke,
    isUserActivated: testCase['userActivation'] as bool? ?? true,
  );
  return (surface, context);
}

Future<void> _executeActionPayload(
  SurfaceModel<ComponentApi> surface,
  DataContext context,
  Object? rawAction,
  String sourceComponentId,
) async {
  if (rawAction is Map &&
      (rawAction['functionCall'] is Map || context.isFunctionCall(rawAction))) {
    final fc = rawAction['functionCall'] is Map
        ? Map<String, Object?>.from(rawAction['functionCall']! as Map)
        : Map<String, Object?>.from(rawAction);
    try {
      await context.evaluateFunctionCall(fc);
    } catch (e) {
      final Object? fnName = fc['@call'] ?? fc['call'];
      await surface.dispatchError(
        A2uiRendererError(
          code: 'EXECUTION_ERROR',
          surfaceId: surface.id,
          message:
              "Function '$fnName' failed in component '$sourceComponentId': $e",
        ),
      );
    }
    return;
  }

  final Map<String, dynamic>? resolvedAction = context.resolveAction(rawAction);
  if (resolvedAction == null) {
    await surface.dispatchError(
      A2uiRendererError(
        code: 'INVALID_ACTION',
        surfaceId: surface.id,
        message: "Invalid action payload in component '$sourceComponentId': "
            '$rawAction',
        details: rawAction,
      ),
    );
  } else {
    await surface.dispatchAction(resolvedAction, sourceComponentId);
  }
}

void _assertDispatchedAction(
  Map<String, Object?> testCase,
  A2uiRendererAction? dispatched,
) {
  if (testCase.containsKey('expectDispatched') &&
      testCase['expectDispatched'] == null) {
    expect(dispatched, isNull);
  }
  final expected = (testCase['expectDispatched'] ?? testCase['expected'])
      as Map<String, Object?>?;
  if (expected == null) return;
  expect(dispatched, isNotNull);
  expect(dispatched!.name, equals(expected['name']));
  if (expected.containsKey('surfaceId')) {
    expect(dispatched.surfaceId, equals(expected['surfaceId']));
  }
  if (expected.containsKey('sourceComponentId')) {
    expect(dispatched.sourceComponentId, equals(expected['sourceComponentId']));
  }
  if (expected['timestampIso8601'] == true) {
    expect(dispatched.timestamp.toIso8601String(), isNotEmpty);
  }
  if (expected.containsKey('context')) {
    expect(dispatched.context, equals(expected['context'] ?? const {}));
  }
  if (expected.containsKey('userMessage')) {
    expect(dispatched.userMessage, equals(expected['userMessage']));
  }
}

void _assertDispatchedError(
  Map<String, Object?> testCase,
  A2uiRendererError? dispatchedError,
) {
  final expectError = testCase['expectError'] as Map<String, Object?>?;
  if (expectError == null) return;
  expect(dispatchedError, isNotNull);
  if (expectError['code'] case final String code) {
    expect(dispatchedError!.code, equals(code));
  }
  if (expectError['surfaceId'] case final String errSurfaceId) {
    expect(dispatchedError!.surfaceId, equals(errSurfaceId));
  }
  if (expectError['message'] case final String msgPart) {
    expect(dispatchedError!.message, contains(msgPart));
  }
}
