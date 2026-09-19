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
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

Catalog<ComponentApi, FunctionImplementation> _catalog() => Catalog(
  id: 'diagnostic-test',
  components: [
    ComponentApi(name: 'Text', schema: Schema.object()),
    ComponentApi(
      name: 'Card',
      schema: Schema.object(properties: {'child': CommonSchemas.componentId}),
    ),
    ComponentApi(
      name: 'Column',
      schema: Schema.object(properties: {'children': CommonSchemas.childList}),
    ),
  ],
);

void _add(
  SurfaceModel<ComponentApi> surface,
  String id,
  String type, [
  Map<String, Object?> properties = const {},
]) =>
    surface.componentsModel.addComponent(ComponentModel(id, type, properties));

void main() {
  late SurfaceModel<ComponentApi> surface;
  late NodeResolver<ComponentApi> resolver;
  late List<A2uiClientError> errors;

  setUp(() {
    surface = SurfaceModel<ComponentApi>('surf', catalog: _catalog());
    resolver = NodeResolver(surface);
    errors = [];
    surface.onError.addListener(errors.add);
  });

  tearDown(() {
    resolver.dispose();
    surface.dispose();
  });

  int reports(String code) =>
      errors.where((error) => error.code == code).length;

  List<ComponentNode> children() =>
      (resolver.rootNode.peek()!.props.peek()['children']! as List)
          .cast<ComponentNode>();

  group('NodeResolver diagnostic parity', () {
    test(
      'reports an unknown type once per component, not referencing edge',
      () {
        _add(surface, 'weird', 'Bogus');
        _add(surface, 'root', 'Column', {
          'children': ['weird', 'weird'],
        });
        expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);
        expect(children(), hasLength(2));
        expect(children()[0], isNot(same(children()[1])));
        expect(
          children().map((node) => node.state),
          everyElement(NodeState.unknownType),
        );

        surface.componentsModel.removeComponent('weird');
        _add(surface, 'weird', 'Bogus');
        expect(reports('UNKNOWN_COMPONENT_TYPE'), 2);
      },
    );

    test('rearms after deleting and readding an id containing colons', () {
      _add(surface, 'root', 'Column', {
        'children': ['weird:x'],
      });
      _add(surface, 'weird:x', 'Bogus');
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);

      surface.componentsModel.removeComponent('weird:x');
      _add(surface, 'weird:x', 'Bogus');
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 2);
    });

    test('reports a cycle again after property repair and reintroduction', () {
      _add(surface, 'root', 'Card', {'child': 'card'});
      _add(surface, 'card', 'Card', {'child': 'card'});
      _add(surface, 'leaf', 'Text');
      expect(reports('CYCLIC_REFERENCE'), 1);

      surface.componentsModel.get('card')!.properties = {'child': 'leaf'};
      expect(reports('CYCLIC_REFERENCE'), 1);
      surface.componentsModel.get('card')!.properties = {'child': 'card'};
      expect(reports('CYCLIC_REFERENCE'), 2);
    });
  });

  group('NodeResolver diagnostic bookkeeping', () {
    test('a failed observer does not consume an undelivered diagnostic', () {
      var shouldThrow = true;
      final void Function() unsubscribe = resolver.rootNode.subscribe((node) {
        if (node != null && shouldThrow) {
          shouldThrow = false;
          throw StateError('root observer failed');
        }
      });
      addTearDown(unsubscribe);
      _add(surface, 'weird', 'Bogus');
      expect(
        () => _add(surface, 'root', 'Column', {
          'children': ['weird'],
        }),
        throwsA(isA<Exception>()),
      );
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 0);
      expect(resolver.activeNodeCount, 2);
      final ComponentModel root = surface.componentsModel.get('root')!;
      root.properties = {'children': <String>[]};
      root.properties = {
        'children': ['weird'],
      };
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);
      expect(children().single.state, NodeState.unknownType);
      root.properties = {
        'children': ['weird', 'weird'],
      };
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);
    });

    test('discarding queued reports preserves already delivered scopes', () {
      _add(surface, 'known', 'Bogus');
      _add(surface, 'later', 'Bogus');
      _add(surface, 'root', 'Column', {
        'children': ['known'],
      });
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);
      surface.componentsModel.removeComponent('root');
      var shouldThrow = true;
      final void Function() unsubscribe = resolver.rootNode.subscribe((node) {
        if (node != null && shouldThrow) {
          shouldThrow = false;
          throw StateError('root observer failed');
        }
      });
      addTearDown(unsubscribe);
      expect(
        () => _add(surface, 'root', 'Column', {
          'children': ['known', 'later'],
        }),
        throwsA(isA<Exception>()),
      );
      final ComponentModel root = surface.componentsModel.get('root')!;
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);
      root.properties = {'children': <String>[]};
      root.properties = {
        'children': ['known', 'later'],
      };
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 2);
      expect(errors.last.message, contains("Component 'later'"));
    });

    test('keeps distinct template data paths independent', () {
      surface.dataModel.set('/items', [1, 2]);
      _add(surface, 'weird', 'Bogus');
      _add(surface, 'root', 'Column', {
        'children': {'componentId': 'weird', 'path': '/items'},
      });
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 2);
      expect(children().map((node) => node.dataPath), ['/items/0', '/items/1']);
      surface.dataModel.set('/items', [1, 2, 3]);
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 3);
    });

    test(
      'different codes at one component and data path remain independent',
      () {
        _add(surface, 'leaf', 'Text');
        _add(surface, 'card', 'Card', {'child': 'card'});
        _add(surface, 'other', 'Card', {'child': 'leaf'});
        _add(surface, 'root', 'Column', {
          'children': ['card', 'other'],
        });
        expect(reports('CYCLIC_REFERENCE'), 1);

        // The existing card remains resolved, while a new reference cannot find
        // an implementation. Both conditions concern card at the root scope.
        surface.catalog.components.remove('Card');
        surface.componentsModel.get('other')!.properties = {'child': 'card'};
        expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);
        expect(reports('CYCLIC_REFERENCE'), 1);
      },
    );

    test('unmounting unknown nodes does not rearm a persistent condition', () {
      _add(surface, 'weird', 'Bogus');
      _add(surface, 'root', 'Column', {
        'children': ['weird', 'weird'],
      });
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);
      surface.componentsModel.get('root')!.properties = {
        'children': <String>[],
      };
      expect(resolver.activeNodeCount, 1);
      surface.componentsModel.get('root')!.properties = {
        'children': ['weird', 'weird', 'weird'],
      };
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);

      surface.componentsModel.get('root')!.properties = {
        'children': <String>[],
      };
      surface.componentsModel.removeComponent('weird');
      _add(surface, 'weird', 'Bogus');
      surface.componentsModel.get('root')!.properties = {
        'children': ['weird'],
      };
      expect(reports('UNKNOWN_COMPONENT_TYPE'), 2);
    });

    test(
      'successfully resolving a pair rearms its prior unknown diagnostic',
      () {
        _add(surface, 'weird', 'Bogus');
        _add(surface, 'root', 'Column', {
          'children': ['weird'],
        });
        expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);

        surface.catalog.components['Bogus'] = ComponentApi(
          name: 'Bogus',
          schema: Schema.object(),
        );
        surface.componentsModel.get('root')!.properties = {
          'children': ['weird'],
        };
        expect(children().single.state, NodeState.resolved);
        surface.catalog.components.remove('Bogus');
        // Removing and restoring only the edge forces a fresh catalog lookup.
        surface.componentsModel.get('root')!.properties = {
          'children': <String>[],
        };
        surface.componentsModel.get('root')!.properties = {
          'children': ['weird'],
        };
        expect(children().single.state, NodeState.unknownType);
        expect(reports('UNKNOWN_COMPONENT_TYPE'), 2);
      },
    );

    test(
      'replacement of a cyclic edge does not erase its deduplication key',
      () {
        _add(surface, 'leaf', 'Text');
        _add(surface, 'root', 'Column', {
          'children': ['leaf', 'root'],
        });
        expect(reports('CYCLIC_REFERENCE'), 1);
        final ComponentNode original = children()[1];
        surface.componentsModel.get('root')!.properties = {
          'children': ['root', 'root'],
        };
        expect(original.disposed, isTrue);
        expect(
          children().map((node) => node.state),
          everyElement(NodeState.cyclic),
        );
        expect(reports('CYCLIC_REFERENCE'), 1);
        surface.componentsModel.get('root')!.properties = {
          'children': ['root', 'root', 'root'],
        };
        expect(reports('CYCLIC_REFERENCE'), 1);
      },
    );

    test('retiring an old cycle cannot clear a rearmed replacement scope', () {
      _add(surface, 'leaf', 'Text');
      _add(surface, 'root', 'Column', {
        'children': ['leaf', 'root'],
      });
      expect(reports('CYCLIC_REFERENCE'), 1);
      children().first.onDestroyed.addListener((_) {
        _add(surface, 'root', 'Column', {
          'children': ['root'],
        });
      });

      surface.componentsModel.removeComponent('root');
      expect(reports('CYCLIC_REFERENCE'), 2);
      expect(children().single.state, NodeState.cyclic);
      surface.componentsModel.get('root')!.properties = {
        'children': ['root', 'root'],
      };
      expect(reports('CYCLIC_REFERENCE'), 2);
      expect(resolver.activeNodeCount, 3);
    });

    test(
      'an earlier deletion listener replaces and rearms an unknown model',
      () {
        // Register the replacement listener before the resolver.
        resolver.dispose();
        surface.componentsModel.onDeleted.addListener((id) {
          if (id == 'weird') _add(surface, id, 'OtherBogus');
        });
        resolver = NodeResolver(surface);
        _add(surface, 'weird', 'Bogus');
        _add(surface, 'root', 'Column', {
          'children': ['weird', 'weird'],
        });
        expect(reports('UNKNOWN_COMPONENT_TYPE'), 1);
        final List<ComponentNode> previous = List.of(children());
        surface.componentsModel.removeComponent('weird');
        expect(reports('UNKNOWN_COMPONENT_TYPE'), 2);
        expect(previous.map((node) => node.disposed), everyElement(isTrue));
        expect(children().map((node) => node.type), everyElement('OtherBogus'));
        expect(
          children().map((node) => node.state),
          everyElement(NodeState.unknownType),
        );
        expect(children().map((node) => node.disposed), everyElement(isFalse));
        expect(resolver.activeNodeCount, 3);
      },
    );
  });
}
