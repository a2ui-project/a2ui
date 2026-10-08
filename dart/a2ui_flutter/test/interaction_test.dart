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

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture_catalog.dart';
import 'support/surface_harness.dart';

void main() {
  List<Map<String, Object?>> form(Map<String, Object?> action) => [
    {
      'id': 'root',
      'component': 'Column',
      'children': ['input', 'echo', 'submit'],
    },
    {
      'id': 'input',
      'component': 'Input',
      'value': {'path': '/name'},
    },
    {
      'id': 'echo',
      'component': 'Text',
      'text': {'path': '/name'},
    },
    {'id': 'submit', 'component': 'Button', 'child': 'label', 'action': action},
    {'id': 'label', 'component': 'Text', 'text': 'Submit'},
  ];

  testWidgets('sends an event action with its context resolved at the tap', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      form({
        'event': {
          'name': 'submit',
          'context': {
            'name': {'path': '/name'},
          },
        },
      }),
      data: {'name': ''},
    );

    await tester.enterText(find.byType(TextField), 'Ada');
    await tester.pump();
    await tester.tap(find.text('Submit'));
    await tester.pump();

    expect(harness.actions, hasLength(1));
    expect(harness.actions.single.name, 'submit');
    expect(harness.actions.single.surfaceId, testSurfaceId);
    expect(harness.actions.single.sourceComponentId, 'submit');
    expect(harness.actions.single.context, {'name': 'Ada'});
  });

  testWidgets('resolves a templated action context against its item', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      [
        {
          'id': 'root',
          'component': 'Column',
          'children': {'componentId': 'pick', 'path': '/people'},
        },
        {
          'id': 'pick',
          'component': 'Button',
          'child': 'name',
          'action': {
            'event': {
              'name': 'pick',
              'context': {
                'name': {'path': 'name'},
              },
            },
          },
        },
        {
          'id': 'name',
          'component': 'Text',
          'text': {'path': 'name'},
        },
      ],
      data: {
        'people': [
          {'name': 'Ada'},
          {'name': 'Lin'},
        ],
      },
    );

    await tester.tap(find.text('Lin'));
    await tester.pump();

    expect(harness.actions.single.context, {'name': 'Lin'});
  });

  testWidgets('runs a function-call action locally', (tester) async {
    final log = FixtureLog();
    final SurfaceHarness harness = await pumpComponents(
      tester,
      form({
        'functionCall': {
          'call': 'record',
          'args': {
            'value': {'path': '/name'},
          },
        },
      }),
      catalog: fixtureCatalog(log),
      data: {'name': 'Lin'},
    );

    await tester.tap(find.text('Submit'));
    await tester.pump();

    expect(log.calls, [
      {'value': 'Lin'},
    ]);
    expect(harness.actions, isEmpty);
    expect(harness.errors, isEmpty);
  });

  testWidgets('writes an edit back and keeps it across a rebuild', (
    tester,
  ) async {
    final SurfaceHarness harness = await pumpComponents(
      tester,
      form({
        'event': {'name': 'submit'},
      }),
      data: {'name': ''},
    );

    await tester.enterText(find.byType(TextField), 'Ada');
    await tester.pump();
    expect(harness.data('/name'), 'Ada');
    expect(
      find.byWidgetPredicate((w) => w is Text && w.data == 'Ada'),
      findsOneWidget,
    );

    await harness.send([
      updateComponents([
        {'id': 'label', 'component': 'Text', 'text': 'Send'},
      ]),
    ]);

    expect(find.text('Send'), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'Ada',
    );
    expect(harness.data('/name'), 'Ada');
  });
}
