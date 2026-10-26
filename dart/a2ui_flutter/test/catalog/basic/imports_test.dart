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

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('basic catalog files do not import the surface or node view', () {
    final List<File> files = Directory('lib/src/catalog/basic')
        .listSync()
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .toList();
    expect(files, isNotEmpty);

    final forbidden = RegExp(
      r'''^\s*(import|export)\s+['"][^'"]*'''
      r'''(a2ui_surface\.dart|node_view\.dart|a2ui_flutter\.dart)['"]''',
      multiLine: true,
    );
    for (final file in files) {
      expect(
        forbidden.hasMatch(file.readAsStringSync()),
        isFalse,
        reason: '${file.path} must not import the surface or node view.',
      );
    }
  });
}
