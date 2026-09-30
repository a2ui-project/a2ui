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

/// Writing v0.9 messages in Express against the published v0.9 basic
/// catalog.
///
/// `conformance/agent/express/decompiler.yaml` and
/// `specification_round_trip_test.dart` cover what Express can write. The
/// cases here cover the messages it cannot, the values it writes as the map
/// literal they compile from, and examples in a prompt.
void main() {
  final SchemaCatalog basic = Catalog.fromJson(
    jsonDecode(
          File(
            '../../specification/v0_9/catalogs/basic/catalog.json',
          ).readAsStringSync(),
        )
        as Map<String, Object?>,
  );
  final SchemaCatalog custom = Catalog.fromJson({
    'catalogId': 'https://example.com/custom.json',
    'components': {
      'Gauge': {
        'type': 'object',
        'properties': {
          'component': {'const': 'Gauge'},
          'value': {'type': 'number'},
          'checks': {'type': 'array'},
        },
        'required': ['component', 'value'],
      },
    },
    'functions': {
      'isOnline': {
        'type': 'object',
        'properties': {
          'call': {'const': 'isOnline'},
          'args': {'type': 'object', 'properties': <String, Object?>{}},
          'returnType': {'const': 'boolean'},
        },
        'required': ['call'],
      },
    },
  });
  final Parser parser = const ExpressFormatFactory().createFormat([
    basic,
    custom,
  ]).createParser();

  List<AgentToRendererMessage> messages(List<Map<String, Object?>> bodies) =>
      AgentToRendererMessage.parseAll([
        for (final Map<String, Object?> body in bodies)
          {'version': 'v0.9', ...body},
      ], protocolVersion: A2uiProtocolVersion.v0_9).messages;

  Map<String, Object?> create(String surfaceId, [String? catalogId]) => {
    'createSurface': {
      'surfaceId': surfaceId,
      'catalogId': catalogId ?? basic.id,
    },
  };

  Map<String, Object?> components(
    String surfaceId,
    List<Map<String, Object?>> components,
  ) => {
    'updateComponents': {'surfaceId': surfaceId, 'components': components},
  };

  /// Writes [bodies] in Express, checks that compiling the result returns
  /// them, and returns what was written.
  String roundTrip(List<Map<String, Object?>> bodies) {
    final List<AgentToRendererMessage> original = messages(bodies);
    final String written = parser.decompile(original);
    expect(
      parser.compile(written).map((m) => m.toJson()),
      original.map((m) => m.toJson()),
      reason: 'Express written:\n$written',
    );
    return written;
  }

  group('writes', () {
    test('a check with its message, filling skipped parameters', () {
      final String written = roundTrip([
        create('s'),
        components('s', [
          {
            'id': 'root',
            'component': 'TextField',
            'label': 'Zip',
            'value': {'path': '/zip'},
            'checks': [
              {
                'condition': {
                  'call': 'required',
                  'args': {
                    'value': {'path': '/zip'},
                  },
                },
                'message': 'Required check failed.',
              },
              {
                'condition': {
                  'call': 'length',
                  'args': {
                    'value': {'path': '/zip'},
                    'min': 5,
                  },
                },
                'message': 'Five digits',
              },
            ],
          },
        ]),
      ]);
      expect(written, contains('[?required, ?length(5, _, "Five digits")]'));
    });

    test('a check of another bound value, with the path written out', () {
      final String written = roundTrip([
        create('s'),
        components('s', [
          {
            'id': 'root',
            'component': 'TextField',
            'label': 'Confirm',
            'value': {'path': '/confirm'},
            'checks': [
              {
                'condition': {
                  'call': 'required',
                  'args': {
                    'value': {'path': '/password'},
                  },
                },
                'message': 'Required check failed.',
              },
            ],
          },
        ]),
      ]);
      expect(written, contains(r'?required($/password)'));
    });

    test('a check calling a function without parameters', () {
      final String written = roundTrip([
        create('s', custom.id),
        components('s', [
          {
            'id': 'root',
            'component': 'Gauge',
            'value': 1,
            'checks': [
              {
                'condition': {'call': 'isOnline', 'args': <String, Object?>{}},
                'message': 'Offline',
              },
            ],
          },
        ]),
      ]);
      expect(written, contains('[?isOnline("Offline")]'));
    });

    test('a call stating its return type as the map it compiles from', () {
      final String written = roundTrip([
        create('s'),
        components('s', [
          {
            'id': 'root',
            'component': 'Text',
            'text': {
              'call': 'formatString',
              'args': {'value': r'Hi ${/name}'},
              'returnType': 'string',
            },
          },
        ]),
      ]);
      expect(written, contains('{call: "formatString"'));
    });

    test('a reference to a component of an earlier response as a string', () {
      final String written = roundTrip([
        components('s', [
          {'id': 'header', 'component': 'Card', 'child': 'existing-title'},
        ]),
      ]);
      expect(written, contains('header = Card("existing-title")'));
    });

    test('a template repeating a component of an earlier response as the map '
        'it compiles from', () {
      final String written = roundTrip([
        components('s', [
          {
            'id': 'items',
            'component': 'List',
            'children': {'componentId': 'row', 'path': '/items'},
          },
        ]),
      ]);
      expect(written, contains('{componentId: "row", path: "/items"}'));
    });

    test('a template repeating a component of the same block', () {
      final String written = roundTrip([
        create('s'),
        components('s', [
          {
            'id': 'root',
            'component': 'List',
            'children': {'componentId': 'row', 'path': '/items'},
          },
          {
            'id': 'row',
            'component': 'Text',
            'text': {'path': 'name'},
          },
        ]),
      ]);
      expect(written, contains(r'root = List(_template($/items, row))'));
      expect(written, contains(r'row = Text($name)'));
    });

    test('a surface of another catalog, naming it', () {
      final String written = roundTrip([
        create('g', custom.id),
        components('g', [
          {'id': 'root', 'component': 'Gauge', 'value': 0.5},
        ]),
      ]);
      expect(written, contains('surface("g", "${custom.id}")'));
    });

    test('an update of a surface of another catalog, naming it', () {
      final String written = roundTrip([
        components('g', [
          {'id': 'needle', 'component': 'Gauge', 'value': 0.5},
        ]),
      ]);
      expect(written, contains('surface("g", "${custom.id}")'));
    });

    test('an empty data model', () {
      roundTrip([
        {
          'updateDataModel': {
            'surfaceId': 's',
            'path': '/',
            'value': <String, Object?>{},
          },
        },
      ]);
    });

    test('several operations as paragraphs', () {
      final String written = roundTrip([
        create('a'),
        components('a', [
          {'id': 'root', 'component': 'Text', 'text': 'A'},
        ]),
        {
          'deleteSurface': {'surfaceId': 'b'},
        },
      ]);
      expect(written.split('\n\n'), hasLength(2));
    });
  });

  group('rejects', () {
    final Map<String, List<Map<String, Object?>>> cases = {
      'an id that is not an identifier': [
        create('s'),
        components('s', [
          {'id': 'root', 'component': 'Card', 'child': 'main-title'},
          {'id': 'main-title', 'component': 'Text', 'text': 'x'},
        ]),
      ],
      'a property every component shares': [
        create('s'),
        components('s', [
          {'id': 'root', 'component': 'Text', 'text': 'x', 'weight': 1},
        ]),
      ],
      'a null property': [
        create('s'),
        components('s', [
          {'id': 'root', 'component': 'Text', 'text': 'x', 'variant': null},
        ]),
      ],
      'a check without a message': [
        create('s'),
        components('s', [
          {
            'id': 'root',
            'component': 'TextField',
            'label': 'x',
            'checks': [
              {
                'condition': {
                  'call': 'required',
                  'args': {'value': 'x'},
                },
              },
            ],
          },
        ]),
      ],
      'a number written with an exponent': [
        create('s'),
        components('s', [
          {'id': 'root', 'component': 'Slider', 'max': 1e21},
        ]),
      ],
      'sendDataModel': [
        {
          'createSurface': {
            'surfaceId': 's',
            'catalogId': basic.id,
            'sendDataModel': true,
          },
        },
        components('s', [
          {'id': 'root', 'component': 'Text', 'text': 'x'},
        ]),
      ],
      'a theme': [
        {
          'createSurface': {
            'surfaceId': 's',
            'catalogId': basic.id,
            'theme': {'primaryColor': '#000000'},
          },
        },
        components('s', [
          {'id': 'root', 'component': 'Text', 'text': 'x'},
        ]),
      ],
      'a surface created without a root': [create('s')],
      'an update setting root': [
        components('s', [
          {'id': 'root', 'component': 'Text', 'text': 'x'},
        ]),
      ],
      'an update below the root of the data model': [
        {
          'updateDataModel': {'surfaceId': 's', 'path': '/name', 'value': 'x'},
        },
      ],
      'a data model key that is not a path segment': [
        {
          'updateDataModel': {
            'surfaceId': 's',
            'value': {'first-name': 'x'},
          },
        },
      ],
      'a component of an inactive catalog': [
        create('s', 'https://example.com/other.json'),
        components('s', [
          {'id': 'root', 'component': 'Text', 'text': 'x'},
        ]),
      ],
    };
    for (final MapEntry<String, List<Map<String, Object?>>> entry
        in cases.entries) {
      test(entry.key, () {
        expect(
          () => parser.decompile(messages(entry.value)),
          throwsA(isA<A2uiValidationError>()),
        );
      });
    }

    test('without catalogs', () {
      expect(
        () => const ExpressFormatFactory()
            .createFormat([])
            .createParser()
            .decompile(const []),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('examples', () {
    final List<AgentToRendererMessage> greeting = messages([
      create('greeting'),
      components('greeting', [
        {'id': 'root', 'component': 'Text', 'text': 'Hi'},
      ]),
    ]);

    test('reach the prompt as Express blocks', () {
      final processor = A2uiRequestProcessor(
        activeCatalogs: [basic],
        examples: [greeting],
        formatFactory: const ExpressFormatFactory(),
      );
      expect(
        processor.promptSnippet,
        contains('<a2ui>\nsurface("greeting")\nroot = Text("Hi")\n</a2ui>'),
      );
    });

    test('that Express cannot write fail when the processor is created', () {
      expect(
        () => A2uiRequestProcessor(
          activeCatalogs: [basic],
          examples: [
            messages([
              create('s'),
              components('s', [
                {'id': 'root', 'component': 'Text', 'text': 'x', 'weight': 1},
              ]),
            ]),
          ],
          formatFactory: const ExpressFormatFactory(),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });
}
