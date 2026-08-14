// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'package:a2ui_core/src/core/component_model.dart';
import 'package:test/test.dart';

void main() {
  group('ComponentModel', () {
    test('onUpdated fires on every property update, not just the first', () {
      final comp = ComponentModel('c1', 'Text', {'text': 'hello'});
      var updateCount = 0;
      comp.onUpdated.addListener((_) => updateCount++);

      comp.properties = {'text': 'world'};
      expect(updateCount, 1, reason: 'first update should notify');

      comp.properties = {'text': 'again'};
      expect(updateCount, 2, reason: 'second update should also notify');

      comp.properties = {'text': 'and again'};
      expect(updateCount, 3, reason: 'third update should also notify');
    });
  });
}
