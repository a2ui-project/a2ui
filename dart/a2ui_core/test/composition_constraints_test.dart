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
import 'package:a2ui_core/src/validation/component_graph.dart';
import 'package:a2ui_core/src/validation/component_refs.dart';
import 'package:test/test.dart';

const String _childListRef =
    'https://a2ui.org/specification/v1_0/common_types.json#/\$defs/ChildList';

/// A v1.0 catalog declaring composition constraints on three of its types.
CatalogApi _catalog() => Catalog.fromJson({
      'catalogId': 'custom',
      'protocolVersion': 'v1.0',
      'components': {
        'Column': {
          'type': 'object',
          'properties': {
            'children': {r'$ref': _childListRef},
          },
        },
        'Row': {
          'type': 'object',
          'properties': {
            'children': {r'$ref': _childListRef},
          },
        },
        'ColumnHeader': {
          'type': 'object',
          'allowedParents': ['Column'],
        },
        'RestrictedBox': {
          'type': 'object',
          'allowedChildren': ['Text', 'Button'],
          'properties': {
            'children': {r'$ref': _childListRef},
          },
        },
        'Banner': {
          'type': 'object',
          'allowedParents': ['Surface'],
        },
        'Text': {'type': 'object'},
        'Video': {'type': 'object'},
      },
    });

void _check(
  CatalogApi catalog,
  List<Map<String, Object?>> components, {
  String? surfaceId = 's1',
}) =>
    checkCompositionConstraints(
      components,
      extractComponentRefFields(catalog),
      extractCompositionRules(catalog),
      surfaceId: surfaceId,
    );

Matcher _violation(String code, {required String path, String? message}) =>
    isA<A2uiValidationError>()
        .having((e) => e.code, 'code', code)
        .having((e) => e.path, 'path', path)
        .having((e) => e.surfaceId, 'surfaceId', 's1')
        .having(
          (e) => e.message,
          'message',
          message == null ? anything : message,
        );

void main() {
  group('Catalog.fromJson composition constraints', () {
    test('parses allowedParents and allowedChildren', () {
      final CatalogApi catalog = _catalog();

      expect(catalog.components['ColumnHeader']!.allowedParents, ['Column']);
      expect(catalog.components['ColumnHeader']!.allowedChildren, isNull);
      expect(
        catalog.components['RestrictedBox']!.allowedChildren,
        ['Text', 'Button'],
      );
      expect(catalog.components['Text']!.allowedParents, isNull);
    });

    test('rejects a non-list allowedParents', () {
      expect(
        () => Catalog.fromJson({
          'catalogId': 'custom',
          'components': {
            'A': {'allowedParents': 'Column'},
          },
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('checkCompositionConstraints', () {
    test('accepts a root whose allowedParents includes Surface', () {
      expect(
        () => _check(_catalog(), [
          {'id': 'root', 'component': 'Banner'},
        ]),
        returnsNormally,
      );
    });

    test('accepts types that declare no constraints', () {
      expect(
        () => _check(_catalog(), [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['h', 't'],
          },
          {'id': 'h', 'component': 'ColumnHeader'},
          {'id': 't', 'component': 'Text'},
        ]),
        returnsNormally,
      );
    });

    test('treats Surface as the parent of the root', () {
      expect(
        () => _check(_catalog(), [
          {'id': 'root', 'component': 'ColumnHeader'},
        ]),
        throwsA(
          _violation(
            'UNALLOWED_PARENT',
            path: '/components/0',
            message: "Component 'root' (ColumnHeader) cannot be placed under "
                "parent 'Surface' (Surface). Allowed parents: ['Column'].",
          ),
        ),
      );
    });

    test('rejects a child under a parent it does not allow', () {
      expect(
        () => _check(_catalog(), [
          {
            'id': 'root',
            'component': 'Row',
            'children': ['invalid_header'],
          },
          {'id': 'invalid_header', 'component': 'ColumnHeader'},
        ]),
        throwsA(
          _violation(
            'UNALLOWED_PARENT',
            path: '/components/0/children/0',
            message: "Component 'invalid_header' (ColumnHeader) cannot be "
                "placed under parent 'root' (Row). Allowed parents: "
                "['Column'].",
          ),
        ),
      );
    });

    test('rejects a child a container does not allow', () {
      expect(
        () => _check(_catalog(), [
          {
            'id': 'root',
            'component': 'RestrictedBox',
            'children': ['t1', 'v1'],
          },
          {'id': 't1', 'component': 'Text'},
          {'id': 'v1', 'component': 'Video'},
        ]),
        throwsA(
          _violation(
            'UNALLOWED_CHILD',
            path: '/components/0/children/1',
            message: "Container 'root' (RestrictedBox) cannot contain child "
                "'v1' (Video). Allowed children: ['Text', 'Button'].",
          ),
        ),
      );
    });

    test('skips references to components it cannot see', () {
      expect(
        () => _check(_catalog(), [
          {
            'id': 'root',
            'component': 'RestrictedBox',
            'children': ['elsewhere'],
          },
        ]),
        returnsNormally,
      );
    });
  });

  group('MessageProcessor composition constraints', () {
    MessageProcessor<ComponentApi> processor(CatalogApi catalog) =>
        MessageProcessor<ComponentApi>(
          catalogs: [
            Catalog<ComponentApi, FunctionImplementation>(
              id: catalog.id,
              protocolVersion: catalog.protocolVersion,
              components: catalog.components.values.toList(),
            ),
          ],
          protocolVersion: A2uiProtocolVersion.v0_9,
        );

    test('rejects an unallowed child before mutating the surface', () {
      final MessageProcessor<ComponentApi> p = processor(_catalog());

      expect(
        () => p.processMessages(
          AgentToRendererMessage.parseAll([
            {
              'version': 'v0.9',
              'createSurface': {'surfaceId': 's1', 'catalogId': 'custom'},
            },
            {
              'version': 'v0.9',
              'updateComponents': {
                'surfaceId': 's1',
                'components': [
                  {
                    'id': 'root',
                    'component': 'RestrictedBox',
                    'children': ['v1'],
                  },
                  {'id': 'v1', 'component': 'Video'},
                ],
              },
            },
          ], protocolVersion: A2uiProtocolVersion.v0_9),
        ),
        throwsA(
          _violation('UNALLOWED_CHILD', path: '/components/0/children/0'),
        ),
      );
      expect(
        p.groupModel.getSurface('s1')?.componentsModel.get('root'),
        isNull,
      );
    });
  });
}
