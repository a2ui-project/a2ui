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

import 'conformance_harness.dart';

/// Runs the shared conformance suites that apply to the agent SDK.
///
/// Cases for unimplemented versions or stubbed behaviour are skipped with a
/// reason, so the suite doubles as the implementation checklist.
void main() {
  _runSuite('core/catalog.yaml');
  _runSuite('agent/catalog_provider.yaml');
  _runSuite('agent/catalog_transformer.yaml');
  _runSuite('agent/catalog_resolver.yaml');
  _runSuite('agent/inference_format.yaml');
  _runSuite('agent/parser.yaml');
  _runSuite('agent/streaming_parser.yaml');
  _runSuite('agent/request_processor.yaml');
}

void _runSuite(String suite) {
  final List<Map<String, Object?>> cases = loadConformanceSuite(suite);

  group('conformance $suite', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      final String? skipReason = _skipReason(testCase);
      test(
        testCase['name']! as String,
        () => _runCase(testCase),
        skip: skipReason,
      );
    }
  });
}

/// Why a case cannot run yet, or null when it can.
String? _skipReason(Map<String, Object?> testCase) {
  final String? version = caseVersion(testCase);
  if (version != null && version != '0.9') {
    return 'Targets protocol v$version; this SDK implements v0.9 only.';
  }

  final action = testCase['action']! as String;
  switch (action) {
    case 'prune':
      final Map<String, Object?> args =
          (testCase['args'] as Map<String, Object?>?) ?? const {};
      final Map<String, Object?> expect =
          (testCase['expect'] as Map<String, Object?>?) ?? const {};
      if (!args.containsKey('allowed_components') &&
          !args.containsKey('allowed_functions')) {
        return 'Message pruning is not part of the agent catalog transformers.';
      }
      if (!expect.containsKey('catalog_schema')) {
        return 'Only catalog schema pruning is modelled by this SDK.';
      }
      return null;
    case 'load_catalog':
      if (testCase.containsKey('modifiers')) {
        return 'Catalog schema modifiers are not implemented yet.';
      }
      return null;
    case 'select_catalog':
      return 'select_catalog is the legacy single-catalog helper; this SDK '
          'negotiates with resolveCatalogs.';
    case 'resolve_catalogs':
      return 'resolveCatalogs is not implemented yet.';
    case 'generate_prompt':
      return 'DirectJsonPromptGenerator.generate is not implemented yet.';
    case 'parse_full':
    case 'fix_payload':
    case 'has_parts':
      return 'DirectJsonParser is not implemented yet.';
    case 'process_chunk':
    case 'verify_cuttable_keys':
      return 'DirectJsonStreamProcessor is not implemented yet.';
    case 'process_request':
      return 'The agent turn is not implemented end to end yet.';
    default:
      return 'Action "$action" is not exercised by the agent SDK.';
  }
}

void _runCase(Map<String, Object?> testCase) {
  final action = testCase['action']! as String;
  switch (action) {
    case 'prune':
      _runPrune(testCase);
    case 'load_catalog':
      _runLoadCatalog(testCase);
    case 'resolve_catalogs':
      _runResolveCatalogs(testCase);
    default:
      fail('No agent harness for conformance action "$action".');
  }
}

void _runPrune(Map<String, Object?> testCase) {
  final Map<String, Object?> args =
      (testCase['args'] as Map<String, Object?>?) ?? const {};
  final expected = testCase['expect']! as Map<String, Object?>;

  final transformers = <CatalogTransformer<CatalogComponent, CatalogFunction>>[
    if (args['allowed_components'] != null)
      ComponentPruningTransformer(
        (args['allowed_components']! as List<Object?>).cast<String>(),
      ),
    if (args['allowed_functions'] != null)
      FunctionPruningTransformer(
        (args['allowed_functions']! as List<Object?>).cast<String>(),
      ),
  ];

  final CatalogConfig<CatalogComponent, CatalogFunction> config =
      SchemaCatalogConfig(
        Catalog.fromJson(_catalogSchemaOf(testCase)),
        transformers: transformers,
      );

  expect(
    config.transformedCatalog.catalogSchema,
    equals(expected['catalog_schema']),
    reason: testCase['name'] as String?,
  );
}

void _runLoadCatalog(Map<String, Object?> testCase) {
  final configs = testCase['catalog_configs']! as List<Object?>;
  final catalogs = <SchemaCatalog>[
    for (final Object? config in configs)
      FileSystemCatalogProvider(
        resolveConformancePath(
          (config! as Map<String, Object?>)['path']! as String,
        ),
      ).load(),
  ];

  final Map<String, Object?> expected =
      (testCase['expect'] as Map<String, Object?>?) ?? const {};

  if (expected['supported_catalog_ids'] != null) {
    expect(
      catalogs.map((c) => c.id).toList(),
      equals(expected['supported_catalog_ids']),
      reason: testCase['name'] as String?,
    );
  }
  if (expected['catalog_schema'] != null) {
    expect(
      catalogs.single.catalogSchema,
      equals(expected['catalog_schema']),
      reason: testCase['name'] as String?,
    );
  }
}

void _runResolveCatalogs(Map<String, Object?> testCase) {
  final args = testCase['args']! as Map<String, Object?>;
  final configs = args['catalogs']! as List<Object?>;
  final bool acceptsInline =
      (args['accepts_inline_catalogs'] as bool?) ?? false;

  // Capabilities are parsed inside the closure: a case may expect the
  // rejection to come from parsing them rather than from negotiation.
  List<Catalog<CatalogComponent, CatalogFunction>> resolve() => resolveCatalogs(
    <SchemaCatalogConfig>[
      for (final Object? entry in configs)
        _catalogConfigOf(entry! as Map<String, Object?>),
    ],
    A2uiRendererCapabilities.fromJson(
      args['renderer_capabilities']! as Map<String, Object?>,
    ),
    acceptsInlineCatalogs: acceptsInline,
  );

  final Object? expectError = testCase['expect_error'];
  if (expectError != null) {
    expect(
      resolve,
      throwsA(matchesConformanceError(expectError as Map<String, Object?>)),
      reason: testCase['name'] as String?,
    );
    return;
  }

  final List<Catalog<CatalogComponent, CatalogFunction>> active = resolve();

  final Object? expectedIds = testCase['expect_active_catalog_ids'];
  if (expectedIds != null) {
    expect(
      active.map((c) => c.id).toList(),
      equals(expectedIds),
      reason: testCase['name'] as String?,
    );
  }

  final expectedComponents =
      testCase['expect_components'] as Map<String, Object?>?;
  if (expectedComponents != null) {
    for (final MapEntry<String, Object?> entry in expectedComponents.entries) {
      final Catalog<CatalogComponent, CatalogFunction> catalog = active
          .firstWhere(
            (c) => c.id == entry.key,
            orElse: () => fail('Catalog "${entry.key}" was not negotiated.'),
          );
      expect(
        catalog.components.keys.toList()..sort(),
        equals(entry.value),
        reason: testCase['name'] as String?,
      );
    }
  }
}

/// Builds a registered catalog configuration from a `catalogs` entry.
SchemaCatalogConfig _catalogConfigOf(Map<String, Object?> entry) {
  final Object? schema = entry['catalog_schema'];
  final SchemaCatalog catalog = switch (schema) {
    final String path => FileSystemCatalogProvider(
      resolveConformancePath(path),
    ).load(),
    final Map<String, Object?> inline => InMemoryCatalogProvider(inline).load(),
    _ => fail('A catalogs entry needs an inline catalog_schema or a path.'),
  };

  return SchemaCatalogConfig(
    catalog,
    transformers: [
      if (entry['allowed_components'] != null)
        ComponentPruningTransformer(
          (entry['allowed_components']! as List<Object?>).cast<String>(),
        ),
      if (entry['allowed_functions'] != null)
        FunctionPruningTransformer(
          (entry['allowed_functions']! as List<Object?>).cast<String>(),
        ),
    ],
  );
}

/// The catalog document a case runs against, inline or loaded from a path.
Map<String, Object?> _catalogSchemaOf(Map<String, Object?> testCase) {
  final Map<String, Object?> catalog =
      (testCase['catalog'] as Map<String, Object?>?) ?? const {};
  final Object? schema = catalog['catalog_schema'];
  if (schema is Map<String, Object?>) return schema;
  if (schema is String) {
    return InMemoryCatalogProvider(loadConformanceJson(schema)).catalog;
  }
  return <String, Object?>{};
}
