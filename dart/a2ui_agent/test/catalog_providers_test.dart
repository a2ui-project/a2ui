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

/// Catalog providers beyond `conformance/agent/catalog_provider.yaml`, which
/// covers the file system provider against v1.0 documents: the in-memory
/// provider, the v0.9 spellings of a version, and malformed documents.
void main() {
  const basicPath = '../../specification/v0_9/catalogs/basic/catalog.json';
  const A2uiProtocolVersion v0_9 = A2uiProtocolVersion.v0_9;

  Map<String, Object?> document({Object? id, Object? version}) => {
    'catalogId': ?id,
    'protocolVersion': ?version,
    'components': {
      'Text': {
        'type': 'object',
        'properties': {
          'component': {'const': 'Text'},
        },
      },
    },
  };

  Matcher throwsCatalogError = throwsA(isA<A2uiCatalogError>());

  group('InMemoryCatalogProvider', () {
    test('loads a document naming its id, given the version', () {
      final CatalogApi catalog = InMemoryCatalogProvider(
        document(id: 'a'),
        protocolVersion: v0_9,
      ).load();
      expect(catalog.id, 'a');
      expect(catalog.components.keys, ['Text']);
    });

    test('takes the id the document omits from the provider', () {
      expect(
        InMemoryCatalogProvider(
          document(version: '0.9'),
          catalogId: 'provided',
        ).load().id,
        'provided',
      );
    });

    test('reads each spelling of v0.9 a document may use', () {
      for (final version in ['0.9', 'v0.9', '0.9.1']) {
        expect(
          InMemoryCatalogProvider(
            document(id: 'a', version: version),
            protocolVersion: v0_9,
          ).load().id,
          'a',
          reason: version,
        );
      }
    });

    final Map<String, CatalogProvider> rejected = {
      'an id conflicting with the document': InMemoryCatalogProvider(
        document(id: 'a'),
        catalogId: 'b',
        protocolVersion: v0_9,
      ),
      'no id anywhere': InMemoryCatalogProvider(
        document(),
        protocolVersion: v0_9,
      ),
      'no version anywhere': InMemoryCatalogProvider(document(id: 'a')),
      'a version other than v0.9': InMemoryCatalogProvider(
        document(id: 'a', version: '1.0'),
      ),
      'an id that is not a string': InMemoryCatalogProvider(
        document(id: 7),
        protocolVersion: v0_9,
      ),
      'an empty id': InMemoryCatalogProvider(
        document(id: ''),
        protocolVersion: v0_9,
      ),
      'a version that is not a string': InMemoryCatalogProvider(
        document(id: 'a', version: 0.9),
      ),
    };
    for (final MapEntry<String, CatalogProvider> entry in rejected.entries) {
      test('rejects ${entry.key}', () {
        expect(entry.value.load, throwsCatalogError);
      });
    }

    test('leaves the document it was given unchanged', () {
      final Map<String, Object?> source = document(version: '0.9');
      InMemoryCatalogProvider(source, catalogId: 'provided').load();
      expect(source.containsKey('catalogId'), isFalse);
    });
  });

  group('FileSystemCatalogProvider', () {
    test('loads the published v0.9 basic catalog', () {
      final CatalogApi catalog = const FileSystemCatalogProvider(
        basicPath,
        protocolVersion: v0_9,
      ).load();
      expect(catalog.id, contains('v0_9/catalogs/basic'));
      expect(catalog.components, contains('Text'));
      expect(catalog.functions, contains('formatString'));
    });

    test('rejects a document that is not a JSON object', () {
      final Directory temp = Directory.systemTemp.createTempSync('a2ui');
      addTearDown(() => temp.deleteSync(recursive: true));
      final file = File('${temp.path}/list.json')..writeAsStringSync('[]');
      expect(
        FileSystemCatalogProvider(file.path, protocolVersion: v0_9).load,
        throwsCatalogError,
      );
    });
  });

  group('CatalogConfig.fromPath', () {
    test('loads the document with the given transformers', () {
      final config = CatalogConfig.fromPath(
        basicPath,
        protocolVersion: v0_9,
        transformers: [
          ComponentPruningTransformer(['Text']),
        ],
      );
      expect(config.catalog.components, hasLength(greaterThan(1)));
      expect(config.transformedCatalog.components.keys, ['Text']);
    });

    test('fails with a catalog error when the document cannot be read', () {
      expect(
        () => CatalogConfig.fromPath('missing.json', protocolVersion: v0_9),
        throwsCatalogError,
      );
    });
  });
}
