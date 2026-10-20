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

import 'dart:math';

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
  Iterable<Map<String, Object?>> existing = const [],
  String rootId = 'root',
  String? surfaceId = 's1',
}) =>
    checkCompositionConstraints(
      components,
      extractComponentRefFields(catalog),
      extractCompositionRules(catalog),
      existing: existing,
      rootId: rootId,
      surfaceId: surfaceId,
    );

Matcher _violation(String code, {required String? path, String? message}) =>
    isA<A2uiValidationError>()
        .having((e) => e.code, 'code', code)
        .having((e) => e.path, 'path', path)
        .having((e) => e.surfaceId, 'surfaceId', 's1')
        .having(
          (e) => e.message,
          'message',
          message ?? anything,
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

    test('omits the path when the offending parent was already stored', () {
      expect(
        () => _check(
          _catalog(),
          [
            {'id': 'v1', 'component': 'Video'},
          ],
          existing: [
            {
              'id': 'root',
              'component': 'RestrictedBox',
              'children': ['v1'],
            },
          ],
        ),
        throwsA(
          _violation(
            'UNALLOWED_CHILD',
            path: null,
            message: "Container 'root' (RestrictedBox) cannot contain child "
                "'v1' (Video). Allowed children: ['Text', 'Button'].",
          ),
        ),
      );
    });

    test('points at the message component when it is the parent', () {
      expect(
        () => _check(
          _catalog(),
          [
            {'id': 't', 'component': 'Text'},
            {
              'id': 'root',
              'component': 'RestrictedBox',
              'children': ['v1'],
            },
          ],
          existing: [
            {'id': 'v1', 'component': 'Video'},
          ],
        ),
        throwsA(
          _violation('UNALLOWED_CHILD', path: '/components/1/children/0'),
        ),
      );
    });

    test('treats Surface as the parent of the configured root id', () {
      expect(
        () => _check(
          _catalog(),
          [
            {'id': 'main', 'component': 'ColumnHeader'},
          ],
          rootId: 'main',
        ),
        throwsA(_violation('UNALLOWED_PARENT', path: '/components/0')),
      );
      expect(
        () => _check(
          _catalog(),
          [
            {'id': 'root', 'component': 'ColumnHeader'},
          ],
          rootId: 'main',
        ),
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
          defaultVersion: A2uiProtocolVersion.v1_0,
        );

    test('rejects an unallowed child before mutating the surface', () {
      final MessageProcessor<ComponentApi> p = processor(_catalog());

      expect(
        () => p.processMessages(
          AgentToRendererMessage.parseAll([
            {
              'version': 'v1.0',
              'createSurface': {'surfaceId': 's1', 'catalogId': 'custom'},
            },
            {
              'version': 'v1.0',
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
          ], protocolVersion: A2uiProtocolVersion.v1_0),
        ),
        throwsA(
          _violation('UNALLOWED_CHILD', path: '/components/0/children/0'),
        ),
      );
      expect(
        p.model.getSurface('s1')?.componentsModel.get('root'),
        isNull,
      );
    });

    test('omits the path when the parent arrived in an earlier message', () {
      final MessageProcessor<ComponentApi> p = processor(_catalog());
      p.processMessages(
        AgentToRendererMessage.parseAll([
          {
            'version': 'v1.0',
            'createSurface': {'surfaceId': 's1', 'catalogId': 'custom'},
          },
          {
            'version': 'v1.0',
            'updateComponents': {
              'surfaceId': 's1',
              'components': [
                {
                  'id': 'root',
                  'component': 'RestrictedBox',
                  'children': ['v1'],
                },
              ],
            },
          },
        ], protocolVersion: A2uiProtocolVersion.v1_0),
      );

      expect(
        () => p.processMessages(
          AgentToRendererMessage.parseAll([
            {
              'version': 'v1.0',
              'updateComponents': {
                'surfaceId': 's1',
                'components': [
                  {'id': 'v1', 'component': 'Video'},
                ],
              },
            },
          ], protocolVersion: A2uiProtocolVersion.v1_0),
        ),
        throwsA(
          _violation(
            'UNALLOWED_CHILD',
            path: null,
            message: "Container 'root' (RestrictedBox) cannot contain child "
                "'v1' (Video). Allowed children: ['Text', 'Button'].",
          ),
        ),
      );
      expect(
        p.model.getSurface('s1')?.componentsModel.get('v1'),
        isNull,
      );
    });

    test('treats Surface as the parent of the configured root id', () {
      final p = MessageProcessor<ComponentApi>(
        catalogs: [
          Catalog<ComponentApi, FunctionImplementation>(
            id: 'custom',
            protocolVersion: A2uiProtocolVersion.v1_0,
            components: _catalog().components.values.toList(),
          ),
        ],
        defaultVersion: A2uiProtocolVersion.v1_0,
        validationConfig: const ValidationConfig(
          rootId: 'main',
          allowOrphanComponents: true,
          allowMissingRoot: true,
          allowDanglingReferences: true,
          allowUnknownElements: true,
        ),
      );

      expect(
        () => p.processMessages(
          AgentToRendererMessage.parseAll([
            {
              'version': 'v1.0',
              'createSurface': {'surfaceId': 's1', 'catalogId': 'custom'},
            },
            {
              'version': 'v1.0',
              'updateComponents': {
                'surfaceId': 's1',
                'components': [
                  {'id': 'main', 'component': 'ColumnHeader'},
                ],
              },
            },
          ], protocolVersion: A2uiProtocolVersion.v1_0),
        ),
        throwsA(_violation('UNALLOWED_PARENT', path: '/components/0')),
      );
    });
  });

  group('MessageProcessor composition constraints under a deferred config', () {
    // Each batch after the first is checked against only the edges it
    // changes. A second processor checks each batch against the whole
    // surface, and the two must agree on every message.
    final configs = <String, ValidationConfig>{
      'missing root allowed': const ValidationConfig(
        allowDanglingReferences: true,
        allowOrphanComponents: true,
        allowMissingRoot: true,
      ),
      'orphans allowed': const ValidationConfig(
        allowDanglingReferences: true,
        allowOrphanComponents: true,
      ),
    };

    Map<String, Object?> component(
      String id,
      String type, [
      List<String>? children,
    ]) =>
        {
          'id': id,
          'component': type,
          if (children != null) 'children': children,
        };

    for (final MapEntry(key: String name, value: ValidationConfig config)
        in configs.entries) {
      group(name, () {
        test('rejects a child that arrives after its container', () {
          final p = _DeferredPair(config);
          p.expectSame([
            component('root', 'Strict', ['a']),
          ]);
          expect(
            p.expectSame([component('a', 'Card')]),
            _violation('UNALLOWED_CHILD', path: null),
          );
        });

        test('rejects a container that arrives after its child', () {
          final p = _DeferredPair(config);
          p.expectSame([component('root', 'Box')]);
          p.expectSame([component('a', 'Card')]);
          expect(
            p.expectSame([
              component('b', 'Strict', ['a']),
            ]),
            _violation('UNALLOWED_CHILD', path: '/components/0/children/0'),
          );
        });

        test('rejects a child added to a container in a later message', () {
          final p = _DeferredPair(config);
          p.expectSame([
            component('root', 'Strict', ['a']),
          ]);
          p.expectSame([component('a', 'Item')]);
          p.expectSame([component('b', 'Card')]);
          expect(
            p.expectSame([
              component('root', 'Strict', ['a', 'b']),
            ]),
            _violation('UNALLOWED_CHILD', path: '/components/0/children/1'),
          );
        });

        test('accepts a container rewritten to drop a child it disallows', () {
          final p = _DeferredPair(config);
          p.expectSame([
            component('root', 'Box', ['a', 'h']),
          ]);
          p.expectSame([component('a', 'Item'), component('h', 'Header')]);
          expect(
            p.expectSame([
              component('root', 'Strict', ['a', 'h']),
            ]),
            _violation('UNALLOWED_CHILD', path: '/components/0/children/1'),
          );
          expect(
            p.expectSame([
              component('root', 'Strict', ['a']),
            ]),
            isNull,
          );
          // `h` no longer has a parent, and may be held by a `Box` again.
          expect(
            p.expectSame([
              component('b', 'Box', ['h']),
            ]),
            isNull,
          );
        });

        test('rejects a held child whose type changes', () {
          final p = _DeferredPair(config);
          p.expectSame([
            component('root', 'Strict', ['a']),
            component('a', 'Item'),
          ]);
          expect(
            p.expectSame([component('a', 'Header')]),
            _violation('UNALLOWED_CHILD', path: null),
          );
        });

        test('rejects a child under a holder its allowedParents omits', () {
          final p = _DeferredPair(config);
          p.expectSame([
            component('root', 'Box', ['c']),
            {'id': 'c', 'component': 'Card', 'child': 'x'},
          ]);
          expect(
            p.expectSame([component('x', 'Header')]),
            _violation('UNALLOWED_PARENT', path: null),
          );
        });

        test('rejects a root its allowedParents does not let the surface hold',
            () {
          final p = _DeferredPair(config);
          p.expectSame([
            component('a', 'Box', ['root']),
          ]);
          expect(
            p.expectSame([component('root', 'Header')]),
            _violation('UNALLOWED_PARENT', path: '/components/0'),
          );
        });

        test('agrees with the whole-surface check on random batches', () {
          const ids = ['root', 'a', 'b', 'c', 'd', 'e'];
          const types = ['Box', 'Strict', 'Card', 'Item', 'Header'];
          for (var seed = 0; seed < 200; seed++) {
            final random = Random(seed);
            final p = _DeferredPair(config);
            for (var step = 0; step < 20; step++) {
              final batch = <String, Map<String, Object?>>{};
              for (int k = 1 + random.nextInt(3); k > 0; k--) {
                final String id = ids[random.nextInt(ids.length)];
                final String type = types[random.nextInt(types.length)];
                batch[id] = {
                  'id': id,
                  'component': type,
                  if (type == 'Box' || type == 'Strict')
                    'children': (ids.toList()..shuffle(random))
                        .take(random.nextInt(4))
                        .toList(),
                  if (type == 'Card') 'child': ids[random.nextInt(ids.length)],
                };
              }
              p.expectSame(
                batch.values.toList(),
                reason: 'seed $seed, step $step',
              );
            }
          }
        });
      });
    }
  });
}

/// A catalog for [_DeferredPair], declaring both kinds of composition
/// constraint.
final Catalog<ComponentApi, FunctionImplementation> _deferredCatalog =
    Catalog<ComponentApi, FunctionImplementation>(
  id: 'custom',
  protocolVersion: A2uiProtocolVersion.v1_0,
  components: Catalog.fromJson({
    'catalogId': 'custom',
    'protocolVersion': 'v1.0',
    'components': {
      'Box': {
        'type': 'object',
        'properties': {
          'children': {r'$ref': _childListRef},
        },
      },
      'Strict': {
        'type': 'object',
        'allowedChildren': ['Item', 'Box'],
        'properties': {
          'children': {r'$ref': _childListRef},
        },
      },
      'Card': {
        'type': 'object',
        'properties': {
          'child': {
            r'$ref': 'https://a2ui.org/specification/v1_0/common_types.json'
                '#/\$defs/ComponentId',
          },
        },
      },
      'Item': {
        'type': 'object',
        'allowedParents': ['Strict', 'Box', 'Surface'],
      },
      'Header': {
        'type': 'object',
        'allowedParents': ['Box'],
      },
    },
  }).components.values.toList(),
);

/// Two processors under the same deferred [ValidationConfig], each holding
/// surface `s1`.
///
/// The first checks each batch against what the check of the batch before
/// found. The second has a component of its surface touched after each
/// batch, so it never starts from what the check before found, and checks
/// each batch against the whole surface.
class _DeferredPair {
  _DeferredPair(ValidationConfig config)
      : incremental = _processor(config),
        whole = _processor(config);

  final MessageProcessor<ComponentApi> incremental;
  final MessageProcessor<ComponentApi> whole;

  static MessageProcessor<ComponentApi> _processor(ValidationConfig config) =>
      MessageProcessor<ComponentApi>(
        catalogs: [_deferredCatalog],
        defaultVersion: A2uiProtocolVersion.v1_0,
        validationConfig: config,
      )..processMessages([
          {
            'version': 'v1.0',
            'createSurface': {'surfaceId': 's1', 'catalogId': 'custom'},
          },
        ]);

  /// Sends [components] to both processors, expects the same outcome and the
  /// same components from both, and returns the error both raised, or null.
  A2uiError? expectSame(
    List<Map<String, Object?>> components, {
    String? reason,
  }) {
    final A2uiError? expected = _send(whole, components);
    final A2uiError? actual = _send(incremental, components);
    final context = '${reason ?? ''} batch $components';
    expect(_describe(actual), _describe(expected), reason: context);
    expect(_snapshot(incremental), _snapshot(whole), reason: context);
    if (expected == null) {
      final ComponentModel first =
          whole.model.getSurface('s1')!.componentsModel.all.first;
      first.properties = first.properties;
    }
    return actual;
  }

  static A2uiError? _send(
    MessageProcessor<ComponentApi> processor,
    List<Map<String, Object?>> components,
  ) {
    try {
      processor.processMessages([
        {
          'version': 'v1.0',
          'updateComponents': {'surfaceId': 's1', 'components': components},
        },
      ]);
      return null;
    } on A2uiError catch (error) {
      return error;
    }
  }

  static String? _describe(A2uiError? error) => switch (error) {
        null => null,
        final A2uiValidationError e =>
          '${e.runtimeType} ${e.code} ${e.path}: ${e.message}',
        final e => '${e.runtimeType}: ${e.message}',
      };

  static Map<String, Object?> _snapshot(
    MessageProcessor<ComponentApi> processor,
  ) =>
      {
        for (final ComponentModel c
            in processor.model.getSurface('s1')!.componentsModel.all)
          c.id: c.toJson(),
      };
}
