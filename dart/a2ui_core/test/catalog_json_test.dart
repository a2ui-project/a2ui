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
import 'package:a2ui_core/src/core/contexts.dart' show ComponentContext;
import 'package:a2ui_core/src/rendering/binder.dart' show GenericBinder;
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
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

    test('parses and round-trips validationResult function returnType', () {
      final CatalogApi catalog = Catalog.fromJson({
        'catalogId': 'https://example.com/v1_validation_catalog',
        'protocolVersion': '1.0',
        'functions': {
          'checkEmail': {
            'type': 'object',
            'properties': {
              'call': {'const': 'checkEmail'},
              'args': {
                'type': 'object',
                'properties': {
                  'value': {'type': 'string'},
                },
                'required': ['value'],
              },
              'returnType': {'const': 'validationResult'},
            },
            'required': ['call', 'args'],
          },
          'checkInline': {
            'returnType': 'validationResult',
            'parameters': {
              'type': 'object',
              'properties': {
                'value': {'type': 'string'},
              },
            },
          },
        },
      });

      expect(
        catalog.functions['checkEmail']!.returnType,
        A2uiReturnType.validationResult,
      );
      expect(
        catalog.functions['checkInline']!.returnType,
        A2uiReturnType.validationResult,
      );

      final Map<String, Object?> rebuilt = catalog.catalogSchema;
      final CatalogApi reparsed = Catalog.fromJson(rebuilt);
      expect(
        reparsed.functions['checkEmail']!.returnType,
        A2uiReturnType.validationResult,
      );
      expect(
        reparsed.functions['checkInline']!.returnType,
        A2uiReturnType.validationResult,
      );
    });

    test(
      'rejects validationResult function returnType when effective '
      'protocolVersion is below 1.0',
      () {
        Map<String, Object?> docWithVersion(String? protocolVersion) => {
              'catalogId': 'https://example.com/pre_v1_validation_catalog',
              if (protocolVersion != null) 'protocolVersion': protocolVersion,
              'functions': {
                'checkEmail': {
                  'returnType': 'validationResult',
                  'parameters': {
                    'type': 'object',
                    'properties': {
                      'value': {'type': 'string'},
                    },
                  },
                },
              },
            };

        for (final String? badVersion in [null, '0.9', 'v0.9', '0.9.1']) {
          expect(
            () => Catalog.fromJson(docWithVersion(badVersion)),
            throwsA(
              isA<A2uiCatalogError>().having(
                (e) => e.message,
                'message',
                allOf(
                  contains('checkEmail'),
                  contains('validationResult'),
                ),
              ),
            ),
            reason: 'Catalog.fromJson with protocolVersion=$badVersion',
          );
          expect(
            () => Catalog<ComponentApi, FunctionApi>(
              id: 'https://example.com/pre_v1_validation_catalog',
              protocolVersion: badVersion,
              components: const [],
              functions: [
                FunctionApi(
                  name: 'checkEmail',
                  argumentSchema: S.object(),
                  returnType: A2uiReturnType.validationResult,
                ),
              ],
            ),
            throwsA(
              isA<A2uiCatalogError>().having(
                (e) => e.message,
                'message',
                allOf(
                  contains('checkEmail'),
                  contains('validationResult'),
                ),
              ),
            ),
            reason: 'Catalog(...) constructor with protocolVersion=$badVersion',
          );
        }

        for (final goodVersion in ['1.0', 'v1.0']) {
          expect(
            Catalog.fromJson(docWithVersion(goodVersion))
                .functions['checkEmail']!
                .returnType,
            A2uiReturnType.validationResult,
          );
          expect(
            Catalog<ComponentApi, FunctionApi>(
              id: 'https://example.com/v1_validation_catalog',
              protocolVersion: goodVersion,
              components: const [],
              functions: [
                FunctionApi(
                  name: 'checkEmail',
                  argumentSchema: S.object(),
                  returnType: A2uiReturnType.validationResult,
                ),
              ],
            ).functions['checkEmail']!.returnType,
            A2uiReturnType.validationResult,
          );
        }
      },
    );

    test(
      'GenericBinder evaluates checks on a JSON-loaded catalog referencing '
      'common_types.json#/\$defs/Checkable',
      () {
        final CatalogApi parsed = Catalog.fromJson(loadBasicCatalogJson());
        final rendererCatalog = Catalog<ComponentApi, FunctionImplementation>(
          id: parsed.id,
          components: parsed.components.values.toList(),
          functions: const [],
        );
        final surface = SurfaceModel<ComponentApi>(
          's-json',
          defaultCatalog: rendererCatalog,
        );
        addTearDown(surface.dispose);

        surface.dataModel.set('/isValidEmail', false);
        final model = ComponentModel('tf1', 'TextField', {
          'label': 'Email',
          'value': 'invalid@',
          'checks': [
            {
              'condition': {'path': '/isValidEmail'},
              'message': 'Enter a valid email address',
            },
          ],
        });
        surface.componentsModel.addComponent(model);

        final binder = GenericBinder(
          ComponentContext(surface, model),
          rendererCatalog.components['TextField']!.schema,
        );
        addTearDown(binder.dispose);

        expect(binder.resolvedProps.value['isValid'], isFalse);
        expect(binder.resolvedProps.value['validationErrors'], [
          'Enter a valid email address',
        ]);
        expect(binder.resolvedProps.value['validationResults'], [
          const ValidationResult(
            valid: false,
            message: 'Enter a valid email address',
            severity: 'error',
          ),
        ]);

        surface.dataModel.set('/isValidEmail', true);
        expect(binder.resolvedProps.value['isValid'], isTrue);
        expect(binder.resolvedProps.value['validationErrors'], isEmpty);
        expect(binder.resolvedProps.value['validationResults'], isEmpty);
      },
    );
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
      final functions = catalog.catalogSchema['functions']! as Map;
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
      for (final String? version in ['v0.9', 'v0.9.1', null]) {
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

    group('invoke resolves argument schema references', () {
      final context = DataContext(DataModel(), (_, __, ___) => null, '/');

      Catalog<ComponentApi, FunctionImplementation> catalogWith(String ref) =>
          Catalog<ComponentApi, FunctionImplementation>(
            id: 'c',
            components: const [],
            functions: [
              _EchoFunction(
                argumentSchema: Schema.fromMap({
                  'type': 'object',
                  'properties': {
                    'value': {r'$ref': ref},
                  },
                  'required': ['value'],
                }),
              ),
            ],
          );

      test('to the shared common types', () {
        final Catalog<ComponentApi, FunctionImplementation> catalog =
            catalogWith(r'common_types.json#/$defs/DynamicNumber');

        expect(catalog.invoke('echo', {'value': 3}, context), 3);
        expect(
          () => catalog.invoke('echo', {'value': 'abc'}, context),
          throwsA(isA<A2uiExpressionError>()),
        );
      });

      test('to definitions the catalog document bundles', () {
        final Catalog<ComponentApi, FunctionImplementation> catalog =
            catalogWith(r'#/$defs/DynamicNumber');

        expect(catalog.invoke('echo', {'value': 3}, context), 3);
        expect(
          () => catalog.invoke('echo', {'value': 'abc'}, context),
          throwsA(isA<A2uiExpressionError>()),
        );
      });
    });
  });

  group('Catalog code-defined', () {
    test('serializes catalogSchema with id and component envelopes', () {
      final Catalog<ComponentApi, FunctionApi> catalog = Catalog(
        id: 'https://example.com/custom-catalog',
        protocolVersion: 'v0.9',
        components: [
          ComponentApi(
            name: 'Button',
            schema: Schema.fromMap({
              'type': 'object',
              'properties': {
                'label': {'type': 'string'},
              },
              'required': ['label'],
            }),
          ),
        ],
      );

      final Map<String, Object?> schema = catalog.catalogSchema;
      expect(schema[r'$schema'], Catalog.jsonSchemaDialect);
      expect(schema['catalogId'], 'https://example.com/custom-catalog');
      expect(schema['protocolVersion'], 'v0.9');

      final comps = schema['components'] as Map<String, Object?>;
      expect(comps.containsKey('Button'), isTrue);

      final button = comps['Button'] as Map<String, Object?>;
      final props = button['properties'] as Map<String, Object?>;
      expect(props['id'], {r'$ref': r'#/$defs/ComponentId'});
      expect(props['component'], {'const': 'Button'});
      expect(props['label'], {'type': 'string'});

      expect(button['required'], ['id', 'label', 'component']);

      final defs = schema[r'$defs'] as Map<String, Object?>;
      expect(defs.containsKey('ComponentId'), isTrue);
      expect(defs.containsKey('anyComponent'), isTrue);
    });
  });
}

/// Returns its `value` argument, which its schema requires to be a string
/// unless another [argumentSchema] is given.
class _EchoFunction extends FunctionImplementation {
  _EchoFunction({Schema? argumentSchema})
      : super(
          name: 'echo',
          argumentSchema: argumentSchema ??
              Schema.object(
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
