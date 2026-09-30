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
  group('DataModel (Dart-specific signal caching)', () {
    test('returns identical cached ReadonlySignal for equivalent paths', () {
      final model = DataModel({'foo': 'bar'});
      addTearDown(model.dispose);

      final ReadonlySignal<Object?> s1 = model.watch('/foo');
      final ReadonlySignal<Object?> s2 = model.watch('/foo/');
      final ReadonlySignal<Object?> s3 = model.watch('//foo//');

      expect(identical(s1, s2), isTrue);
      expect(identical(s1, s3), isTrue);
    });
  });
}
