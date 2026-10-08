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
import 'package:a2ui_core/src/primitives/reference_schema.dart'
    show ReferenceSchemaReader;
import 'package:a2ui_core/src/rendering/binder.dart' show GenericBinder;
import 'package:json_schema_builder/json_schema_builder.dart' show Schema;
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

/// The published v1.0 basic catalog, which declares `protocolVersion: "1.0"`.
const String basicCatalogV1Path = '../catalogs/basic/v1/catalog.json';

Map<String, Object?> loadBasicCatalogV1Json() => jsonDecode(
      File(resolveConformancePath(basicCatalogV1Path)).readAsStringSync(),
    ) as Map<String, Object?>;

void main() {
  group('Catalog.commonTypesSchema', () {
    Map<String, Object?> defsOf(CatalogApi catalog) =>
        (catalog.commonTypesSchema[r'$defs']! as Map).cast<String, Object?>();

    /// The `CheckRule` schema that `common_types.json#/$defs/Checkable`
    /// leads to when read against [catalog]'s documents, the way
    /// `Catalog.refMap` and `GenericBinder` read it.
    Map<String, Object?> checkRuleOf(CatalogApi catalog) {
      final reader = ReferenceSchemaReader(
        <String, Object?>{},
        document: catalog.catalogSchema,
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
            isA<A2uiCatalogError>()
                .having((e) => e.catalogId, 'catalogId', 'versioned'),
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
      expect(catalog.catalogSchema['protocolVersion'], '1.0');
      expect(
        Catalog.fromJson(catalog.catalogSchema).protocolVersion,
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
          catalog: rendererCatalog,
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

  group('Catalog code-defined', () {
    test('serializes catalogSchema with id and component envelopes', () {
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

      final Map<String, Object?> schema = catalog.catalogSchema;
      expect(schema[r'$schema'], Catalog.jsonSchemaDialect);
      expect(schema['catalogId'], 'https://example.com/custom-catalog');
      expect(schema['protocolVersion'], '0.9');

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

    test('serializes a v1.0 catalogSchema with @call and no id', () {
      final Catalog<ComponentApi, FunctionApi> catalog = Catalog(
        id: 'https://example.com/custom-catalog',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: [
          ComponentApi(
            name: 'Button',
            schema: Schema.fromMap({
              'type': 'object',
              'properties': {
                'label': {r'$ref': r'#/$defs/DynamicString'},
                'child': {r'$ref': r'#/$defs/Child'},
              },
              'required': ['label'],
            }),
          ),
        ],
        functions: [
          FunctionApi(
            name: 'f',
            argumentSchema: Schema.object(
              properties: {'value': Schema.string()},
            ),
            returnType: A2uiReturnType.string,
          ),
        ],
      );

      final Map<String, Object?> schema = catalog.catalogSchema;
      expect(schema['protocolVersion'], '1.0');

      final button =
          (schema['components'] as Map<String, Object?>)['Button']
              as Map<String, Object?>;
      final props = button['properties'] as Map<String, Object?>;
      expect(props.containsKey('id'), isFalse);
      expect(props['component'], {'const': 'Button'});
      expect(button['required'], ['label', 'component']);

      final f = (schema['functions'] as Map<String, Object?>)['f']
          as Map<String, Object?>;
      final fProps = f['properties'] as Map<String, Object?>;
      expect(fProps['@call'], {'const': 'f'});
      expect(fProps.containsKey('call'), isFalse);
      expect(f['required'], ['@call', 'args']);
      expect(f.containsKey('unevaluatedProperties'), isFalse);

      // Shared types are bundled from the v1.0 common_types.json, including
      // what they reference in turn (Child points at ComponentId).
      final defs = schema[r'$defs'] as Map<String, Object?>;
      expect(defs.containsKey('Child'), isTrue);
      expect(defs.containsKey('ComponentId'), isTrue);
      expect(defs.containsKey('DataBinding'), isTrue);
      expect(jsonEncode(defs['DataBinding']), contains('"@path"'));
      expect(jsonEncode(defs['DataBinding']), isNot(contains('"path"')));
    });
  });
}
