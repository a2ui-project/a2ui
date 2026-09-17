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
  test('ResolvedBinding does not leak subclass knowledge', () {
    final rb = const ResolvedBinding<int>(1);
    final wb = WritableBinding<int>(1, (v) {}, '/foo');

    expect(rb == wb, false);
    expect(wb == rb, false);

    expect(rb, isNot(equals(wb)));

    final wb2 = WritableBinding<int>(1, (v) {}, '/foo');
    final wb3 = WritableBinding<int>(1, (v) {}, '/bar');
    expect(wb == wb2, true);
    expect(wb == wb3, false);
  });
}
