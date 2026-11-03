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

/// A catalog document with the given parts, declaring [protocolVersion]
/// unless it is null.
Map<String, Object?> _catalog({
  String? protocolVersion = '1.0',
  Map<String, Object?> components = const {},
  Map<String, Object?>? functions,
  Map<String, Object?>? defs,
}) =>
    {
      'catalogId': 'https://example.com/catalogs/refs',
      if (protocolVersion != null) 'protocolVersion': protocolVersion,
      'components': components,
      if (functions != null) 'functions': functions,
      if (defs != null) r'$defs': defs,
    };

/// A component named [name] whose `value` property is [valueSchema].
Map<String, Object?> _component(String name, Object? valueSchema) => {
      name: {
        'type': 'object',
        'properties': {
          'component': {'const': name},
          'value': valueSchema,
        },
        'required': ['component'],
      },
    };

Matcher _unsupportedRef(String ref, String path) => throwsA(
      isA<A2uiCatalogError>().having(
        (error) => error.message,
        'message',
        "Unsupported external \$ref '$ref' at $path: a v1.0 catalog may only "
            'reference its own components and functions (#/...) or '
            'common_types.json.',
      ),
    );

void main() {
  group('Catalog.fromJson external \$ref check (v1.0)', () {
    test('rejects a relative reference to a peer catalog', () {
      expect(
        () => Catalog.fromJson(
          _catalog(
            components: {
              'FancyText': {
                'type': 'object',
                'allOf': [
                  {r'$ref': 'basic_catalog.json#/components/Text'},
                ],
                'properties': {
                  'component': {'const': 'FancyText'},
                },
              },
            },
          ),
        ),
        _unsupportedRef(
          'basic_catalog.json#/components/Text',
          r'/components/FancyText/allOf/0/$ref',
        ),
      );
    });

    test('rejects an absolute URI reference to another catalog', () {
      const ref = 'https://a2ui.org/specification/v1_0/catalogs/basic/'
          'catalog.json#/components/Button/properties/action';
      expect(
        () => Catalog.fromJson(
          _catalog(components: _component('FancyButton', {r'$ref': ref})),
        ),
        _unsupportedRef(ref, r'/components/FancyButton/properties/value/$ref'),
      );
    });

    test('rejects a catalog.json that is not the catalog itself', () {
      expect(
        () => Catalog.fromJson(
          _catalog(
            components: _component('Thing', {
              r'$ref': 'foo/catalog.json#/components/Text',
            }),
          ),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects a reference nested in function arguments', () {
      const ref = 'other_catalog.json#/functions/formatString';
      expect(
        () => Catalog.fromJson(
          _catalog(
            functions: {
              'formatBadge': {
                'type': 'object',
                'returnType': 'string',
                'properties': {
                  '@call': {'const': 'formatBadge'},
                  'args': {
                    'type': 'object',
                    'properties': {
                      'value': {r'$ref': ref},
                    },
                  },
                },
                'required': ['@call', 'args'],
              },
            },
          ),
        ),
        _unsupportedRef(
          ref,
          r'/functions/formatBadge/properties/args/properties/value/$ref',
        ),
      );
    });

    test(r'rejects a reference nested in $defs', () {
      const ref = 'other_catalog.json#/\$defs/Shared';
      expect(
        () => Catalog.fromJson(
          _catalog(
            defs: {
              'Shared': {
                'anyOf': [
                  {'type': 'string'},
                  {r'$ref': ref},
                ],
              },
            },
          ),
        ),
        _unsupportedRef(ref, r'/$defs/Shared/anyOf/1/$ref'),
      );
    });

    test('escapes JSON pointer tokens in the reported path', () {
      expect(
        () => Catalog.fromJson(
          _catalog(
            defs: {
              'a/b~c': {r'$ref': 'x.json'},
            },
          ),
        ),
        _unsupportedRef('x.json', r'/$defs/a~1b~0c/$ref'),
      );
    });

    test('accepts local, common_types.json and catalog.json references', () {
      final CatalogApi catalog = Catalog.fromJson(
        _catalog(
          components: {
            'Label': {
              'type': 'object',
              'allOf': [
                {r'$ref': r'common_types.json#/$defs/Checkable'},
              ],
              'properties': {
                'component': {'const': 'Label'},
                'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
                'caption': {
                  r'$ref': 'https://a2ui.org/specification/v1_0/'
                      r'common_types.json#/$defs/DynamicString',
                },
                'tone': {r'$ref': r'#/$defs/Tone'},
                'size': {r'$ref': r'catalog.json#/$defs/Tone'},
              },
              'required': ['component', 'text'],
            },
          },
          defs: {
            'Tone': {
              'type': 'string',
              'enum': ['plain', 'loud'],
            },
          },
        ),
      );
      expect(catalog.components.keys, ['Label']);
    });

    test('leaves a v0.9 catalog unaffected', () {
      final CatalogApi catalog = Catalog.fromJson(
        _catalog(
          protocolVersion: null,
          components: _component('Thing', {
            r'$ref': 'basic_catalog.json#/components/Text',
          }),
        ),
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      expect(catalog.components.keys, ['Thing']);
    });
  });
}
