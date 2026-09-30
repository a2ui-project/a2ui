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
/// [resolveCatalogs], with the capabilities lowered to v0.9 as `suites.dart`
/// describes.
void main() {
  const path = 'agent/catalog_resolution.yaml';
  group('conformance $path', () {
    final List<Map<String, Object?>> cases = loadSuite(path);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      final args = testCase['args']! as Map<String, Object?>;
      test(
        testCase['name']! as String,
        skip: args.containsKey('renderer_capabilities')
            ? null
            : 'resolveCatalogs requires renderer capabilities, as in the '
                  'blueprint, so a request without them cannot be written.',
        () {
          List<SchemaCatalog> resolve() => resolveCatalogs(
            [
              for (final Object? entry in args['catalogs']! as List<Object?>)
                catalogConfig(entry),
            ],
            lowerCapabilities(
              args['renderer_capabilities']! as Map<String, Object?>,
            ),
            acceptsInlineCatalogs:
                args['accepts_inline_catalogs'] as bool? ?? false,
          );

          if (testCase['expect_error'] case final Object error) {
            expect(resolve, throwsCategory(error));
            return;
          }
          final List<SchemaCatalog> active = resolve();
          final expected = testCase['expect']! as Map<String, Object?>;
          expect(
            active.map((c) => c.id),
            unorderedEquals(expected['active_catalog_ids']! as List<Object?>),
          );
          for (final Object? catalog
              in expected['catalogs'] as List<Object?>? ?? const []) {
            final assertion = catalog! as Map<String, Object?>;
            expectCatalog(
              active.singleWhere((c) => c.id == assertion['catalog_id']),
              assertion,
            );
          }
        },
      );
    }
  });
}
