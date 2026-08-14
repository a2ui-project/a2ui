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

import 'package:a2ui_core/src/primitives/reactivity.dart';
import 'package:test/test.dart';

void main() {
  group('Reactivity', () {
    test('Signal notifies subscribers on change', () {
      final Signal<int> sig = signal(10);
      final List<int> values = [];
      sig.subscribe(values.add);

      // subscribe fires immediately with current value
      expect(values, [10]);

      sig.value = 20;
      expect(values, [10, 20]);
      expect(sig.value, 20);
    });

    test('Computed tracks dependencies', () {
      final Signal<int> a = signal(1);
      final Signal<int> b = signal(2);
      final ReadonlySignal<int> sum = computed(() => a.value + b.value);

      expect(sum.value, 3);

      final List<int> values = [];
      sum.subscribe(values.add);

      a.value = 10;
      expect(sum.value, 12);
      expect(values, [3, 12]);

      b.value = 20;
      expect(sum.value, 30);
      expect(values, [3, 12, 30]);
    });

    test('Computed updates dependencies dynamically', () {
      final Signal<bool> useA = signal(true);
      final Signal<int> a = signal(1);
      final Signal<int> b = signal(2);
      final ReadonlySignal<int> result = computed(
        () => useA.value ? a.value : b.value,
      );

      expect(result.value, 1);

      final List<int> values = [];
      result.subscribe(values.add);

      b.value = 10; // Should not notify as b is not a dependency yet
      expect(values, [1]);

      useA.value = false;
      expect(result.value, 10);
      expect(values, [1, 10]);

      a.value = 100; // Should not notify as a is no longer a dependency
      expect(values, [1, 10]);

      b.value = 20;
      expect(values, [1, 10, 20]);
      expect(result.value, 20);
    });

    test('batch defers notifications', () {
      final Signal<int> a = signal(1);
      final Signal<int> b = signal(2);
      final ReadonlySignal<int> sum = computed(() => a.value + b.value);

      final List<int> values = [];
      sum.subscribe(values.add);
      expect(values, [3]); // initial

      batch(() {
        a.value = 10;
        b.value = 20;
      });

      expect(values, [3, 30]); // only one update, not two
      expect(sum.value, 30);
    });

    test('nested batch defers to outermost', () {
      final Signal<int> a = signal(0);
      final List<int> values = [];
      a.subscribe(values.add);
      expect(values, [0]); // initial

      batch(() {
        a.value = 1;
        batch(() {
          a.value = 2;
        });
        expect(values, [0]); // still deferred
      });

      expect(values, [0, 2]); // only final value
      expect(a.value, 2);
    });

    test('subscribe returns dispose function', () {
      final Signal<int> sig = signal(1);
      final List<int> values = [];
      final void Function() dispose = sig.subscribe(values.add);

      sig.value = 2;
      expect(values, [1, 2]);

      dispose();

      sig.value = 3;
      expect(values, [1, 2], reason: 'should not fire after dispose');
    });
  });
}
