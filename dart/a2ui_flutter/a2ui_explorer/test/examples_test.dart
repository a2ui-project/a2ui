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
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the bundle holds every specification example', () async {
    final List<String> specified = [
      for (final FileSystemEntity file in Directory(
        '../../../specification/v0_9/catalogs/basic/examples',
      ).listSync())
        if (file.path.endsWith('.json')) file.uri.pathSegments.last,
    ]..sort();

    final List<Example> examples = await loadExamples(rootBundle);

    expect(specified, isNotEmpty);
    expect([for (final e in examples) e.fileName], specified);
    for (final example in examples) {
      expect(example.messages, isNotEmpty, reason: example.fileName);
    }
  });
}
