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
  group('A2uiVersionCapabilities', () {
    test('parses supported catalog ids', () {
      final caps = A2uiVersionCapabilities.fromJson({
        'supportedCatalogIds': ['a', 'b'],
      });

      expect(caps.supportedCatalogIds, ['a', 'b']);
      expect(caps.inlineCatalogs, isEmpty);
    });

    test('parses inline catalogs into schema catalogs', () {
      final caps = A2uiVersionCapabilities.fromJson({
        'supportedCatalogIds': <String>[],
        'inlineCatalogs': [
          {
            'catalogId': 'inline',
            'components': {
              'Gauge': {'type': 'object'},
            },
          },
        ],
      });

      expect(caps.inlineCatalogs, hasLength(1));
      expect(caps.inlineCatalogs.single.id, 'inline');
      expect(caps.inlineCatalogs.single.components.keys, ['Gauge']);
    });

    test('rejects an inline catalog that is not an object', () {
      for (final malformed in <Object?>[null, 'nope', 42, <Object?>[]]) {
        expect(
          () => A2uiVersionCapabilities.fromJson({
            'supportedCatalogIds': <String>[],
            'inlineCatalogs': [malformed],
          }),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              contains('inlineCatalogs'),
            ),
          ),
          reason: '$malformed',
        );
      }
    });

    test('rejects missing or malformed supportedCatalogIds', () {
      expect(
        () => A2uiVersionCapabilities.fromJson(<String, Object?>{}),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => A2uiVersionCapabilities.fromJson({
          'supportedCatalogIds': [1, 2],
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('round trips through JSON', () {
      final caps = A2uiVersionCapabilities(supportedCatalogIds: ['a']);
      expect(caps.toJson(), {
        'supportedCatalogIds': ['a'],
      });
    });
  });

  group('A2uiRendererCapabilities', () {
    test('parses a v0.9 capabilities object', () {
      final caps = A2uiRendererCapabilities.fromJson({
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
      });

      expect(caps.versions.keys, [A2uiProtocolVersion.v0_9]);
      expect(caps.forVersion(A2uiProtocolVersion.v0_9)!.supportedCatalogIds, [
        'basic',
      ]);
      expect(caps.unsupportedVersions, isEmpty);
    });

    test('records version entries this SDK does not implement', () {
      final caps = A2uiRendererCapabilities.fromJson({
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
        'v1.0': {
          'supportedCatalogIds': ['basic'],
        },
      });

      expect(caps.unsupportedVersions, ['v1.0']);
    });

    test('rejects capabilities carrying no v0.9 entry', () {
      expect(
        () => A2uiRendererCapabilities.fromJson({
          'v1.0': {
            'supportedCatalogIds': ['basic'],
          },
        }),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('supported version'),
          ),
        ),
      );
      expect(
        () => A2uiRendererCapabilities.fromJson(<String, Object?>{}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('builds capabilities from a list of catalog ids', () {
      final caps = A2uiRendererCapabilities.forCatalogIds(['basic']);
      expect(caps.forVersion(A2uiProtocolVersion.v0_9)!.supportedCatalogIds, [
        'basic',
      ]);
    });

    test('resolves capabilities for a supported version', () {
      final caps = A2uiRendererCapabilities.forCatalogIds(['basic']);
      expect(caps.forVersion(A2uiProtocolVersion.v0_9)!.supportedCatalogIds, [
        'basic',
      ]);
    });

    test('rejects a version entry that is not an object', () {
      expect(
        () => A2uiRendererCapabilities.fromJson({'v0.9': 'nope'}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('drops unimplemented version entries when serialising', () {
      final caps = A2uiRendererCapabilities.fromJson({
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
        'v1.0': {
          'supportedCatalogIds': ['basic'],
        },
      });

      expect(caps.unsupportedVersions, ['v1.0']);
      expect(caps.toJson().keys, ['v0.9']);
    });

    test('round trips through JSON', () {
      final json = {
        'v0.9': {
          'supportedCatalogIds': ['basic'],
        },
      };
      expect(A2uiRendererCapabilities.fromJson(json).toJson(), json);
    });
  });
}
