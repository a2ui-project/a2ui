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
  final CatalogApi basic = Catalog.fromJson(
    jsonDecode(
          File(
            '../../specification/v0_9/catalogs/basic/catalog.json',
          ).readAsStringSync(),
        )
        as Map<String, Object?>,
  );
  final CatalogApi custom = Catalog.fromJson({
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
                'message': 'Required check failed',
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
                'message': 'Required check failed',
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
      expect(written, contains('?isOnline("Offline")'));
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

    group('a double the way ECMAScript Number.prototype.toString does', () {
      /// What a `Gauge` with [value] is written as, after a round trip.
      String gauge(double value) => roundTrip([
        create('g', custom.id),
        components('g', [
          {'id': 'root', 'component': 'Gauge', 'value': value},
        ]),
      ]);

      // Plain decimal for 1e-6 <= |v| < 1e21, exponent form otherwise, with
      // `.0` kept on integral doubles.
      final cases = <double, String>{
        1e-7: '1e-7',
        0.000015: '0.000015',
        1e16: '10000000000000000.0',
        1e21: '1e+21',
        1.5e300: '1.5e+300',
        3.0: '3.0',
        -0.0: '-0.0',
      };
      for (final MapEntry<double, String> entry in cases.entries) {
        test(entry.value, () {
          expect(gauge(entry.key), contains('root = Gauge(${entry.value})'));
        });
      }
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

    test('an update of an item of a list in the data model', () {
      final String written = roundTrip([
        {
          'updateDataModel': {
            'surfaceId': 's',
            'path': '/items/0',
            'value': 'x',
          },
        },
      ]);
      expect(written, 'surface("s")\n\$/items/0 = "x"');
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

    test('non-identifier and reserved component ids before v1.0 with derived '
        'variables and id=', () {
      final String written = roundTrip([
        create('s'),
        components('s', [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['main-title', 'main_title', 'true'],
          },
          {'id': 'main-title', 'component': 'Text', 'text': 'First'},
          {'id': 'main_title', 'component': 'Text', 'text': 'Second'},
          {'id': 'true', 'component': 'Text', 'text': 'Third'},
        ]),
      ]);
      expect(
        written,
        contains('root = Column([main_title_2, main_title, _true])'),
      );
      expect(
        written,
        contains('main_title_2 = Text("First", id="main-title")'),
      );
      expect(written, contains('main_title = Text("Second")'));
      expect(written, contains('_true = Text("Third", id="true")'));
    });

    test('Unicode UAX 31 identifiers as bare variable names', () {
      final String written = roundTrip([
        create('s'),
        components('s', [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['entête', '見出し_1'],
          },
          {'id': 'entête', 'component': 'Text', 'text': 'Bonjour'},
          {'id': '見出し_1', 'component': 'Text', 'text': 'こんにちは'},
        ]),
      ]);
      expect(written, contains('root = Column([entête, 見出し_1])'));
      expect(written, contains('entête = Text("Bonjour")'));
      expect(written, contains('見出し_1 = Text("こんにちは")'));
    });
  });

  group('rejects', () {
    final Map<String, List<Map<String, Object?>>> cases = {
      'an undeclared component property': [
        create('s'),
        components('s', [
          {'id': 'root', 'component': 'Text', 'text': 'x', 'unknownProp': 1},
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
      'a removal below the root of the data model': [
        {
          'updateDataModel': {'surfaceId': 's', 'path': '/name'},
        },
      ],
      'a data model key that is not a path segment': [
        create('s'),
        components('s', [
          {'id': 'root', 'component': 'Text', 'text': 'x'},
        ]),
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

    for (final double value in [double.infinity, double.nan]) {
      test('a non-finite number ($value)', () {
        expect(
          () => parser.decompile(
            messages([
              create('g', custom.id),
              components('g', [
                {'id': 'root', 'component': 'Gauge', 'value': value},
              ]),
            ]),
          ),
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

    test('a non-UAX 31 component id in protocol v1.0', () {
      final CatalogApi v1Basic = Catalog.fromJson(
        jsonDecode(
              File('../../catalogs/basic/v1/catalog.json').readAsStringSync(),
            )
            as Map<String, Object?>,
        protocolVersion: A2uiProtocolVersion.v1_0,
      );
      final Parser v1Parser = const ExpressFormatFactory().createFormat([
        v1Basic,
      ]).createParser();
      final List<AgentToRendererMessage> v1Messages =
          AgentToRendererMessage.parseAll([
            {
              'version': '1.0',
              'createSurface': {
                'surfaceId': 's',
                'components': [
                  {'id': 'root', 'component': 'Card', 'child': 'main-title'},
                  {'id': 'main-title', 'component': 'Text', 'text': 'x'},
                ],
              },
            },
          ], protocolVersion: A2uiProtocolVersion.v1_0).messages;
      expect(
        () => v1Parser.decompile(v1Messages),
        throwsA(
          isA<A2uiValidationError>()
              .having((e) => e.path, 'path', 'components.main-title.id')
              .having((e) => e.errors.map((d) => d.code).toList(), 'codes', [
                'invalid_identifier',
              ]),
        ),
      );
      expect(
        () => v1Parser.compile(
          'root = Card(child=t); t = Text("x", id="main-title")',
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('writes v1.0 actions', () {
    final CatalogApi links = Catalog.fromJson({
      'catalogId': 'https://example.com/links.json',
      'protocolVersion': '1.0',
      'components': {
        'Text': {
          'type': 'object',
          'properties': {
            'component': {'const': 'Text'},
            'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
          },
          'required': ['component', 'text'],
        },
        'Button': {
          'type': 'object',
          'properties': {
            'component': {'const': 'Button'},
            'child': {r'$ref': r'common_types.json#/$defs/Child'},
            'action': {r'$ref': r'common_types.json#/$defs/Action'},
          },
          'required': ['component', 'child', 'action'],
        },
        'Links': {
          'type': 'object',
          'properties': {
            'component': {'const': 'Links'},
            'items': {
              'type': 'array',
              'items': {
                'type': 'object',
                'properties': {
                  'label': {'type': 'string'},
                  'action': {r'$ref': r'common_types.json#/$defs/Action'},
                },
                'required': ['label', 'action'],
              },
            },
          },
          'required': ['component', 'items'],
        },
      },
      'functions': {
        'openUrl': {
          'type': 'object',
          'returnType': 'void',
          'properties': {
            '@call': {'const': 'openUrl'},
            'args': {
              'type': 'object',
              'properties': {
                'url': {'type': 'string'},
              },
              'required': ['url'],
            },
          },
          'required': ['@call', 'args'],
        },
      },
    });
    final Parser v1Parser = const ExpressFormatFactory().createFormat([
      links,
    ]).createParser();

    /// Writes a v1.0 surface of [components] in Express, checks that
    /// compiling the result returns it, and returns what was written.
    String roundTripV1(List<Map<String, Object?>> components) {
      final List<AgentToRendererMessage> original =
          AgentToRendererMessage.parseAll([
            {
              'version': '1.0',
              'createSurface': {
                'surfaceId': 's',
                'catalogId': links.id,
                'components': components,
              },
            },
          ], protocolVersion: A2uiProtocolVersion.v1_0).messages;
      final String written = v1Parser.decompile(original);
      expect(
        v1Parser.compile(written).map((m) => m.toJson()),
        original.map((m) => m.toJson()),
        reason: 'Express written:\n$written',
      );
      return written;
    }

    test('an event with userMessage=, after its context', () {
      expect(
        roundTripV1([
          {
            'id': 'root',
            'component': 'Button',
            'child': 'label',
            'action': {
              'event': {'name': 'reply', 'userMessage': 'Replying now'},
            },
          },
          {'id': 'label', 'component': 'Text', 'text': 'Reply'},
        ]),
        contains('Event("reply", userMessage="Replying now")'),
      );
      expect(
        roundTripV1([
          {
            'id': 'root',
            'component': 'Button',
            'child': 'label',
            'action': {
              'event': {
                'name': 'reply',
                'userMessage': {'@path': '/draft'},
                'context': {'id': 1},
              },
            },
          },
          {'id': 'label', 'component': 'Text', 'text': 'Reply'},
        ]),
        contains(r'Event("reply", {id: 1}, userMessage=$/draft)'),
      );
    });

    test('an event with a function call userMessage', () {
      expect(
        roundTripV1([
          {
            'id': 'root',
            'component': 'Links',
            'items': [
              {
                'label': 'Reply',
                'action': {
                  'event': {
                    'name': 'reply',
                    'userMessage': {
                      '@call': 'openUrl',
                      'args': {'url': 'https://a2ui.org'},
                    },
                  },
                },
              },
            ],
          },
        ]),
        contains('Event("reply", userMessage=openUrl("https://a2ui.org"))'),
      );
    });

    test('a functionCall in an item slot reached through a \$ref', () {
      final CatalogApi menu = Catalog.fromJson({
        'catalogId': 'https://example.com/menu.json',
        'protocolVersion': '1.0',
        'components': {
          'Menu': {
            'type': 'object',
            'properties': {
              'component': {'const': 'Menu'},
              'items': {
                'type': 'array',
                'items': {r'$ref': r'#/$defs/MenuItem'},
              },
            },
            'required': ['component', 'items'],
          },
        },
        'functions': {
          'openUrl': {
            'type': 'object',
            'returnType': 'void',
            'properties': {
              '@call': {'const': 'openUrl'},
              'args': {
                'type': 'object',
                'properties': {
                  'url': {'type': 'string'},
                },
                'required': ['url'],
              },
            },
            'required': ['@call', 'args'],
          },
        },
        r'$defs': {
          'MenuItem': {
            'type': 'object',
            'properties': {
              'label': {'type': 'string'},
              'action': {r'$ref': r'common_types.json#/$defs/Action'},
            },
            'required': ['label', 'action'],
          },
        },
      });
      final String written = ExpressDecompiler([menu]).decompile([
        AgentToRendererMessage.fromJson({
          'version': '1.0',
          'createSurface': {
            'surfaceId': 's1',
            'catalogId': menu.id,
            'components': [
              {
                'id': 'root',
                'component': 'Menu',
                'items': [
                  {
                    'label': 'Docs',
                    'action': {
                      'functionCall': {
                        '@call': 'openUrl',
                        'args': {'url': 'https://a2ui.org'},
                      },
                    },
                  },
                ],
              },
            ],
          },
        }),
      ]);
      expect(
        written,
        contains(
          'root = Menu([{label: "Docs", action: openUrl("https://a2ui.org")}])',
        ),
      );
    });

    test('an event with a userMessage as a map literal before v1.0', () {
      // v0.9 has no userMessage and its compiler rejects `userMessage=`, so
      // the object stays data that compiles back as written.
      final CatalogApi v09 = Catalog.fromJson({
        'catalogId': 'https://example.com/v09.json',
        'protocolVersion': '0.9',
        'components': {
          'Card': {
            'type': 'object',
            'properties': {
              'component': {'const': 'Card'},
              'child': {'type': 'object'},
            },
            'required': ['component', 'child'],
          },
        },
      });
      final String written = ExpressDecompiler([v09]).decompile([
        AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'createSurface': {'surfaceId': 's1', 'catalogId': v09.id},
        }),
        AgentToRendererMessage.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 's1',
            'components': [
              {
                'id': 'root',
                'component': 'Card',
                'child': {
                  'event': {'name': 'go', 'userMessage': 'hi'},
                },
              },
            ],
          },
        }),
      ]);
      expect(written, isNot(contains('Event(')));
      expect(written, contains('{event: {name:'));
    });

    test('a functionCall in a list item action slot as a plain call', () {
      expect(
        roundTripV1([
          {
            'id': 'root',
            'component': 'Links',
            'items': [
              {
                'label': 'Docs',
                'action': {
                  'functionCall': {
                    '@call': 'openUrl',
                    'args': {'url': 'https://a2ui.org'},
                  },
                },
              },
              {
                'label': 'Go',
                'action': {
                  'event': {'name': 'go'},
                },
              },
            ],
          },
        ]),
        contains(
          'root = Links([{label: "Docs", action: openUrl("https://a2ui.org")}, '
          '{label: "Go", action: Event("go")}])',
        ),
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
                {
                  'id': 'root',
                  'component': 'Text',
                  'text': 'x',
                  'unknownProp': 1,
                },
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
