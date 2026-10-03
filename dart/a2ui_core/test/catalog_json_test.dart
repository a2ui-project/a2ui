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

Map<String, Object?> loadBasicCatalogJson() => jsonDecode(
      File(resolveConformancePath(basicCatalogPath)).readAsStringSync(),
    ) as Map<String, Object?>;

void main() {
  group('Catalog.fromJson', () {
    test('parses the published basic catalog document', () {
      final CatalogApi catalog = Catalog.fromJson(loadBasicCatalogJson());

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
      final CatalogApi catalog = Catalog.fromJson(loadBasicCatalogJson());

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
  });

  group('Catalog generics', () {
    test('separates function signatures from function implementations', () {
      // Agents hold schema-only functions; renderers hold implementations.
      final CatalogApi agentCatalog = Catalog.fromJson(
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

  group('catalogSchema function call key', () {
    Map<String, Object?> functionSchema(String? protocolVersion) {
      final function = CapitalizeFunction();
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'c',
        protocolVersion: protocolVersion,
        components: const [],
        functions: [function],
      );
      final Map<dynamic, dynamic> functions =
          catalog.catalogSchema['functions']! as Map;
      return (functions[function.name]! as Map).cast<String, Object?>();
    }

    test('is @call from protocol 1.0', () {
      for (final version in ['1.0', 'v1.0', 'v1.1']) {
        final Map<String, Object?> schema = functionSchema(version);
        expect(
          (schema['properties']! as Map).keys,
          containsAll(<String>['@call', 'args']),
          reason: version,
        );
        expect(
          (schema['properties']! as Map).containsKey('call'),
          isFalse,
          reason: version,
        );
        expect(schema['required'], ['@call', 'args'], reason: version);
      }
    });

    test('is call before protocol 1.0 or without a version', () {
      for (final version in ['v0.9', 'v0.9.1', null]) {
        final Map<String, Object?> schema = functionSchema(version);
        expect(
          (schema['properties']! as Map).containsKey('call'),
          isTrue,
          reason: '$version',
        );
        expect(schema['required'], ['call', 'args'], reason: '$version');
      }
    });

    test('carries the protocolVersion a document declares', () {
      final CatalogApi parsed = Catalog.fromJson({
        'catalogId': 'c',
        'protocolVersion': '1.0',
        'components': <String, Object?>{},
      });
      expect(parsed.protocolVersion, '1.0');
      expect(parsed.catalogSchema['protocolVersion'], '1.0');
      expect(
        Catalog.fromJson({
          'catalogId': 'c',
          'components': <String, Object?>{},
        }, protocolVersion: 'v0.9')
            .protocolVersion,
        'v0.9',
      );
      expect(
        () => Catalog.fromJson({'catalogId': 'c', 'protocolVersion': 1}),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });
}
