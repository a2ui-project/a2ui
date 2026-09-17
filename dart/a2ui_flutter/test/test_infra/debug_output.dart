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

import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

void _saveToFile(String label, String extension, String Function() content) {
  if (!kDebugMode) return;
  final String timestamp = DateTime.now()
      .toIso8601String()
      .replaceAll(':', '-')
      .replaceAll('.', '-');
  final dir = Directory('debug')..createSync(recursive: true);
  final file = File('${dir.path}/$timestamp-$label.$extension');
  file.writeAsStringSync(content());
  // ignore: avoid_print
  print('Saved $label to ${file.absolute.path}');
}

/// Saves [content] to a file and prints the file location to console.
void debugSaveTxt(String content, {String label = 'string'}) {
  _saveToFile(label, 'txt', () => content);
}

/// Saves [content] to a file and prints the file location to console.
void debugSaveJson(Object? content, {String label = 'object'}) {
  _saveToFile(
    label,
    'json',
    () => const JsonEncoder.withIndent('  ').convert(content),
  );
}
