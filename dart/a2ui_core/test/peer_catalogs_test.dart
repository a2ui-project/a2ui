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

/// Cross-catalog `$ref` resolution across peer catalogs: what the shared
/// conformance cases in `conformance/core/catalog.yaml` cannot observe, such
/// as which instances linking leaves unchanged.
void main() {
  group('withPeerCatalogs', () {
    test('returns a linked copy and leaves the receiver unchanged', () {
      final CatalogApi peer = _peer('https://example.com/peer.json');
      final CatalogApi referencing = _referencing('peer.json');
      final Map<String, Object?> schemaBefore = referencing.validationSchema;
      final Map<String, Object?> peerSchemaBefore = peer.validationSchema;

      final CatalogApi linked = referencing.withPeerCatalogs([peer]);

      expect(linked, isNot(same(referencing)));
      expect(linked.id, referencing.id);
      expect(linked.components.keys, referencing.components.keys);
      expect(linked.peerCatalogs, [same(peer)]);
      expect(_properties(linked, 'Fancy'), containsAll(['label', 'size']));

      expect(referencing.peerCatalogs, isEmpty);
      expect(referencing.validationSchema, same(schemaBefore));
      expect(_properties(referencing, 'Fancy'), isNot(contains('label')));
      expect(peer.peerCatalogs, isEmpty);
      expect(peer.validationSchema, same(peerSchemaBefore));
    });

    test('returns the receiver when no peer is added', () {
      final CatalogApi peer = _peer('https://example.com/peer.json');
      final CatalogApi linked = _referencing('peer.json').withPeerCatalogs([
        peer,
      ]);

      expect(linked.withPeerCatalogs([peer]), same(linked));
      expect(linked.withPeerCatalogs([linked]), same(linked));
    });

    test('lists link origins, never linked copies', () {
      final CatalogApi peer = _peer('https://example.com/peer.json');
      final CatalogApi other = _referencing('peer.json', id: 'other');
      final CatalogApi linkedOther = other.withPeerCatalogs([peer]);

      final CatalogApi linked = _referencing('peer.json').withPeerCatalogs([
        linkedOther,
        peer,
      ]);

      expect(linked.peerCatalogs, [same(other), same(peer)]);
    });

    test('resolves an entry a pruned peer dropped through its source', () {
      final CatalogApi peer = _peer('https://example.com/peer.json');
      final CatalogApi pruned = peer.copyWith(components: const []);

      final CatalogApi linked = _referencing('peer.json').withPeerCatalogs([
        pruned,
      ]);

      expect(linked.peerCatalogs, [same(peer), same(pruned)]);
      expect(_properties(linked, 'Fancy'), containsAll(['label', 'size']));
    });

    test('resolves references a peer makes to a further peer', () {
      final CatalogApi c = Catalog.fromJson({
        'catalogId': 'https://example.com/c.json',
        'components': {
          'Base': _component('Base', {
            'depth': {'type': 'number'},
          }, required: [
            'depth'
          ]),
        },
      });
      final CatalogApi b = Catalog.fromJson({
        'catalogId': 'https://example.com/b.json',
        'components': {
          'Middle': _component(
            'Middle',
            {
              'title': {'type': 'string'},
            },
            allOf: ['c.json#/components/Base'],
          ),
        },
      });
      final CatalogApi a = Catalog.fromJson({
        'catalogId': 'https://example.com/a.json',
        'components': {
          'Top': _component('Top', const {}, allOf: [
            'b.json#/components/Middle',
          ]),
        },
      });

      final List<CatalogApi> linked = linkCatalogs([a, b, c]);

      expect(_properties(linked[0], 'Top'), containsAll(['title', 'depth']));
      final validator = PayloadValidator<ComponentApi, FunctionApi>(
        catalog: linked[0],
      );
      validator.validateComponent({
        'id': 't',
        'component': 'Top',
        'title': 'x',
        'depth': 2,
      });
      expect(
        () => validator.validateComponent({
          'id': 't',
          'component': 'Top',
          'title': 'x',
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test("resolves a peer's local references in the peer's document", () {
      final CatalogApi peer = Catalog.fromJson({
        'catalogId': 'https://example.com/peer.json',
        r'$defs': {
          'Size': {'type': 'number'},
          'Common': {
            'properties': {
              'peerCommon': {'type': 'boolean'},
            },
          },
        },
        'components': {
          'Sized': _component(
            'Sized',
            {
              'size': {r'$ref': r'#/$defs/Size'},
              'twin': {r'$ref': '#/components/Sized/properties/size'},
            },
            allOf: [r'#/$defs/Common'],
          ),
        },
      });
      final CatalogApi referencing = Catalog.fromJson({
        'catalogId': 'https://example.com/referencing.json',
        r'$defs': {
          'Size': {'type': 'string'},
          'Common': {
            'properties': {
              'ownCommon': {'type': 'boolean'},
            },
          },
        },
        'components': {
          'Mine': _component('Mine', const {}, allOf: [
            r'#/$defs/Common',
            'peer.json#/components/Sized',
          ]),
        },
      });

      final CatalogApi linked = referencing.withPeerCatalogs([peer]);
      final properties = linked
          .resolvedComponentSchema('Mine')!
          .value['properties']! as Map<String, Object?>;

      expect(
        properties.keys,
        containsAll(['ownCommon', 'peerCommon', 'size', 'twin']),
      );
      expect(properties['size'], {'type': 'number'});
      expect(properties['twin'], {'type': 'number'});
    });

    test('follows the same local pointer again inside a peer document', () {
      final CatalogApi peer = Catalog.fromJson({
        'catalogId': 'https://example.com/peer.json',
        r'$defs': {
          'Box': {
            'type': 'object',
            'properties': {
              'size': {'type': 'number'},
            },
          },
          'Wrapper': {
            'type': 'object',
            'properties': {
              'box': {r'$ref': r'#/$defs/Box'},
            },
          },
        },
        'components': const {},
      });
      final CatalogApi referencing = Catalog.fromJson({
        'catalogId': 'https://example.com/referencing.json',
        r'$defs': {
          'Box': {
            'type': 'object',
            'properties': {
              'wrapped': {r'$ref': r'peer.json#/$defs/Wrapper'},
            },
          },
        },
        'components': {
          'Holder': _component('Holder', {
            'box': {r'$ref': r'#/$defs/Box'},
          }),
        },
      });

      final CatalogApi linked = referencing.withPeerCatalogs([peer]);
      final box =
          (linked.resolvedComponentSchema('Holder')!.value['properties']!
              as Map<String, Object?>)['box']! as Map<String, Object?>;
      final Object? innerBox = ((((box['properties']! as Map)['wrapped']!
          as Map)['properties']! as Map)['box']! as Map)['properties'];

      expect(innerBox, {
        'size': {'type': 'number'},
      });
    });
  });

  group('peer matching', () {
    final CatalogApi alpha = _peer(
      'https://example.com/catalogs/alpha/catalog.json',
      catalogId: 'example/alpha',
      property: 'alpha',
    );
    final CatalogApi beta = _peer(
      'https://example.com/catalogs/beta/catalog.json',
      catalogId: 'example/beta',
      property: 'beta',
    );
    final CatalogApi mcp = _peer(
      'https://example.com/catalogs/mcp_catalog.json',
      catalogId: 'example/mcp',
      property: 'mcp',
    );

    Set<String> resolve(String document) => _properties(
          _referencing(document).withPeerCatalogs([alpha, beta, mcp]),
          'Fancy',
        );

    test(r"prefers a peer's exact $id to an earlier peer's file name", () {
      expect(
        resolve('https://example.com/catalogs/beta/catalog.json'),
        contains('beta'),
      );
      expect(
        resolve('https://example.com/catalogs/beta/catalog.json'),
        isNot(contains('alpha')),
      );
    });

    test('matches a path suffix of a peer id', () {
      expect(resolve('beta/catalog.json'), contains('beta'));
      expect(resolve('example/alpha'), contains('alpha'));
    });

    test('resolves mcp_catalog.json to the peer with that file name', () {
      expect(resolve('mcp_catalog.json'), contains('mcp'));
    });

    test('reads an unmatched catalog.json path as the catalog itself', () {
      final Set<String> properties = resolve(
        'https://example.com/catalogs/gamma/catalog.json',
      );
      expect(properties, isNot(anyOf(contains('alpha'), contains('beta'))));
      expect(properties, isNot(contains('mcp')));
    });
  });

  group('unresolvable cross-catalog references', () {
    for (final (String name, Map<String, Object?> schema) in [
      (
        'an allOf member',
        _component('Broken', const {}, allOf: ['other.json#/components/X']),
      ),
      (
        'a property',
        _component('Broken', {
          'p': {r'$ref': 'mcp_catalog.json#/components/Badge/properties/icon'},
        }),
      ),
    ]) {
      test('fail validation for $name instead of accepting any value', () {
        final CatalogApi catalog = Catalog.fromJson({
          'catalogId': 'https://example.com/broken.json',
          'components': {'Broken': schema},
        }).withPeerCatalogs([_peer('https://example.com/peer.json')]);
        final validator = PayloadValidator<ComponentApi, FunctionApi>(
          catalog: catalog,
        );

        expect(
          () => validator.validateComponent({
            'id': 'b',
            'component': 'Broken',
            'p': 42,
          }),
          throwsA(
            isA<A2uiCatalogError>().having(
              (e) => e.message,
              'message',
              contains('Unresolvable schema reference'),
            ),
          ),
        );
      });
    }
  });

  group('linkCatalogs', () {
    test('returns catalogs without cross-catalog references as they are', () {
      final CatalogApi peer = _peer('https://example.com/peer.json');
      final CatalogApi referencing = _referencing('peer.json');

      final List<CatalogApi> linked = linkCatalogs([peer, referencing]);

      expect(linked[0], same(peer));
      expect(linked[1], isNot(same(referencing)));
      expect(linked[1].peerCatalogs, [same(peer)]);
      expect(referencing.peerCatalogs, isEmpty);
    });

    test('puts extra peers first', () {
      final CatalogApi peer = _peer('https://example.com/peer.json');
      final CatalogApi extra = _peer('https://example.com/extra.json');
      final CatalogApi referencing = _referencing('peer.json');

      final List<CatalogApi> linked = linkCatalogs(
        [referencing, peer],
        extraPeers: [extra],
      );

      expect(linked[0].peerCatalogs, [same(extra), same(peer)]);
    });

    test('returns a single catalog as it is', () {
      final CatalogApi referencing = _referencing('peer.json');
      expect(linkCatalogs([referencing]).single, same(referencing));
    });
  });

  group('MessageProcessor', () {
    test('links copies and leaves a shared catalog unchanged', () {
      final Catalog<ComponentApi, FunctionImplementation> basic =
          BasicCatalog.v1_0();
      final Map<String, Object?> basicSchema = basic.validationSchema;
      final Catalog<ComponentApi, FunctionImplementation> referencing =
          _referencing(
        '${BasicCatalog.v1_0Id}#/components/Text',
        pointer: false,
        protocolVersion: A2uiProtocolVersion.v1_0,
      ).withFunctions(const <FunctionImplementation>[]);

      for (var i = 0; i < 2; i++) {
        final processor = MessageProcessor<ComponentApi>(
          catalogs: [basic, referencing],
        );
        addTearDown(processor.model.dispose);

        expect(processor.catalogs[0], same(basic));
        expect(processor.catalogs[1], isNot(same(referencing)));
        expect(processor.catalogs[1].peerCatalogs, [same(basic)]);
        expect(_properties(processor.catalogs[1], 'Fancy'), contains('text'));
      }

      expect(basic.peerCatalogs, isEmpty);
      expect(basic.validationSchema, same(basicSchema));
      expect(referencing.peerCatalogs, isEmpty);
    });
  });
}

/// A component schema named [name] with [properties], inheriting the
/// subschemas at [allOf].
Map<String, Object?> _component(
  String name,
  Map<String, Object?> properties, {
  List<String> allOf = const [],
  List<String> required = const [],
}) =>
    {
      'type': 'object',
      if (allOf.isNotEmpty)
        'allOf': [
          for (final ref in allOf) {r'$ref': ref}
        ],
      'properties': {
        'component': {'const': name},
        ...properties,
      },
      'required': ['component', ...required],
    };

/// A catalog with `$id` [schemaId] whose `Badge` component requires a string
/// [property] and has a number `size`.
CatalogApi _peer(
  String schemaId, {
  String? catalogId,
  String property = 'label',
}) =>
    Catalog.fromJson({
      r'$id': schemaId,
      'catalogId': catalogId ?? schemaId,
      'components': {
        'Badge': _component('Badge', {
          property: {'type': 'string'},
          'size': {'type': 'number'},
        }, required: [
          property
        ]),
      },
    });

/// A catalog whose `Fancy` component inherits `Badge` from the document
/// [document], or, when [pointer] is false, the subschema [document] names.
CatalogApi _referencing(
  String document, {
  String id = 'https://example.com/referencing.json',
  bool pointer = true,
  A2uiProtocolVersion? protocolVersion,
}) =>
    Catalog.fromJson({
      'catalogId': id,
      'components': {
        'Fancy': _component('Fancy', const {}, allOf: [
          pointer ? '$document#/components/Badge' : document,
        ]),
      },
    }, protocolVersion: protocolVersion);

/// The property names of [component]'s resolved schema in [catalog].
Set<String> _properties(CatalogApi catalog, String component) => {
      ...(catalog.resolvedComponentSchema(component)!.value['properties']!
              as Map<String, Object?>)
          .keys,
    };
