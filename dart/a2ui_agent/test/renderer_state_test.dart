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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

final CatalogApi _basic = BasicCatalog.v0_9();

CreateSurfaceMessage _create({String catalogId = BasicCatalog.v0_9Id}) =>
    CreateSurfaceMessage(version: 'v0.9', surfaceId: 's', catalogId: catalogId);

DeleteSurfaceMessage _delete() =>
    DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's');

UpdateComponentsMessage _update(
  List<Map<String, Object?>> components, {
  String version = 'v0.9',
}) => UpdateComponentsMessage(
  version: version,
  surfaceId: 's',
  components: components,
);

Map<String, Object?> _column(List<String> children, {String id = 'root'}) => {
  'id': id,
  'component': 'Column',
  'children': children,
};

Map<String, Object?> _text(String id, [String text = 'Hi']) => {
  'id': id,
  'component': 'Text',
  'text': text,
};

/// Applies one turn's messages and checks the trees they touch.
void _turn(RendererState state, List<AgentToRendererMessage> messages) =>
    state.checkTopology(state.apply(messages));

Set<String> _componentIds(RendererState state) =>
    state.getSurface('s')!.componentsModel.keys.toSet();

/// The surfaces [state] holds, as plain data, to compare two states.
Map<String, Object?> _snapshot(RendererState state) => {
  for (final String id in state.surfaceIds)
    id: [
      {
        for (final ComponentModel c
            in state.getSurface(id)!.componentsModel.values)
          c.id: [c.type, c.properties],
      },
      state.getSurface(id)!.dataModel.get('/'),
    ],
};

/// A state holding a surface whose root column shows one text.
RendererState _canvas() {
  final state = RendererState([_basic]);
  _turn(state, [
    _create(),
    _update([
      _column(['a']),
      _text('a'),
    ]),
  ]);
  return state;
}

UpdateDataModelMessage _data(String path, Object? value) =>
    UpdateDataModelMessage(
      version: 'v0.9',
      surfaceId: 's',
      path: path,
      value: value,
    );

Object? _textOf(RendererState state, String componentId) =>
    state.getSurface('s')?.componentsModel.get(componentId)?.properties['text'];

/// A catalog with [id] that declares [components], each with a string
/// `text`, which [version] 1.0 requires.
CatalogApi _catalog(
  String id,
  List<String> components, {
  String version = '0.9',
}) => Catalog.fromJson({
  'catalogId': id,
  'protocolVersion': version,
  'components': {
    for (final String name in components)
      name: {
        'type': 'object',
        'properties': {
          'text': {'type': 'string'},
        },
        if (version == '1.0') 'required': ['text'],
      },
  },
});

void main() {
  group('RendererState', () {
    test('a later turn may reference components of an earlier turn', () {
      final RendererState state = _canvas();

      _turn(state, [
        _update([
          _column(['a', 'b']),
          _text('b'),
        ]),
      ]);

      expect(_componentIds(state), {'root', 'a', 'b'});
    });

    test('a later turn rejects a reference no turn sent', () {
      final RendererState state = _canvas();
      final List<UpdateComponentsMessage> payload = [
        _update([
          _column(['a', 'missing']),
        ]),
      ];

      // Checked on its own, the update may refer to anything the renderer
      // holds.
      validatePayload([_basic], payload);
      expect(
        () => _turn(state, payload),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains("non-existent component 'missing'"),
          ),
        ),
      );
    });

    test('a later turn rejects a cycle with earlier components', () {
      final RendererState state = _canvas();

      expect(
        () => state.apply([
          _update([
            _column(['root'], id: 'a'),
          ]),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('a later turn rejects a new component that is unreachable', () {
      final RendererState state = _canvas();

      expect(
        () => _turn(state, [
          _update([_text('orphan')]),
        ]),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains("'orphan' is not reachable"),
          ),
        ),
      );
    });

    test('a later turn may leave a replaced component unreachable', () {
      // The protocol cannot remove one component, so replacing one detaches
      // it.
      final RendererState state = _canvas();

      _turn(state, [
        _update([
          _column(['b']),
          _text('b'),
        ]),
      ]);
      _turn(state, [
        _update([_text('b', 'Still fine')]),
      ]);

      expect(_componentIds(state), {'root', 'a', 'b'});
    });

    test('one payload may not add a component it leaves unreachable', () {
      final state = RendererState([_basic]);

      expect(
        () => _turn(state, [
          _create(),
          _update([
            _column(['a']),
            _text('a'),
          ]),
          _update([
            _column(['b']),
            _text('b'),
          ]),
        ]),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains("'a' is not reachable"),
          ),
        ),
      );
    });

    test('a surface with no root fails the topology check', () {
      final state = RendererState([_basic]);

      expect(
        () => _turn(state, [
          _create(),
          _update([_text('title')]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('creating a surface twice is rejected', () {
      final RendererState state = _canvas();

      expect(
        () => state.apply([_create()]),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains('already exists'),
          ),
        ),
      );
    });

    test('a deleted surface may be created again', () {
      final RendererState state = _canvas();

      _turn(state, [_delete()]);
      expect(state.surfaceIds, isEmpty);
      _turn(state, [
        _create(),
        _update([_text('root')]),
      ]);

      expect(_componentIds(state), {'root'});
    });

    test('an update to an unknown surface is rejected', () {
      final state = RendererState([_basic]);

      expect(
        () => state.apply([
          _update([
            _column(['a']),
          ]),
        ]),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains('Surface not found'),
          ),
        ),
      );
      expect(state.surfaceIds, isEmpty);
    });

    test('a surface on a catalog that is not active is rejected', () {
      final state = RendererState([_basic]);

      expect(
        () => state.apply([_create(catalogId: 'missing')]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('not active'),
          ),
        ),
      );
    });

    test('a message stating another version is rejected', () {
      final RendererState state = _canvas();

      expect(
        () => state.apply([
          _update([_text('a')], version: 'v1.0'),
        ]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("states version 'v1.0'"),
          ),
        ),
      );
    });

    test('an update with no components is rejected', () {
      final RendererState state = _canvas();

      expect(
        () => state.apply([_update([])]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('apply is atomic', () {
      final RendererState state = _canvas();
      final Map<String, Object?> before = _snapshot(state);

      expect(
        () => state.apply([
          _update([_text('a', 'Changed'), _text('b')]),
          _update([
            {'id': 'c', 'component': 'Unknown'},
          ]),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(_snapshot(state), before);
      expect(_componentIds(state), {'root', 'a'});
      expect(
        state.getSurface('s')!.componentsModel.get('a')!.properties['text'],
        'Hi',
      );
    });

    test('a failed transaction restores every call inside it', () {
      final state = RendererState([_basic]);

      expect(
        () => state.transaction(() {
          state.apply([
            _create(),
            _update([
              _column(['a']),
            ]),
          ]);
          state.checkTopology(['s']);
        }),
        throwsA(isA<A2uiIntegrityError>()),
      );

      expect(state.surfaceIds, isEmpty);
    });

    test('a successful transaction keeps its calls', () {
      final state = RendererState([_basic]);

      final List<String> touched = state.transaction(
        () => [
          ...state.apply([_create()]),
          ...state.apply([
            _update([_text('root')]),
          ]),
        ],
      );

      expect(touched, ['s', 's']);
      expect(_componentIds(state), {'root'});
    });

    test('catalogs with incompatible versions are rejected', () {
      expect(
        () => RendererState([_basic, BasicCatalog.v1_0()]),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('a state without catalogs is rejected', () {
      expect(() => RendererState([]), throwsA(isA<A2uiCatalogError>()));
    });

    test('a newer version of a message replaces the older one', () {
      // A stream applies a message again each time it grows.
      final List<UpdateComponentsMessage> versions = [
        _update([_text('a', 'Hel')]),
        _update([_text('a', 'Hello')]),
      ];
      final RendererState everyVersion = _canvas();
      final RendererState latestOnly = _canvas();

      for (final version in versions) {
        everyVersion.apply([version]);
      }
      latestOnly.apply([versions.last]);

      expect(_snapshot(everyVersion), _snapshot(latestOnly));
    });

    test('a rollback restores a deleted surface', () {
      final RendererState state = _canvas();

      expect(
        () => state.transaction(() {
          state.apply([_delete()]);
          state.apply([
            _update([_text('a')]),
          ]);
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(_componentIds(state), {'root', 'a'});
    });

    test(
      'nested rollbacks restore the state from before the outer transaction',
      () {
        final RendererState state = _canvas();

        expect(
          () => state.transaction(() {
            state.apply([
              _update([_text('a', 'Outer')]),
            ]);
            expect(
              () => state.apply([
                _update([
                  {'id': 'x', 'component': 'Unknown'},
                ]),
              ]),
              throwsA(isA<A2uiValidationError>()),
            );
            state.apply([
              _update([_text('a', 'Changed again')]),
            ]);
            state.apply([
              _update([
                {'id': 'y', 'component': 'Unknown'},
              ]),
            ]);
          }),
          throwsA(isA<A2uiValidationError>()),
        );

        expect(
          state.getSurface('s')!.componentsModel.get('a')!.properties['text'],
          'Hi',
        );
      },
    );

    test('a rollback restores the data model', () {
      final RendererState state = _canvas()
        ..apply([
          UpdateDataModelMessage(
            version: 'v0.9',
            surfaceId: 's',
            value: {
              'user': {'name': 'Ada'},
            },
          ),
        ]);

      expect(
        () => state.transaction(() {
          state.apply([
            UpdateDataModelMessage(
              version: 'v0.9',
              surfaceId: 's',
              path: '/user/name',
              value: 'Grace',
            ),
          ]);
          throw StateError('abort');
        }),
        throwsStateError,
      );

      expect(state.getSurface('s')!.dataModel.get('/'), {
        'user': {'name': 'Ada'},
      });
    });

    test('a failed inner transaction restores the state where it started, '
        'and the outer one goes on', () {
      final RendererState state = _canvas();

      state.transaction(() {
        state.apply([
          _update([_text('a', 'Outer')]),
        ]);
        expect(
          () => state.transaction(() {
            state.apply([
              _update([_text('a', 'Inner'), _text('b')]),
            ]);
            state.apply([_data('/name', 'Inner')]);
            state.apply([
              _update([
                {'id': 'x', 'component': 'Unknown'},
              ]),
            ]);
          }),
          throwsA(isA<A2uiValidationError>()),
        );
        expect(_textOf(state, 'a'), 'Outer');
        state.apply([
          _update([
            _column(['a', 'c']),
            _text('c'),
          ]),
        ]);
      });

      expect(_componentIds(state), {'root', 'a', 'c'});
      expect(_textOf(state, 'a'), 'Outer');
      expect(state.getSurface('s')!.dataModel.get('/'), isEmpty);
    });

    test('a rollback undoes an update in place on the same objects', () {
      final RendererState state = _canvas();
      final SurfaceModel<ComponentApi> surface = state.getSurface('s')!;
      final ComponentModel component = surface.componentsModel.get('a')!;
      final Map<String, Object?> before = _snapshot(state);

      expect(
        () => state.transaction(() {
          state.apply([
            _update([_text('a', 'Changed')]),
          ]);
          state.apply([
            _update([_text('a', 'Changed again')]),
          ]);
          state.apply([
            _update([
              {'id': 'x', 'component': 'Unknown'},
            ]),
          ]);
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      // The same objects hold the state: the rollback undid the updates
      // rather than swapping in a copy of the surface.
      expect(state.getSurface('s'), same(surface));
      expect(surface.componentsModel.get('a'), same(component));
      expect(_snapshot(state), before);
    });

    test('a rollback undoes an update that changes a component type', () {
      final RendererState state = _canvas();
      final Map<String, Object?> before = _snapshot(state);

      expect(
        () => state.transaction(() {
          state.apply([
            _update([
              {'id': 'a', 'component': 'Divider'},
            ]),
          ]);
          state.apply([
            _update([
              {'id': 'x', 'component': 'Unknown'},
            ]),
          ]);
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(_snapshot(state), before);
      expect(state.getSurface('s')!.componentsModel.get('a')!.type, 'Text');
    });

    test(
      'a rollback restores a surface that was deleted and created again',
      () {
        final RendererState state = _canvas()
          ..apply([
            _data('/items', ['x', 'y']),
          ]);
        final Map<String, Object?> before = _snapshot(state);

        expect(
          () => state.transaction(() {
            state.apply([
              _update([_text('a', 'Before delete')]),
            ]);
            state.apply([
              _delete(),
              _create(),
              _update([
                _column(['n']),
                _text('n'),
              ]),
            ]);
            state.apply([_data('/items/5', 'z')]);
            state.apply([
              _update([
                {'id': 'x', 'component': 'Unknown'},
              ]),
            ]);
          }),
          throwsA(isA<A2uiValidationError>()),
        );

        expect(_snapshot(state), before);
        // The restored surface still holds what changes to its tree check.
        expect(
          () => _turn(state, [
            _update([_text('orphan')]),
          ]),
          throwsA(isA<A2uiIntegrityError>()),
        );
      },
    );

    test('a rollback undoes data model writes that create containers and '
        'pad lists', () {
      final RendererState state = _canvas()
        ..apply([
          _data('/', {
            'list': ['a'],
            'nested': {'kept': 1},
            'empty': null,
          }),
        ]);
      final Object? before = _deepCopy(
        state.getSurface('s')!.dataModel.get('/'),
      );

      expect(
        () => state.transaction(() {
          state.apply([_data('/list/3', 'd')]);
          state.apply([_data('/list/5/deep', 'e')]);
          state.apply([_data('/nested/kept', 2)]);
          state.apply([_data('/fresh/deep/path', true)]);
          state.apply([_data('/empty/inner', 1)]);
          state.apply([_data('/nested', null)]);
          state.apply([
            _update([
              {'id': 'x', 'component': 'Unknown'},
            ]),
          ]);
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      final DataModel dataModel = state.getSurface('s')!.dataModel;
      expect(dataModel.get('/'), before);
      expect(dataModel.get('/list'), hasLength(1));
      expect(dataModel.has('/empty'), isTrue);
    });

    test('a rollback restores what a tree check marked checked', () {
      final RendererState state = _canvas()
        // Not reachable yet, so the next tree check of the surface holds it
        // to that.
        ..apply([
          _update([_text('b')]),
        ]);

      expect(
        () => state.transaction(() {
          _turn(state, [
            _update([
              _column(['a', 'b']),
            ]),
          ]);
          throw StateError('the response failed later');
        }),
        throwsStateError,
      );

      expect(
        () => state.checkTopology(['s']),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('a rollback restores the components of a v1.0 surface from two '
        'catalogs', () {
      final state =
          RendererState([
            _catalog('urn:primary', ['Panel'], version: '1.0'),
            _catalog('urn:extra', ['Badge'], version: '1.0'),
          ])..apply([
            CreateSurfaceMessage(
              version: 'v1.0',
              surfaceId: 's',
              catalogId: 'urn:primary',
            ),
            UpdateComponentsMessage(
              version: 'v1.0',
              surfaceId: 's',
              components: [
                {'id': 'root', 'component': 'Panel', 'text': 'Hi'},
                {
                  'id': 'b',
                  'component': 'Badge',
                  'text': 'New',
                  'catalogId': 'urn:extra',
                },
              ],
            ),
          ]);
      String? catalogOf(String id) =>
          state.getSurface('s')!.componentsModel.get(id)!.catalog;

      expect(
        () => state.transaction(() {
          state.apply([DeleteSurfaceMessage(version: 'v1.0', surfaceId: 's')]);
          state.apply([
            DeleteSurfaceMessage(version: 'v1.0', surfaceId: 'missing'),
          ]);
          state.apply([
            UpdateComponentsMessage(
              version: 'v1.0',
              surfaceId: 's',
              components: [
                {'id': 'root', 'component': 'Panel'},
              ],
            ),
          ]);
        }),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(_componentIds(state), {'root', 'b'});
      expect(catalogOf('root'), isNull);
      expect(catalogOf('b'), 'urn:extra');
      expect(state.getSurface('s')!.defaultCatalog!.id, 'urn:primary');
    });

    test('an updated surface is checked against the catalog it was created '
        'with', () {
      // Checked on its own, an update passes on any catalog that accepts it.
      final List<CatalogApi> catalogs = [
        _catalog('a', ['Text']),
        _catalog('b', ['Text', 'Card']),
      ];
      final UpdateComponentsMessage update = _update([
        {'id': 'c', 'component': 'Card', 'text': 'Hi'},
      ]);

      validatePayload(catalogs, [update]);
      final state = RendererState(catalogs)..apply([_create(catalogId: 'a')]);
      expect(
        () => state.apply([update]),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("no component named 'Card'"),
          ),
        ),
      );
    });

    test('checks v1.0 messages', () {
      final state = RendererState([BasicCatalog.v1_0()]);

      _turn(state, [
        CreateSurfaceMessage(
          version: 'v1.0',
          surfaceId: 's',
          catalogId: BasicCatalog.v1_0Id,
          components: [_text('root')],
        ),
      ]);
      expect(_componentIds(state), {'root'});
      expect(state.apply([]), isEmpty);
    });

    test('markChecked stops holding changed components against checks', () {
      final RendererState state = _canvas()
        ..apply([
          _update([_text('orphan')]),
        ]);

      state.markChecked(['s']);

      state.checkTopology(['s']);
    });

    test('markChecked still reports a dangling reference', () {
      final RendererState state = _canvas()
        ..apply([
          _update([
            _column(['a', 'missing']),
          ]),
        ]);

      state.markChecked(['s']);

      expect(
        () => state.checkTopology(['s']),
        throwsA(
          isA<A2uiIntegrityError>().having(
            (e) => e.message,
            'message',
            contains("non-existent component 'missing'"),
          ),
        ),
      );
    });
  });
}

/// A deep copy of [value], a JSON value.
Object? _deepCopy(Object? value) => switch (value) {
  final Map<Object?, Object?> map => {
    for (final MapEntry<Object?, Object?> entry in map.entries)
      entry.key: _deepCopy(entry.value),
  },
  final List<Object?> list => [
    for (final Object? item in list) _deepCopy(item),
  ],
  _ => value,
};
