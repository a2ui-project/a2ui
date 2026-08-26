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

/// Marks a test that describes behaviour `A2uiValidator` does not implement
/// yet. Remove the skip alongside the implementation.
const String pendingValidator =
    'A2uiValidator deep checks are not implemented yet.';

const String catalogId = 'https://example.com/catalogs/test.json';

Map<String, Object?> createSurface({String version = 'v0.9'}) => {
  'version': version,
  'createSurface': {'surfaceId': 's1', 'catalogId': catalogId},
};

Map<String, Object?> updateComponents(List<Map<String, Object?>> components) =>
    {
      'version': 'v0.9',
      'updateComponents': {'surfaceId': 's1', 'components': components},
    };

SchemaCatalog testCatalog() => Catalog.fromJson({
  'catalogId': catalogId,
  'components': {
    'Card': {
      'type': 'object',
      'properties': {
        'component': {'const': 'Card'},
        'child': {'type': 'string'},
      },
    },
    'Text': {
      'type': 'object',
      'properties': {
        'component': {'const': 'Text'},
        'text': {'type': 'string'},
      },
      'required': ['text'],
    },
  },
});

void main() {
  group('A2uiValidator version gating', () {
    test('accepts payloads declaring the supported version', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);

      expect(validator.checkVersion(createSurface()), A2uiProtocolVersion.v0_9);
      expect(validator.parseMessages([createSurface()]), hasLength(1));
      expect(
        validator.parseMessages([createSurface()]).single,
        isA<CreateSurfaceMessage>(),
      );
    });

    test('rejects payloads declaring another protocol version', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);

      for (final version in ['v0.8', 'v0.9.1', 'v1.0']) {
        expect(
          () => validator.checkVersion(createSurface(version: version)),
          throwsA(isA<A2uiValidationError>()),
          reason: version,
        );
        expect(
          () => validator.parseMessages([createSurface(version: version)]),
          throwsA(isA<A2uiValidationError>()),
          reason: version,
        );
      }
    });

    test('rejects payloads that omit the version', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      final Map<String, Map<String, String>> message = {
        'createSurface': {'surfaceId': 's1', 'catalogId': catalogId},
      };

      expect(
        () => validator.checkVersion(message),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => validator.parseMessages([message]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects an envelope naming no known message body', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);

      expect(
        () => validator.parseMessages([
          {'version': 'v0.9', 'notAMessage': <String, Object?>{}},
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('is constructed for a supported version by name', () {
      expect(
        A2uiValidator.forVersion('v0.9').protocolVersion,
        A2uiProtocolVersion.v0_9,
      );
    });

    test('cannot be constructed for an unsupported version', () {
      expect(
        () => A2uiValidator.forVersion('v1.0'),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => A2uiValidator.forVersion(null),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('indexes the catalogs it validates against by id', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      expect(validator.catalogs.keys, [catalogId]);
    });
  });

  group('A2uiValidator.validateStructure', () {
    test('accepts a well formed component graph', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'root', 'component': 'Card', 'child': 'label'},
          {'id': 'label', 'component': 'Text', 'text': 'Hello'},
        ]),
      ]);

      expect(() => validator.validateStructure(messages), returnsNormally);
    }, skip: pendingValidator);

    test('rejects duplicate component ids', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'root', 'component': 'Text', 'text': 'a'},
          {'id': 'root', 'component': 'Text', 'text': 'b'},
        ]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(isA<A2uiIntegrityError>()),
      );
    }, skip: pendingValidator);

    test('rejects a child reference that names no component', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'root', 'component': 'Card', 'child': 'missing'},
        ]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(isA<A2uiIntegrityError>()),
      );
    }, skip: pendingValidator);

    test('rejects a cycle in the component graph', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'a', 'component': 'Card', 'child': 'b'},
          {'id': 'b', 'component': 'Card', 'child': 'a'},
        ]),
      ]);

      expect(
        () => validator.validateStructure(messages),
        throwsA(isA<A2uiRecursionError>()),
      );
    }, skip: pendingValidator);
  });

  group('A2uiValidator.validateAgainstCatalogs', () {
    test('accepts components that satisfy the catalog schema', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Text', 'text': 'Hello'},
        ]),
      ]);

      expect(validator.validateAgainstCatalogs(messages), completes);
    }, skip: pendingValidator);

    test('rejects a component missing a required property', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      final List<A2uiMessage> messages = validator.parseMessages([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Text'},
        ]),
      ]);

      expect(
        validator.validateAgainstCatalogs(messages),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingValidator);

    test('rejects a surface created against an unregistered catalog', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);
      final List<A2uiMessage> messages = validator.parseMessages([
        {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 's1',
            'catalogId': 'https://example.com/catalogs/other.json',
          },
        },
      ]);

      expect(
        validator.validateAgainstCatalogs(messages),
        throwsA(isA<A2uiCatalogError>()),
      );
    }, skip: pendingValidator);
  });

  group('A2uiValidator.validate', () {
    test('returns the parsed messages for a valid payload', () async {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);

      final List<A2uiMessage> messages = await validator.validate([
        createSurface(),
        updateComponents([
          {'id': 'label', 'component': 'Text', 'text': 'Hello'},
        ]),
      ]);

      expect(messages, hasLength(2));
      expect(messages.first, isA<CreateSurfaceMessage>());
    }, skip: pendingValidator);

    test('rejects an unsupported version before any deep check runs', () {
      final A2uiValidator<CatalogComponent, CatalogFunction> validator =
          A2uiValidator(catalogs: [testCatalog()]);

      expect(
        validator.validate([createSurface(version: 'v1.0')]),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });
}
