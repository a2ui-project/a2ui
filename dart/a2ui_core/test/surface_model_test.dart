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
  group('SurfaceGroupModel', () {
    late MinimalCatalog catalog;

    setUp(() {
      catalog = MinimalCatalog();
    });

    test('removes action forwarder listener when surface is deleted', () {
      final group = SurfaceGroupModel<ComponentApi>();
      final surface = SurfaceModel<ComponentApi>('s1', defaultCatalog: catalog);
      group.addSurface(surface);

      // Verify the forwarder works while surface is alive.
      var actionCount = 0;
      group.onAction.addListener((_) => actionCount++);

      surface.dispatchAction({
        'event': {'name': 'test'},
      }, 'c1');
      expect(actionCount, 1);

      // Delete the surface — the forwarder should be removed before
      // the surface is disposed.
      group.deleteSurface('s1');

      // Create a new surface with the same ID and verify the group
      // only forwards from the new one (not a leaked old listener).
      final surface2 =
          SurfaceModel<ComponentApi>('s1', defaultCatalog: catalog);
      group.addSurface(surface2);

      actionCount = 0;
      surface2.dispatchAction({
        'event': {'name': 'test2'},
      }, 'c1');
      // Should be exactly 1 — if the old listener leaked, it would
      // have thrown (dispatching on a disposed surface) or
      // double-counted.
      expect(actionCount, 1);
    });

    test(
      'reports functionCall and call actions to onError',
      () async {
        final surface = SurfaceModel<ComponentApi>(
          's1',
          defaultCatalog: catalog,
        );
        var actionCount = 0;
        final errors = <A2uiClientError>[];
        surface.onAction.addListener((_) => actionCount++);
        surface.onError.addListener(errors.add);

        await surface.dispatchAction({
          'functionCall': {'call': 'doTask', 'args': <String, dynamic>{}},
        }, 'c1');
        expect(actionCount, 0);
        expect(errors, hasLength(1));
        expect(errors.last.code, 'INVALID_ACTION');

        await surface.dispatchAction({
          'call': 'doTask',
          'args': <String, dynamic>{},
        }, 'c1');
        expect(actionCount, 0);
        expect(errors, hasLength(2));
        expect(errors.last.code, 'INVALID_ACTION');
      },
    );

    test('dispatches direct name action with userMessage', () {
      final surface = SurfaceModel<ComponentApi>('s1', defaultCatalog: catalog);
      A2uiClientAction? dispatched;
      surface.onAction.addListener((action) => dispatched = action);

      surface.dispatchAction({
        'name': 'submit_name',
        'userMessage': 'Action performed',
        'context': {'key': 'val'},
      }, 'c1');

      expect(dispatched, isNotNull);
      expect(dispatched!.name, 'submit_name');
      expect(dispatched!.userMessage, 'Action performed');
      expect(dispatched!.context, {'key': 'val'});
    });

    test('safely normalizes non-map context and non-string userMessage', () {
      final surface = SurfaceModel<ComponentApi>('s1', defaultCatalog: catalog);
      A2uiClientAction? dispatched;
      surface.onAction.addListener((action) => dispatched = action);

      surface.dispatchAction({
        'name': 'test_action',
        'context': 'not_a_map',
        'userMessage': 12345,
      }, 'c1');

      expect(dispatched, isNotNull);
      expect(dispatched!.name, 'test_action');
      expect(dispatched!.context, isEmpty);
      expect(dispatched!.userMessage, isNull);
    });

    test('reports an event whose name is missing, empty, or not a string',
        () async {
      final surface = SurfaceModel<ComponentApi>('s1', defaultCatalog: catalog);
      A2uiClientAction? dispatched;
      final errors = <A2uiClientError>[];
      surface.onAction.addListener((action) => dispatched = action);
      surface.onError.addListener(errors.add);

      await surface.dispatchAction({
        'event': {'name': 42},
      }, 'c1');
      await surface.dispatchAction({'name': 42}, 'c1');
      await surface.dispatchAction({
        'event': {'name': ''},
      }, 'c1');
      await surface.dispatchAction({'foo': 'bar'}, 'c1');

      expect(dispatched, isNull);
      expect(errors, hasLength(4));
      expect(errors.every((e) => e.code == 'INVALID_ACTION'), isTrue);
    });

    test('throws A2uiStateError when a surface id is added twice', () {
      final group = SurfaceGroupModel<ComponentApi>();
      addTearDown(group.dispose);
      final first = SurfaceModel<ComponentApi>('s1', defaultCatalog: catalog);
      final second = SurfaceModel<ComponentApi>('s1', defaultCatalog: catalog);
      addTearDown(second.dispose);
      group.addSurface(first);

      expect(() => group.addSurface(second), throwsA(isA<A2uiStateError>()));
      expect(group.getSurface('s1'), same(first));
    });
  });

  group('SurfaceModel catalogs', () {
    Catalog<ComponentApi, FunctionImplementation> catalogNamed(
      String id, {
      A2uiProtocolVersion? protocolVersion,
    }) =>
        Catalog<ComponentApi, FunctionImplementation>(
          id: id,
          components: const [],
          protocolVersion: protocolVersion,
        );

    Matcher catalogError(String message, {String? catalogId}) =>
        isA<A2uiCatalogError>()
            .having((e) => e.message, 'message', message)
            .having((e) => e.catalogId, 'catalogId', catalogId);

    test('resolves an explicit catalog id the surface supports', () {
      final Catalog<ComponentApi, FunctionImplementation> a = catalogNamed('a');
      final Catalog<ComponentApi, FunctionImplementation> b = catalogNamed('b');
      final surface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: a,
        availableCatalogs: [a, b],
      );

      expect(surface.resolveCatalog('b'), same(b));
      expect(surface.resolveCatalog('a'), same(a));
    });

    test('rejects an explicit catalog id the surface does not support', () {
      final Catalog<ComponentApi, FunctionImplementation> a = catalogNamed('a');
      final surface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: a,
        availableCatalogs: [a],
      );

      expect(
        () => surface.resolveCatalog('vendor'),
        throwsA(
          catalogError(
            "Catalog 'vendor' is not supported by surface 's1'.",
            catalogId: 'vendor',
          ),
        ),
      );
    });

    test('resolves an item without a catalog id to the default catalog', () {
      final Catalog<ComponentApi, FunctionImplementation> a = catalogNamed('a');
      final Catalog<ComponentApi, FunctionImplementation> b = catalogNamed('b');
      final surface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: a,
        availableCatalogs: [b],
      );

      expect(surface.resolveCatalog(null), same(a));
      expect(surface.availableCatalogs.keys, unorderedEquals(['a', 'b']));
    });

    test('raises when there is neither a catalog id nor a default', () {
      // The surface supports exactly one catalog, and still does not fall
      // back to it: v1.0 forbids a fallback to the supported set.
      final Catalog<ComponentApi, FunctionImplementation> a = catalogNamed('a');
      final surface = SurfaceModel<ComponentApi>('s1', availableCatalogs: [a]);

      expect(surface.defaultCatalog, isNull);
      expect(
        () => surface.resolveCatalog(null),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects an available catalog of another protocol version', () {
      expect(
        () => SurfaceModel<ComponentApi>(
          's1',
          protocolVersion: 'v1.0',
          defaultCatalog:
              catalogNamed('basic', protocolVersion: A2uiProtocolVersion.v1_0),
          availableCatalogs: [
            catalogNamed('old', protocolVersion: A2uiProtocolVersion.v0_9)
          ],
        ),
        throwsA(
          catalogError(
            "Protocol version mismatch: cannot mix catalog 'old' (v0.9) with "
            'surface version v1.0.',
            catalogId: 'old',
          ),
        ),
      );
    });

    test('accepts catalogs of compatible protocol versions', () {
      final surface = SurfaceModel<ComponentApi>(
        's1',
        protocolVersion: 'v0.9',
        defaultCatalog:
            catalogNamed('a', protocolVersion: A2uiProtocolVersion.v0_9_1),
        availableCatalogs: [
          catalogNamed('b', protocolVersion: A2uiProtocolVersion.v0_9),
          catalogNamed('c'),
        ],
      );

      expect(surface.availableCatalogs.keys, unorderedEquals(['a', 'b', 'c']));
    });

    test('accepts an unversioned catalog on a pre-v1.0 surface', () {
      final surface = SurfaceModel<ComponentApi>(
        's1',
        protocolVersion: 'v0.9.1',
        defaultCatalog: catalogNamed('a'),
        availableCatalogs: [catalogNamed('b')],
      );

      expect(surface.availableCatalogs.keys, unorderedEquals(['a', 'b']));
    });

    test('rejects an unversioned catalog on a v1.0 surface', () {
      expect(
        () => SurfaceModel<ComponentApi>(
          's1',
          protocolVersion: 'v1.0',
          defaultCatalog:
              catalogNamed('basic', protocolVersion: A2uiProtocolVersion.v1_0),
          availableCatalogs: [catalogNamed('legacy')],
        ),
        throwsA(
          catalogError(
            'Protocol version mismatch: cannot mix unversioned catalog '
            "'legacy' with surface version v1.0.",
            catalogId: 'legacy',
          ),
        ),
      );
      expect(
        () => SurfaceModel<ComponentApi>(
          's1',
          protocolVersion: 'v1.0',
          defaultCatalog: catalogNamed('legacy'),
        ),
        throwsA(
          catalogError(
            'Protocol version mismatch: cannot mix unversioned catalog '
            "'legacy' with surface version v1.0.",
            catalogId: 'legacy',
          ),
        ),
      );
    });

    test('rejects two different available catalogs with one id', () {
      expect(
        () => SurfaceModel<ComponentApi>(
          's1',
          availableCatalogs: [catalogNamed('a'), catalogNamed('a')],
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('dispatchAction carries the catalogId of the action', () async {
      final surface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: catalogNamed('a'),
      );
      final dispatched = <A2uiClientAction>[];
      surface.onAction.addListener(dispatched.add);

      await surface.dispatchAction({
        'event': {'name': 'wrapped', 'catalogId': 'b'},
      }, 'c1');
      await surface.dispatchAction({
        'name': 'direct',
        'catalogId': 'c',
      }, 'c1');
      await surface.dispatchAction({
        'event': {'name': 'plain'},
      }, 'c1');

      expect(dispatched.map((a) => a.catalogId), ['b', 'c', null]);
    });

    test('delivers warnings stamped with the surface id', () async {
      final surface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: catalogNamed('a'),
      );
      final warnings = <A2uiWarning>[];
      surface.onWarning.addListener(warnings.add);

      await surface.dispatchWarning(
        const A2uiWarning(
          code: 'MISSING_DATA_BINDING',
          message: 'No data at /name.',
          path: '/name',
        ),
      );

      expect(warnings, hasLength(1));
      expect(warnings.single.code, 'MISSING_DATA_BINDING');
      expect(warnings.single.message, 'No data at /name.');
      expect(warnings.single.path, '/name');
      expect(warnings.single.surfaceId, 's1');
    });

    test('holds surface metadata', () {
      final surface = SurfaceModel<ComponentApi>(
        's1',
        metadata: const {
          'extensions': {'x': 1},
        },
      );

      expect(surface.metadata, {
        'extensions': {'x': 1},
      });
    });

    test('dispatches action with UTC timestamp that serializes with trailing Z',
        () {
      final surface = SurfaceModel<ComponentApi>('s1');
      A2uiClientAction? dispatched;
      surface.onAction.addListener((action) => dispatched = action);

      surface.dispatchAction({
        'event': {'name': 'submit'},
      }, 'c1');

      expect(dispatched, isNotNull);
      expect(dispatched!.timestamp.isUtc, isTrue);
      expect(dispatched!.toJson()['timestamp'], endsWith('Z'));
    });
  });
}
