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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import 'conformance/conformance_harness.dart';

void main() {
  final CatalogApi basic = Catalog.fromJson(
    jsonDecode(
      File(
        resolveConformancePath('../catalogs/basic/v1/catalog.json'),
      ).readAsStringSync(),
    ) as Map<String, Object?>,
  );
  const chatId = 'https://example.com/chat';
  final label = ComponentApi(
    name: 'Label',
    schema: Schema.object(properties: {'text': Schema.string()}),
  );

  group('Catalog.derive', () {
    test('keeps the named entries and adds new ones under the new id', () {
      final CatalogApi derived = basic.derive(
        catalogId: chatId,
        components: ['Text', 'Button'],
        addComponents: [label],
        functions: ['openUrl'],
      );

      expect(derived.id, chatId);
      expect(derived.protocolVersion, basic.protocolVersion);
      expect(derived.components.keys, ['Text', 'Button', 'Label']);
      expect(derived.components['Text'], same(basic.components['Text']));
      expect(derived.functions.keys, ['openUrl']);
      expect(derived.themeSchema, same(basic.themeSchema));
      final Map<String, Object?> out = derived.toJson();
      expect(out['catalogId'], chatId);
      expect((out['components']! as Map).keys, ['Text', 'Button', 'Label']);
    });

    test("drops the source's \$id, title, description and instructions", () {
      final Map<String, Object?> out = basic.derive(catalogId: chatId).toJson();

      expect(out[r'$schema'], basic.schemaDialect);
      expect(out.containsKey(r'$id'), isFalse);
      expect(out.containsKey('title'), isFalse);
      expect(out.containsKey('description'), isFalse);
      expect(out.containsKey('instructions'), isFalse);
    });

    test('takes the instructions it is given', () {
      final CatalogApi derived = basic.derive(
        catalogId: chatId,
        instructions: 'Be brief.',
      );

      expect(derived.instructions, 'Be brief.');
      expect(derived.toJson()['instructions'], 'Be brief.');
    });

    test('keeps every entry of a kind it names none of', () {
      final CatalogApi derived = basic.derive(catalogId: chatId);

      expect(derived.components.keys, basic.components.keys);
      expect(derived.functions.keys, basic.functions.keys);
    });

    test("replaces the source's entry with an added one of the same name", () {
      final text = ComponentApi(
        name: 'Text',
        schema: Schema.object(properties: {'text': Schema.string()}),
      );

      final CatalogApi derived = basic.derive(
        catalogId: chatId,
        components: ['Text', 'Image'],
        addComponents: [text],
      );

      expect(derived.components.keys, ['Text', 'Image']);
      expect(derived.components['Text'], same(text));
    });

    test('throws for a name the source has no entry of', () {
      expect(
        () => basic.derive(catalogId: chatId, components: ['Nope']),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            allOf(contains("has no component 'Nope'"), contains(chatId)),
          ),
        ),
      );
      expect(
        () => basic.derive(catalogId: chatId, functions: ['nope']),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains("has no function 'nope'"),
          ),
        ),
      );
    });

    test('drops definitions that only left-out entries referenced', () {
      final CatalogApi v09 = Catalog.fromJson(
        jsonDecode(
          File(
            resolveConformancePath(
              '../specification/v0_9_1/catalogs/basic/catalog.json',
            ),
          ).readAsStringSync(),
        ) as Map<String, Object?>,
        catalogId:
            'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      );
      expect(v09.definitions.keys, contains('CatalogComponentCommon'));

      final CatalogApi derived = v09.derive(catalogId: chatId, components: []);

      expect(
        derived.definitions.keys,
        isNot(contains('CatalogComponentCommon')),
      );
    });
  });
}
