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

/// How [validatePayload] checks one payload, and how `A2uiRequestProcessor`
/// checks the examples it is given with it: each example is one render, so a
/// surface may arrive across several of its messages, but must be complete
/// once the whole example is applied.
void main() {
  final CatalogApi basic = Catalog.fromJson(
    jsonDecode(
          File(
            '../../specification/v0_9/catalogs/basic/catalog.json',
          ).readAsStringSync(),
        )
        as Map<String, Object?>,
  );

  CreateSurfaceMessage create() => CreateSurfaceMessage(
    version: 'v0.9',
    surfaceId: 's',
    catalogId: basic.id,
  );

  UpdateComponentsMessage update(List<Map<String, Object?>> components) =>
      UpdateComponentsMessage(
        version: 'v0.9',
        surfaceId: 's',
        components: components,
      );

  Map<String, Object?> column(String id, List<String> children) => {
    'id': id,
    'component': 'Column',
    'children': children,
  };

  Map<String, Object?> text(String id) => {
    'id': id,
    'component': 'Text',
    'text': id,
  };

  void check(List<AgentToRendererMessage> example) =>
      A2uiRequestProcessor(activeCatalogs: [basic], examples: [example]);

  group('A2uiRequestProcessor example validation', () {
    test('resolves a recursive definition the catalog document declares', () {
      final CatalogApi tree = Catalog.fromJson({
        'catalogId': 'https://example.com/tree',
        'protocolVersion': '0.9',
        'components': {
          'Tree': {
            'type': 'object',
            'properties': {
              'root': {r'$ref': r'#/$defs/node'},
            },
          },
        },
        r'$defs': {
          'node': {
            'type': 'object',
            'properties': {
              'children': {
                'type': 'array',
                'items': {r'$ref': r'#/$defs/node'},
              },
            },
          },
        },
      });

      expect(
        () => A2uiRequestProcessor(
          activeCatalogs: [tree],
          examples: [
            [
              CreateSurfaceMessage(
                version: 'v0.9',
                surfaceId: 's',
                catalogId: tree.id,
              ),
              update([
                {
                  'id': 'root',
                  'component': 'Tree',
                  'root': {
                    'children': [
                      {'children': <Object?>[]},
                    ],
                  },
                },
              ]),
            ],
          ],
        ),
        returnsNormally,
      );
    });

    test('accepts a parent whose child arrives in a later message', () {
      expect(
        () => check([
          create(),
          update([
            column('root', ['card']),
          ]),
          update([
            column('card', ['title']),
            text('title'),
          ]),
        ]),
        returnsNormally,
      );
    });

    test('rejects an example that leaves a reference unresolved', () {
      expect(
        () => check([
          create(),
          update([
            column('root', ['missing']),
          ]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('rejects an example that leaves a component unreachable', () {
      expect(
        () => check([
          create(),
          update([text('root'), text('orphan')]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('rejects an example whose surface has no root', () {
      expect(
        () => check([
          create(),
          update([text('title')]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('rejects a component the catalog does not declare', () {
      expect(
        () => check([
          create(),
          update([
            {'id': 'root', 'component': 'NoSuchType'},
          ]),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('validatePayload', () {
    test('accepts an update to a surface the payload does not create', () {
      // The surface is assumed to exist, holding components the check never
      // saw.
      expect(
        () => validatePayload(
          [basic],
          [
            update([
              column('root', ['elsewhere']),
            ]),
          ],
        ),
        returnsNormally,
      );
    });

    test('checks the components of an assumed surface', () {
      expect(
        () => validatePayload(
          [basic],
          [
            update([
              {'id': 'root', 'component': 'NoSuchType'},
            ]),
          ],
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('checks a surface the payload creates in full', () {
      expect(
        () => validatePayload(
          [basic],
          [
            create(),
            update([
              column('root', ['missing']),
            ]),
          ],
        ),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('rejects a surface on a catalog that is not active', () {
      expect(
        () => validatePayload(
          [basic],
          [
            CreateSurfaceMessage(
              version: 'v0.9',
              surfaceId: 's',
              catalogId: 'missing',
            ),
          ],
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('accepts an empty payload', () {
      expect(() => validatePayload([basic], []), returnsNormally);
    });

    test('checks the catalogs of an empty payload', () {
      expect(() => validatePayload([], []), throwsA(isA<A2uiCatalogError>()));
    });

    CatalogApi sizedText(String id, String sizeType) => Catalog.fromJson({
      'catalogId': id,
      'protocolVersion': '0.9',
      'components': {
        'Text': {
          'type': 'object',
          'properties': {
            'component': {'const': 'Text'},
            'text': {'type': 'string'},
            'size': {'type': sizeType},
          },
          'required': ['component', 'text'],
        },
      },
    });

    test('assumes a surface on a catalog that accepts every update to it', () {
      // Both catalogs accept the first update, and only "b" accepts the
      // second.
      expect(
        () => validatePayload(
          [sizedText('a', 'string'), sizedText('b', 'number')],
          [
            update([
              {'id': 't', 'component': 'Text', 'text': 'Hi'},
            ]),
            update([
              {'id': 't', 'component': 'Text', 'text': 'Hi', 'size': 12},
            ]),
          ],
        ),
        returnsNormally,
      );
    });

    test('reports the first catalog error when none accepts every update', () {
      expect(
        () => validatePayload(
          [sizedText('a', 'string'), sizedText('b', 'number')],
          [
            update([
              {'id': 't', 'component': 'Text', 'text': 'Hi', 'size': 12},
            ]),
            update([
              {'id': 't', 'component': 'Text', 'text': 'Hi', 'size': 'big'},
            ]),
          ],
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('does not assume a surface that an earlier message deleted', () {
      expect(
        () => validatePayload(
          [basic],
          [
            create(),
            update([
              column('root', ['t']),
              text('t'),
            ]),
            DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's'),
            update([text('t')]),
          ],
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('does not assume a surface that a later message creates', () {
      expect(
        () => validatePayload(
          [basic],
          [
            update([text('t')]),
            create(),
          ],
        ),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('Surface not found'),
          ),
        ),
      );
    });

    test('accepts a surface recreated after a delete', () {
      expect(
        () => validatePayload(
          [basic],
          [
            update([text('t')]),
            DeleteSurfaceMessage(version: 'v0.9', surfaceId: 's'),
            create(),
            update([
              column('root', ['t']),
              text('t'),
            ]),
          ],
        ),
        returnsNormally,
      );
    });

    test('accepts any iterable of messages', () {
      final Iterable<AgentToRendererMessage> messages = [
        create(),
        update([
          column('root', ['t']),
          text('t'),
        ]),
      ].where((_) => true);

      expect(() => validatePayload([basic], messages), returnsNormally);
    });
  });

  test('A2uiRequestProcessor accepts an example that updates a surface it '
      'does not create', () {
    expect(
      () => check([
        update([text('root')]),
      ]),
      returnsNormally,
    );
  });
}
