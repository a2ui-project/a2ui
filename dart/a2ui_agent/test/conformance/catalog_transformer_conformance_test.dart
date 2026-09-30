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

import 'suites.dart';

/// Runs the shared `conformance/agent/catalog_transformer.yaml` suite.
///
/// A case's `protocol_version` is not checked, because an `a2ui_core` catalog
/// does not record the version its document declares.
/// Cases this SDK cannot run yet, with the reason.
const Map<String, String> _skipReasons = {
  'test_function_pruning_on_catalog_without_functions':
      'The catalog document declares no catalogId, which only a '
      'CatalogProvider can supply, and loading is not implemented.',
};

void main() {
  const path = 'agent/catalog_transformer.yaml';
  group('conformance $path', () {
    final List<Map<String, Object?>> cases = loadSuite(path);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      final name = testCase['name']! as String;
      test(name, skip: _skipReasons[name], () {
        final SchemaCatalog catalog = catalogConfig(
          testCase['args'],
        ).transformedCatalog;
        final expected = testCase['expect']! as Map<String, Object?>;
        if (expected['catalog_id'] case final String id) {
          expect(catalog.id, id);
        }
        if (expected['components'] case final List<Object?> names) {
          expect(catalog.components.keys, unorderedEquals(names));
        }
        if (expected['functions'] case final List<Object?> names) {
          expect(catalog.functions.keys, unorderedEquals(names));
        }
      });
    }
  });
}
