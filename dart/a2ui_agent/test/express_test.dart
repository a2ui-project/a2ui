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
        },
        'required': ['component', 'value'],
      },
    },
  });

  A2uiRequestProcessor processor([List<SchemaCatalog>? catalogs]) =>
      A2uiRequestProcessor(
        activeCatalogs: catalogs ?? [basic],
        formatFactory: const ExpressFormatFactory(),
      );

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
          'message': 'Required check failed.',
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
          'message': 'Length check failed.',
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
      'components without root': (
        r'$/title = "x"; title = Text($/title)',
        throwsError<A2uiValidationError>(),
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
    };
    for (final MapEntry<String, (String, Matcher)> entry in cases.entries) {
      test(entry.key, () {
        expect(() => compile(entry.value.$1), entry.value.$2);
      });
    }

    test('a direct JSON payload', () {
      expect(
        () => processor().parseResponse('<a2ui-json>[]</a2ui-json>'),
        throwsError<A2uiParseError>(),
      );
    });
  });

  group('promptSnippet', () {
    test('annotates the catalog signatures', () {
      final String snippet = processor().promptSnippet;
      expect(
        snippet,
        contains(
          '• TextField(label, value?, variant? (static), '
          'validationRegexp? (static), checks?)',
        ),
      );
      expect(
        snippet,
        contains(
          '• Button(child (component ID), variant? (static), action (action), '
          'checks?)',
        ),
      );
      expect(snippet, contains('• formatString(value)'));
      expect(snippet, contains('• openUrl(url)'));
    });

    test('names each catalog when there are several', () {
      final String snippet = processor([basic, custom]).promptSnippet;
      expect(snippet, contains('## Catalog `${basic.id}`'));
      expect(snippet, contains('## Catalog `${custom.id}`'));
      expect(snippet, contains('• Gauge(value (static))'));
    });
  });
}
