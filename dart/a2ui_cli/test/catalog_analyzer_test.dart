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

import 'package:a2ui_cli/a2ui_cli.dart';
import 'package:a2ui_core/a2ui_core.dart' show A2uiReturnType;
import 'package:test/test.dart';

void main() {
  group('CodegenCatalog.fromJson & CatalogAnalyzer', () {
    test('parses components and functions from catalog schema', () {
      final json = <String, Object?>{
        'catalogId': 'test_catalog',
        'protocolVersion': 'v0.9.1',
        'components': {
          'Heading': {
            'description': 'A simple heading',
            'properties': {
              'text': {'type': 'string'},
              'level': {'type': 'integer', 'default': 1},
            },
            'required': ['text'],
          },
          'ComplexCard': {
            'allOf': [
              {
                'description': 'Card description from allOf',
                'properties': {
                  'child': {'type': 'string'},
                },
                'required': ['child'],
              },
              {
                'properties': {
                  'elevation': {'type': 'number'},
                },
              },
            ],
          },
        },
        'functions': {
          'openUrl': {
            'description': 'Opens a URL',
            'returnType': 'boolean',
            'properties': {
              'call': {'const': 'openUrl'},
              'args': {
                'type': 'object',
                'properties': {
                  'url': {'type': 'string'},
                  'target': {'type': 'string'},
                },
                'required': ['url'],
              },
            },
          },
        },
      };

      final catalog = CodegenCatalog.fromJson(json);

      expect(catalog.id, equals('test_catalog'));
      expect(catalog.version, equals('v0.9.1'));
      expect(catalog.components.keys, containsAll(['Heading', 'ComplexCard']));

      final CatalogComponentDefinition heading = catalog.components['Heading']!;
      expect(heading.name, equals('Heading'));
      expect(heading.description, equals('A simple heading'));
      expect(heading.properties.keys, containsAll(['text', 'level']));
      expect(heading.requiredProperties, contains('text'));

      final CatalogComponentDefinition card =
          catalog.components['ComplexCard']!;
      expect(card.name, equals('ComplexCard'));
      expect(card.description, equals('Card description from allOf'));
      expect(card.properties.keys, containsAll(['child', 'elevation']));
      expect(card.requiredProperties, contains('child'));

      expect(catalog.functions.keys, contains('openUrl'));
      final CatalogFunctionDefinition fn = catalog.functions['openUrl']!;
      expect(fn.name, equals('openUrl'));
      expect(fn.description, equals('Opens a URL'));
      expect(fn.returnType, equals(A2uiReturnType.boolean));
      expect(fn.parameters.keys, containsAll(['url', 'target']));
      expect(fn.requiredParameters, contains('url'));
    });

    test('resolves local JSON pointer with ~01 and ~1 RFC 6901 escapes', () {
      final json = <String, Object?>{
        'catalogId': 'pointer_catalog',
        'components': {
          'Custom': {
            'allOf': [
              {r'$ref': r'#/$defs/special~01key~1slash'},
            ],
          },
        },
        r'$defs': {
          'special~1key/slash': {
            'description': 'Resolved definition',
            'properties': {
              'foo': {'type': 'string'},
            },
          },
        },
      };

      final catalog = CodegenCatalog.fromJson(json);
      final CatalogComponentDefinition custom = catalog.components['Custom']!;
      expect(custom.description, equals('Resolved definition'));
      expect(custom.properties.keys, contains('foo'));
    });

    test('handles schema with nullable type list', () {
      final json = <String, Object?>{
        'catalogId': 'nullable_catalog',
        'components': {
          'NullableBox': {
            'properties': {
              'label': {
                'type': ['string', 'null'],
              },
            },
          },
        },
      };

      final catalog = CodegenCatalog.fromJson(json);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      final AnalysedComponentApi box = analysed.components['NullableBox']!;
      final PropertyDescriptor labelProp = box.properties['label']!;
      expect(labelProp.type, isA<UnionType>());
      expect(typeToPython(labelProp.type), equals('str | None'));
    });

    test('preserves scalar enum values instead of stringifying them', () {
      final catalog = CodegenCatalog.fromJson({
        'catalogId': 'scalar_enums',
        'components': {
          'Input': {
            'properties': {
              'choice': {
                'enum': [1, true, '1', null],
              },
            },
          },
        },
      });
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      expect(analysed.enums['InputChoice']!.values, [1, true, '1', null]);
    });

    test('falls back to default v0.9.1 when protocolVersion is omitted', () {
      final json = <String, Object?>{
        'catalogId': 'fallback_catalog',
        'components': {},
      };
      final catalog = CodegenCatalog.fromJson(json);
      expect(catalog.version, equals('v0.9.1'));
    });

    test(
      'resolves binding-only union without base types to DynamicType(any)',
      () {
        final json = <String, Object?>{
          'catalogId': 'binding_only_catalog',
          'components': {
            'RuleBox': {
              'properties': {
                'condition': {
                  'oneOf': [
                    {r'$ref': r'#/$defs/DataBinding'},
                    {r'$ref': r'#/$defs/FunctionCall'},
                  ],
                },
              },
            },
          },
        };

        final catalog = CodegenCatalog.fromJson(json);
        final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(
          catalog,
        );
        final AnalysedComponentApi box = analysed.components['RuleBox']!;
        final PropertyDescriptor conditionProp = box.properties['condition']!;
        expect(conditionProp.type, isA<DynamicType>());
        final dynType = conditionProp.type as DynamicType;
        expect(dynType.inner, isA<PrimitiveType>());
        expect(
          (dynType.inner as PrimitiveType).primitive,
          equals(PrimitiveKind.any),
        );
      },
    );

    test('skips @-prefixed component envelope mixins while preserving custom '
        'metadata, catalogId, accessibility, and checks properties', () {
      final json = <String, Object?>{
        'catalogId': 'envelope_props_catalog',
        'protocolVersion': '1.0',
        'components': {
          'CustomBox': {
            'properties': {
              'component': {'const': 'CustomBox'},
              '@catalogId': {'type': 'string'},
              '@metadata': {'type': 'object'},
              '@accessibility': {
                'type': 'object',
                'properties': {
                  'label': {'type': 'string'},
                },
              },
              '@checks': {
                'type': 'array',
                'items': {'type': 'object'},
              },
              'metadata': {'type': 'string'},
              'catalogId': {'type': 'string'},
              'accessibility': {'type': 'string'},
              'checks': {'type': 'integer'},
            },
            'required': ['component', 'metadata'],
          },
          'ScalarChecksOnly': {
            'properties': {
              'component': {'const': 'ScalarChecksOnly'},
              'checks': {'type': 'integer'},
            },
            'required': ['component'],
          },
        },
      };

      final catalog = CodegenCatalog.fromJson(json);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      final AnalysedComponentApi box = analysed.components['CustomBox']!;
      expect(box.isCheckable, isTrue);
      expect(
        box.properties.keys,
        unorderedEquals([
          '@checks',
          'metadata',
          'catalogId',
          'accessibility',
          'checks',
        ]),
      );
      final AnalysedComponentApi scalarChecks =
          analysed.components['ScalarChecksOnly']!;
      expect(scalarChecks.isCheckable, isFalse);
      expect(scalarChecks.properties.keys, equals(['checks']));
    });
  });
}
