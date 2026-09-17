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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../test_infra/golden_texts.dart';
import '../test_infra/mock_assets.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(setUpMockPackageAssets);

  final testCatalog = Catalog(
    [BasicCatalogItems.text],
    catalogId: 'test_catalog',
    systemPromptFragments: [
      BasicCatalogItems.basicCatalogRules,
      PromptFragments.acknowledgeUser(),
      PromptFragments.requireAtLeastOneSubmitElement(
        prefix: PromptBuilder.defaultImportancePrefix,
      ),
    ],
  );

  group('Chat prompt', () {
    test(
      'is equivalent to custom prompt with create only operations',
      () async {
        final systemPromptFragments = [
          'You are a chat assistant.',
          'You sometimes tell jokes to the user',
        ];
        final PromptBuilder chatBuilder = PromptBuilder.chat(
          catalog: testCatalog,
          systemPromptFragments: systemPromptFragments,
        );
        final PromptBuilder customBuilder = PromptBuilder.custom(
          catalog: testCatalog,
          allowedOperations: SurfaceOperations.createOnly(dataModel: false),
          systemPromptFragments: systemPromptFragments,
        );
        expect(chatBuilder.systemPrompt(), customBuilder.systemPrompt());
      },
    );
  });

  group('Custom prompt', () {
    final systemPromptFragments = <String>[
      'You are a helpful assistant who chats with a user.',
      PromptFragments.acknowledgeUser(),
      PromptFragments.requireAtLeastOneSubmitElement(
        prefix: PromptBuilder.defaultImportancePrefix,
      ),
    ];

    final Map<String, SurfaceOperations> operationsUnderTheTest = {};
    for (final dataModel in [false, true]) {
      operationsUnderTheTest['create_only_with_dataModel_$dataModel'] =
          SurfaceOperations.createOnly(dataModel: dataModel);
      operationsUnderTheTest['update_only_with_dataModel_$dataModel'] =
          SurfaceOperations.updateOnly(dataModel: dataModel);
      operationsUnderTheTest['create_and_update_with_dataModel_$dataModel'] =
          SurfaceOperations.createAndUpdate(dataModel: dataModel);
      operationsUnderTheTest['all_operations_with_dataModel_$dataModel'] =
          SurfaceOperations.all(dataModel: dataModel);
    }

    for (MapEntry<String, SurfaceOperations> b
        in operationsUnderTheTest.entries) {
      test(b.key, () async {
        final SurfaceOperations operations = b.value;

        final String prompt = PromptBuilder.custom(
          catalog: testCatalog,
          allowedOperations: operations,
          systemPromptFragments: systemPromptFragments,
        ).systemPromptJoined();

        for (final fragment in systemPromptFragments) {
          expect(prompt, contains(fragment));
        }

        for (final ProtocolMessages message in ProtocolMessages.values) {
          expect(prompt, contains(message.name));
        }

        final allowedMessages = <ProtocolMessages>{};

        if (operations.create) {
          allowedMessages.addAll([
            ProtocolMessages.createSurface,
            ProtocolMessages.updateComponents,
          ]);
        }
        if (operations.update) {
          allowedMessages.add(ProtocolMessages.updateComponents);
        }
        if (operations.delete) {
          allowedMessages.add(ProtocolMessages.deleteSurface);
        }
        if (operations.dataModel) {
          allowedMessages.add(ProtocolMessages.updateDataModel);
        }

        for (final ProtocolMessages message in ProtocolMessages.values) {
          if (allowedMessages.contains(message)) {
            expect(prompt, contains(message.name), reason: b.key);
          } else {
            // TODO: remove this check when examples will stop containing
            // not supported operations.
            if (!b.key.contains('_with_dataModel_false') &&
                !b.key.contains('only') &&
                !b.key.contains('create_and_update')) {
              expect(prompt, isNot(contains(message.name)), reason: b.key);
            }
          }
        }

        if (allowedMessages.contains(ProtocolMessages.createSurface)) {
          expect(prompt, contains('unique `surfaceId`'));
        }

        if (allowedMessages.contains(ProtocolMessages.updateComponents)) {
          expect(prompt, contains('root'));
        }

        verifyGoldenText(prompt, '${b.key}.txt');
      });
    }
  });

  group('Prompt with functions', () {
    test('includes functions when catalog has functions', () async {
      final catalogWithFunctions = Catalog(
        [BasicCatalogItems.text],
        functions: [BasicFunctions.pluralizeFunction],
        catalogId: 'test_catalog',
      );

      final String prompt = PromptBuilder.chat(
        catalog: catalogWithFunctions,
      ).systemPromptJoined();

      expect(prompt, contains('pluralize'));
      expect(
        prompt,
        contains(
          'Returns a localized string based on the Common Locale Data '
          'Repository',
        ),
      );
    });
  });

  group('Prompt with custom components', () {
    test('includes custom component schema in prompt', () async {
      final customItem = CatalogItem(
        name: 'CustomCard',
        dataSchema: S.object(
          properties: {
            'title': A2uiSchemas.stringReference(),
            'elevation': S.number(description: 'Card elevation.'),
          },
          required: ['title'],
        ),
        widgetBuilder: (ctx) => const SizedBox(), // Dummy builder
      );

      final customCatalog = Catalog([customItem], catalogId: 'custom_catalog');

      final String prompt = PromptBuilder.chat(
        catalog: customCatalog,
      ).systemPromptJoined();

      expect(prompt, contains('CustomCard'));
      expect(prompt, contains('Card elevation.'));
      expect(prompt, contains('"title"'));
    });
  });

  group('Catalog ID', () {
    test('is surfaced in system prompt when provided', () async {
      final catalog = Catalog([
        BasicCatalogItems.text,
      ], catalogId: 'my_custom_catalog');
      final PromptBuilder builder = PromptBuilder.chat(catalog: catalog);
      final String prompt = builder.systemPromptJoined();
      expect(prompt, contains('The active catalog ID is: "my_custom_catalog"'));
    });

    test('is not surfaced in system prompt when not provided', () async {
      final catalog = Catalog([BasicCatalogItems.text]);
      final PromptBuilder builder = PromptBuilder.chat(catalog: catalog);
      final String prompt = builder.systemPromptJoined();
      expect(prompt, isNot(contains('The active catalog ID is:')));
    });
  });
}
