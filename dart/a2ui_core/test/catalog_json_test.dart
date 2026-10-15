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
import 'package:a2ui_core/src/primitives/reference_schema.dart'
    show ReferenceSchemaReader;
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
import 'package:test/test.dart';

import 'conformance/conformance_harness.dart';
import 'support/test_catalog.dart';

/// The published basic catalog, which agent-side tests are measured against.
const String basicCatalogPath =
    '../specification/v0_9_1/catalogs/basic/catalog.json';

const String basicCatalogId =
    'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

Map<String, Object?> loadBasicCatalogJson() => jsonDecode(
      File(resolveConformancePath(basicCatalogPath)).readAsStringSync(),
    ) as Map<String, Object?>;

/// The published v1.0 basic catalog, which declares `protocolVersion: "1.0"`.
const String basicCatalogV1Path = '../catalogs/basic/v1/catalog.json';

Map<String, Object?> loadBasicCatalogV1Json() => jsonDecode(
      File(resolveConformancePath(basicCatalogV1Path)).readAsStringSync(),
    ) as Map<String, Object?>;

void main() {
  group('allOf property precedence', () {
    test('a component property overrides mixin and local definitions', () {
      final CatalogApi catalog = Catalog.fromJson({
        'catalogId': 'https://example.com/precedence',
        'protocolVersion': '1.0',
        r'$defs': {
          'Base': {
            'type': 'object',
            'properties': {
              'label': {'type': 'number'},
              'size': {'type': 'number'},
            },
          },
        },
        'components': {
          'Toggle': {
            'type': 'object',
            'properties': {
              'size': {
                'type': 'string',
                'enum': ['s', 'm'],
              },
            },
            'allOf': [
              {
                'type': 'object',
                'properties': {
                  'component': {'const': 'Toggle'},
                  'checks': {
                    'type': 'string',
                    'enum': ['strict'],
                  },
                  'label': {'type': 'string'},
                  'size': {'type': 'boolean'},
                },
                'required': ['component'],
              },
              {r'$ref': r'#/$defs/Base'},
              {r'$ref': r'common_types.json#/$defs/Checkable'},
            ],
          },
        },
      });

      final properties = catalog
          .resolvedComponentSchema('Toggle')!
          .value['properties']! as Map<String, Object?>;
      expect(properties['checks'], {
        'type': 'string',
        'enum': ['strict'],
      });
      expect(properties['label'], {'type': 'string'});
      expect(properties['size'], {
        'type': 'string',
        'enum': ['s', 'm'],
      });

      final validation =
          catalog.validationSchema['components']! as Map<String, Object?>;
      final toggle = (validation['Toggle']!
          as Map<String, Object?>)['properties']! as Map<String, Object?>;
      expect(toggle['checks'], properties['checks']);
      expect(toggle['label'], properties['label']);
      expect(toggle['size'], properties['size']);
    });
  });

  group('Catalog.commonTypesSchema', () {
    Map<String, Object?> defsOf(CatalogApi catalog) =>
        (catalog.commonTypesSchema[r'$defs']! as Map).cast<String, Object?>();

    /// The `CheckRule` schema that `common_types.json#/$defs/Checkable`
    /// leads to when read against [catalog]'s documents, the way
    /// `Catalog.refMap` and `GenericBinder` read it.
    Map<String, Object?> checkRuleOf(CatalogApi catalog) {
      final reader = ReferenceSchemaReader(
        <String, Object?>{},
        document: catalog.validationSchema,
        commonTypes: catalog.commonTypesSchema,
      );
      final List<Map<String, Object?>> checkable = reader.schemas(
        <String, Object?>{r'$ref': r'common_types.json#/$defs/Checkable'},
      );
      final List<Map<String, Object?>> checks = reader.schemas(
        reader.properties(checkable)['checks'],
      );
      expect(reader.isCheckable(checks), isTrue);
      return reader.schemas(reader.items(checks)).firstWhere(
            (Map<String, Object?> schema) => schema.containsKey('required'),
          );
    }

    test('is the v0.9 document for a catalog declaring no version', () {
      final CatalogApi catalog = Catalog.fromJson(loadBasicCatalogJson());

      expect(catalog.protocolVersion, isNull);
      expect(
        catalog.commonTypesSchema[r'$id'],
        'https://a2ui.org/specification/v0_9/common_types.json',
      );
      expect(defsOf(catalog), isNot(contains('Child')));
      expect(checkRuleOf(catalog)['required'], ['condition', 'message']);
    });

    test('is the v1.0 document for the published v1.0 basic catalog', () {
      final CatalogApi catalog = Catalog.fromJson(loadBasicCatalogV1Json());

      expect(catalog.protocolVersion, A2uiProtocolVersion.v1_0);
      expect(
        catalog.commonTypesSchema[r'$id'],
        'https://a2ui.org/specification/v1_0/common_types.json',
      );
      expect(defsOf(catalog), contains('Child'));
      final Map<String, Object?> rule = checkRuleOf(catalog);
      expect(rule['required'], ['condition']);
      expect(
        ((rule['properties']! as Map)['condition'] as Map)['oneOf'],
        hasLength(2),
      );
    });

    test('is decoded once per catalog', () {
      final CatalogApi catalog = Catalog.fromJson(loadBasicCatalogV1Json());
      expect(
        identical(catalog.commonTypesSchema, catalog.commonTypesSchema),
        isTrue,
      );
    });
  });

  group('Catalog.fromJson', () {
    test('reads protocolVersion as a semantic version', () {
      for (final spelling in ['1.0', 'v1.0', '1.0.0', '1.0.0-rc.1']) {
        final CatalogApi catalog = Catalog.fromJson({
          'catalogId': 'versioned',
          'protocolVersion': spelling,
          'components': <String, Object?>{},
        });
        expect(
          catalog.protocolVersion,
          A2uiProtocolVersion.v1_0,
          reason: spelling,
        );
      }
      expect(
        Catalog.fromJson({
          'catalogId': 'versioned',
          'protocolVersion': 'v0.9.1',
          'components': <String, Object?>{},
        }).protocolVersion,
        A2uiProtocolVersion.v0_9_1,
      );
    });

    test('rejects a protocolVersion this SDK does not implement', () {
      for (final Object spelling in ['2.0', '0.8', 'latest', 1.0]) {
        expect(
          () => Catalog.fromJson({
            'catalogId': 'versioned',
            'protocolVersion': spelling,
            'components': <String, Object?>{},
          }),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.catalogId,
              'catalogId',
              'versioned',
            ),
          ),
          reason: '$spelling',
        );
      }
    });

    test('writes protocolVersion back as the bare semantic version', () {
      final CatalogApi catalog = Catalog.fromJson({
        'catalogId': 'versioned',
        'protocolVersion': 'v1.0',
        'components': <String, Object?>{},
      });
      expect(catalog.validationSchema['protocolVersion'], '1.0');
      expect(
        Catalog.fromJson(catalog.validationSchema).protocolVersion,
        A2uiProtocolVersion.v1_0,
      );
    });

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

      final Map<String, Object?> rebuilt = catalog.validationSchema;
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
        'protocolVersion is below 1.0', () {
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
              allOf(contains('checkEmail'), contains('validationResult')),
            ),
          ),
          reason: 'Catalog.fromJson with protocolVersion=$badVersion',
        );
        expect(
          () => Catalog<ComponentApi, FunctionApi>(
            id: 'https://example.com/pre_v1_validation_catalog',
            protocolVersion: badVersion == null
                ? null
                : A2uiProtocolVersion.tryParseSemVer(badVersion),
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
              allOf(contains('checkEmail'), contains('validationResult')),
            ),
          ),
          reason: 'Catalog(...) constructor with protocolVersion=$badVersion',
        );
      }

      for (final goodVersion in ['1.0', 'v1.0']) {
        expect(
          Catalog.fromJson(
            docWithVersion(goodVersion),
          ).functions['checkEmail']!.returnType,
          A2uiReturnType.validationResult,
        );
        expect(
          Catalog<ComponentApi, FunctionApi>(
            id: 'https://example.com/v1_validation_catalog',
            protocolVersion: A2uiProtocolVersion.tryParseSemVer(goodVersion),
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
    });

    test(
        'GenericBinder evaluates checks on a JSON-loaded catalog referencing '
        'common_types.json#/\$defs/Checkable', () {
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
    });
  });

  group('Catalog generics', () {
    test('separates function signatures from function implementations', () {
      // Agents hold schema-only functions; renderers hold implementations.
      final CatalogApi agentCatalog = Catalog.fromJson(loadBasicCatalogJson());
      expect(agentCatalog.functions.values, everyElement(isA<FunctionApi>()));
      expect(
        agentCatalog.functions.values,
        isNot(anyElement(isA<FunctionImplementation>())),
      );

      final Catalog<ComponentApi, FunctionImplementation> rendererCatalog =
          TestCatalog();
      expect(
        rendererCatalog.functions.values,
        everyElement(isA<FunctionImplementation>()),
      );
    });
  });

  group('validationSchema function call key', () {
    Map<String, Object?> functionSchema(A2uiProtocolVersion? protocolVersion) {
      final function = CapitalizeFunction();
      final catalog = Catalog<ComponentApi, FunctionImplementation>(
        id: 'c',
        protocolVersion: protocolVersion,
        components: const [],
        functions: [function],
      );
      final functions = catalog.validationSchema['functions']! as Map;
      return (functions[function.name]! as Map).cast<String, Object?>();
    }

    test('is @call from protocol 1.0', () {
      final Map<String, Object?> schema = functionSchema(
        A2uiProtocolVersion.v1_0,
      );
      expect(
        (schema['properties']! as Map).keys,
        containsAll(<String>['@call', 'args']),
      );
      expect((schema['properties']! as Map).containsKey('call'), isFalse);
      expect(schema['required'], ['@call', 'args']);
    });

    test('localizes full-URI common_types refs in function args', () {
      final fn = FunctionApi(
        name: 'customFn',
        description: 'Custom function with full URI common_types ref',
        returnType: A2uiReturnType.string,
        argumentSchema: Schema.fromMap({
          'type': 'object',
          'properties': {
            'label': {
              r'$ref':
                  r'https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicString',
            },
          },
          'required': ['label'],
        }),
      );
      final catalog = Catalog<ComponentApi, FunctionApi>(
        id: 'custom-cat',
        protocolVersion: A2uiProtocolVersion.v0_9,
        components: const [],
        functions: [fn],
      );
      final Map<String, Object?> schema = catalog.catalogSchema;
      final functions = schema['functions']! as Map<String, Object?>;
      final fnSchema = functions['customFn']! as Map<String, Object?>;
      expect(
        fnSchema['description'],
        'Custom function with full URI common_types ref',
      );
      final args =
          (fnSchema['properties']! as Map<String, Object?>)['args']! as Map;
      final props = args['properties']! as Map;
      expect(
        (props['label']! as Map)[r'$ref'],
        r'#/$defs/DynamicString',
      );
      expect(
        (schema[r'$defs']! as Map).containsKey('DynamicString'),
        isTrue,
      );
    });

    test('is call before protocol 1.0 or without a version', () {
      for (final A2uiProtocolVersion? version in [
        A2uiProtocolVersion.v0_9,
        A2uiProtocolVersion.v0_9_1,
        null,
      ]) {
        final Map<String, Object?> schema = functionSchema(version);
        expect(
          (schema['properties']! as Map).containsKey('call'),
          isTrue,
          reason: '$version',
        );
        expect(schema['required'], ['call', 'args'], reason: '$version');
      }
    });

    test('writes the published v1 entry from protocol 1.0', () {
      final Map<String, Object?> schema = functionSchema(
        A2uiProtocolVersion.v1_0,
      );

      expect(schema['returnType'], 'string');
      expect((schema['properties']! as Map).containsKey('returnType'), isFalse);
      expect(schema.containsKey('unevaluatedProperties'), isFalse);
      expect(
        ((schema['properties']! as Map)['args']
            as Map)['unevaluatedProperties'],
        isFalse,
      );
    });

    test('writes allowedCallers and requiresUserActivation only when set', () {
      final functions = Catalog.fromJson({
        'catalogId': 'c',
        'protocolVersion': '1.0',
        'functions': {
          'plain': {
            'type': 'object',
            'returnType': 'string',
            'properties': {
              '@call': {'const': 'plain'},
            },
          },
          'guarded': {
            'type': 'object',
            'returnType': 'void',
            'allowedCallers': 'agentOnly',
            'requiresUserActivation': true,
            'properties': {
              '@call': {'const': 'guarded'},
            },
          },
        },
      }).validationSchema['functions']! as Map<String, Object?>;
      final plain = functions['plain']! as Map;
      final guarded = functions['guarded']! as Map;

      expect(plain.containsKey('allowedCallers'), isFalse);
      expect(plain.containsKey('requiresUserActivation'), isFalse);
      expect(guarded['allowedCallers'], 'agentOnly');
      expect(guarded['requiresUserActivation'], isTrue);
    });

    test('closes the entry and restates returnType before protocol 1.0', () {
      final Map<String, Object?> schema = functionSchema(
        A2uiProtocolVersion.v0_9,
      );

      expect(schema.containsKey('returnType'), isFalse);
      expect((schema['properties']! as Map)['returnType'], {'const': 'string'});
      expect(schema['unevaluatedProperties'], isFalse);
    });

    test('carries the protocolVersion a document declares', () {
      final CatalogApi parsed = Catalog.fromJson({
        'catalogId': 'c',
        'protocolVersion': '1.0',
        'components': <String, Object?>{},
      });
      expect(parsed.protocolVersion, A2uiProtocolVersion.v1_0);
      expect(parsed.validationSchema['protocolVersion'], '1.0');
      expect(
        Catalog.fromJson({
          'catalogId': 'c',
          'components': <String, Object?>{},
        }, protocolVersion: A2uiProtocolVersion.v0_9)
            .protocolVersion,
        A2uiProtocolVersion.v0_9,
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
      expect(catalog.protocolVersion, A2uiProtocolVersion.v1_0);
      expect(catalog.validationSchema['instructions'], 'Prefer cards.');
      expect(catalog.copyWith().instructions, 'Prefer cards.');
      expect(catalog.copyWith().protocolVersion, A2uiProtocolVersion.v1_0);
    });

    test(
        'does not misclassify top-level combinators in function args as '
        'parameters', () {
      final CatalogApi catalog = Catalog.fromJson({
        'catalogId': 'https://example.com/combinator.json',
        'functions': {
          'flexibleFunc': {
            'parameters': {
              'oneOf': [
                {
                  'type': 'object',
                  'properties': {
                    'text': {'type': 'string'},
                  },
                },
                {
                  'type': 'object',
                  'properties': {
                    'count': {'type': 'number'},
                  },
                },
              ],
            },
          },
        },
      });

      final FunctionApi fn = catalog.functions['flexibleFunc']!;
      expect(fn.argumentSchema.value.containsKey('properties'), isFalse);
      expect(fn.argumentSchema.value.containsKey('oneOf'), isTrue);
    });

    test('requires args in validationSchema only for required parameters', () {
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
          catalog.validationSchema['functions']! as Map<String, Object?>;

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
    test('serializes validationSchema with id and component envelopes', () {
      final Catalog<ComponentApi, FunctionApi> catalog = Catalog(
        id: 'https://example.com/custom-catalog',
        protocolVersion: A2uiProtocolVersion.v0_9,
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

      final Map<String, Object?> schema = catalog.validationSchema;
      expect(schema[r'$schema'], Catalog.jsonSchemaDialect);
      expect(schema['catalogId'], 'https://example.com/custom-catalog');
      expect(schema['protocolVersion'], '0.9');

      final comps = schema['components'] as Map<String, Object?>;
      expect(comps.containsKey('Button'), isTrue);

      final button = comps['Button'] as Map<String, Object?>;
      final props = button['properties'] as Map<String, Object?>;
      expect(props['id'], {
        r'$ref': r'#/$defs/ComponentId',
        'description': 'The unique identifier for a component, used for both '
            'definitions and references within the same surface.',
      });
      expect(props['component'], {'const': 'Button'});
      expect(props['label'], {'type': 'string'});

      expect(button['required'], ['id', 'label', 'component']);

      final defs = schema[r'$defs'] as Map<String, Object?>;
      expect(defs.containsKey('ComponentId'), isTrue);
      expect(defs.containsKey('anyComponent'), isTrue);
    });
  });

  group('Catalog.toJson of a document', () {
    Map<String, Object?> load(String path) =>
        jsonDecode(File(resolveConformancePath(path)).readAsStringSync())
            as Map<String, Object?>;

    for (final path in [
      '../catalogs/basic/v1/catalog.json',
      '../specification/v0_9/catalogs/basic/catalog.json',
      '../catalogs/mcp/catalog.json',
    ]) {
      test('writes $path back unchanged', () {
        final Map<String, Object?> source = load(path);
        final Map<String, Object?> out = Catalog.fromJson(source).toJson();

        expect(out, equals(source));
        expect(out.keys, orderedEquals(source.keys));
        expect(Catalog.fromJson(out).toJson(), equals(out));
      });
    }

    test('writes catalogId only when the document declared it', () {
      final source = <String, Object?>{
        'components': {
          'Label': {
            'type': 'object',
            'properties': {
              'text': {'type': 'string'},
            },
          },
        },
      };
      final CatalogApi catalog = Catalog.fromJson(
        source,
        catalogId: 'https://example.com/given',
      );

      expect(catalog.id, 'https://example.com/given');
      expect(catalog.toJson(), equals(source));
      expect(() => Catalog.fromJson(source), throwsA(isA<A2uiCatalogError>()));
    });

    test('takes the passed catalogId over the declared one', () {
      final CatalogApi catalog = Catalog.fromJson(
        _themedDocument(),
        catalogId: 'https://example.com/renamed',
      );

      expect(catalog.id, 'https://example.com/renamed');
      expect(catalog.toJson()['catalogId'], 'https://example.com/renamed');
    });

    test('keeps each component schema as written', () {
      final CatalogApi catalog = Catalog.fromJson(_themedDocument());

      expect(
        catalog.components['Card']!.schema.value,
        (_themedDocument()['components']! as Map<String, Object?>)['Card'],
      );
      expect(
        jsonEncode(catalog.components['Card']!.schema.value),
        contains(r'#/$defs/Weighted'),
      );
      expect(
        jsonEncode(catalog.resolvedComponentSchema('Card')!.value),
        isNot(contains(r'#/$defs/Weighted')),
      );
    });

    test('returns a fresh copy on each call', () {
      final CatalogApi catalog = Catalog.fromJson(_themedDocument());
      final Map<String, Object?> first = catalog.toJson();
      (first['components']! as Map<String, Object?>).clear();
      first.remove(r'$defs');

      expect(catalog.toJson(), equals(_themedDocument()));
    });

    test('reads composition and caller metadata', () {
      final CatalogApi catalog = Catalog.fromJson(_v10Document());

      expect(catalog.components['Spacer']!.allowedParents, ['Surface']);
      expect(catalog.components['Spacer']!.allowedChildren, isEmpty);
      expect(
        catalog.functions['launch']!.allowedCallers,
        AllowedCallers.rendererOnly,
      );
      expect(catalog.functions['launch']!.requiresUserActivation, isTrue);
      expect(catalog.functions['launch']!.description, 'Launches a URL.');
    });

    test('passes keys it does not model through', () {
      final source = <String, Object?>{
        'catalogId': 'extra',
        'x-vendor': {
          'tags': ['a', 'b'],
        },
        'components': <String, Object?>{},
      };

      expect(Catalog.fromJson(source).toJson(), equals(source));
    });

    test('keeps a functions list as a list', () {
      final source = <String, Object?>{
        'catalogId': 'list',
        'components': <String, Object?>{},
        'functions': [
          {
            'name': 'shout',
            'returnType': 'string',
            'parameters': {'type': 'object'},
          },
        ],
      };

      expect(Catalog.fromJson(source).toJson(), equals(source));
    });

    test('does not gain metadata, functions or unions', () {
      final source = <String, Object?>{
        'catalogId': 'bare',
        'components': {
          'Label': {
            'type': 'object',
            'properties': {
              'component': {'const': 'Label'},
              'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
            },
            'required': ['component', 'text'],
          },
        },
      };

      expect(
        Catalog.fromJson(
          source,
          protocolVersion: A2uiProtocolVersion.v1_0,
        ).toJson(),
        equals(source),
      );
    });

    group('writes each function definition back as written', () {
      final Map<String, Map<String, Object?>> documents = {
        'in the shorthand map form': {
          'catalogId': 'shorthand',
          'components': <String, Object?>{},
          'functions': {
            'shout': {
              'returnType': 'string',
              'parameters': {
                'type': 'object',
                'properties': {
                  'text': {'type': 'string'},
                },
              },
            },
          },
        },
        'from v0.9 without unevaluatedProperties': {
          'catalogId': 'open',
          'components': <String, Object?>{},
          'functions': {
            'shout': {
              'type': 'object',
              'properties': {
                'call': {'const': 'shout'},
                'args': {'type': 'object'},
                'returnType': {'const': 'string'},
              },
              'required': ['call'],
            },
          },
        },
        'from v1.0 with a title and unevaluatedProperties': {
          'catalogId': 'titled',
          'protocolVersion': '1.0',
          'components': <String, Object?>{},
          'functions': {
            'shout': {
              'type': 'object',
              'title': 'Shout',
              'returnType': 'string',
              'properties': {
                '@call': {'const': 'shout'},
                'args': {'type': 'object'},
              },
              'required': ['@call'],
              'unevaluatedProperties': false,
            },
          },
        },
        'from v1.0 without args': {
          'catalogId': 'no-args',
          'protocolVersion': '1.0',
          'components': <String, Object?>{},
          'functions': {
            'now': {
              'type': 'object',
              'returnType': 'number',
              'properties': {
                '@call': {'const': 'now'},
              },
              'required': ['@call'],
            },
          },
        },
        'as a list item without returnType': {
          'catalogId': 'untyped',
          'components': <String, Object?>{},
          'functions': [
            {
              'name': 'log',
              'parameters': {'type': 'object'},
            },
          ],
        },
      };
      for (final MapEntry<String, Map<String, Object?>> entry
          in documents.entries) {
        test(entry.key, () {
          expect(Catalog.fromJson(entry.value).toJson(), equals(entry.value));
        });
      }

      test('and keeps it through withFunctions', () {
        final Map<String, Object?> source =
            documents['in the shorthand map form']!;
        final CatalogApi catalog = Catalog.fromJson(source);
        final FunctionApi shout = catalog.functions['shout']!;

        expect(shout.definition, (source['functions']! as Map)['shout']);
        expect(shout.returnType, A2uiReturnType.string);
        expect(
          catalog.withFunctions([
            FunctionApi(
              name: shout.name,
              argumentSchema: shout.argumentSchema,
              returnType: shout.returnType,
              definition: shout.definition,
            ),
          ]).toJson(),
          equals(source),
        );
      });
    });

    test('keeps an authored commonTypesRef key', () {
      final source = <String, Object?>{
        'catalogId': 'marker',
        'components': {
          'Label': {
            'type': 'object',
            'properties': {
              'text': {
                r'$ref': r'common_types.json#/$defs/DynamicString',
                'commonTypesRef': 'x',
                'minLength': 2,
              },
            },
          },
        },
        'functions': {
          'shout': {
            'returnType': 'string',
            'parameters': {
              'type': 'object',
              'properties': {
                'text': {
                  r'$ref': r'common_types.json#/$defs/DynamicString',
                  'commonTypesRef': 'x',
                },
              },
            },
          },
        },
      };
      final CatalogApi catalog = Catalog.fromJson(source);

      expect(catalog.toJson(), equals(source));
      expect(
        catalog
            .copyWith(components: catalog.components.values.toList())
            .toJson(),
        equals(source),
      );
    });

    test('cannot be changed after it is read', () {
      final CatalogApi catalog = Catalog.fromJson(_v10Document());
      final Map<String, Object?> before = catalog.toJson();

      expect(
        () => catalog.components['Extra'] = catalog.components['Spacer']!,
        throwsUnsupportedError,
      );
      expect(() => catalog.functions.remove('launch'), throwsUnsupportedError);
      expect(
        () => catalog.components['Spacer']!.schema.value['title'] = 't',
        throwsUnsupportedError,
      );
      expect(
        () => catalog.functions['launch']!.argumentSchema.value['title'] = 't',
        throwsUnsupportedError,
      );
      expect(
        () => catalog.functions['launch']!.definition!['title'] = 't',
        throwsUnsupportedError,
      );
      expect(catalog.toJson(), equals(before));
      expect(before, equals(_v10Document()));
    });

    test('has an unmodifiable theme', () {
      final CatalogApi catalog = Catalog.fromJson(_themedDocument());

      expect(
        () => catalog.themeSchema!.value['title'] = 't',
        throwsUnsupportedError,
      );
    });
  });

  group('Catalog model', () {
    test('reads the document into fields', () {
      final CatalogApi catalog = Catalog.fromJson(_v10Document());

      expect(catalog.schemaDialect, Catalog.jsonSchemaDialect);
      expect(catalog.title, 'Versioned');
      expect(catalog.definitions.keys, ['Weighted', 'Unused']);
      expect(
        catalog.components['Spacer']!.schema.value,
        isNot(contains('allowedParents')),
      );
      final FunctionApi launch = catalog.functions['launch']!;
      expect(launch.declaredAllowedCallers, AllowedCallers.rendererOnly);
      expect(launch.declaredRequiresUserActivation, isTrue);
      expect(
        launch.argumentSchema.value,
        ((((_v10Document()['functions']! as Map)['launch']!
                as Map)['properties']! as Map)['args']! as Map)
            .cast<String, Object?>(),
      );
    });

    test('writes a replaced function from its signature', () {
      final CatalogApi catalog = Catalog.fromJson(_v10Document());
      final FunctionApi launch = catalog.functions['launch']!;
      final CatalogApi changed = catalog.copyWith(
        functions: [
          FunctionApi(
            name: 'launch',
            description: 'Opens a URL.',
            returnType: launch.returnType,
            argumentSchema: launch.argumentSchema,
          ),
        ],
      );

      final functions = changed.toJson()['functions']! as Map;
      final written = functions['launch']! as Map<String, Object?>;
      expect(written['description'], 'Opens a URL.');
      expect(written, isNot(contains('allowedCallers')));
      expect(written, isNot(contains('requiresUserActivation')));
      expect(catalog.toJson(), equals(_v10Document()));
    });

    test('keeps a top-level theme at the top level', () {
      final CatalogApi catalog = Catalog.fromJson(_themedDocument());

      expect(catalog.themeSchema!.value, _themedDocument()['theme']);
      expect(catalog.definitions.keys, ['Weighted']);
      expect(catalog.toJson()['theme'], _themedDocument()['theme']);
      expect(
        (catalog.toJson()[r'$defs']! as Map).keys,
        isNot(contains('theme')),
      );
    });

    test('flattens each component once', () {
      final CatalogApi catalog = Catalog.fromJson(_themedDocument());
      final Schema card = catalog.resolvedComponentSchema('Card')!;

      expect(identical(catalog.resolvedComponentSchema('Card'), card), isTrue);
      expect(
        (card.value['properties']! as Map).keys,
        unorderedEquals(['child', 'weight']),
      );
      expect(card.value['required'], ['child']);
      expect(card.value, isNot(contains('allOf')));
      expect(catalog.resolvedComponentSchema('Missing'), isNull);
    });

    test('caches validationSchema and copies toJson', () {
      final CatalogApi catalog = Catalog.fromJson(_themedDocument());

      expect(
        identical(catalog.validationSchema, catalog.validationSchema),
        isTrue,
      );
      expect(identical(catalog.toJson(), catalog.toJson()), isFalse);
    });
  });

  group('Catalog.toJson of a derived catalog', () {
    test('rebuilds a union whose entries changed and keeps the other', () {
      final CatalogApi catalog = Catalog.fromJson(_v10Document());
      final Map<String, Object?> source = _v10Document();
      final CatalogApi pruned = catalog.copyWith(
        components: [catalog.components['Spacer']!],
      );

      final Map<String, Object?> out = pruned.toJson();
      final defs = out[r'$defs']! as Map<String, Object?>;

      expect(out['title'], 'Versioned');
      expect(out['protocolVersion'], '1.0');
      expect((out['components']! as Map).keys, ['Spacer']);
      expect(defs['anyComponent'], {
        'oneOf': [
          {r'$ref': '#/components/Spacer'},
        ],
        'discriminator': {'propertyName': 'component'},
      });
      expect(
        defs['anyFunction'],
        (source[r'$defs']! as Map<String, Object?>)['anyFunction'],
      );
    });

    test('drops an authored definition only its removed users referenced', () {
      final CatalogApi catalog = Catalog.fromJson(_v10Document());

      final Map<String, Object?> withoutCard = catalog
          .copyWith(components: [catalog.components['Spacer']!]).toJson();
      final Map<String, Object?> withCard =
          catalog.copyWith(components: [catalog.components['Card']!]).toJson();

      expect(withoutCard[r'$defs'], isNot(contains('Weighted')));
      expect(withoutCard[r'$defs'], contains('Unused'));
      expect(withCard[r'$defs'], contains('Weighted'));
    });

    test('serializes a replaced entry from its schema', () {
      final CatalogApi catalog = Catalog.fromJson(_v10Document());
      final CatalogApi changed = catalog.copyWith(
        components: [
          ComponentApi(
            name: 'Spacer',
            schema: Schema.fromMap({
              'type': 'object',
              'properties': {'size': CommonSchemas.dynamicBoolean.value},
            }),
            allowedParents: const ['Surface'],
          ),
        ],
      );

      expect(
        (changed.toJson()['components']! as Map<String, Object?>)['Spacer'],
        {
          'type': 'object',
          'allowedParents': ['Surface'],
          'properties': {
            'size': {
              r'$ref': r'common_types.json#/$defs/DynamicBoolean',
              'description': CommonSchemas.dynamicBoolean.value['description'],
            },
          },
        },
      );
    });

    test('writes a new protocolVersion in canonical form', () {
      final CatalogApi catalog = Catalog.fromJson(_themedDocument());

      expect(
        catalog
            .copyWith(protocolVersion: A2uiProtocolVersion.v0_9_1)
            .toJson()['protocolVersion'],
        '0.9.1',
      );
      expect(catalog.toJson(), isNot(contains('protocolVersion')));
    });
  });

  group('Catalog.toJson of a code-defined catalog', () {
    test('is an unbundled v1.0 catalog document', () {
      final Catalog<ComponentApi, FunctionApi> catalog = Catalog(
        id: 'https://example.com/code',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: [
          ComponentApi(
            name: 'Label',
            schema: Schema.object(
              properties: {'text': CommonSchemas.dynamicString},
              required: ['text'],
            ),
            allowedParents: const ['Surface', 'Card'],
          ),
        ],
        functions: [
          FunctionApi(
            name: 'launch',
            description: 'Launches a URL.',
            returnType: A2uiReturnType.void_,
            requiresUserActivation: true,
            argumentSchema: Schema.object(
              properties: {'url': CommonSchemas.dynamicString},
              required: ['url'],
            ),
          ),
        ],
      );

      final Map<String, Object?> out = catalog.toJson();

      expect(out[r'$schema'], Catalog.jsonSchemaDialect);
      expect(out['protocolVersion'], '1.0');
      expect((out[r'$defs']! as Map).keys, ['anyComponent', 'anyFunction']);
      expect(jsonEncode(out), isNot(contains('commonTypesRef')));
      expect(jsonEncode(out), isNot(contains(r'"#/$defs/')));
      final label = (out['components']! as Map)['Label'] as Map;
      expect(label['allowedParents'], ['Surface', 'Card']);
      // The schema is written as defined, with no `component` constant
      // added.
      expect(label['required'], ['text']);
      expect((label['properties']! as Map).keys, ['text']);
      expect(
        ((label['properties']! as Map)['text'] as Map)[r'$ref'],
        r'common_types.json#/$defs/DynamicString',
      );
      final launch = (out['functions']! as Map)['launch'] as Map;
      expect(launch['returnType'], 'void');
      // rendererOnly is the default, so a code-defined function omits it.
      expect(launch.containsKey('allowedCallers'), isFalse);
      expect(launch['requiresUserActivation'], isTrue);
      expect((launch['properties']! as Map).keys, ['@call', 'args']);
      expect(launch['required'], ['@call', 'args']);
      expect(_catalogDefinitionErrors(out), isEmpty);
      expect(Catalog.fromJson(out).toJson(), equals(out));
    });

    test('declares both unions from v1.0, matching nothing when empty', () {
      final Map<String, Object?> out = Catalog<ComponentApi, FunctionApi>(
        id: 'empty',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const [],
      ).toJson();

      expect(out[r'$defs'], {
        'anyComponent': {'not': <String, Object?>{}},
        'anyFunction': {'not': <String, Object?>{}},
      });
      expect(_catalogDefinitionErrors(out), isEmpty);
    });

    test('uses the v0.9 shape below v1.0', () {
      final Map<String, Object?> out = TestCatalog().toJson();

      expect(out['protocolVersion'], '0.9');
      final capitalize = (out['functions']! as Map).values.single as Map;
      expect((capitalize['properties']! as Map).keys, [
        'call',
        'args',
        'returnType',
      ]);
      expect(capitalize['unevaluatedProperties'], isFalse);
      expect((out[r'$defs']! as Map).keys, [
        'theme',
        'anyComponent',
        'anyFunction',
      ]);
    });

    test('writes the basic catalog functions as published', () {
      final published = jsonDecode(
        File(
          resolveConformancePath('../catalogs/basic/v1/catalog.json'),
        ).readAsStringSync(),
      ) as Map<String, Object?>;

      final Map<String, Object?> out = BasicCatalog.v1_0().toJson();

      expect(out['functions'], equals(published['functions']));
      expect(out['instructions'], published['instructions']);
      expect(
        ((out[r'$defs']! as Map)['anyFunction'] as Map)['oneOf'],
        hasLength(14),
      );
      expect(_catalogDefinitionErrors(out), isEmpty);
    });
  });

  group('Catalog.validationSchema', () {
    Map<String, Object?> standardDef(String path, String name) =>
        ((jsonDecode(File(resolveConformancePath(path)).readAsStringSync())
                as Map<String, Object?>)[r'$defs']!
            as Map<String, Object?>)[name]! as Map<String, Object?>;

    Map<String, Object?> labelDocument(String? version) => {
          'catalogId': 'label',
          if (version != null) 'protocolVersion': version,
          'components': {
            'Label': {
              'type': 'object',
              'properties': {
                'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
              },
            },
          },
        };

    test('bundles the v1.0 common types for a v1.0 catalog', () {
      final defs = Catalog.fromJson(labelDocument('1.0'))
          .validationSchema[r'$defs']! as Map<String, Object?>;

      expect(
        defs['DynamicString'],
        standardDef(
          '../specification/v1_0/json/common_types.json',
          'DynamicString',
        ),
      );
    });

    for (final String? version in [null, '0.9', '0.9.1']) {
      test('bundles the v0.9 common types for version $version', () {
        final defs = Catalog.fromJson(labelDocument(version))
            .validationSchema[r'$defs']! as Map<String, Object?>;

        expect(
          defs['DynamicString'],
          standardDef(
            '../specification/v0_9/json/common_types.json',
            'DynamicString',
          ),
        );
      });
    }

    test('is what the deprecated catalogSchema returns', () {
      final CatalogApi catalog = Catalog.fromJson(labelDocument('1.0'));

      // ignore: deprecated_member_use_from_same_package
      expect(catalog.catalogSchema, same(catalog.validationSchema));
    });

    test('leaves the document metadata to toJson', () {
      final CatalogApi catalog = Catalog.fromJson({
        r'$id': 'https://example.com/label.json',
        'title': 'Label catalog',
        'description': 'One label.',
        'instructions': 'Use labels.',
        ...labelDocument('0.9'),
      });
      final Map<String, Object?> schema = catalog.validationSchema;

      expect(schema.containsKey(r'$id'), isFalse);
      expect(schema.containsKey('title'), isFalse);
      expect(schema.containsKey('description'), isFalse);
      expect(schema['instructions'], 'Use labels.');
      expect(catalog.toJson()['title'], 'Label catalog');
    });

    for (final version in ['0.9', '1.0']) {
      test('is self-contained at version $version', () {
        final Map<String, Object?> schema = Catalog.fromJson(
          labelDocument(version),
        ).validationSchema;
        final defs = schema[r'$defs']! as Map<String, Object?>;

        expect(jsonEncode(schema), isNot(contains('catalog.json#')));
        expect(
          jsonEncode(defs['FunctionCall']),
          contains(r'"#/$defs/anyFunction"'),
        );
        // The label catalog has no functions, so its union matches nothing.
        expect(defs['anyFunction'], {'not': <String, Object?>{}});
      });
    }

    test('emits only the protocolVersion the document declares', () {
      final Map<String, Object?> undeclared = Catalog.fromJson(
        labelDocument(null),
        protocolVersion: A2uiProtocolVersion.v0_9,
      ).validationSchema;
      final Map<String, Object?> declared = Catalog.fromJson(
        labelDocument('0.9'),
      ).validationSchema;

      expect(undeclared.containsKey('protocolVersion'), isFalse);
      expect(declared['protocolVersion'], '0.9');
    });

    test('closes components and function arguments', () {
      final Map<String, Object?> schema = Catalog.fromJson({
        'catalogId': 'closed',
        'components': {
          'Label': {
            'type': 'object',
            'properties': {
              'text': {'type': 'string'},
            },
          },
          'Open': {
            'type': 'object',
            'properties': <String, Object?>{},
            'additionalProperties': true,
          },
        },
        'functions': {
          'echo': {
            'type': 'object',
            'properties': {
              'call': {'const': 'echo'},
              'args': {
                'type': 'object',
                'properties': {
                  'value': {'type': 'string'},
                },
                'additionalProperties': false,
              },
              'returnType': {'const': 'string'},
            },
          },
        },
      }).validationSchema;
      final components = schema['components']! as Map<String, Object?>;
      final echo = (schema['functions']! as Map)['echo'] as Map;
      final args = (echo['properties'] as Map)['args'] as Map;

      expect((components['Label']! as Map)['unevaluatedProperties'], isFalse);
      expect((components['Open']! as Map)['unevaluatedProperties'], isTrue);
      expect(
        (components['Open']! as Map).containsKey('additionalProperties'),
        isFalse,
      );
      expect(args['unevaluatedProperties'], isFalse);
      expect(args.containsKey('additionalProperties'), isFalse);
    });

    test('leaves v1.0 components open unless the source closes them', () {
      final components = Catalog.fromJson({
        'catalogId': 'v1',
        'protocolVersion': '1.0',
        'components': {
          'Open': {'type': 'object', 'properties': <String, Object?>{}},
          'Closed': {
            'type': 'object',
            'properties': <String, Object?>{},
            'unevaluatedProperties': false,
          },
        },
      }).validationSchema['components']! as Map<String, Object?>;

      expect(
        (components['Open']! as Map).containsKey('unevaluatedProperties'),
        isFalse,
      );
      expect((components['Closed']! as Map)['unevaluatedProperties'], isFalse);
    });

    group('theme', () {
      Map<String, Object?> theme(String version, {bool? open}) {
        final defs = Catalog.fromJson({
          'catalogId': 'themed',
          'protocolVersion': version,
          'components': <String, Object?>{},
          r'$defs': {
            'theme': {
              'type': 'object',
              'properties': {
                'primaryColor': {'type': 'string'},
              },
              if (open != null) 'additionalProperties': open,
            },
          },
        }).validationSchema[r'$defs']! as Map<String, Object?>;
        return defs['theme']! as Map<String, Object?>;
      }

      test('is open from v0.9 when it leaves additionalProperties unset', () {
        expect(theme('0.9')['additionalProperties'], isTrue);
      });

      test('stays closed when authored closed', () {
        expect(theme('0.9', open: false)['additionalProperties'], isFalse);
      });

      test('is not opened when closed by unevaluatedProperties', () {
        final defs = Catalog.fromJson({
          'catalogId': 'themed',
          'protocolVersion': '0.9',
          'components': <String, Object?>{},
          r'$defs': {
            'theme': {
              'type': 'object',
              'properties': <String, Object?>{},
              'unevaluatedProperties': false,
            },
          },
        }).validationSchema[r'$defs']! as Map<String, Object?>;

        expect(defs['theme'], {
          'type': 'object',
          'properties': <String, Object?>{},
          'unevaluatedProperties': false,
        });
      });
    });

    test('localizes common types references and describes them', () {
      const absolute =
          r'https://a2ui.org/specification/v0_9/common_types.json#/$defs/';
      final Map<String, Object?> schema = Catalog.fromJson({
        'catalogId': 'refs',
        'components': {
          'Label': {
            'type': 'object',
            'properties': {
              'text': {r'$ref': '${absolute}DynamicString'},
              'title': {
                r'$ref': '${absolute}DynamicString',
                'description': 'The title.',
              },
            },
          },
        },
        'functions': {
          'echo': {
            'type': 'object',
            'properties': {
              'call': {'const': 'echo'},
              'args': {
                'type': 'object',
                'properties': {
                  'value': {r'$ref': '${absolute}DynamicNumber'},
                },
              },
              'returnType': {'const': 'number'},
            },
          },
        },
      }).validationSchema;
      final label =
          ((schema['components']! as Map)['Label'] as Map)['properties'] as Map;
      final echo = (schema['functions']! as Map)['echo'] as Map;
      final args = (echo['properties'] as Map)['args'] as Map;
      final Map<String, Object?> dynamicNumber = standardDef(
        '../specification/v0_9/json/common_types.json',
        'DynamicNumber',
      );

      expect(label['text'], {
        r'$ref': r'#/$defs/DynamicString',
        'description': 'Represents a string',
      });
      expect(label['title'], {
        r'$ref': r'#/$defs/DynamicString',
        'description': 'The title.',
      });
      expect((args['properties'] as Map)['value'], {
        r'$ref': r'#/$defs/DynamicNumber',
        'description': dynamicNumber['description'],
      });
    });

    test('describes local references to standard definitions in args', () {
      final Map<String, Object?> schema = Catalog.fromJson({
        'catalogId': 'local-refs',
        'protocolVersion': '1.0',
        'components': <String, Object?>{},
        'functions': {
          'echo': {
            'type': 'object',
            'returnType': 'string',
            'properties': {
              '@call': {'const': 'echo'},
              'args': {
                'type': 'object',
                'properties': {
                  'value': {r'$ref': r'#/$defs/DynamicString'},
                },
              },
            },
          },
        },
      }).validationSchema;
      final echo = (schema['functions']! as Map)['echo'] as Map;
      final args = (echo['properties'] as Map)['args'] as Map;
      final Map<String, Object?> dynamicString = standardDef(
        '../specification/v1_0/json/common_types.json',
        'DynamicString',
      );

      expect((args['properties'] as Map)['value'], {
        r'$ref': r'#/$defs/DynamicString',
        'description': dynamicString['description'],
      });
      expect((schema[r'$defs']! as Map).containsKey('DynamicString'), isTrue);
    });

    test('carries non-empty allowedParents and allowedChildren', () {
      final components = Catalog.fromJson({
        'catalogId': 'composition',
        'protocolVersion': '1.0',
        'components': {
          'Row': {
            'type': 'object',
            'allowedChildren': ['Cell'],
            'properties': <String, Object?>{},
          },
          'Cell': {
            'type': 'object',
            'allowedParents': ['Row'],
            'properties': <String, Object?>{},
          },
          'Free': {
            'type': 'object',
            'allowedParents': <String>[],
            'properties': <String, Object?>{},
          },
        },
      }).validationSchema['components']! as Map<String, Object?>;

      expect((components['Row']! as Map)['allowedChildren'], ['Cell']);
      expect((components['Row']! as Map).containsKey('allowedParents'), false);
      expect((components['Cell']! as Map)['allowedParents'], ['Row']);
      expect((components['Free']! as Map).containsKey('allowedParents'), false);
    });

    test('copies referenced authored definitions', () {
      final Map<String, Object?> schema = Catalog.fromJson({
        'catalogId': 'authored-defs',
        'protocolVersion': '0.9',
        'components': {
          'Tree': {
            'type': 'object',
            'properties': {
              'root': {r'$ref': r'#/$defs/node'},
            },
          },
        },
        r'$defs': {
          'node': {
            'type': 'object',
            'properties': {
              'label': {r'$ref': 'common_types.json#/\$defs/DynamicString'},
              'children': {
                'type': 'array',
                'items': {r'$ref': r'#/$defs/node'},
              },
            },
          },
          'unused': {'type': 'string'},
        },
      }).validationSchema;
      final defs = schema[r'$defs']! as Map<String, Object?>;

      expect(defs.containsKey('node'), isTrue);
      expect(defs.containsKey('unused'), isFalse);
      expect(defs.containsKey('DynamicString'), isTrue);
      final node = defs['node']! as Map;
      expect(
        ((node['properties'] as Map)['label'] as Map)[r'$ref'],
        r'#/$defs/DynamicString',
      );
      expect(_danglingRefs(schema), isEmpty);
    });

    test('gives v1.0 ComponentCommon users the standard metadata', () {
      final Map<String, Object?> schema = Catalog.fromJson({
        'catalogId': 'common',
        'protocolVersion': '1.0',
        'components': {
          'Box': {
            'type': 'object',
            'allOf': [
              {r'$ref': 'common_types.json#/\$defs/ComponentCommon'},
              {
                'properties': {
                  'component': {'const': 'Box'},
                  'label': {'type': 'string'},
                },
              },
            ],
          },
        },
      }).validationSchema;
      final box = (schema['components']! as Map)['Box'] as Map;
      final properties = box['properties'] as Map;
      final Map<String, Object?> common = standardDef(
        '../specification/v1_0/json/common_types.json',
        'ComponentCommon',
      );
      final Map<String, Object?> extensions = standardDef(
        '../specification/v1_0/json/common_types.json',
        'Extensions',
      );
      final metadata =
          (common['properties']! as Map)['metadata'] as Map<String, Object?>;

      expect(properties.keys, containsAll(['accessibility', 'metadata']));
      expect(properties.containsKey('catalogId'), isFalse);
      expect(properties['metadata'], {
        ...metadata,
        'properties': {
          'extensions': {
            r'$ref': r'#/$defs/Extensions',
            if (extensions['description'] != null)
              'description': extensions['description'],
          },
        },
      });
      expect((schema[r'$defs']! as Map).containsKey('Extensions'), isTrue);
    });

    test('gives v0.9 ComponentCommon users no metadata', () {
      final Map<String, Object?> schema = Catalog.fromJson({
        'catalogId': 'common',
        'protocolVersion': '0.9',
        'components': {
          'Box': {
            'type': 'object',
            'allOf': [
              {r'$ref': 'common_types.json#/\$defs/ComponentCommon'},
              {
                'properties': {
                  'component': {'const': 'Box'},
                },
              },
            ],
          },
        },
      }).validationSchema;
      final box = (schema['components']! as Map)['Box'] as Map;

      expect((box['properties'] as Map).containsKey('accessibility'), isTrue);
      expect((box['properties'] as Map).containsKey('metadata'), isFalse);
    });
  });

  group('inline catalogs', () {
    final CatalogApi catalog = Catalog.fromJson(_v10Document());

    test('are catalog documents from v1.0', () {
      final Map<String, Object?> json = A2uiRendererCapabilities(
        versions: {
          A2uiProtocolVersion.v1_0: A2uiVersionCapabilities(
            supportedCatalogIds: const [],
            inlineCatalogs: [catalog],
          ),
        },
      ).toJson();

      expect(
        ((json['v1.0']! as Map)['inlineCatalogs'] as List).single,
        equals(_v10Document()),
      );
    });

    test('use the legacy inline catalog shape before v1.0', () {
      final Map<String, Object?> json = A2uiRendererCapabilities(
        versions: {
          A2uiProtocolVersion.v0_9: A2uiVersionCapabilities(
            supportedCatalogIds: const [],
            inlineCatalogs: [catalog],
          ),
        },
      ).toJson();

      final legacy = ((json['v0.9']! as Map)['inlineCatalogs'] as List).single
          as Map<String, Object?>;
      expect(legacy, equals(catalog.toLegacyInlineCatalog()));
      expect(legacy.keys, ['catalogId', 'components', 'functions']);
      expect((legacy['functions']! as List).single, {
        'name': 'launch',
        'description': 'Launches a URL.',
        'returnType': 'void',
        'parameters': {
          'type': 'object',
          'properties': {
            'url': {
              r'$ref': r'common_types.json#/$defs/DynamicString',
              'description': 'Represents a string',
            },
          },
          'required': ['url'],
        },
      });
    });

    test('follow the version a processor advertises', () {
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [TestCatalog()],
      );

      final Map<String, Object?> json = processor
          .getRendererCapabilities(
            const CapabilitiesOptions(
              versions: [A2uiProtocolVersion.v1_0, A2uiProtocolVersion.v0_9],
              includeInlineCatalogs: true,
            ),
          )
          .toJson();

      expect(
        ((json['v1.0']! as Map)['inlineCatalogs'] as List).single,
        equals(TestCatalog().toJson()),
      );
      expect(
        ((json['v0.9']! as Map)['inlineCatalogs'] as List).single,
        equals(TestCatalog().toLegacyInlineCatalog()),
      );
    });
  });

  group('Catalog.validationSchema references', () {
    // A catalog whose component property and function argument both name
    // an authored definition and a deep pointer into the common types.
    Map<String, Object?> document() => {
          'catalogId': 'https://example.com/refs',
          'protocolVersion': '0.9',
          'components': {
            'Counter': {
              'type': 'object',
              'properties': {
                'count': {r'$ref': r'#/$defs/PositiveInt'},
                'label': {
                  r'$ref': r'common_types.json#/$defs/DynamicString/oneOf/0',
                },
              },
              'required': ['count'],
            },
          },
          'functions': {
            'repeat': {
              'type': 'object',
              'properties': {
                'call': {'const': 'repeat'},
                'args': {
                  'type': 'object',
                  'properties': {
                    'times': {r'$ref': r'#/$defs/PositiveInt'},
                    'text': {
                      r'$ref':
                          r'common_types.json#/$defs/DynamicString/oneOf/0',
                    },
                  },
                },
                'returnType': {'const': 'string'},
              },
            },
          },
          r'$defs': {
            'PositiveInt': {'type': 'integer', 'minimum': 1},
          },
        };

    Map<String, Object?> properties(Map<String, Object?> schema) =>
        ((schema['components']! as Map)['Counter'] as Map)['properties']
            as Map<String, Object?>;
    Map<String, Object?> arguments(Map<String, Object?> schema) =>
        ((((schema['functions']! as Map)['repeat'] as Map)['properties']
            as Map)['args'] as Map)['properties'] as Map<String, Object?>;

    test('keeps the full path of a deep pointer into the common types', () {
      final Map<String, Object?> schema = Catalog.fromJson(
        document(),
      ).validationSchema;
      const deep = {r'$ref': r'#/$defs/DynamicString/oneOf/0'};

      // No description: the pointer names part of a definition.
      expect(properties(schema)['label'], deep);
      expect(arguments(schema)['text'], deep);
      expect(schema[r'$defs'], contains('DynamicString'));
    });

    test('keeps references to authored definitions and bundles them', () {
      final Map<String, Object?> schema = Catalog.fromJson(
        document(),
      ).validationSchema;
      const ref = {r'$ref': r'#/$defs/PositiveInt'};

      expect(properties(schema)['count'], ref);
      expect(arguments(schema)['times'], ref);
      expect((schema[r'$defs']! as Map)['PositiveInt'], {
        'type': 'integer',
        'minimum': 1,
      });
    });

    test('validates against an authored definition it references', () {
      final CatalogApi catalog = Catalog.fromJson(document());
      final validator = PayloadValidator<ComponentApi, FunctionApi>(
        catalog: catalog,
      );

      expect(
        () => validator.validateComponent({
          'id': 'c',
          'component': 'Counter',
          'count': 1,
        }),
        returnsNormally,
      );
      expect(
        () => validator.validateComponent({
          'id': 'c',
          'component': 'Counter',
          'count': 0,
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator.validateFunction('repeat', {'times': 0}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('serializes a replaced entry from its new schema', () {
      final CatalogApi catalog = Catalog.fromJson(document());
      final CatalogApi changed = catalog.copyWith(
        components: [
          ComponentApi(
            name: 'Counter',
            schema: Schema.object(properties: {'count': Schema.integer()}),
          ),
        ],
      );

      expect(properties(changed.validationSchema)['count'], {
        'type': 'integer',
      });
    });
  });

  group('Catalog.withFunctions', () {
    test('keeps the authored document and definitions', () {
      final CatalogApi catalog = Catalog.fromJson(_v10Document());
      final Catalog<ComponentApi, FunctionApi> retyped = catalog.withFunctions(
        catalog.functions.values,
      );

      expect(retyped.toJson(), equals(catalog.toJson()));
      expect(retyped.validationSchema, equals(catalog.validationSchema));
    });
  });

  group('Catalog.copyWith', () {
    test('recomputes an authored union when entries change', () {
      final Map<String, Object?> doc = _v10Document();
      // Give anyComponent a non-default order so fromJson keeps it in
      // definitions.
      (doc[r'$defs']! as Map)['anyComponent'] = {
        'oneOf': [
          {r'$ref': '#/components/Card'},
          {r'$ref': '#/components/Spacer'},
        ],
        'discriminator': {'propertyName': 'component'},
      };
      final CatalogApi loaded = Catalog.fromJson(doc);
      final CatalogApi pruned = loaded.copyWith(
        components: [loaded.components['Card']!],
      );

      final defs = pruned.toJson()[r'$defs']! as Map<String, Object?>;
      expect(defs['anyComponent'], {
        'oneOf': [
          {r'$ref': '#/components/Card'},
        ],
        'discriminator': {'propertyName': 'component'},
      });
    });

    test('re-serializes functions when protocolVersion crosses v1.0', () {
      final CatalogApi v09Loaded = Catalog.fromJson(loadBasicCatalogJson());
      final CatalogApi upgraded = v09Loaded.copyWith(
        protocolVersion: A2uiProtocolVersion.v1_0,
      );
      final Map<String, Object?> json = upgraded.toJson();
      expect(json['protocolVersion'], '1.0');
      final functions = json['functions']! as Map<String, Object?>;
      final requiredFn = functions['required']! as Map<String, Object?>;
      expect(requiredFn['returnType'], 'boolean');
      final props = requiredFn['properties']! as Map<String, Object?>;
      expect(props[r'@call'], {'const': 'required'});
      expect(props.containsKey('call'), isFalse);
    });
  });
}

/// A v0.9 document with instructions, a top-level theme and a local mixin.
Map<String, Object?> _themedDocument() => {
      'catalogId': 'https://example.com/themed',
      'instructions': 'Prefer Cards.',
      'components': {
        'Card': {
          'type': 'object',
          'allOf': [
            {r'$ref': r'#/$defs/Weighted'},
            {
              'type': 'object',
              'properties': {
                'component': {'const': 'Card'},
                'child': {r'$ref': r'common_types.json#/$defs/ComponentId'},
              },
              'required': ['component', 'child'],
            },
          ],
          'unevaluatedProperties': false,
        },
      },
      'theme': {
        'primaryColor': {'type': 'string'},
      },
      r'$defs': {
        'Weighted': {
          'type': 'object',
          'properties': {
            'weight': {'type': 'number'},
          },
        },
      },
    };

/// A v1.0 document with metadata, functions, a mixin and both unions.
Map<String, Object?> _v10Document() => {
      r'$schema': Catalog.jsonSchemaDialect,
      'protocolVersion': '1.0',
      'title': 'Versioned',
      'catalogId': 'https://example.com/v10',
      'components': {
        'Spacer': {
          'type': 'object',
          'allowedParents': ['Surface'],
          'allowedChildren': <Object?>[],
          'properties': {
            'component': {'const': 'Spacer'},
          },
          'required': ['component'],
        },
        'Card': {
          'type': 'object',
          'allOf': [
            {r'$ref': r'#/$defs/Weighted'},
            {
              'type': 'object',
              'properties': {
                'component': {'const': 'Card'},
              },
              'required': ['component'],
            },
          ],
        },
      },
      'functions': {
        'launch': {
          'type': 'object',
          'description': 'Launches a URL.',
          'returnType': 'void',
          'allowedCallers': 'rendererOnly',
          'requiresUserActivation': true,
          'properties': {
            '@call': {'const': 'launch'},
            'args': {
              'type': 'object',
              'properties': {
                'url': {r'$ref': r'common_types.json#/$defs/DynamicString'},
              },
              'required': ['url'],
            },
          },
          'required': ['@call', 'args'],
        },
      },
      r'$defs': {
        'Weighted': {
          'type': 'object',
          'properties': {
            'weight': {'type': 'number'},
          },
        },
        'Unused': {'type': 'string'},
        'anyComponent': {
          'oneOf': [
            {r'$ref': '#/components/Spacer'},
            {r'$ref': '#/components/Card'},
          ],
          'discriminator': {'propertyName': 'component'},
        },
        'anyFunction': {
          'oneOf': [
            {r'$ref': '#/functions/launch'},
          ],
        },
      },
    };

/// The errors validating [document] against the v1.0
/// `catalog_definition.json`, with its references to the JSON Schema
/// meta-schema and to `common_types.json` accepted as is.
List<ValidationError> _catalogDefinitionErrors(Map<String, Object?> document) {
  Object? acceptExternal(Object? node) {
    if (node is List) return [for (final item in node) acceptExternal(item)];
    if (node is! Map) return node;
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in node.entries)
        if (!(entry.key == r'$ref' &&
            entry.value is String &&
            !(entry.value! as String).startsWith('#')))
          entry.key! as String: acceptExternal(entry.value),
    };
  }

  final definition = acceptExternal(
    jsonDecode(
      File(
        resolveConformancePath(
          '../specification/v1_0/json/catalog_definition.json',
        ),
      ).readAsStringSync(),
    ),
  )! as Map<String, Object?>
    ..remove(r'$schema')
    ..remove(r'$id');
  return Schema.fromMap(definition).validateSync(document);
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

/// The local `#/$defs/` references in [schema] that name no definition.
Set<String> _danglingRefs(Map<String, Object?> schema) {
  final defs = schema[r'$defs']! as Map<String, Object?>;
  final dangling = <String>{};
  void visit(Object? node) {
    if (node is List) {
      node.forEach(visit);
    } else if (node is Map) {
      final Object? ref = node[r'$ref'];
      if (ref is String && ref.startsWith(r'#/$defs/')) {
        final String name = ref.substring(8);
        if (!defs.containsKey(name)) dangling.add(name);
      }
      node.values.forEach(visit);
    }
  }

  visit(schema);
  return dangling;
}
