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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../test_infra/message_builders.dart';

const _surfaceId = 'textFieldTest';
const _catalogId = 'test_catalog';

/// Renders a single `TextField` component with the given [properties].
///
/// Submitted actions are collected into [submissions], and [functions] are
/// registered on the catalog so that `functionCall` actions can be exercised.
Future<SurfaceController> _pumpTextField(
  WidgetTester tester, {
  required JsonMap properties,
  List<ChatMessage>? submissions,
  List<ClientFunction> functions = const [],
}) async {
  final surfaceController = SurfaceController(
    catalogs: [
      // `copyWith` keeps the basic catalog's own functions, which the `checks`
      // in these tests are written against.
      BasicCatalogItems.asCatalog().copyWith(
        catalogId: _catalogId,
        newFunctions: functions,
      ),
    ],
  );
  addTearDown(surfaceController.dispose);
  if (submissions != null) {
    surfaceController.onSubmit.listen(submissions.add);
  }

  surfaceController.handleMessage(
    updateComponents(
      surfaceId: _surfaceId,
      components: [
        component(id: 'root', type: 'TextField', properties: properties),
      ],
    ),
  );
  surfaceController.handleMessage(
    createSurface(surfaceId: _surfaceId, catalogId: _catalogId),
  );

  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Surface(surfaceContext: surfaceController.contextFor(_surfaceId)),
      ),
    ),
  );
  await tester.pumpAndSettle();

  return surfaceController;
}

/// Renders a `TextField` of the given [variant], bound to `/value`.
Future<SurfaceController> _pumpVariant(
  WidgetTester tester, {
  String? variant,
}) => _pumpTextField(
  tester,
  properties: {
    'label': 'Input',
    'variant': ?variant,
    'value': {'path': '/value'},
  },
);

Object? _value(SurfaceController controller) => controller
    .contextFor(_surfaceId)
    .dataModel
    .getValue<Object>(DataPath('/value'));

/// The `action` payload of a submission, as sent to the agent.
JsonMap _action(ChatMessage message) {
  final String interaction =
      message.parts.first.asUiInteractionPart!.interaction;
  return (jsonDecode(interaction) as JsonMap)['action'] as JsonMap;
}

/// Submits the focused text field, as pressing enter does.
Future<void> _submit(WidgetTester tester) async {
  await tester.testTextInput.receiveAction(TextInputAction.done);
  await tester.pumpAndSettle();
}

/// A [ClientFunction] that records the arguments it was called with.
class _RecordingFunction implements ClientFunction {
  _RecordingFunction(this.name);

  @override
  final String name;

  final List<JsonMap> calls = [];

  @override
  String get description => 'Records its invocations.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.any;

  @override
  Schema get argumentSchema => Schema.object();

  @override
  Stream<Object?> execute(JsonMap args, ExecutionContext context) {
    calls.add(args);
    return Stream<Object?>.value(null);
  }
}

void main() {
  testWidgets('TextField with no weight in Row defaults to weight: 1 '
      'and expands', (WidgetTester tester) async {
    final surfaceController = SurfaceController(
      catalogs: [BasicCatalogItems.asCatalog()],
    );
    addTearDown(surfaceController.dispose);
    const surfaceId = 'testSurface';
    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'Row',
        properties: {
          'children': ['text_field'],
        },
      ),
      component(
        id: 'text_field',
        type: 'TextField',
        properties: {'label': 'Input'},
        // "weight" property is left unset.
      ),
    ];

    surfaceController.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    surfaceController.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: basicCatalogId),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(
            surfaceContext: surfaceController.contextFor(surfaceId),
          ),
        ),
      ),
    );

    expect(find.byType(TextField), findsOneWidget);

    final Flexible flexible = tester.widget(
      find.ancestor(
        of: find.byType(TextField),
        matching: find.byType(Flexible),
      ),
    );
    expect(flexible.flex, 1);

    final Finder textFieldFinder = find.byType(TextField);
    final Size size = tester.getSize(textFieldFinder);
    expect(size.width, 800.0);
  });

  testWidgets('TextField in Row (with weight) expands', (
    WidgetTester tester,
  ) async {
    final surfaceController = SurfaceController(
      catalogs: [BasicCatalogItems.asCatalog()],
    );
    addTearDown(surfaceController.dispose);
    const surfaceId = 'testSurface';
    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'Row',
        properties: {
          'children': ['text_field'],
        },
      ),
      component(
        id: 'text_field',
        type: 'TextField',
        properties: {'label': 'Input', 'weight': 1},
      ),
    ];

    surfaceController.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    surfaceController.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: basicCatalogId),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(
            surfaceContext: surfaceController.contextFor(surfaceId),
          ),
        ),
      ),
    );

    expect(find.byType(TextField), findsOneWidget);

    expect(
      find.ancestor(
        of: find.byType(TextField),
        matching: find.byType(Flexible),
      ),
      findsOneWidget,
    );

    // Default test screen width is 800.
    final Size size = tester.getSize(find.byType(TextField));
    expect(size.width, 800.0);
  });

  testWidgets('TextField validation checks work', (WidgetTester tester) async {
    final surfaceController = SurfaceController(
      catalogs: [BasicCatalogItems.asCatalog()],
    );
    addTearDown(surfaceController.dispose);
    const surfaceId = 'validationTest';
    // Initialize with invalid value
    surfaceController.handleMessage(
      updateDataModel(
        surfaceId: surfaceId,
        path: DataPath('/myValue'),
        value: 'initial',
      ),
    );

    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'TextField',
        properties: {
          'label': 'Input',
          'value': {'path': 'inputValue'},
          'checks': [
            {
              'message': 'Must be at least 6 chars',
              'condition': {
                'call': 'length',
                'args': {
                  'value': {'path': 'inputValue'},
                  'min': 6,
                },
              },
            },
          ],
        },
      ),
    ];

    surfaceController.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    surfaceController.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: basicCatalogId),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(
            surfaceContext: surfaceController.contextFor(surfaceId),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Verify error text is shown
    expect(find.text('Must be at least 6 chars'), findsOneWidget);

    // Update with valid value
    await tester.enterText(find.byType(TextField), 'valid value');
    await tester.pumpAndSettle();

    expect(find.text('Must be at least 6 chars'), findsNothing);
  });
  testWidgets('TextField validation using condition wrapper and call key', (
    WidgetTester tester,
  ) async {
    final surfaceController = SurfaceController(
      catalogs: [BasicCatalogItems.asCatalog()],
    );
    addTearDown(surfaceController.dispose);
    const surfaceId = 'validationWrapperTest';
    // Initialize with invalid value (empty string)
    surfaceController.handleMessage(
      updateDataModel(surfaceId: surfaceId, path: DataPath('/name'), value: ''),
    );

    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'TextField',
        properties: {
          'label': 'Name',
          'value': {'path': '/name'},
          'checks': [
            {
              // Using "condition" wrapper and "call" instead of "func"
              // Args as list, as expected by function registry
              'condition': {
                'call': 'required',
                'args': {
                  'value': {'path': '/name'},
                },
              },
              'message': 'Name required',
            },
          ],
        },
      ),
    ];

    surfaceController.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    surfaceController.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: basicCatalogId),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(
            surfaceContext: surfaceController.contextFor(surfaceId),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Empty value should trigger required
    expect(find.text('Name required'), findsOneWidget);

    // Update with valid value
    await tester.enterText(find.byType(TextField), 'Alice');
    await tester.pumpAndSettle();

    expect(find.text('Name required'), findsNothing);
  });

  testWidgets('TextField gracefully handles non-string data model values', (
    WidgetTester tester,
  ) async {
    final surfaceController = SurfaceController(
      catalogs: [BasicCatalogItems.asCatalog()],
    );
    addTearDown(surfaceController.dispose);
    const surfaceId = 'validationTypeTest';
    // Initialize with an integer value
    surfaceController.handleMessage(
      updateDataModel(
        surfaceId: surfaceId,
        path: DataPath('/name'),
        value: 123,
      ),
    );

    final List<JsonMap> components = [
      component(
        id: 'root',
        type: 'TextField',
        properties: {
          'label': 'Name',
          'value': {'path': '/name'},
        },
      ),
    ];

    surfaceController.handleMessage(
      updateComponents(surfaceId: surfaceId, components: components),
    );
    surfaceController.handleMessage(
      createSurface(surfaceId: surfaceId, catalogId: basicCatalogId),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Surface(
            surfaceContext: surfaceController.contextFor(surfaceId),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The text field should convert the integer 123 to "123"
    expect(find.text('123'), findsOneWidget);
  });

  testWidgets('TextField with variant "obscured" hides what is typed', (
    WidgetTester tester,
  ) async {
    final SurfaceController surfaceController = await _pumpVariant(
      tester,
      variant: 'obscured',
    );

    final TextField field = tester.widget(find.byType(TextField));
    expect(field.obscureText, isTrue);
    // Obscured text is only valid on a single line.
    expect(field.maxLines, 1);
    // Neither of these should be able to observe a password.
    expect(field.autocorrect, isFalse);
    expect(field.enableSuggestions, isFalse);

    await tester.enterText(find.byType(TextField), 'hunter2');
    await tester.pumpAndSettle();

    expect(_value(surfaceController), 'hunter2');
    // The value reaches the data model, but is painted as obscuring characters
    // rather than as the typed text.
    final EditableText editable = tester.widget(find.byType(EditableText));
    expect(editable.obscureText, isTrue);
  });

  testWidgets('TextField with variant "longText" accepts multiple lines', (
    WidgetTester tester,
  ) async {
    final SurfaceController surfaceController = await _pumpVariant(
      tester,
      variant: 'longText',
    );

    final TextField field = tester.widget(find.byType(TextField));
    // A null `maxLines` lets the field grow with its content.
    expect(field.maxLines, isNull);
    expect(field.minLines, 3);
    expect(field.keyboardType, TextInputType.multiline);

    final double singleLineHeight = tester
        .getSize(find.byType(TextField))
        .height;

    await tester.enterText(
      find.byType(TextField),
      'Once upon a time\nthere was a text field\nthat could wrap\nand wrap',
    );
    await tester.pumpAndSettle();

    expect(
      _value(surfaceController),
      'Once upon a time\nthere was a text field\nthat could wrap\nand wrap',
    );
    // The field grew to fit the extra lines.
    expect(
      tester.getSize(find.byType(TextField)).height,
      greaterThan(singleLineHeight),
    );
  });

  testWidgets('TextField with variant "number" only accepts numbers', (
    WidgetTester tester,
  ) async {
    final SurfaceController surfaceController = await _pumpVariant(
      tester,
      variant: 'number',
    );

    final TextField field = tester.widget(find.byType(TextField));
    expect(field.maxLines, 1);
    expect(
      field.keyboardType,
      const TextInputType.numberWithOptions(signed: true, decimal: true),
    );

    // Non-numeric input is rejected outright.
    await tester.enterText(find.byType(TextField), 'abc');
    await tester.pumpAndSettle();
    expect(find.text('abc'), findsNothing);
    expect(_value(surfaceController), isNull);

    // Signed decimals are accepted, and stored as numbers rather than strings.
    await tester.enterText(find.byType(TextField), '-12.5');
    await tester.pumpAndSettle();
    expect(find.text('-12.5'), findsOneWidget);
    expect(_value(surfaceController), -12.5);

    // A rejected edit leaves the previously entered number untouched.
    await tester.enterText(find.byType(TextField), '-12.5e');
    await tester.pumpAndSettle();
    expect(find.text('-12.5'), findsOneWidget);
    expect(_value(surfaceController), -12.5);

    // The field can still be cleared.
    await tester.enterText(find.byType(TextField), '');
    await tester.pumpAndSettle();
    expect(_value(surfaceController), '');
  });

  testWidgets('TextField with variant "number" accepts partial input', (
    WidgetTester tester,
  ) async {
    final SurfaceController surfaceController = await _pumpVariant(
      tester,
      variant: 'number',
    );

    // A number is typed one character at a time, so every intermediate state
    // has to survive, including the ones that are not yet numbers.
    for (final partial in ['-', '-1', '-1.', '-1.0', '-1.05']) {
      await tester.enterText(find.byType(TextField), partial);
      await tester.pumpAndSettle();
      expect(find.text(partial), findsOneWidget, reason: 'typing "$partial"');
    }

    // Text that is not yet a number is stored as-is; anything parseable is
    // stored as a number.
    await tester.enterText(find.byType(TextField), '-');
    await tester.pumpAndSettle();
    expect(_value(surfaceController), '-');

    // A second decimal point is not part of any number, so it is rejected.
    await tester.enterText(find.byType(TextField), '-1.2.3');
    await tester.pumpAndSettle();
    expect(find.text('-'), findsOneWidget);
  });

  testWidgets('TextField with variant "number" can be typed into one key at a '
      'time', (WidgetTester tester) async {
    final SurfaceController surfaceController = await _pumpVariant(
      tester,
      variant: 'number',
    );

    // Typing "12.5" keystroke by keystroke. Writing 12.0 to the data model at
    // the "12." keystroke must not rewrite the field, or the next keystroke
    // would append to "12.0" and produce 12.05.
    for (final String keystroke in '12.5'.split('')) {
      final EditableText editable = tester.widget(find.byType(EditableText));
      await tester.enterText(
        find.byType(TextField),
        '${editable.controller.text}$keystroke',
      );
      await tester.pumpAndSettle();
    }

    expect(find.text('12.5'), findsOneWidget);
    expect(_value(surfaceController), 12.5);
  });

  testWidgets('TextField defaults to a single line of plain text', (
    WidgetTester tester,
  ) async {
    // Both an absent variant and an explicit "shortText" mean the same thing.
    for (final String? variant in [null, 'shortText']) {
      final SurfaceController surfaceController = await _pumpVariant(
        tester,
        variant: variant,
      );

      final TextField field = tester.widget(find.byType(TextField));
      expect(field.obscureText, isFalse, reason: 'variant: $variant');
      expect(field.maxLines, 1, reason: 'variant: $variant');
      expect(field.minLines, isNull, reason: 'variant: $variant');
      expect(
        field.keyboardType,
        TextInputType.text,
        reason: 'variant: $variant',
      );
      expect(field.autocorrect, isTrue, reason: 'variant: $variant');
      // Text of any kind is accepted, unlike the number variant.
      expect(field.inputFormatters, isNull, reason: 'variant: $variant');

      await tester.enterText(find.byType(TextField), 'a1! -.');
      await tester.pumpAndSettle();
      expect(_value(surfaceController), 'a1! -.', reason: 'variant: $variant');
    }
  });

  testWidgets('TextField submits its onSubmittedAction with resolved context', (
    WidgetTester tester,
  ) async {
    final List<ChatMessage> submissions = [];
    await _pumpTextField(
      tester,
      submissions: submissions,
      properties: {
        'label': 'Search',
        'value': {'path': '/value'},
        'onSubmittedAction': {
          'event': {
            'name': 'search',
            'context': {
              'query': {'path': '/value'},
            },
          },
        },
      },
    );

    await tester.enterText(find.byType(TextField), 'kittens');
    await tester.pumpAndSettle();
    // Typing alone is not a submission.
    expect(submissions, isEmpty);

    await _submit(tester);

    expect(submissions, hasLength(1));
    final JsonMap action = _action(submissions.single);
    expect(action['name'], 'search');
    expect(action['sourceComponentId'], 'root');
    // The context is resolved against the data model, not passed through as a
    // binding.
    expect(action['context'], {'query': 'kittens'});
  });

  testWidgets('TextField does not submit while a check fails', (
    WidgetTester tester,
  ) async {
    final List<ChatMessage> submissions = [];
    await _pumpTextField(
      tester,
      submissions: submissions,
      properties: {
        'label': 'Name',
        'value': {'path': '/value'},
        'checks': [
          {
            'message': 'Must be at least 6 chars',
            'condition': {
              'call': 'length',
              'args': {
                'value': {'path': '/value'},
                'min': 6,
              },
            },
          },
        ],
        'onSubmittedAction': {
          'event': {'name': 'submitted'},
        },
      },
    );

    await tester.enterText(find.byType(TextField), 'short');
    await tester.pumpAndSettle();
    expect(find.text('Must be at least 6 chars'), findsOneWidget);

    await _submit(tester);
    expect(submissions, isEmpty);

    // Once the check passes, the same submission goes through.
    await tester.enterText(find.byType(TextField), 'long enough');
    await tester.pumpAndSettle();
    expect(find.text('Must be at least 6 chars'), findsNothing);

    await _submit(tester);
    expect(submissions, hasLength(1));
    expect(_action(submissions.single)['name'], 'submitted');
  });

  testWidgets('TextField runs a functionCall onSubmittedAction', (
    WidgetTester tester,
  ) async {
    final recorder = _RecordingFunction('recordSubmission');
    await _pumpTextField(
      tester,
      functions: [recorder],
      properties: {
        'label': 'Input',
        'value': {'path': '/value'},
        'onSubmittedAction': {
          'functionCall': {
            'call': 'recordSubmission',
            'args': {
              'value': {'path': '/value'},
            },
          },
        },
      },
    );

    await tester.enterText(find.byType(TextField), 'typed');
    await tester.pumpAndSettle();
    expect(recorder.calls, isEmpty);

    await tester.runAsync(() async {
      await tester.testTextInput.receiveAction(TextInputAction.done);
    });
    await tester.pumpAndSettle();

    expect(recorder.calls, hasLength(1));
    expect(recorder.calls.single['value'], 'typed');
  });

  testWidgets('TextField shows a value updated outside of the field', (
    WidgetTester tester,
  ) async {
    final SurfaceController surfaceController = await _pumpVariant(tester);

    await tester.enterText(find.byType(TextField), 'typed by the user');
    await tester.pumpAndSettle();
    expect(find.text('typed by the user'), findsOneWidget);

    // An agent (or any other writer) updates the bound path.
    surfaceController.handleMessage(
      updateDataModel(
        surfaceId: _surfaceId,
        path: DataPath('/value'),
        value: 'set by the agent',
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('set by the agent'), findsOneWidget);
    expect(find.text('typed by the user'), findsNothing);
  });

  testWidgets('TextField accepts a literal value and label', (
    WidgetTester tester,
  ) async {
    await _pumpTextField(
      tester,
      properties: {'label': 'Your name', 'value': 'Ada Lovelace'},
    );

    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(find.text('Your name'), findsOneWidget);
  });

  testWidgets('TextField resolves a label bound to the data model', (
    WidgetTester tester,
  ) async {
    final SurfaceController surfaceController = await _pumpTextField(
      tester,
      properties: {
        'label': {'path': '/label'},
        'value': {'path': '/value'},
      },
    );

    surfaceController.handleMessage(
      updateDataModel(
        surfaceId: _surfaceId,
        path: DataPath('/label'),
        value: 'Bound label',
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Bound label'), findsOneWidget);
  });

  testWidgets('TextField without a value binding writes to its own id', (
    WidgetTester tester,
  ) async {
    final SurfaceController surfaceController = await _pumpTextField(
      tester,
      properties: {'label': 'Input'},
    );

    await tester.enterText(find.byType(TextField), 'unbound');
    await tester.pumpAndSettle();

    // Falls back to "<component id>.value" so the text is still readable.
    expect(
      surfaceController
          .contextFor(_surfaceId)
          .dataModel
          .getValue<Object>(DataPath('root.value')),
      'unbound',
    );
  });

  testWidgets('TextField reports a value that fails its validationRegexp', (
    WidgetTester tester,
  ) async {
    final List<ChatMessage> submissions = [];
    await _pumpTextField(
      tester,
      submissions: submissions,
      properties: {
        'label': 'Zip code',
        'value': {'path': '/value'},
        'validationRegexp': '[0-9]{5}',
        'onSubmittedAction': {
          'event': {'name': 'submitted'},
        },
      },
    );

    // An empty field is exempt, so the form does not open covered in errors.
    expect(find.text('Invalid format'), findsNothing);

    await tester.enterText(find.byType(TextField), '123');
    await tester.pumpAndSettle();
    expect(find.text('Invalid format'), findsOneWidget);

    // The regexp has to match the whole value, so a longer zip code that
    // merely contains five digits is still invalid.
    await tester.enterText(find.byType(TextField), '123456');
    await tester.pumpAndSettle();
    expect(find.text('Invalid format'), findsOneWidget);

    // An invalid value cannot be submitted, just like a failing check.
    await _submit(tester);
    expect(submissions, isEmpty);

    await tester.enterText(find.byType(TextField), '12345');
    await tester.pumpAndSettle();
    expect(find.text('Invalid format'), findsNothing);

    await _submit(tester);
    expect(submissions, hasLength(1));
  });

  testWidgets('TextField reports a value bound in from the data model that '
      'fails its validationRegexp', (WidgetTester tester) async {
    final SurfaceController surfaceController = await _pumpTextField(
      tester,
      properties: {
        'label': 'Zip code',
        'value': {'path': '/value'},
        'validationRegexp': '[0-9]{5}',
      },
    );

    surfaceController.handleMessage(
      updateDataModel(
        surfaceId: _surfaceId,
        path: DataPath('/value'),
        value: 'not a zip',
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Invalid format'), findsOneWidget);
  });

  testWidgets('TextField ignores a validationRegexp that does not compile', (
    WidgetTester tester,
  ) async {
    final SurfaceController surfaceController = await _pumpTextField(
      tester,
      properties: {
        'label': 'Input',
        'value': {'path': '/value'},
        'validationRegexp': '[unterminated',
      },
    );

    await tester.enterText(find.byType(TextField), 'anything');
    await tester.pumpAndSettle();

    // The field stays usable rather than rejecting everything the user types.
    expect(find.text('Invalid format'), findsNothing);
    expect(_value(surfaceController), 'anything');
  });

  testWidgets('TextField validates a price with the catalog example regexp', (
    WidgetTester tester,
  ) async {
    // Taken from the shipped example rather than copied, so that the example
    // and what it promises cannot drift apart.
    final JsonMap example = BasicCatalogItems.textField.exampleData
        .map((build) => (jsonDecode(build()) as List).first as JsonMap)
        .firstWhere((component) => component.containsKey('validationRegexp'));

    await _pumpTextField(
      tester,
      properties: {
        'label': example['label'],
        'value': {'path': '/value'},
        'validationRegexp': example['validationRegexp'],
      },
    );

    for (final valid in [r'$5', r'$12.99', r'$0.99', r'$0.01', r'$10.5']) {
      await tester.enterText(find.byType(TextField), valid);
      await tester.pumpAndSettle();
      expect(find.text('Invalid format'), findsNothing, reason: valid);
    }

    for (final invalid in [
      '5', // No dollar sign.
      r'-$5', // Not positive.
      r'$0', // Not positive.
      r'$0.00', // Not positive.
      r'$12.345', // More than two decimals.
      r'$12.99 or best offer', // Matches only part of the value.
    ]) {
      await tester.enterText(find.byType(TextField), invalid);
      await tester.pumpAndSettle();
      expect(find.text('Invalid format'), findsOneWidget, reason: invalid);
    }
  });
}
