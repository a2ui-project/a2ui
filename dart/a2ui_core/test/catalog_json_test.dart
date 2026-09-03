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
import 'package:test/test.dart';

import 'conformance/conformance_harness.dart';

/// The published basic catalog, which agent-side tests are measured against.
const String basicCatalogPath =
    '../specification/v0_9_1/catalogs/basic/catalog.json';

const String basicCatalogId =
    'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

Map<String, Object?> loadBasicCatalogJson() =>
    jsonDecode(
          File(resolveConformancePath(basicCatalogPath)).readAsStringSync(),
        )
        as Map<String, Object?>;

void main() {
  group('Catalog.fromJson', () {
    test('parses the published basic catalog document', () {
      final SchemaCatalog catalog = Catalog.fromJson(loadBasicCatalogJson());

      expect(catalog.id, basicCatalogId);
      expect(
        catalog.components.keys,
        containsAll(<String>['Text', 'Card', 'Column', 'Button', 'TextField']),
      );
      expect(
        catalog.functions.keys,
        containsAll(<String>['required', 'email', 'formatNumber', 'openUrl']),
      );
      expect(catalog.themeSchema, isNotNull);
    });

    test('reads a function argument schema and return type', () {
      final SchemaCatalog catalog = Catalog.fromJson(loadBasicCatalogJson());

      final FunctionApi required = catalog.functions['required']!;
      expect(required.name, 'required');
      expect(required.returnType, A2uiReturnType.boolean);
      expect(
        (required.argumentSchema.value['required']! as List).cast<String>(),
        ['value'],
      );

      expect(
        catalog.functions['formatNumber']!.returnType,
        A2uiReturnType.string,
      );
    });

    test('parses the inline catalog form used by renderer capabilities', () {
      final SchemaCatalog catalog = Catalog.fromJson({
        'catalogId': 'inline',
        'components': {
          'Text': {'type': 'object'},
        },
        'functions': [
          {
            'name': 'greet',
            'description': 'Says hello.',
            'parameters': {'type': 'object'},
            'returnType': 'string',
          },
        ],
      });

      expect(catalog.id, 'inline');
      expect(catalog.components.keys, ['Text']);
      expect(catalog.functions['greet']!.returnType, A2uiReturnType.string);
    });

    test('defaults an undeclared function return type to any', () {
      final SchemaCatalog catalog = Catalog.fromJson({
        'catalogId': 'c',
        'functions': {
          'mystery': {'type': 'object', 'properties': <String, Object?>{}},
        },
      });

      expect(catalog.functions['mystery']!.returnType, A2uiReturnType.any);
    });

    test('rejects a document without a catalog id', () {
      expect(
        () => Catalog.fromJson({'components': <String, Object?>{}}),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => Catalog.fromJson({'catalogId': ''}),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects a catalog id that conflicts with the expected id', () {
      expect(
        () => Catalog.fromJson({
          'catalogId': 'actual',
        }, expectedCatalogId: 'expected'),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.catalogId,
            'catalogId',
            'actual',
          ),
        ),
      );
    });

    test('accepts a catalog id that matches the expected id', () {
      expect(
        Catalog.fromJson({'catalogId': 'same'}, expectedCatalogId: 'same').id,
        'same',
      );
    });

    test('ignores any protocol version the document declares', () {
      // Catalogs are version-agnostic: the document's `protocolVersion` is
      // not checked against the version this SDK implements.
      expect(
        Catalog.fromJson({'catalogId': 'c', 'protocolVersion': 'v1.0'}).id,
        'c',
      );
    });

    test('rejects malformed components and functions', () {
      expect(
        () => Catalog.fromJson({'catalogId': 'c', 'components': 'nope'}),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => Catalog.fromJson({'catalogId': 'c', 'functions': 'nope'}),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('Catalog.catalogSchema', () {
    test('inlines the document\'s own definitions into each schema', () {
      final SchemaCatalog catalog = Catalog.fromJson(loadBasicCatalogJson());
      final Object text = catalog.components['Text']!.schema.value;

      // `#/$defs/CatalogComponentCommon` is expanded in place, leaving no
      // pointer into the document behind ...
      expect(jsonEncode(text), isNot(contains(r'"$ref":"#/')));
      expect(jsonEncode(text), contains('weight'));
      // ... while references the catalog cannot reach are left for the
      // validator, rather than dropped as unconstrained.
      expect(
        jsonEncode(text),
        contains('common_types.json#/\$defs/DynamicString'),
      );
    });

    test('round trips the source document', () {
      final Map<String, Object?> source = loadBasicCatalogJson();
      final Map<String, Object?> rendered = Catalog.fromJson(
        source,
      ).catalogSchema;

      expect(rendered['catalogId'], source['catalogId']);
      expect(
        (rendered['components']! as Map).keys.toSet(),
        (source['components']! as Map).keys.toSet(),
      );
      expect(
        (rendered['functions']! as Map).keys.toSet(),
        (source['functions']! as Map).keys.toSet(),
      );
    });

    test('does not alias the source document', () {
      final Map<String, Object?> source = loadBasicCatalogJson();
      final Map<String, Object?> rendered = Catalog.fromJson(
        source,
      ).catalogSchema;

      (rendered['components']! as Map).remove('Text');
      expect((source['components']! as Map).containsKey('Text'), isTrue);
    });

    test('reflects a pruned catalog and narrows the anyComponent union', () {
      final SchemaCatalog catalog = Catalog.fromJson(loadBasicCatalogJson());
      final SchemaCatalog pruned = catalog.copyWith(
        components: [catalog.components['Text']!, catalog.components['Card']!],
      );

      final Map<String, Object?> rendered = pruned.catalogSchema;
      expect((rendered['components']! as Map).keys.toSet(), {'Text', 'Card'});

      final oneOf =
          ((rendered[r'$defs']! as Map)['anyComponent']! as Map)['oneOf']!
              as List;
      expect(oneOf.map((e) => (e! as Map)[r'$ref']).toSet(), {
        '#/components/Text',
        '#/components/Card',
      });
    });

    test('reflects pruned functions and narrows the anyFunction union', () {
      final SchemaCatalog catalog = Catalog.fromJson(loadBasicCatalogJson());
      final SchemaCatalog pruned = catalog.copyWith(
        functions: [catalog.functions['required']!],
      );

      final Map<String, Object?> rendered = pruned.catalogSchema;
      expect((rendered['functions']! as Map).keys.toSet(), {'required'});

      final oneOf =
          ((rendered[r'$defs']! as Map)['anyFunction']! as Map)['oneOf']!
              as List;
      expect(oneOf.map((e) => (e! as Map)[r'$ref']).toSet(), {
        '#/functions/required',
      });
    });

    test('synthesises a document for a code defined catalog', () {
      final Map<String, Object?> rendered = MinimalCatalog().catalogSchema;

      expect(rendered['catalogId'], MinimalCatalog().id);
      expect((rendered['components']! as Map).keys, contains('Text'));
    });
  });

  group('Catalog generics', () {
    test('separates function signatures from function implementations', () {
      // Agents hold schema-only functions; renderers hold implementations.
      final SchemaCatalog agentCatalog = Catalog.fromJson(
        loadBasicCatalogJson(),
      );
      expect(agentCatalog.functions.values, everyElement(isA<FunctionApi>()));
      expect(
        agentCatalog.functions.values,
        isNot(anyElement(isA<FunctionImplementation>())),
      );

      final Catalog<ComponentApi, FunctionImplementation> rendererCatalog =
          MinimalCatalog();
      expect(
        rendererCatalog.functions.values,
        everyElement(isA<FunctionImplementation>()),
      );
    });
  });
}
