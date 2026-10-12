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

/// Cases that cannot run yet, keyed by name, with the reason they are skipped.
const Map<String, String> _skipped = {
  'test_multi_catalog_function_call_catalog_id_override':
      'Requires embedded v1.0 common types.',
};

/// Runs the shared `conformance/core/multi_catalog.yaml` suite against
/// [SurfaceModel.resolveCatalog] and the [DataContext] a component renders
/// with.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/multi_catalog.yaml',
  );

  group('conformance core/multi_catalog.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      final name = testCase['name']! as String;
      test(name, skip: _skipped[name], () => _runCase(testCase));
    }
  });
}

void _runCase(Map<String, Object?> testCase) {
  final action = testCase['action']! as String;
  switch (action) {
    case 'select_catalog':
      _runSelectCatalogCase(testCase);
    default:
      throw StateError('Unsupported multi_catalog action: $action');
  }
}

/// Builds the surface a case describes and reports the catalog id its last
/// component or its function call selects.
///
/// Each catalog carries a function named after the case's function call, so
/// the catalog that runs the call is observable rather than inferred.
void _runSelectCatalogCase(Map<String, Object?> testCase) {
  final name = testCase['name']! as String;
  final args = testCase['args']! as Map<String, Object?>;
  final surfaceArgs = args['surface']! as Map<String, Object?>;
  final String surfaceId = surfaceArgs['id'] as String? ?? 'main_surface';
  final defaultId = surfaceArgs['defaultCatalogId'] as String?;
  final String surfaceVersion = (testCase['catalog']
          as Map<String, Object?>?)?['protocolVersion'] as String? ??
      'v1.0';
  final functionCall = args['functionCall'] as Map<String, Object?>?;
  final functionName = functionCall?['call'] as String?;
  final selections = <String>[];

  Catalog<ComponentApi, FunctionImplementation> catalogFor(
    String id,
    String version,
  ) =>
      Catalog<ComponentApi, FunctionImplementation>(
        id: id,
        components: const [],
        functions: [
          if (functionName != null)
            _RecordingFunction(functionName, id, selections),
        ],
        protocolVersion: A2uiProtocolVersion.parse(version),
      );

  final declared = args['catalogs'] as Map<String, Object?>?;
  final catalogs = <String, Catalog<ComponentApi, FunctionImplementation>>{
    if (declared != null)
      for (final MapEntry<String, Object?> entry in declared.entries)
        entry.key: catalogFor(
          entry.key,
          (entry.value as Map<String, Object?>?)?['protocolVersion']
                  as String? ??
              surfaceVersion,
        )
    else
      for (final Object? id
          in surfaceArgs['supportedCatalogIds'] as List<Object?>? ??
              [defaultId])
        id! as String: catalogFor(id as String, surfaceVersion),
  };

  void select() {
    final surface = SurfaceModel<ComponentApi>(
      surfaceId,
      defaultCatalog: defaultId == null ? null : catalogs[defaultId],
      availableCatalogs: catalogs.values,
      protocolVersion: surfaceVersion,
    );
    addTearDown(surface.dispose);

    final components = args['components'] as Map<String, Object?>?;
    if (components != null) {
      for (final MapEntry<String, Object?> entry in components.entries) {
        final properties = entry.value! as Map<String, Object?>;
        final model = ComponentModel(
          entry.key,
          properties['component']! as String,
          const {},
          catalog: properties['catalogId'] as String?,
        );
        selections.add(surface.resolveCatalog(model.catalog).id);
      }
    }
    if (functionCall != null) {
      // Wired as a component's context is: calls without a catalogId run in
      // the default catalog, and calls with one in the catalog they name.
      final context = DataContext(
        surface.dataModel,
        (name, args, context) =>
            surface.resolveCatalog(null).invoke(name, args, context),
        '/',
        protocolVersion: surface.protocolVersion,
        invokerForCatalog: (catalogId) =>
            surface.resolveCatalog(catalogId).invoke,
      );
      context.resolveSync({
        '@call': functionName,
        if (functionCall['catalogId'] != null)
          'catalogId': functionCall['catalogId'],
        'args': functionCall['args'] ?? const <String, Object?>{},
      });
    }
  }

  final expectError = testCase['expectError'] as Map<String, Object?>?;
  if (expectError != null) {
    expect(expectError['category'], 'CatalogError', reason: name);
    expect(
      select,
      throwsA(
        isA<A2uiCatalogError>().having(
          (e) => e.message,
          'message',
          expectError['message'],
        ),
      ),
      reason: name,
    );
    return;
  }

  select();
  expect(selections, isNotEmpty, reason: '$name: nothing was selected');
  expect(selections.last, testCase['expectSelected'], reason: name);
}

/// Records the id of the catalog it belongs to each time it runs.
class _RecordingFunction extends FunctionImplementation {
  final String catalogId;
  final List<String> calls;

  _RecordingFunction(String name, this.catalogId, this.calls)
      : super(name: name, argumentSchema: Schema.object());

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    calls.add(catalogId);
    return null;
  }
}
