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
import 'package:test/test.dart';

import 'conformance_harness.dart';

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
  final initialData = (testCase['dataModel'] ?? testCase['data_model'])
      as Map<String, Object?>?;
  final catalog = Catalog<ComponentApi, FunctionImplementation>(
    id: 'test_catalog',
    components: const [],
    functions: const [],
  );
  final SurfaceModel surface = SurfaceModel(
    testCase['surfaceId'] as String? ?? 'test_surface',
    catalog: catalog,
  );
  if (initialData != null) {
    surface.dataModel.set('/', initialData);
  }

  final String scope = testCase['scope'] as String? ?? '/';
  final dispatchedErrors = <A2uiClientError>[];
  surface.onError.addListener(dispatchedErrors.add);
  // Report as ComponentContext does by default: to the surface's error channel.
  final context = DataContext(
    surface.dataModel,
    catalog.invoke,
    scope,
    onError: (error) {
      surface.dispatchError(
        A2uiClientError(
          code: 'EXPRESSION_ERROR',
          surfaceId: surface.id,
          message: error.message,
          details: error.details,
        ),
      );
    },
  );

  final Object? rawAction =
      testCase['actionPayload'] ?? testCase['action_data'];

  A2uiClientAction? dispatched;
  surface.onAction.addListener((action) {
    dispatched = action;
  });

  final Object? functionCall =
      rawAction is Map ? rawAction['functionCall'] : null;
  if (functionCall != null) {
    // A functionCall action runs locally, as GenericBinder does when triggered.
    context.resolveSync(functionCall);
  } else {
    final Map<String, dynamic>? resolvedAction =
        context.resolveAction(rawAction);
    expect(resolvedAction, isNotNull);
    await surface.dispatchAction(
      resolvedAction!,
      'test_component',
    );
  }

  final expectedErrors = testCase['expectDispatchedErrors'] as List<Object?>?;
  if (expectedErrors != null) {
    expect(
      dispatchedErrors.map((error) => error.code).toList(),
      equals([
        for (final Object? error in expectedErrors)
          (error! as Map<Object?, Object?>)['code'],
      ]),
    );
    expect(
      dispatchedErrors.map((error) => error.surfaceId),
      everyElement(surface.id),
    );
  }

  final expected = (testCase['expectDispatched'] ?? testCase['expected'])
      as Map<String, Object?>?;
  if (expected != null) {
    expect(dispatched, isNotNull);
    expect(dispatched!.name, equals(expected['name']));
    if (expected.containsKey('context')) {
      expect(dispatched!.context, equals(expected['context'] ?? const {}));
    }
    if (expected.containsKey('userMessage')) {
      expect(dispatched!.userMessage, equals(expected['userMessage']));
    }
  }

  final expectDataModel = testCase['expectDataModel'] as Map<String, Object?>?;
  if (expectDataModel != null) {
    expect(surface.dataModel.get('/'), equals(expectDataModel));
  }
}
