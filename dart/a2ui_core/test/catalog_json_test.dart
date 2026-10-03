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
  group('Catalog hygiene', () {
    ComponentApi component(String name) =>
        ComponentApi(name: name, schema: Schema.object());

    test('rejects two components with one name', () {
      expect(
        () => CatalogApi(
          id: 'c',
          components: [component('Text'), component('Text')],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects two functions with one name', () {
      final fn = FunctionApi(name: 'now', argumentSchema: Schema.object());
      expect(
        () => CatalogApi(id: 'c', components: const [], functions: [fn, fn]),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects the reserved component name Surface', () {
      expect(
        () => CatalogApi(id: 'c', components: [component('Surface')]),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => Catalog.fromJson({
          'catalogId': 'c',
          'components': {
            'Surface': {'type': 'object'},
          },
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects a custom function whose name starts with @', () {
      expect(
        () => Catalog.fromJson({
          'catalogId': 'c',
          'components': <String, Object?>{},
          'functions': [
            {'name': '@custom', 'returnType': 'string'},
          ],
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('reads instructions and protocolVersion from a document', () {
      final CatalogApi catalog = Catalog.fromJson({
        'catalogId': 'c',
        'protocolVersion': 'v1.0',
        'instructions': 'Prefer cards.',
        'components': <String, Object?>{},
      });

      expect(catalog.instructions, 'Prefer cards.');
      expect(catalog.protocolVersion, 'v1.0');
      expect(catalog.catalogSchema['instructions'], 'Prefer cards.');
      expect(catalog.copyWith().instructions, 'Prefer cards.');
      expect(catalog.copyWith().protocolVersion, 'v1.0');
    });

    test('requires args in catalogSchema only for required parameters', () {
      final CatalogApi catalog = CatalogApi(
        id: 'c',
        components: const [],
        functions: [
          FunctionApi(name: 'now', argumentSchema: Schema.object()),
          FunctionApi(
            name: 'upper',
            argumentSchema: Schema.object(
              properties: {'value': Schema.string()},
              required: ['value'],
            ),
          ),
        ],
      );
      final functions =
          catalog.catalogSchema['functions']! as Map<String, Object?>;

      expect((functions['now']! as Map)['required'], ['call']);
      expect((functions['upper']! as Map)['required'], ['call', 'args']);
    });

    test('invoke checks arguments against the function schema', () {
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'c',
        components: const [],
        functions: [_EchoFunction()],
      );
      final context = DataContext(DataModel(), (_, __, ___) => null, '/');

      expect(catalog.invoke('echo', {'value': 'hi'}, context), 'hi');
      expect(
        () => catalog.invoke('echo', {'value': 3}, context),
        throwsA(isA<A2uiExpressionError>()),
      );
      expect(
        () => catalog.invoke('echo', <String, dynamic>{}, context),
        throwsA(isA<A2uiExpressionError>()),
      );
      // A null argument is unresolved data, which the function handles.
      expect(catalog.invoke('echo', {'value': null}, context), isNull);
    });
  });
}

/// Returns its `value` argument, which its schema requires to be a string.
class _EchoFunction extends FunctionImplementation {
  _EchoFunction()
      : super(
          name: 'echo',
          argumentSchema: Schema.object(
            properties: {'value': Schema.string()},
            required: ['value'],
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      args['value'];
}
