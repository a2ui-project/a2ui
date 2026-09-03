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

    group('clock injection', () {
      test('uses systemClock by default producing recent timestamp', () async {
        final before = DateTime.now();
        final surface = SurfaceModel<ComponentApi>('s1', catalog: catalog);
        A2uiClientAction? receivedAction;
        surface.onAction.addListener((action) => receivedAction = action);

        await surface.dispatchAction({
          'event': {'name': 'defaultClockTest'},
        }, 'c1');

        final after = DateTime.now();
        expect(receivedAction, isNotNull);
        expect(
          receivedAction!.timestamp.isAfter(
                before.subtract(const Duration(seconds: 1)),
              ) ||
              receivedAction!.timestamp.isAtSameMomentAs(before),
          isTrue,
        );
        expect(
          receivedAction!.timestamp.isBefore(
                after.add(const Duration(seconds: 1)),
              ) ||
              receivedAction!.timestamp.isAtSameMomentAs(after),
          isTrue,
        );
      });

      test(
        'uses custom injected fake clock for deterministic timestamps',
        () async {
          final fixedTime = DateTime.utc(2026, 8, 14, 12, 0, 0);
          final fakeClock = FakeClock(fixedTime);
          final surface = SurfaceModel<ComponentApi>(
            's1',
            catalog: catalog,
            clock: fakeClock,
          );

          A2uiClientAction? receivedAction;
          surface.onAction.addListener((action) => receivedAction = action);

          await surface.dispatchAction({
            'event': {'name': 'customClockTest'},
          }, 'c1');

          expect(receivedAction, isNotNull);
          expect(receivedAction!.timestamp, equals(fixedTime));

          // Advance clock and dispatch again
          fakeClock.advance(const Duration(seconds: 45));
          await surface.dispatchAction({
            'event': {'name': 'advancedClockTest'},
          }, 'c1');

          expect(
            receivedAction!.timestamp,
            equals(DateTime.utc(2026, 8, 14, 12, 0, 45)),
          );
        },
      );
    });
  });
}
