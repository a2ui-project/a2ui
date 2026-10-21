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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_explorer/src/example.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the bundle holds every example of each version', () async {
    final List<Example> examples = await loadExamples(rootBundle);

    for (final (A2uiProtocolVersion version, String directory) in [
      (
        A2uiProtocolVersion.v0_9,
        '../../../specification/v0_9/catalogs/basic/examples',
      ),
      (A2uiProtocolVersion.v1_0, '../../../catalogs/basic/v1/examples'),
    ]) {
      final List<String> specified = [
        for (final FileSystemEntity file in Directory(directory).listSync())
          if (file.path.endsWith('.json')) file.uri.pathSegments.last,
      ]..sort();

      expect(specified, isNotEmpty, reason: directory);
      expect([
        for (final e in examples)
          if (e.version == version) e.fileName,
      ], specified);
    }
    for (final example in examples) {
      expect(example.messages, isNotEmpty, reason: example.fileName);
      for (final Map<String, Object?> message in example.messages) {
        expect(
          message['version'],
          example.version.jsonValue,
          reason: example.fileName,
        );
      }
    }
  });
}
