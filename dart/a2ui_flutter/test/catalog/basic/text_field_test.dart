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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/surface_harness.dart';

final WidgetCatalog _catalog = basicTestCatalog([
  BasicComponents.textField,
  BasicComponents.column,
]);

Future<SurfaceHarness> _pump(
  WidgetTester tester,
  List<Map<String, Object?>> components, {
  Map<String, Object?>? data,
}) => pumpComponents(tester, components, catalog: _catalog, data: data);

Map<String, Object?> _field(Map<String, Object?> props) => {
  'id': 'root',
  'component': 'TextField',
  'label': 'Name',
  ...props,
};

TextField _textField(WidgetTester tester, [Finder? finder]) =>
    tester.widget<TextField>(finder ?? find.byType(TextField));

TextEditingController _controller(WidgetTester tester, [Finder? finder]) =>
    _textField(tester, finder).controller!;

String? _errorText(WidgetTester tester) =>
    _textField(tester).decoration!.errorText;

void main() {
  group('TextField', () {
    testWidgets('shows its label and literal value', (tester) async {
      await _pump(tester, [
        _field({'value': 'Ada'}),
      ]);

      expect(find.text('Name'), findsOneWidget);
      expect(_controller(tester).text, 'Ada');
    });

    testWidgets('is empty without a value', (tester) async {
      await _pump(tester, [_field({})]);

      expect(_controller(tester).text, isEmpty);
    });

    group('with a bound value', () {
      testWidgets('writes every edit to the data model at once', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _field({
              'value': {'path': '/name'},
            }),
          ],
          data: {'name': 'Ada'},
        );

        await tester.enterText(find.byType(TextField), 'G');
        expect(harness.data('/name'), 'G');
        await tester.enterText(find.byType(TextField), 'Grace');
        expect(harness.data('/name'), 'Grace');
        await tester.pump();

        expect(_controller(tester).text, 'Grace');
        expect(tester.takeException(), isNull);
      });

      testWidgets('follows a value the agent changes', (tester) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _field({
              'value': {'path': '/name'},
            }),
          ],
          data: {'name': 'Ada'},
        );
        await tester.enterText(find.byType(TextField), 'Grace');
        await tester.pump();

        await harness.send([updateDataModel('Linus', path: '/name')]);

        final TextEditingController controller = _controller(tester);
        expect(controller.text, 'Linus');
        expect(controller.selection, const TextSelection.collapsed(offset: 5));
      });

      testWidgets('takes back a value the agent resets before the next frame', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _field({
              'value': {'path': '/name'},
            }),
          ],
          data: {'name': 'Ada'},
        );

        await tester.enterText(find.byType(TextField), 'Grace');
        await harness.send([updateDataModel('Ada', path: '/name')]);

        expect(_controller(tester).text, 'Ada');
      });

      testWidgets('drops a literal edit when bound to an equal value', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _field({'value': 'Ada'}),
          ],
          data: {'name': 'Ada'},
        );
        await tester.enterText(find.byType(TextField), 'Grace');
        await tester.pump();

        await harness.send([
          updateComponents([
            _field({
              'value': {'path': '/name'},
            }),
          ]),
        ]);

        expect(_controller(tester).text, 'Ada');
        expect(harness.data('/name'), 'Ada');
      });

      testWidgets('keeps the selection when its own edit comes back', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _field({
              'value': {'path': '/name'},
            }),
          ],
          data: {'name': ''},
        );
        await tester.enterText(find.byType(TextField), 'Grace');
        final TextEditingController controller = _controller(tester);
        controller.selection = const TextSelection.collapsed(offset: 2);
        await tester.pump();

        await harness.send([
          updateComponents([
            _field({
              'label': 'Full name',
              'value': {'path': '/name'},
            }),
          ]),
        ]);

        expect(find.text('Full name'), findsOneWidget);
        expect(controller.text, 'Grace');
        expect(controller.selection, const TextSelection.collapsed(offset: 2));
        expect(identical(_controller(tester), controller), isTrue);
      });

      testWidgets('writes each template item to its own path', (tester) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            {
              'id': 'root',
              'component': 'Column',
              'children': {'componentId': 'field', 'path': '/people'},
            },
            {
              'id': 'field',
              'component': 'TextField',
              'label': 'Name',
              'value': {'path': 'name'},
            },
          ],
          data: {
            'people': [
              {'name': 'Ada'},
              {'name': 'Grace'},
            ],
          },
        );
        expect(_controller(tester, find.byType(TextField).first).text, 'Ada');
        expect(_controller(tester, find.byType(TextField).last).text, 'Grace');

        await tester.enterText(find.byType(TextField).last, 'Linus');
        await tester.pump();

        expect(harness.data('/people'), [
          {'name': 'Ada'},
          {'name': 'Linus'},
        ]);
      });
    });

    group('with a literal value', () {
      testWidgets('keeps an edit without writing to the data model', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _field({'value': 'Ada'}),
          ],
          data: {'name': 'unchanged'},
        );

        await tester.enterText(find.byType(TextField), 'Grace');
        await tester.pump();

        expect(_controller(tester).text, 'Grace');
        expect(harness.data('/'), {'name': 'unchanged'});
        expect(tester.takeException(), isNull);
      });

      testWidgets('keeps an edit when another property changes', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(tester, [
          _field({'value': 'Ada'}),
        ]);
        await tester.enterText(find.byType(TextField), 'Grace');
        await tester.pump();

        await harness.send([
          updateComponents([
            _field({'label': 'Full name', 'value': 'Ada'}),
          ]),
        ]);

        expect(find.text('Full name'), findsOneWidget);
        expect(_controller(tester).text, 'Grace');
      });

      testWidgets('takes a new literal from the agent', (tester) async {
        final SurfaceHarness harness = await _pump(tester, [
          _field({'value': 'Ada'}),
        ]);
        await tester.enterText(find.byType(TextField), 'Grace');
        await tester.pump();

        await harness.send([
          updateComponents([
            _field({'value': 'Linus'}),
          ]),
        ]);

        expect(_controller(tester).text, 'Linus');
      });
    });

    group('checks', () {
      Map<String, Object?> checked() => _field({
        'value': {'path': '/name'},
        'checks': [
          {
            'condition': {
              'call': 'required',
              'args': {
                'value': {'path': '/name'},
              },
            },
            'message': 'Name is required',
          },
        ],
      });

      testWidgets('show the first failing message as the error', (
        tester,
      ) async {
        await _pump(
          tester,
          [
            _field({
              'value': {'path': '/name'},
              'checks': [
                {
                  'condition': {'path': '/first'},
                  'message': 'First fails',
                },
                {
                  'condition': {'path': '/second'},
                  'message': 'Second fails',
                },
              ],
            }),
          ],
          data: {'name': '', 'first': false, 'second': false},
        );

        expect(_errorText(tester), 'First fails');
        expect(find.text('First fails'), findsOneWidget);
        expect(find.text('Second fails'), findsNothing);
      });

      testWidgets('re-run as the user types', (tester) async {
        await _pump(tester, [checked()], data: {'name': ''});
        expect(_errorText(tester), 'Name is required');

        await tester.enterText(find.byType(TextField), 'Ada');
        await tester.pump();
        expect(_errorText(tester), isNull);

        await tester.enterText(find.byType(TextField), '');
        await tester.pump();
        expect(_errorText(tester), 'Name is required');
      });
    });

    group('validationRegexp', () {
      Map<String, Object?> zip([Object? value]) => _field({
        'label': 'ZIP',
        'value': ?value,
        'validationRegexp': '[0-9]{5}',
      });

      testWidgets('reports text that does not match in full', (tester) async {
        await _pump(tester, [zip()]);

        await tester.enterText(find.byType(TextField), '1234');
        await tester.pump();
        expect(_errorText(tester), 'Invalid format');

        await tester.enterText(find.byType(TextField), '12345');
        await tester.pump();
        expect(_errorText(tester), isNull);

        await tester.enterText(find.byType(TextField), '123456');
        await tester.pump();
        expect(_errorText(tester), 'Invalid format');
      });

      testWidgets('accepts an empty field', (tester) async {
        await _pump(tester, [zip()]);

        expect(_errorText(tester), isNull);
      });

      testWidgets('writes text that does not match', (tester) async {
        final SurfaceHarness harness = await _pump(tester, [
          zip({'path': '/zip'}),
        ]);

        await tester.enterText(find.byType(TextField), '12');
        await tester.pump();

        expect(harness.data('/zip'), '12');
      });

      testWidgets('gives way to a failing check', (tester) async {
        await _pump(tester, [
          _field({
            'value': 'abc',
            'validationRegexp': '[0-9]+',
            'checks': [
              {'condition': false, 'message': 'Check fails'},
            ],
          }),
        ]);

        expect(_errorText(tester), 'Check fails');
      });

      testWidgets('is ignored when it does not compile', (tester) async {
        await _pump(tester, [
          _field({'value': 'abc', 'validationRegexp': '[0-9'}),
        ]);

        expect(tester.takeException(), isNull);
        expect(_errorText(tester), isNull);
      });

      testWidgets('follows a pattern the agent changes', (tester) async {
        final SurfaceHarness harness = await _pump(tester, [
          _field({'value': 'abc', 'validationRegexp': '[a-z]+'}),
        ]);
        expect(_errorText(tester), isNull);

        await harness.send([
          updateComponents([
            _field({'value': 'abc', 'validationRegexp': '[0-9]+'}),
          ]),
        ]);

        expect(_errorText(tester), 'Invalid format');
      });
    });

    group('variant', () {
      testWidgets('shortText is the default: one line of plain text', (
        tester,
      ) async {
        await _pump(tester, [_field({})]);

        final TextField field = _textField(tester);
        expect(field.maxLines, 1);
        expect(field.obscureText, isFalse);
        expect(field.keyboardType, TextInputType.text);
        expect(field.inputFormatters, isNull);
      });

      testWidgets('longText accepts several lines', (tester) async {
        final SurfaceHarness harness = await _pump(tester, [
          _field({
            'variant': 'longText',
            'value': {'path': '/story'},
          }),
        ]);

        final TextField field = _textField(tester);
        expect(field.maxLines, isNull);
        expect(field.keyboardType, TextInputType.multiline);

        await tester.enterText(find.byType(TextField), 'One\nTwo\nThree');
        await tester.pump();
        expect(harness.data('/story'), 'One\nTwo\nThree');
      });

      testWidgets('obscured hides the text', (tester) async {
        final SurfaceHarness harness = await _pump(tester, [
          _field({
            'variant': 'obscured',
            'value': {'path': '/secret'},
          }),
        ]);

        final TextField field = _textField(tester);
        expect(field.obscureText, isTrue);
        expect(field.enableSuggestions, isFalse);
        expect(field.autocorrect, isFalse);

        await tester.enterText(find.byType(TextField), 'hunter2');
        await tester.pump();
        expect(
          tester.widget<EditableText>(find.byType(EditableText)).obscureText,
          isTrue,
        );
        expect(harness.data('/secret'), 'hunter2');
      });

      testWidgets('number accepts numbers and writes them as text', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(tester, [
          _field({
            'variant': 'number',
            'value': {'path': '/amount'},
          }),
        ]);
        expect(
          _textField(tester).keyboardType,
          const TextInputType.numberWithOptions(signed: true, decimal: true),
        );

        await tester.enterText(find.byType(TextField), '-1.5');
        await tester.pump();

        expect(_controller(tester).text, '-1.5');
        expect(harness.data('/amount'), '-1.5');
      });

      testWidgets('number accepts partial input', (tester) async {
        await _pump(tester, [
          _field({'variant': 'number'}),
        ]);

        for (final partial in ['-', '1.', '-.', '.5']) {
          await tester.enterText(find.byType(TextField), partial);
          await tester.pump();
          expect(_controller(tester).text, partial);
        }
      });

      testWidgets('number rejects an edit that is not a number', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _field({
              'variant': 'number',
              'value': {'path': '/amount'},
            }),
          ],
          data: {'amount': '12'},
        );

        await tester.enterText(find.byType(TextField), '12a');
        await tester.pump();
        await tester.enterText(find.byType(TextField), '1-2');
        await tester.pump();

        expect(_controller(tester).text, '12');
        expect(harness.data('/amount'), '12');
      });

      testWidgets('number accepts deletions from a value that is not one', (
        tester,
      ) async {
        final SurfaceHarness harness = await _pump(
          tester,
          [
            _field({
              'variant': 'number',
              'value': {'path': '/amount'},
            }),
          ],
          data: {'amount': '1,000'},
        );

        await tester.enterText(find.byType(TextField), '1,0005');
        await tester.pump();
        expect(_controller(tester).text, '1,000');

        await tester.enterText(find.byType(TextField), '1,00');
        await tester.pump();
        expect(_controller(tester).text, '1,00');
        expect(harness.data('/amount'), '1,00');

        await tester.enterText(find.byType(TextField), '100');
        await tester.pump();
        expect(harness.data('/amount'), '100');
      });
    });

    testWidgets('lets the user type with the keyboard', (tester) async {
      final SurfaceHarness harness = await _pump(
        tester,
        [
          _field({
            'value': {'path': '/name'},
          }),
        ],
        data: {'name': 'Ad'},
      );

      await tester.tap(find.byType(TextField));
      await tester.pump();
      _controller(tester).selection = const TextSelection.collapsed(offset: 2);
      tester.testTextInput.updateEditingValue(
        const TextEditingValue(
          text: 'Ada',
          selection: TextSelection.collapsed(offset: 3),
        ),
      );
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();

      expect(harness.data('/name'), 'Ada');
      expect(harness.actions, isEmpty);
    });
  });

  testWidgets('reports a write below a primitive to onError and shows the '
      'bound value again', (tester) async {
    final SurfaceHarness harness = await _pump(
      tester,
      [
        _field({
          'value': {'path': '/name/first'},
        }),
      ],
      data: {'name': 'Ada'},
    );

    await tester.enterText(find.byType(TextField), 'Grace');
    await tester.pump();

    expect(tester.takeException(), isNull);
    expect(harness.errorCodes, ['DATA_ERROR']);
    expect(harness.errors.single.path, '/name/first');
    expect(harness.data('/name'), 'Ada');
    expect(_controller(tester).text, isEmpty);
  });
}
