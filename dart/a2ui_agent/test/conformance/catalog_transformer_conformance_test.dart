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

import 'package:test/test.dart';

import 'suites.dart';

const Map<String, Set<String>> _knownKeys = {
  'case:transform_catalog': {
    ...caseMetadataKeys,
    'args',
    'expect',
    'expect_error',
  },
  'args:transform_catalog': {'catalog', 'transformers'},
};

/// Runs the shared `conformance/agent/catalog_transformer.yaml` suite, in
/// each [SuiteVersion].
void main() {
  const path = 'agent/catalog_transformer.yaml';
  for (final SuiteVersion version in SuiteVersion.values) {
    group('conformance $path ${version.label}', () {
      final List<Map<String, Object?>> cases = loadSuite(path);
      test('suite is not empty', () => expect(cases, isNotEmpty));
      for (final testCase in cases) {
        test(testCase['name']! as String, () {
          switch (testCase['action']) {
            case 'transform_catalog':
              assertKnownKeys(
                testCase,
                _knownKeys['case:transform_catalog']!,
                'case:transform_catalog',
              );
            default:
              throw UnsupportedError('Unknown action ${testCase['action']}');
          }
          final args = testCase['args']! as Map<String, Object?>;
          assertKnownKeys(
            args,
            _knownKeys['args:transform_catalog']!,
            'args:transform_catalog',
          );
          version.expectCatalog(
            version.catalogConfig(args).transformedCatalog,
            testCase['expect']! as Map<String, Object?>,
          );
        });
      }
    });
  }
}
