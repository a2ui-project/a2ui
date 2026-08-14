// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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
  });
}
