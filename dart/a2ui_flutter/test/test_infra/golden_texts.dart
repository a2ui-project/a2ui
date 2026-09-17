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

/// Verifies that the given [text] matches the content of the golden file.
///
/// If [autoUpdateGoldenFiles] is true, the golden file will be updated.
///
/// The file resides in the directory, named as the test file, located
/// in the same directory as the test file.
/// For example, if the test file is `utils/my_main_test.dart`,
/// the golden file will be in `utils/my_main_test.golden/[file_name]`.
void verifyGoldenText(String text, String goldenFileName) {
  final String goldenFilePath = _goldenFilePath(goldenFileName);

  if (autoUpdateGoldenFiles) {
    final goldenFile = File(goldenFilePath);
    goldenFile.parent.createSync(recursive: true);
    goldenFile.writeAsStringSync(text);
  } else {
    final String goldenFileContent;
    try {
      goldenFileContent = File(goldenFilePath).readAsStringSync();
    } on PathNotFoundException {
      fail(
        'Golden file not found: $goldenFilePath\n'
        'Run with --update-goldens to create it.',
      );
    }
    expect(goldenFileContent, text);
  }
}

/// Extracts the test file URI from the call stack, skipping frames from
/// this file.
Uri _testFileUri() {
  // Frame format: "#N      name (uri:line:col)"
  final framePattern = RegExp(r'\((.+\.dart):\d+:\d+\)$');
  for (final String frame in StackTrace.current.toString().split('\n')) {
    final RegExpMatch? match = framePattern.firstMatch(frame.trim());
    if (match == null) continue;
    final Uri? uri = Uri.tryParse(match.group(1)!);
    if (uri == null) continue;
    if (uri.pathSegments.last == 'golden_texts.dart') continue;
    return uri;
  }
  throw StateError('Could not determine test file URI from stack trace');
}

/// Returns absolute path to the golden file.
String _goldenFilePath(String fileName) {
  final Uri testUri = _testFileUri();
  final String scriptName = testUri.pathSegments.last;
  final String stem = scriptName.endsWith('.dart')
      ? scriptName.substring(0, scriptName.length - 5)
      : scriptName;
  final Uri goldenDir = testUri.resolve('$stem.golden/');
  return goldenDir.resolve(fileName).toFilePath();
}
