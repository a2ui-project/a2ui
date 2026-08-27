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

import '../conformance/conformance_harness.dart';
import '../test_catalogs.dart';
import 'minimal_snippet.dart';

/// Marks assertions needing negotiation, prompting and response parsing.
const String pendingSnippet =
    'The blueprint snippet cannot run end to end yet.';

/// Exercises [userSnippet], the "Code Example" section of
/// `blueprints/modules/a2ui_agent.blueprint.md`.
///
/// Its inputs and expected parse come from
/// `conformance/agent/request_processor.yaml`, the data every SDK is measured
/// against.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'agent/request_processor.yaml',
  );
  final Map<String, Object?> data = cases.firstWhere(
    (c) => c['name'] == 'test_primary_use_case_basic_catalog_login_form',
    orElse: () => throw StateError('No primary use case in the suite'),
  );
  final args = data['args']! as Map<String, Object?>;
  final llmResponse = args['llm_response']! as String;

  /// Runs the snippet with a stubbed model, recording the prompt it was given.
  UserSnippetResult run({
    String? response,
    List<String>? supportedCatalogIds,
    List<String>? promptsSeen,
  }) => userSnippet(
    rendererCapabilities: A2uiRendererCapabilities.forCatalogIds(
      supportedCatalogIds ?? [basicCatalogId],
    ),
    callLlm: (prompt) {
      promptsSeen?.add(prompt);
      return response ?? llmResponse;
    },
  );

  group('blueprint code example', () {
    test('runs the five steps of the example end to end', () {
      final promptsSeen = <String>[];
      final UserSnippetResult result = run(promptsSeen: promptsSeen);

      // Step 2: the renderer declared the basic catalog, so it is
      // negotiated.
      expect(result.processor.activeCatalogs.map((c) => c.id), <String>[
        basicCatalogId,
      ]);

      // Step 3: the model is called once, with the rendered snippet.
      expect(promptsSeen, [result.promptSnippet]);
      for (final Object? fragment in data['expect_prompt_contains']! as List) {
        expect(result.promptSnippet, contains(fragment! as String));
      }
      expect(result.llmOutput, llmResponse);

      // Step 4: parts come back in the order the model emitted them.
      final expected = data['expect']! as List<Object?>;
      expect(result.responseParts, hasLength(expected.length));
      for (var i = 0; i < expected.length; i++) {
        final expectedPart = expected[i]! as Map<String, Object?>;
        final ResponsePart actual = result.responseParts[i];
        if (expectedPart.containsKey('a2ui')) {
          expect(actual, isA<A2uiPart>(), reason: 'part $i');
          expect(
            (actual as A2uiPart).a2ui.map((m) => m.toJson()).toList(),
            equals(expectedPart['a2ui']),
            reason: 'part $i',
          );
        } else {
          expect(actual, isA<TextPart>(), reason: 'part $i');
          expect(
            (actual as TextPart).text,
            expectedPart['text'],
            reason: 'part $i',
          );
        }
      }

      // Step 5: the renderer gets one flat, ordered payload.
      expect(result.a2uiPayload.first, isA<CreateSurfaceMessage>());
      expect(
        (result.a2uiPayload.first as CreateSurfaceMessage).catalogId,
        basicCatalogId,
      );
      expect(
        result.a2uiPayload.whereType<UpdateComponentsMessage>(),
        isNotEmpty,
      );
      expect(
        result.a2uiPayload.whereType<UpdateDataModelMessage>(),
        isNotEmpty,
      );
    }, skip: pendingSnippet);

    test('rejects a renderer that does not support the basic catalog', () {
      expect(
        () => run(supportedCatalogIds: ['https://example.com/unknown.json']),
        throwsA(isA<A2uiCatalogError>()),
      );
    }, skip: pendingSnippet);

    test('rejects a model payload declaring an unsupported version', () {
      final Map<String, Object?> rejected = cases.firstWhere(
        (c) => c['name'] == 'test_primary_use_case_rejects_unsupported_version',
      );
      expect(
        () => run(
          response:
              (rejected['args']! as Map<String, Object?>)['llm_response']!
                  as String,
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingSnippet);
  });

  group('blueprint code example inputs', () {
    test('the agent registers the catalog the example loads', () {
      // Step 1 stands on its own: the generator advertises its catalog
      // before anything is negotiated.
      final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
        catalogs: [CatalogConfig(basicCatalog())],
      );
      expect(generator.agentCapabilities['supportedCatalogIds'], <String>[
        basicCatalogId,
      ]);
      expect(generator.agentCapabilities['a2uiVersions'], <String>['v0.9']);
    });

    test('the example runs against the published basic catalog', () {
      final SchemaCatalog catalog = basicCatalog();
      expect(catalog.id, basicCatalogId);
      expect(catalog.protocolVersion, A2uiProtocolVersion.v0_9);
      expect(
        catalog.components.keys,
        containsAll(<String>['Card', 'Column', 'Text', 'TextField', 'Button']),
      );
    });
  });
}
