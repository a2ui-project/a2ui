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

import 'dart:io';

import 'package:a2ui_explorer/src/example.dart';
import 'package:a2ui_explorer/src/examples.g.dart';
import 'package:flutter_test/flutter_test.dart';

import '../tool/generate_examples.dart' as generator;

void main() {
  test('examples.g.dart matches the specification examples', () {
    expect(
      File(generator.outputFile).readAsStringSync(),
      generator.render(Directory(generator.examplesDirectory)),
      reason:
          'examples.g.dart is stale. Run '
          '`dart run tool/generate_examples.dart`.',
    );
  });

  test('every example has messages', () {
    expect(examples, isNotEmpty);
    for (final Example example in examples) {
      expect(example.messages, isNotEmpty, reason: example.fileName);
    }
  });
}
