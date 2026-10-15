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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

/// Runs the shared `conformance/agent/catalog_resolution.yaml` suite against
/// [resolveCatalogs], in each [SuiteVersion].
void main() {
  const path = 'agent/catalog_resolution.yaml';
  for (final SuiteVersion version in SuiteVersion.values) {
    group('conformance $path ${version.label}', () {
      final List<Map<String, Object?>> cases = loadSuite(path);
      test('suite is not empty', () => expect(cases, isNotEmpty));
      for (final testCase in cases) {
        test(
          testCase['name']! as String,
          () => version.run(() => _runCase(testCase, version)),
        );
      }
    });
  }
}

void _runCase(Map<String, Object?> testCase, SuiteVersion version) {
  final args = testCase['args']! as Map<String, Object?>;
  final capabilities = args['renderer_capabilities'] as Map<String, Object?>?;
  List<CatalogApi> resolve() => resolveCatalogs(
    [
      for (final Object? entry in args['catalogs']! as List<Object?>)
        version.catalogConfig(entry),
    ],
    capabilities == null ? null : version.capabilities(capabilities),
    acceptsInlineCatalogs: args['accepts_inline_catalogs'] as bool? ?? false,
  );

  if (testCase['expect_error'] case final Object error) {
    expectThrowsCategory(resolve, error);
    return;
  }
  final List<CatalogApi> active = resolve();
  final expected = testCase['expect']! as Map<String, Object?>;
  expect(
    active.map((c) => c.id),
    unorderedEquals(expected['active_catalog_ids']! as List<Object?>),
  );
  for (final Object? catalog
      in expected['catalogs'] as List<Object?>? ?? const []) {
    final assertion = catalog! as Map<String, Object?>;
    version.expectCatalog(
      active.singleWhere((c) => c.id == assertion['catalog_id']),
      assertion,
    );
  }
}
