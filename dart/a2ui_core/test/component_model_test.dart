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
