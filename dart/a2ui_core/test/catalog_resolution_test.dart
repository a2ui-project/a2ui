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

/// The v1.0 "Catalog resolution" rule: a component or function call uses the
/// catalog it names, else the surface's default catalog, else it fails.
///
/// The shared conformance suites cover the rule itself (see
/// `conformance/core/message_processor_v1_0.yaml` and `functions.yaml`).
/// These tests cover what those cases cannot observe: the state of
/// [SurfaceModel], the catalog a component is bound to, the arguments `@index`
/// takes, and evaluation in nested and list contexts.
void main() {
  late MessageProcessor<ComponentApi> processor;

  setUp(() {
    processor = MessageProcessor<ComponentApi>(
      catalogs: [
        _catalog('cat-a', 'Alpha', _EchoFunction('shout')),
        _catalog('cat-b', 'Beta', _EchoFunction('whisper')),
      ],
      defaultVersion: A2uiProtocolVersion.v1_0,
      // Leaves the shared types unchecked; these tests use none.
      commonTypesSchema: const {},
      validationConfig: ValidationConfig.relaxed,
    );
  });
  tearDown(() => processor.groupModel.dispose());

  void create({String? catalogId}) => processor.processMessages(
        AgentToRendererMessagePayload([
          CreateSurfaceMessage(
            version: 'v1.0',
            surfaceId: 's',
            catalogId: catalogId,
          ),
        ]),
      );

  void update(List<Map<String, dynamic>> components) =>
      processor.processMessages(
        AgentToRendererMessagePayload([
          UpdateComponentsMessage(
            version: 'v1.0',
            surfaceId: 's',
            components: components,
          ),
        ]),
      );

  SurfaceModel<ComponentApi> surface() => processor.groupModel.getSurface('s')!;

  group('createSurface', () {
    test('v1.0 without catalogId creates a surface with no default', () {
      create();

      expect(surface().defaultCatalog, isNull);
      expect(surface().availableCatalogs.keys,
          unorderedEquals(['cat-a', 'cat-b']));
      expect(surface().protocolVersion, 'v1.0');
    });
  });

  group('components', () {
    // The rejection of such an update is covered by the conformance case
    // test_v10_component_update_without_catalog_id_uses_surface_default; this
    // checks the catalog the accepted update is bound to.
    test('an update that names no catalogId is bound to the surface default',
        () {
      create(catalogId: 'cat-a');
      update([
        {'id': 'root', 'component': 'Beta', 'catalogId': 'cat-b'},
      ]);

      update([
        {'id': 'root', 'component': 'Alpha'},
      ]);
      final ComponentModel root = surface().componentsModel.get('root')!;
      expect(root.properties.containsKey('catalogId'), isFalse);
      expect(root.catalog, isNull);
      expect(surface().resolveCatalog(root.catalog).id, 'cat-a');
    });

    test('a component\'s references are read through its own catalog', () {
      // Both catalogs declare `Box`, but only `boxes` gives it a child. The
      // graph checks must read root's references through `boxes`, the catalog
      // it names, not through the surface default.
      processor.groupModel.dispose();
      processor = MessageProcessor<ComponentApi>(
        catalogs: [
          Catalog<ComponentApi, FunctionImplementation>(
            id: 'cat-a',
            protocolVersion: A2uiProtocolVersion.v1_0,
            components: [
              ComponentApi(
                name: 'Box',
                schema: Schema.object(properties: {'label': Schema.string()}),
              ),
            ],
          ),
          Catalog<ComponentApi, FunctionImplementation>(
            id: 'boxes',
            protocolVersion: A2uiProtocolVersion.v1_0,
            components: [
              ComponentApi(
                name: 'Box',
                schema: Schema.object(properties: {'child': Schema.string()}),
              ),
            ],
          ),
        ],
        defaultVersion: A2uiProtocolVersion.v1_0,
        commonTypesSchema: const {},
        validationConfig: ValidationConfig.strict,
      );
      create(catalogId: 'cat-a');

      expect(
        () => update([
          {
            'id': 'root',
            'component': 'Box',
            'catalogId': 'boxes',
            'child': 'x'
          },
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
      update([
        {'id': 'root', 'component': 'Box', 'catalogId': 'boxes', 'child': 'x'},
        {'id': 'x', 'component': 'Box', 'label': 'leaf'},
      ]);
      expect(surface().componentsModel.getChildIds('root'), ['x']);
    });

    test('a component is bound to the catalog it names', () {
      create(catalogId: 'cat-a');
      update([
        {'id': 'root', 'component': 'Beta', 'catalogId': 'cat-b'},
      ]);

      final ComponentModel root = surface().componentsModel.get('root')!;
      expect(root.catalog, 'cat-b');
      expect(surface().resolveCatalog(root.catalog),
          same(processor.catalogFor('cat-b')));
      expect(root.toJson()['catalogId'], 'cat-b');
    });

    test('an update that resolves to another catalog replaces the model', () {
      // Both catalogs declare the same type, so only the catalog changes.
      processor.groupModel.dispose();
      processor = MessageProcessor<ComponentApi>(
        catalogs: [
          _catalog('cat-a', 'Alpha', _EchoFunction('shout')),
          _catalog('cat-b', 'Alpha', _EchoFunction('whisper')),
        ],
        defaultVersion: A2uiProtocolVersion.v1_0,
        commonTypesSchema: const {},
        validationConfig: ValidationConfig.relaxed,
      );
      create(catalogId: 'cat-a');
      update([
        {'id': 'root', 'component': 'Alpha'},
      ]);
      final ComponentModel first = surface().componentsModel.get('root')!;

      // Naming the default explicitly resolves to the same catalog, so the
      // model is updated in place.
      update([
        {'id': 'root', 'component': 'Alpha', 'catalogId': 'cat-a'},
      ]);
      expect(surface().componentsModel.get('root'), same(first));

      update([
        {'id': 'root', 'component': 'Alpha', 'catalogId': 'cat-b'},
      ]);
      final ComponentModel second = surface().componentsModel.get('root')!;
      expect(second, isNot(same(first)));
      expect(second.catalog, 'cat-b');
      expect(surface().resolveCatalog(second.catalog),
          same(processor.catalogFor('cat-b')));
    });
  });

  group('nested function calls', () {
    test('to @index take only an offset argument', () {
      create(catalogId: 'cat-a');

      expect(
        () => update([
          {
            'id': 'root',
            'component': 'Alpha',
            'label': {
              '@call': '@index',
              'args': {'step': 2},
            },
          },
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('runtime evaluation', () {
    test('nested contexts keep the catalog routing', () {
      create();
      final DataContext nested = DataContext(
        surface().dataModel,
        (name, args, context) =>
            surface().resolveCatalog(null).invoke(name, args, context),
        '/',
        protocolVersion: 'v1.0',
        invokerForCatalog: (catalogId) =>
            surface().resolveCatalog(catalogId).invoke,
      ).nested('items');

      expect(
        () => nested.resolveSync({
          '@call': 'shout',
          'args': {'value': 'Hi'},
        }),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('does not consult any catalog for @index', () {
      create();
      final consulted = <String>[];
      final context = DataContext(
        surface().dataModel,
        (name, args, context) => consulted.add(name),
        '/items/0',
        protocolVersion: 'v1.0',
      );

      expect(
        () => context.resolveSync({
          '@call': '@index',
          'args': {'offset': 1},
        }),
        throwsA(
          isA<A2uiExpressionError>().having(
            (e) => e.message,
            'message',
            contains("System function '@index'"),
          ),
        ),
      );
      expect(consulted, isEmpty);
    });

    group('reports @index naming a catalogId as an expression error', () {
      for (final catalogId in <Object?>['cat-a', 5, null]) {
        for (final reactive in [false, true]) {
          test('catalogId $catalogId, ${reactive ? 'reactive' : 'sync'}', () {
            create();
            final consulted = <String>[];
            final errors = <A2uiExpressionError>[];
            final context = DataContext(
              surface().dataModel,
              (name, args, context) => consulted.add(name),
              '/items/0',
              onError: errors.add,
              protocolVersion: 'v1.0',
            );
            final call = <String, Object?>{
              '@call': '@index',
              'catalogId': catalogId,
            };

            final Object? result = reactive
                ? context.resolveListenable(call).value
                : context.resolveSync(call);

            expect(result, isNull);
            expect(consulted, isEmpty);
            expect(errors, hasLength(1));
            expect(errors.single.code, 'EXPRESSION_ERROR');
            expect(errors.single.message, contains('belongs to no catalog'));
          });
        }
      }
    });
  });
}

Catalog<ComponentApi, FunctionImplementation> _catalog(
  String id,
  String component,
  FunctionImplementation function,
) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: id,
      protocolVersion: A2uiProtocolVersion.v1_0,
      components: [ComponentApi(name: component, schema: Schema.object())],
      functions: [function],
    );

/// Returns its `value` argument.
class _EchoFunction extends FunctionImplementation {
  _EchoFunction(String name)
      : super(
          name: name,
          argumentSchema: Schema.object(
            properties: {'value': Schema.string()},
            required: ['value'],
          ),
          returnType: A2uiReturnType.string,
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      args['value'];
}
