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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

void main() {
  group('Catalog.fromJson', () {
    test('parses components and functions from catalog schema', () {
      final json = {
        'catalogId': 'test_catalog',
        'version': '0.9',
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

      final catalog = Catalog.fromJson(json);

      expect(catalog.id, equals('test_catalog'));
      expect(catalog.version, equals('v0.9.1'));
      expect(catalog.components.keys, containsAll(['Heading', 'ComplexCard']));

      final heading = catalog.components['Heading']!;
      expect(heading.name, equals('Heading'));
      expect(heading.description, equals('A simple heading'));
      expect(heading.properties.keys, containsAll(['text', 'level']));
      expect(heading.requiredProperties, contains('text'));

      final card = catalog.components['ComplexCard']!;
      expect(card.name, equals('ComplexCard'));
      expect(card.description, equals('Card description from allOf'));
      expect(card.properties.keys, containsAll(['child', 'elevation']));
      expect(card.requiredProperties, contains('child'));

      expect(catalog.functions.keys, contains('openUrl'));
      final fn = catalog.functions['openUrl'] as CatalogFunctionDefinition;
      expect(fn.name, equals('openUrl'));
      expect(fn.description, equals('Opens a URL'));
      expect(fn.returnType, equals(A2uiReturnType.boolean));
      expect(fn.parameters.keys, containsAll(['url', 'target']));
      expect(fn.requiredParameters, contains('url'));
    });
  });
}
