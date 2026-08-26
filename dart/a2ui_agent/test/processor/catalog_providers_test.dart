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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import '../test_catalogs.dart';

void main() {
  group('FileSystemCatalogProvider', () {
    test('loads the published basic catalog', () {
      final SchemaCatalog catalog = FileSystemCatalogProvider(
        basicCatalogFile(),
      ).load();

      expect(catalog.id, basicCatalogId);
      expect(catalog.protocolVersion, A2uiProtocolVersion.v0_9);
      expect(catalog.components.keys, contains('Button'));
      expect(catalog.functions.keys, contains('required'));
    });

    test('accepts a matching expected catalog id', () {
      expect(
        FileSystemCatalogProvider(
          basicCatalogFile(),
          catalogId: basicCatalogId,
        ).load().id,
        basicCatalogId,
      );
    });

    test('rejects a conflicting expected catalog id', () {
      expect(
        FileSystemCatalogProvider(
          basicCatalogFile(),
          catalogId: 'https://example.com/other.json',
        ).load,
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('accepts a matching expected protocol version', () {
      expect(
        FileSystemCatalogProvider(
          basicCatalogFile(),
          protocolVersion: A2uiProtocolVersion.v0_9,
        ).load().protocolVersion,
        A2uiProtocolVersion.v0_9,
      );
    });

    test('reports a missing file', () {
      expect(
        const FileSystemCatalogProvider('/no/such/catalog.json').load,
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('not found'),
          ),
        ),
      );
    });

    test('reports a file that is not valid JSON', () {
      final Directory dir = Directory.systemTemp.createTempSync('a2ui_agent');
      addTearDown(() => dir.deleteSync(recursive: true));
      final file = File('${dir.path}/broken.json')..writeAsStringSync('{oops');

      expect(
        FileSystemCatalogProvider(file.path).load,
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            contains('not valid JSON'),
          ),
        ),
      );
    });

    test('reports a file that is not a JSON object', () {
      final Directory dir = Directory.systemTemp.createTempSync('a2ui_agent');
      addTearDown(() => dir.deleteSync(recursive: true));
      final file = File('${dir.path}/list.json')..writeAsStringSync('[]');

      expect(
        FileSystemCatalogProvider(file.path).load,
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('InMemoryCatalogProvider', () {
    test('parses an in-memory schema', () {
      final SchemaCatalog catalog = InMemoryCatalogProvider(
        basicCatalogJson(),
      ).load();

      expect(catalog.id, basicCatalogId);
    });

    test('rejects a conflicting expected catalog id', () {
      expect(
        const InMemoryCatalogProvider({
          'catalogId': 'actual',
        }, catalogId: 'expected').load,
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects a schema declaring an unsupported protocol version', () {
      expect(
        const InMemoryCatalogProvider({
          'catalogId': 'c',
          'protocolVersion': 'v1.0',
        }).load,
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a schema without a catalog id', () {
      expect(
        const InMemoryCatalogProvider({}).load,
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });
}
