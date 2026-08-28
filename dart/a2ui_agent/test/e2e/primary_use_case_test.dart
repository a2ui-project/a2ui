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

/// Marks assertions needing negotiation, prompting and response parsing.
const String pendingEndToEnd =
    'The agent turn is not implemented end to end yet.';

/// The agent turn from section 5 of
/// `blueprints/modules/a2ui_agent.blueprint.md`.
///
/// Inputs and expected outputs come from
/// `conformance/agent/request_processor.yaml`, so every SDK is measured
/// against the same data. The model is stubbed.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'agent/request_processor.yaml',
  );

  Map<String, Object?> conformanceCase(String name) => cases.firstWhere(
    (c) => c['name'] == name,
    orElse: () => throw StateError('No conformance case named $name'),
  );

  group('primary use case: one agent turn against the basic catalog', () {
    late Map<String, Object?> data;
    late Map<String, Object?> args;

    setUp(() {
      data = conformanceCase('test_primary_use_case_basic_catalog_login_form');
      args = data['args']! as Map<String, Object?>;
    });

    test('negotiates, prompts, and parses a full turn', () {
      // 1. Agent startup: register every catalog, narrowed to the components
      //    and functions this agent uses.
      final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
        catalogs: [
          CatalogConfig(
            basicCatalog(),
            transformers: [
              ComponentPruningTransformer(
                (args['allowed_components']! as List<Object?>).cast<String>(),
              ),
              FunctionPruningTransformer(
                (args['allowed_functions']! as List<Object?>).cast<String>(),
              ),
            ],
          ),
        ],
      );

      // 2. Request handling: negotiate against the renderer's capabilities.
      final capabilities = A2uiRendererCapabilities.fromJson(
        args['client_capabilities']! as Map<String, Object?>,
      );
      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          generator.createProcessor(capabilities);

      expect(
        processor.activeCatalogs.map((c) => c.id),
        (data['expect_active_catalog_ids']! as List<Object?>).cast<String>(),
      );

      // 3. Prompting: the snippet the agent prepends its own preamble to.
      final String prompt = processor.promptSnippet;
      for (final Object? fragment in data['expect_prompt_contains']! as List) {
        expect(prompt, contains(fragment! as String));
      }

      // 4. Inference: a canned response stands in for the model.
      final modelOutput = args['llm_response']! as String;

      // 5. Parsing and validation: what goes to the renderer.
      final List<ResponsePart> parts = processor.parseResponse(modelOutput);

      final expected = data['expect']! as List<Object?>;
      expect(parts, hasLength(expected.length));

      for (var i = 0; i < expected.length; i++) {
        final expectedPart = expected[i]! as Map<String, Object?>;
        final ResponsePart actual = parts[i];

        if (expectedPart.containsKey('a2ui')) {
          expect(actual, isA<A2uiPart>(), reason: 'part $i');
          final messages = expectedPart['a2ui']! as List<Object?>;
          expect(
            (actual as A2uiPart).a2ui.map((m) => m.toJson()).toList(),
            equals(messages),
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
    }, skip: pendingEndToEnd);

    test('delivers a surface the renderer can render', () {
      // The payload must reconstruct into live surface state, which is what
      // the renderer does with it.
      final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
        catalogs: [CatalogConfig(basicCatalog())],
      );
      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          generator.createProcessor(
            A2uiRendererCapabilities.fromJson(
              args['client_capabilities']! as Map<String, Object?>,
            ),
          );

      final List<A2uiMessage> messages = processor
          .parseResponse(args['llm_response']! as String)
          .whereType<A2uiPart>()
          .expand((part) => part.a2ui)
          .toList();

      expect(messages.first, isA<CreateSurfaceMessage>());
      expect(
        (messages.first as CreateSurfaceMessage).catalogId,
        basicCatalogId,
      );
      expect(messages.whereType<UpdateComponentsMessage>(), isNotEmpty);
      expect(messages.whereType<UpdateDataModelMessage>(), isNotEmpty);
    }, skip: pendingEndToEnd);
  });

  group('primary use case: rejected turns', () {
    test('rejects a payload declaring an unsupported protocol version', () {
      final Map<String, Object?> data = conformanceCase(
        'test_primary_use_case_rejects_unsupported_version',
      );
      final args = data['args']! as Map<String, Object?>;

      final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
        catalogs: [CatalogConfig(basicCatalog())],
      );
      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          generator.createProcessor(
            A2uiRendererCapabilities.fromJson(
              args['client_capabilities']! as Map<String, Object?>,
            ),
          );

      expect(
        () => processor.parseResponse(args['llm_response']! as String),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingEndToEnd);

    test('rejects a payload whose messages omit the version', () {
      final Map<String, Object?> data = conformanceCase(
        'test_primary_use_case_rejects_missing_version',
      );
      final args = data['args']! as Map<String, Object?>;

      final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
        catalogs: [CatalogConfig(basicCatalog())],
      );
      final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
          generator.createProcessor(
            A2uiRendererCapabilities.fromJson(
              args['client_capabilities']! as Map<String, Object?>,
            ),
          );

      expect(
        () => processor.parseResponse(args['llm_response']! as String),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingEndToEnd);

    test('rejects a renderer that supports no registered catalog', () {
      final Map<String, Object?> data = conformanceCase(
        'test_primary_use_case_rejects_unknown_catalog',
      );
      final args = data['args']! as Map<String, Object?>;

      final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
        catalogs: [CatalogConfig(basicCatalog())],
      );

      expect(
        () => generator.createProcessor(
          A2uiRendererCapabilities.fromJson(
            args['client_capabilities']! as Map<String, Object?>,
          ),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    }, skip: pendingEndToEnd);
  });

  group('primary use case data', () {
    test('the conformance suite carries every case this test drives', () {
      expect(
        cases.map((c) => c['name']),
        containsAll(<String>[
          'test_primary_use_case_basic_catalog_login_form',
          'test_primary_use_case_rejects_unsupported_version',
          'test_primary_use_case_rejects_missing_version',
          'test_primary_use_case_rejects_unknown_catalog',
        ]),
      );
    });

    test('the turn is expressed against the published basic catalog', () {
      final Map<String, Object?> data = conformanceCase(
        'test_primary_use_case_basic_catalog_login_form',
      );
      final catalog = data['catalog']! as Map<String, Object?>;

      expect(catalog['version'], '0.9');
      expect(catalog['catalog_schema'], basicCatalogPath);
    });
  });
}
