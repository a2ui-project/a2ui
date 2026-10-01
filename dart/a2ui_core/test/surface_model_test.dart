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
      final surface = SurfaceModel<ComponentApi>('s1', catalog: catalog);
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
      final surface2 = SurfaceModel<ComponentApi>('s1', catalog: catalog);
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

    test('ignores functionCall and call actions without emitting onAction', () {
      final surface = SurfaceModel<ComponentApi>('s1', catalog: catalog);
      var actionCount = 0;
      surface.onAction.addListener((_) => actionCount++);

      surface.dispatchAction({
        'functionCall': {'call': 'doTask', 'args': <String, dynamic>{}},
      }, 'c1');
      expect(actionCount, 0);

      surface.dispatchAction({
        'call': 'doTask',
        'args': <String, dynamic>{},
      }, 'c1');
      expect(actionCount, 0);
    });

    test('dispatches direct name action with userMessage', () {
      final surface = SurfaceModel<ComponentApi>('s1', catalog: catalog);
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
      final surface = SurfaceModel<ComponentApi>('s1', catalog: catalog);
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

    test('ignores an event whose name is not a string', () async {
      final surface = SurfaceModel<ComponentApi>('s1', catalog: catalog);
      A2uiClientAction? dispatched;
      surface.onAction.addListener((action) => dispatched = action);

      await surface.dispatchAction({
        'event': {'name': 42},
      }, 'c1');
      await surface.dispatchAction({'name': 42}, 'c1');

      expect(dispatched, isNull);
    });
  });
}
