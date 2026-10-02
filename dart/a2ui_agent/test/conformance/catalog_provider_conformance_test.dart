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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

/// Runs the shared `conformance/agent/catalog_provider.yaml` suite against
/// [FileSystemCatalogProvider].
///
/// The suite is written against v1.0, so the harness lowers each document it
/// can read to v0.9 into a temporary file, and constructs the provider with
/// v0.9 where the case says v1.0; see `suites.dart`. A case whose provider
/// states v0.9 would need a provider stating v1.0 after lowering, which this
/// SDK cannot name, so it runs as written: its document's `1.0` and the
/// provider's v0.9 conflict just the same.
void main() {
  const path = 'agent/catalog_provider.yaml';
  late Directory temp;
  setUpAll(() => temp = Directory.systemTemp.createTempSync('a2ui_provider'));
  tearDownAll(() => temp.deleteSync(recursive: true));

  group('conformance $path', () {
    final List<Map<String, Object?>> cases = loadSuite(path);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      final name = testCase['name']! as String;
      test(name, () {
        final args = testCase['args']! as Map<String, Object?>;
        expect(args['provider'], 'file_system');
        final lower = args['protocol_version'] != 'v0.9';
        final provider = FileSystemCatalogProvider(
          _documentPath(args['path']! as String, lower, temp, name),
          catalogId: args['catalog_id'] as String?,
          protocolVersion: switch (args['protocol_version']) {
            null => null,
            _ => A2uiProtocolVersion.v0_9,
          },
        );
        if (testCase['expect_error'] case final Object error) {
          expect(provider.load, throwsCategory(error));
          return;
        }
        expectCatalog(
          provider.load(),
          testCase['expect']! as Map<String, Object?>,
        );
      });
    }
  });
}

/// The path the provider reads for [path], relative to `conformance/`.
///
/// When [lower] is true and the document is JSON, it is lowered into a file
/// in [temp]; a document that is missing or not JSON is read where it is.
String _documentPath(String path, bool lower, Directory temp, String name) {
  final file = File('$conformanceRoot/$path');
  if (!lower || !file.existsSync()) return file.path;
  final Object? document;
  try {
    document = jsonDecode(file.readAsStringSync());
  } on FormatException {
    return file.path;
  }
  final lowered = File('${temp.path}/$name.json')
    ..writeAsStringSync(
      jsonEncode(lowerCatalogDocument(document! as Map<String, Object?>)),
    );
  return lowered.path;
}
