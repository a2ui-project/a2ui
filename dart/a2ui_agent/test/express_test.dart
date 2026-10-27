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

/// Express prompting and parsing against the published v0.9 basic catalog.
///
/// The rules shared by every SDK are covered by the conformance suites, run
/// by `conformance/express_conformance_test.dart`. The cases here cover what
/// those suites do not: the v0.9 message shapes, decisions of this SDK, and
/// the checks `A2uiRequestProcessor` runs across blocks.
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
        },
        'required': ['component', 'value'],
      },
    },
  });

  A2uiRequestProcessor processor([List<CatalogApi>? catalogs]) =>
      A2uiRequestProcessor(activeCatalogs: catalogs ?? [basic]);

  /// The messages one block compiles to, as JSON.
  List<Map<String, Object?>> compile(String block) {
    final List<ResponsePart> parts = processor().parseResponse(
      '<a2ui>\n$block\n</a2ui>',
    );
    return [for (final m in (parts.single as A2uiPart).a2ui) m.toJson()];
  }

  /// The components of the one surface a block creates.
  List<Object?> components(String block) {
    final List<Map<String, Object?>> messages = compile(block);
    return (messages[1]['updateComponents']! as Map)['components']! as List;
  }

  Matcher throwsError<T extends A2uiError>() => throwsA(isA<T>());

  group('compiles', () {
    test('a root into createSurface and updateComponents', () {
      expect(compile('root = Text("Hello")'), [
        {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': 'default_surface',
            'catalogId': basic.id,
            'sendDataModel': false,
          },
        },
        {
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'default_surface',
            'components': [
              {'id': 'root', 'component': 'Text', 'text': 'Hello'},
            ],
          },
        },
      ]);
    });

    test('children named by variable and written inline', () {
      expect(
        components('''
root = Column([title, Text("Inline")])
title = Card(Text("Nested"))
'''),
        [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['title', 'root_children_1'],
          },
          {'id': 'root_children_1', 'component': 'Text', 'text': 'Inline'},
          {'id': 'title', 'component': 'Card', 'child': 'title_child'},
          {'id': 'title_child', 'component': 'Text', 'text': 'Nested'},
        ],
      );
    });

    test('keyword arguments, placeholders and nulls', () {
      expect(
        components('root = TextField("Email", _, null, validationRegexp=".+")'),
        [
          {
            'id': 'root',
            'component': 'TextField',
            'label': 'Email',
            'validationRegexp': '.+',
          },
        ],
      );
    });

    test('common property weight as kwarg', () {
      expect(components('root = Text("Hello", weight=2)'), [
        {'id': 'root', 'component': 'Text', 'text': 'Hello', 'weight': 2},
      ]);
    });

    test('string literals', () {
      expect(
        components(r'''
root = Column([a, b, c])
a = Text(r"C:\temp\n")
b = Text("Line 1\nLine \"2\"")
c = Text("""Say "hi" """)
'''),
        containsAll(<Object?>[
          {'id': 'a', 'component': 'Text', 'text': r'C:\temp\n'},
          {'id': 'b', 'component': 'Text', 'text': 'Line 1\nLine "2"'},
          {'id': 'c', 'component': 'Text', 'text': 'Say "hi" '},
        ]),
      );
    });

    test('checks on the bound value, with and without messages', () {
      final List<Object?> compiled = components(r'''
root = TextField("Zip", $/zip, checks=[?required, ?regex(r"^[0-9]{5}$", "Five digits"), ?length(5, 5)])
''');
      expect((compiled.single! as Map)['checks'], [
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
            'call': 'regex',
            'args': {
              'value': {'path': '/zip'},
              'pattern': r'^[0-9]{5}$',
            },
          },
          'message': 'Five digits',
        },
        {
          'condition': {
            'call': 'length',
            'args': {
              'value': {'path': '/zip'},
              'min': 5,
              'max': 5,
            },
          },
          'message': 'Length check failed',
        },
      ]);
    });

    test('data assignments into updateDataModel', () {
      expect(
        compile(r'''
$/user/name = "Ada"
$/items = [1, 2]
root = Text($/user/name)
''').last,
        {
          'version': 'v0.9',
          'updateDataModel': {
            'surfaceId': 'default_surface',
            'path': '/',
            'value': {
              'user': {'name': 'Ada'},
              'items': [1, 2],
            },
          },
        },
      );
    });

    test(
      'standalone data assignments emit targeted updateDataModel messages',
      () {
        final List<AgentToRendererMessage> messages = ExpressCompiler([basic])
            .compile(r'''
surface("main")
$/user/name = "Ada"
$/items/0 = "updated"
''');
        expect(
          [for (final m in messages) m.toJson()],
          [
            {
              'version': 'v0.9',
              'updateDataModel': {
                'surfaceId': 'main',
                'path': '/user/name',
                'value': 'Ada',
              },
            },
            {
              'version': 'v0.9',
              'updateDataModel': {
                'surfaceId': 'main',
                'path': '/items/0',
                'value': 'updated',
              },
            },
          ],
        );
      },
    );

    test('root data model replacement and array override on createSurface', () {
      expect(
        (compile(r'''
$/stale = "remove_me"
$/ = {items: ["a", "b"]}
$/items/1 = "B"
$/matrix/0/1 = "cell"
root = Text("hi")
''').last['updateDataModel']!
            as Map)['value'],
        {
          'items': ['a', 'B'],
          'matrix': [
            [null, 'cell'],
          ],
        },
      );
    });

    test(
      'rejects invalid list or primitive path traversal on createSurface',
      () {
        expect(
          () => compile(r'''
$/items = ["a", "b"]
$/items/foo = "bar"
root = Text("hi")
'''),
          throwsA(isA<A2uiValidationError>()),
        );
        expect(
          () => compile(r'''
$/user = "Ada"
$/user/name = "Lovelace"
root = Text("hi")
'''),
          throwsA(isA<A2uiValidationError>()),
        );
        expect(
          () => compile(r'''
$/items/99999 = "too_large"
root = Text("hi")
'''),
          throwsA(isA<A2uiValidationError>()),
        );
      },
    );

    test('data assignments into a map assigned earlier', () {
      expect(
        (compile(r'''
$/user = {name: "Ada"}
$/user/age = 36
$/action = Event("go")
$/action/event/extra = null
root = Text($/user/name)
''').last['updateDataModel']!
            as Map)['value'],
        {
          'user': {'name': 'Ada', 'age': 36},
          'action': {
            'event': {'name': 'go', 'extra': null},
          },
        },
      );
    });

    test('an integer too large for an int as a double', () {
      expect(components('root = Text("x", weight=99999999999999999999)'), [
        {'id': 'root', 'component': 'Text', 'text': 'x', 'weight': 1e20},
      ]);
    });

    test('line-wrapped identifiers, paths, and single-line strings', () {
      expect(
        components(
          'root = Column([card2\nRating], justify="start\n")\n'
          'card2\nRating = Card(lights\nCheckbox)\n'
          'lightsCheckbox = Text(\$/\nform/phone)',
        ),
        containsAll(<Object?>[
          {
            'id': 'root',
            'component': 'Column',
            'children': ['card2Rating'],
            'justify': 'start',
          },
          {'id': 'card2Rating', 'component': 'Card', 'child': 'lightsCheckbox'},
          {
            'id': 'lightsCheckbox',
            'component': 'Text',
            'text': {'path': '/form/phone'},
          },
        ]),
      );
    });

    test('positional numeric weight skipping non-numeric properties', () {
      expect(components('root = Column([a], 2)\na = Text("hi")'), [
        {
          'id': 'root',
          'component': 'Column',
          'children': ['a'],
          'weight': 2,
        },
        {'id': 'a', 'component': 'Text', 'text': 'hi'},
      ]);
    });

    group('number literals', () {
      /// The `value` of a `Gauge` written with [literal].
      Object? gauge(String literal) {
        final List<ResponsePart>
        parts = processor([basic, custom]).parseResponse(
          '<a2ui>surface("g", "${custom.id}"); root = Gauge($literal)</a2ui>',
        );
        final AgentToRendererMessage last =
            (parts.single as A2uiPart).a2ui.last;
        return (last as UpdateComponentsMessage).components.single['value'];
      }

      // Integer text (no '.', 'e' or 'E') is an exact int while it fits in
      // one; everything else is a double, read the way `double.parse` does.
      final cases = <String, (Object, Matcher)>{
        '.5': (0.5, isA<double>()),
        '-.25': (-0.25, isA<double>()),
        '1.': (1.0, isA<double>()),
        '+3': (3, isA<int>()),
        '1e2': (100.0, isA<double>()),
        '1E-2': (0.01, isA<double>()),
        '2.5e-7': (2.5e-7, isA<double>()),
        '9007199254740991': (9007199254740991, isA<int>()),
        '9007199254740993': (9007199254740993, isA<int>()),
        '18446744073709551616': (18446744073709552000.0, isA<double>()),
        '-0': (0, isA<int>()),
      };
      for (final MapEntry<String, (Object, Matcher)> entry in cases.entries) {
        test(entry.key, () {
          final Object? value = gauge(entry.key);
          expect(value, entry.value.$2);
          expect(value, entry.value.$1);
        });
      }

      test('out of the double range is a parse error', () {
        expect(() => gauge('1e999'), throwsError<A2uiParseError>());
        expect(() => gauge('-1e999'), throwsError<A2uiParseError>());
      });
    });
  });

  group('parses a response', () {
    test('checking each block against the surfaces earlier blocks built', () {
      final List<ResponsePart> parts = processor().parseResponse('''
Here it is.
```
<a2ui>
surface("s1")
root = Text("</a2ui> inside a string")
</a2ui>
```
And now some data.
<a2ui>
surface("s1")
\$/title = "Hello"
</a2ui>
<a2ui>deleteSurface("s1")</a2ui>
''');
      expect(parts, hasLength(5));
      expect((parts[0] as TextPart).text, 'Here it is.');
      expect((parts[1] as A2uiPart).a2ui.map((m) => m.runtimeType), [
        CreateSurfaceMessage,
        UpdateComponentsMessage,
      ]);
      expect((parts[2] as TextPart).text, 'And now some data.');
      expect((parts[3] as A2uiPart).a2ui.single, isA<UpdateDataModelMessage>());
      expect((parts[4] as A2uiPart).a2ui.single, isA<DeleteSurfaceMessage>());
    });

    test('with a surface built from another catalog', () {
      final List<ResponsePart> parts = processor([basic, custom]).parseResponse(
        '<a2ui>surface("g", "${custom.id}"); root = Gauge(0.5)</a2ui>',
      );
      final List<AgentToRendererMessage> messages =
          (parts.single as A2uiPart).a2ui;
      expect((messages.first as CreateSurfaceMessage).catalogId, custom.id);
      expect((messages.last as UpdateComponentsMessage).components, [
        {'id': 'root', 'component': 'Gauge', 'value': 0.5},
      ]);
    });
  });

  group('rejects', () {
    final cases = <String, (String, Matcher)>{
      'a property given twice': (
        'root = Text("x", "h1", variant="h2")',
        throwsError<A2uiValidationError>(),
      ),
      // A block without root updates a surface an earlier response created,
      // which a processor checking one response on its own does not hold.
      'components without root': (
        r'$/title = "x"; title = Text($/title)',
        throwsError<A2uiIntegrityError>(),
      ),
      'too many arguments': (
        'root = Card(a, b); a = Text("A"); b = Text("B")',
        throwsError<A2uiValidationError>(),
      ),
      'an unassigned variable': (
        'root = Card(body)',
        throwsError<A2uiValidationError>(),
      ),
      'a block without root': (
        'title = Text("x")',
        throwsError<A2uiIntegrityError>(),
      ),
      'a block without components or data': (
        'surface("s1")',
        throwsError<A2uiValidationError>(),
      ),
      'a standalone function call, which v0.9 has no message for': (
        'openUrl("https://a2ui.org")',
        throwsError<A2uiValidationError>(),
      ),
      'a component nothing reaches from root': (
        'root = Text("x"); orphan = Text("y")',
        throwsError<A2uiIntegrityError>(),
      ),
      'two top-level components with the same explicit id': (
        'root = Column([a, b]); a = Text("x", id="dup"); '
            'b = Text("y", id="dup")',
        throwsError<A2uiValidationError>(),
      ),
      'two inline components with the same explicit id': (
        'root = Column([Text("x", id="dup"), Text("y", id="dup")])',
        throwsError<A2uiValidationError>(),
      ),
    };
    for (final MapEntry<String, (String, Matcher)> entry in cases.entries) {
      test(entry.key, () {
        expect(() => compile(entry.value.$1), entry.value.$2);
      });
    }
  });

  group('reports where a syntax error is', () {
    final cases = <String, (String, String)>{
      'one the parser finds': (
        'root = Text("x")\nb = Text("y"',
        "line 2, column 13: mismatched input '<EOF>'",
      ),
      'one the lexer finds': (
        'root = @Text("x")',
        "line 1, column 8: token recognition error at: '@'",
      ),
      'an argument given twice': (
        'root = Text(text="a", text="b")',
        "line 1, column 23: argument 'text' is given twice.",
      ),
    };
    for (final MapEntry<String, (String, String)> entry in cases.entries) {
      test(entry.key, () {
        expect(
          () => compile(entry.value.$1),
          throwsA(
            isA<A2uiParseError>().having(
              (e) => e.message,
              'message',
              contains('Express syntax error at ${entry.value.$2}'),
            ),
          ),
        );
      });
    }
  });

  group('promptSnippet', () {
    test('annotates the catalog signatures', () {
      final String snippet = processor().promptSnippet;
      expect(
        snippet,
        contains(
          '• TextField(label, value?, variant? (static), '
          'validationRegexp? (static), '
          'weight? (static), checks?)',
        ),
      );
      expect(
        snippet,
        contains(
          '• Button(child (component ID), variant? (static), action (action), '
          'weight? (static), checks?)',
        ),
      );
      expect(snippet, contains('• formatString(value)'));
      expect(snippet, contains('• openUrl(url)'));
    });

    test('describes each function', () {
      expect(
        processor().promptSnippet,
        contains(
          '• required(value)\n'
          '  - Description: Checks that the value is not null, undefined, or '
          'empty.',
        ),
      );
    });

    test('describes only the statements of the allowed messages', () {
      String snippet(List<String> allowed) => ExpressFormatFactory(
        allowedMessages: allowed,
      ).createFormat([basic]).promptGenerator.generate();

      final String data = snippet(['updateDataModel']);
      expect(data, contains(r'$/path/to/key = "value"'));
      expect(data, contains('surface("dashboard-surface-1")'));
      expect(data, isNot(contains('root = ')));
      expect(data, isNot(contains('deleteSurface(')));
      expect(data, contains('\n6. Surface targeting'));

      final String update = snippet(['updateComponents']);
      expect(update, contains('_template('));
      expect(update, isNot(contains("reserved variable 'root'")));
      expect(update, isNot(contains('root = ComponentB(...)')));

      final String delete = snippet(['deleteSurface']);
      expect(delete, contains('deleteSurface("dashboard-surface-1")'));
      expect(delete, isNot(contains('surface(surfaceId)')));
    });

    test('rejects an allowed message v0.9 does not have', () {
      expect(
        () => const ExpressFormatFactory(
          allowedMessages: ['callFunction'],
        ).createFormat([basic]).promptGenerator.generate(),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('names each catalog when there are several', () {
      final String snippet = processor([basic, custom]).promptSnippet;
      expect(snippet, contains('## Catalog `${basic.id}`'));
      expect(snippet, contains('## Catalog `${custom.id}`'));
      expect(snippet, contains('• Gauge(value (static))'));
    });
  });

  group('parser', () {
    final Parser parser = const ExpressFormatFactory().createFormat([
      basic,
    ]).createParser();

    test('finds an open block, and a closed one when asked', () {
      const open = 'Here: <a2ui>\nroot = Text("Hello")';
      expect(parser.hasFormatContent(open), isTrue);
      expect(parser.hasFormatContent(open, complete: true), isFalse);
      expect(parser.hasFormatContent('$open\n</a2ui>', complete: true), isTrue);
    });

    test('does not take a close tag in a string as the end of a block', () {
      expect(
        parser.hasFormatContent(
          '<a2ui>\nroot = Text("</a2ui>")',
          complete: true,
        ),
        isFalse,
      );
    });

    group('ends a block where the grammar ends strings and comments', () {
      final cases = <String, (String, String)>{
        'a comment, at a lone carriage return': (
          '<a2ui>\r# note\rroot = Text("x")\r</a2ui>',
          '# note\rroot = Text("x")',
        ),
        'a triple-quoted string without its closing quotes': (
          '<a2ui>root = Text("""x")</a2ui>',
          'root = Text("""x")',
        ),
        'a raw triple-quoted string without its closing quotes': (
          '<a2ui>root = Text(r"""x")</a2ui>',
          'root = Text(r"""x")',
        ),
        // `r"` followed by a line break is the name `r` and a string, which
        // reads `\"` as an escaped quote.
        'a raw string across a line break': (
          '<a2ui>x = r"\n\\"</a2ui>"\n</a2ui>',
          'x = r"\n\\"</a2ui>"',
        ),
        // `$r` is a path, so the string after it is not raw.
        'a raw string prefix inside a path': (
          '<a2ui>x = \$r"\\"</a2ui>"\n</a2ui>',
          'x = \$r"\\"</a2ui>"',
        ),
      };
      for (final MapEntry<String, (String, String)> entry in cases.entries) {
        test(entry.key, () {
          expect(
            parser.hasFormatContent(entry.value.$1, complete: true),
            isTrue,
          );
          expect(parser.unwrap(entry.value.$1), [
            isA<RawA2uiPart>()
                .having((p) => p.a2uiRaw, 'a2uiRaw', entry.value.$2)
                .having((p) => p.isFinal, 'isFinal', isTrue),
          ]);
        });
      }
    });

    test('reads a direct JSON block as text', () {
      const json = '<a2ui-json>[]</a2ui-json>';
      expect(parser.hasFormatContent(json), isFalse);
      expect(parser.hasFormatContent('Which city?'), isFalse);
      const response = '$json\n<a2ui>\nroot = Text("x")\n</a2ui>';
      expect(parser.hasFormatContent(response, complete: true), isTrue);
      expect(parser.unwrap(response), [
        isA<TextPart>().having((p) => p.text, 'text', json),
        isA<RawA2uiPart>().having(
          (p) => p.a2uiRaw,
          'a2uiRaw',
          'root = Text("x")',
        ),
      ]);
    });

    test('does not stream', () {
      expect(parser.supportsStreaming, isFalse);
      expect(parser.openStream, throwsUnsupportedError);
    });
  });

  group('public API', () {
    test('builds a format from its parts, as the factory does', () {
      final format = ExpressFormat(
        [basic],
        allowedMessages: ['createSurface', 'updateComponents'],
      );
      expect(format.promptGenerator.catalogs, [basic]);
      expect(
        format.promptGenerator.generate(),
        const ExpressFormatFactory(
          allowedMessages: ['createSurface', 'updateComponents'],
        ).createFormat([basic]).promptGenerator.generate(),
      );
      expect(format.createParser(), isA<ExpressParser>());
      expect(
        () => ExpressFormat([basic, basic]),
        throwsError<A2uiCatalogError>(),
      );
    });

    test('compiles and decompiles a block', () {
      final List<AgentToRendererMessage> messages = ExpressCompiler([
        basic,
      ]).compile('root = Text("Hello")');
      final String block = ExpressDecompiler([basic]).decompile(messages);
      expect(
        ExpressParser([basic]).compile(block).map((m) => m.toJson()),
        messages.map((m) => m.toJson()),
      );
    });
  });

  // A local mixin whose own `allOf` brings in the common types and adds
  // properties, as `MaterialComponentCommon` does in a composite catalog.
  group('a local mixin with a nested allOf', () {
    const commonTypes = 'https://a2ui.org/specification/v0_9/common_types.json';
    final CatalogApi material = Catalog.fromJson({
      'catalogId': 'https://example.com/material.json',
      r'$defs': {
        'MaterialComponentCommon': {
          'allOf': [
            {r'$ref': '$commonTypes#/\$defs/ComponentCommon'},
            {
              'type': 'object',
              'properties': {
                'weight': {'type': 'number'},
                'style': {'type': 'object'},
              },
            },
          ],
        },
      },
      'components': {
        'MaterialText': {
          'type': 'object',
          'allOf': [
            {r'$ref': r'#/$defs/MaterialComponentCommon'},
            {
              'type': 'object',
              'properties': {
                'component': {'const': 'MaterialText'},
                'text': {r'$ref': '$commonTypes#/\$defs/DynamicString'},
                'usageHint': {
                  'type': 'string',
                  'enum': ['h1', 'body'],
                },
              },
              'required': ['component', 'text'],
            },
          ],
          'unevaluatedProperties': false,
        },
        // Overrides the mixin's `style` with its own definition.
        'MaterialCard': {
          'type': 'object',
          'allOf': [
            {r'$ref': r'#/$defs/MaterialComponentCommon'},
            {
              'type': 'object',
              'properties': {
                'component': {'const': 'MaterialCard'},
                'child': {r'$ref': '$commonTypes#/\$defs/ComponentId'},
                'style': {
                  'type': 'string',
                  'enum': ['outlined', 'filled'],
                },
              },
              'required': ['component', 'child'],
            },
          ],
          'unevaluatedProperties': false,
        },
      },
    });

    List<Object?> compileMaterial(String block) {
      final List<ResponsePart> parts = processor([material]).parseResponse(
        '<a2ui>\nsurface("s", "${material.id}")\n$block\n</a2ui>',
      );
      final List<Map<String, Object?>> messages = [
        for (final m in (parts.single as A2uiPart).a2ui) m.toJson(),
      ];
      return (messages[1]['updateComponents']! as Map)['components']! as List;
    }

    test('includes the mixin properties in the signature', () {
      final String snippet = processor([material]).promptSnippet;
      expect(
        snippet,
        contains(
          '• MaterialText(style? (static), text, usageHint? (static), '
          'weight? (static))',
        ),
      );
      expect(
        snippet,
        contains(
          '• MaterialCard(style? (static), child (component ID), '
          'weight? (static))',
        ),
      );
    });

    test('maps positional arguments onto the mixin properties', () {
      expect(
        compileMaterial(
          'root = MaterialCard("filled", body, 2)\n'
          'body = MaterialText({"color": "red"}, "Hi", "h1", 3)',
        ),
        [
          {
            'id': 'root',
            'component': 'MaterialCard',
            'style': 'filled',
            'child': 'body',
            'weight': 2,
          },
          {
            'id': 'body',
            'component': 'MaterialText',
            'style': {'color': 'red'},
            'text': 'Hi',
            'usageHint': 'h1',
            'weight': 3,
          },
        ],
      );
    });

    test("prefers the component's own definition of a mixin property", () {
      final String snippet = processor([material]).promptSnippet;
      expect(snippet, contains("Must be one of: 'outlined', 'filled'"));
      expect(
        () => compileMaterial(
          'root = MaterialCard({"color": "red"}, body)\n'
          'body = MaterialText(text="Hi")',
        ),
        throwsError<A2uiValidationError>(),
      );
    });
  });

  group('Event arguments', () {
    final CatalogApi v1 = Catalog.fromJson({
      'catalogId': 'https://example.com/events.json',
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

    /// The action of the `root` Button [block] compiles to.
    Object? action(String block) {
      final List<AgentToRendererMessage> messages = ExpressCompiler([
        v1,
      ]).compile('$block\nlabel = Text("Go")');
      final components =
          (messages.single.toJson()['createSurface']! as Map)['components']!
              as List;
      return (components.first as Map)['action'];
    }

    test('compiles userMessage to the v1.0 event field', () {
      expect(
        action('root = Button(label, Event("reply", userMessage="Replying"))'),
        {
          'event': {'name': 'reply', 'userMessage': 'Replying'},
        },
      );
    });

    test('compiles a \$path userMessage beside a positional context', () {
      expect(
        action(
          r'root = Button(label, Event("go", {id: 1}, userMessage=$/draft))',
        ),
        {
          'event': {
            'name': 'go',
            'userMessage': {'@path': '/draft'},
            'context': {'id': 1},
          },
        },
      );
    });

    test('accepts context= as a keyword argument', () {
      expect(action('root = Button(label, Event("go", context={id: 1}))'), {
        'event': {
          'name': 'go',
          'context': {'id': 1},
        },
      });
    });

    test('rejects a context given both positionally and by keyword', () {
      expect(
        () =>
            action('root = Button(label, Event("go", {a: 1}, context={b: 2}))'),
        throwsError<A2uiValidationError>(),
      );
    });

    test('rejects an unknown keyword instead of dropping it', () {
      expect(
        () => action('root = Button(label, Event("go", message="hi"))'),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("Event has no keyword parameter 'message'"),
          ),
        ),
      );
    });

    test('compiles a function call userMessage, as DynamicString allows', () {
      expect(
        action(
          'root = Button(label, Event("go", '
          'userMessage=openUrl("https://a2ui.org")))',
        ),
        {
          'event': {
            'name': 'go',
            'userMessage': {
              '@call': 'openUrl',
              'args': {'url': 'https://a2ui.org'},
            },
          },
        },
      );
    });

    test('rejects a userMessage that is not a DynamicString, naming it', () {
      expect(
        () => action('root = Button(label, Event("go", userMessage=42))'),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            'Event userMessage must be a string, a \$path data binding or a '
                'function call, got the number 42.',
          ),
        ),
      );
      expect(
        () => action('root = Button(label, Event("go", userMessage={a: 1}))'),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('got a map literal.'),
          ),
        ),
      );
    });

    test('rejects userMessage before v1.0, whose Action has no such field', () {
      expect(
        () => compile(
          'root = Button(label, Event("go", userMessage="hi"))\n'
          'label = Text("Go")',
        ),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains('userMessage requires protocol v1.0'),
          ),
        ),
      );
    });
  });

  group('action slots nested in list items', () {
    final CatalogApi links = Catalog.fromJson({
      'catalogId': 'https://example.com/links.json',
      'protocolVersion': '1.0',
      'components': {
        'Links': {
          'type': 'object',
          'properties': {
            'component': {'const': 'Links'},
            'items': {
              'type': 'array',
              'items': {
                'type': 'object',
                'properties': {
                  'label': {r'$ref': r'common_types.json#/$defs/DynamicString'},
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

    /// The items of the `root` Links [block] compiles to.
    Object? items(String block) {
      final List<AgentToRendererMessage> messages = ExpressCompiler([
        links,
      ]).compile(block);
      final components =
          (messages.single.toJson()['createSurface']! as Map)['components']!
              as List;
      return (components.single as Map)['items'];
    }

    const Map<String, Object?> docs = {
      'label': 'Docs',
      'action': {
        'functionCall': {
          '@call': 'openUrl',
          'args': {'url': 'https://a2ui.org'},
        },
      },
    };

    test('wraps a function call in functionCall inside a list item', () {
      expect(
        items(
          'root = Links([{label: "Docs", action: openUrl("https://a2ui.org")}, '
          '{label: "Go", action: Event("go")}])',
        ),
        [
          docs,
          {
            'label': 'Go',
            'action': {
              'event': {'name': 'go'},
            },
          },
        ],
      );
    });

    test('wraps a function call reached through a variable', () {
      expect(
        items(
          'docs = {label: "Docs", action: openUrl("https://a2ui.org")}\n'
          'root = Links([docs])',
        ),
        [docs],
      );
    });

    /// The `root` component [block] compiles to, against [catalog].
    Map<String, Object?> rootOf(CatalogApi catalog, String block) {
      final List<AgentToRendererMessage> messages = ExpressCompiler([
        catalog,
      ]).compile(block);
      final components =
          (messages.single.toJson()['createSurface']! as Map)['components']!
              as List;
      return (components.single as Map).cast<String, Object?>();
    }

    const Map<String, Object?> openUrlFunction = {
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
    };
    const Map<String, Object?> wrappedOpenUrl = {
      'functionCall': {
        '@call': 'openUrl',
        'args': {'url': 'https://a2ui.org'},
      },
    };

    test(
      'resolves a property named items as a property, not the array items',
      () {
        // The item schema is reached through a local $ref too.
        final CatalogApi menu = Catalog.fromJson({
          'catalogId': 'https://example.com/menu.json',
          'protocolVersion': '1.0',
          'components': {
            'Menu': {
              'type': 'object',
              'properties': {
                'component': {'const': 'Menu'},
                'menu': {
                  'type': 'object',
                  'properties': {
                    'items': {
                      'type': 'array',
                      'items': {r'$ref': r'#/$defs/MenuItem'},
                    },
                  },
                },
              },
              'required': ['component', 'menu'],
            },
          },
          'functions': {'openUrl': openUrlFunction},
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
        expect(
          rootOf(
            menu,
            'root = Menu({items: [{label: "Docs", '
            'action: openUrl("https://a2ui.org")}]})',
          )['menu'],
          {
            'items': [
              {'label': 'Docs', 'action': wrappedOpenUrl},
            ],
          },
        );
      },
    );

    test('finds action slots through allOf, anyOf, additionalProperties', () {
      final CatalogApi mixins = Catalog.fromJson({
        'catalogId': 'https://example.com/mixins.json',
        'protocolVersion': '1.0',
        'components': {
          'Board': {
            'type': 'object',
            'properties': {
              'component': {'const': 'Board'},
              // The item schema is an allOf of two mixins, one of which holds
              // the action under anyOf.
              'cards': {
                'type': 'array',
                'items': {
                  'allOf': [
                    {r'$ref': r'#/$defs/Labelled'},
                    {
                      'anyOf': [
                        {
                          'type': 'object',
                          'properties': {
                            'action': {
                              r'$ref': r'common_types.json#/$defs/Action',
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
              // Every entry of the map is an action.
              'shortcuts': {
                'type': 'object',
                'additionalProperties': {
                  r'$ref': r'common_types.json#/$defs/Action',
                },
              },
            },
            'required': ['component', 'cards'],
          },
        },
        'functions': {'openUrl': openUrlFunction},
        r'$defs': {
          'Labelled': {
            'type': 'object',
            'properties': {
              'label': {'type': 'string'},
            },
          },
        },
      });
      final Map<String, Object?> root = rootOf(
        mixins,
        'root = Board([{label: "Docs", action: openUrl("https://a2ui.org")}], '
        'shortcuts={help: openUrl("https://a2ui.org")})',
      );
      expect(root['cards'], [
        {'label': 'Docs', 'action': wrappedOpenUrl},
      ]);
      expect(root['shortcuts'], {'help': wrappedOpenUrl});
    });

    test('follows a definition that refers to itself without looping', () {
      final CatalogApi tree = Catalog.fromJson({
        'catalogId': 'https://example.com/tree.json',
        'protocolVersion': '1.0',
        'components': {
          'Tree': {
            'type': 'object',
            'properties': {
              'component': {'const': 'Tree'},
              'nodes': {
                'type': 'array',
                'items': {r'$ref': r'#/$defs/Node'},
              },
            },
            'required': ['component', 'nodes'],
          },
        },
        'functions': {'openUrl': openUrlFunction},
        r'$defs': {
          'Node': {
            'type': 'object',
            'properties': {
              'label': {'type': 'string'},
              'action': {r'$ref': r'common_types.json#/$defs/Action'},
              'children': {
                'type': 'array',
                'items': {r'$ref': r'#/$defs/Node'},
              },
            },
          },
        },
      });
      expect(
        rootOf(
          tree,
          'root = Tree([{label: "a", children: [{label: "b", '
          'action: openUrl("https://a2ui.org")}]}])',
        )['nodes'],
        [
          {
            'label': 'a',
            'children': [
              {'label': 'b', 'action': wrappedOpenUrl},
            ],
          },
        ],
      );
    });

    test('keeps a function call outside an action slot as a plain call', () {
      expect(
        items(
          'root = Links([{label: openUrl("https://a2ui.org"), '
          'action: Event("go")}])',
        ),
        [
          {
            'label': {
              '@call': 'openUrl',
              'args': {'url': 'https://a2ui.org'},
            },
            'action': {
              'event': {'name': 'go'},
            },
          },
        ],
      );
    });
  });
}
