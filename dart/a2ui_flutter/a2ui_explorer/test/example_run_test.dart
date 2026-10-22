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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_explorer/src/example.dart';
import 'package:a2ui_explorer/src/example_run.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// A run of an example made of [messages].
ExampleRun _run(List<Map<String, Object?>> messages) {
  final run = ExampleRun(
    Example(
      fileName: 'test.json',
      name: 'Test',
      description: '',
      json: jsonEncode({'messages': messages}),
    ),
  );
  addTearDown(run.dispose);
  return run;
}

const Map<String, Object?> _createSurface = {
  'version': 'v0.9',
  'createSurface': {'surfaceId': 'test', 'catalogId': BasicCatalog.v0_9Id},
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late final List<Example> examples;
  setUpAll(() async => examples = await loadExamples(rootBundle));

  testWidgets('runs and renders every example without an error', (
    tester,
  ) async {
    for (final example in examples) {
      final run = ExampleRun(example)..runAll();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: Column(
                children: [
                  for (final surface in run.surfaces)
                    A2uiSurface(key: ObjectKey(surface), surface: surface),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(run.log, isEmpty, reason: example.fileName);
      await tester.pumpWidget(const SizedBox());
      run.dispose();
    }
  });

  test('logs a message the processor rejects, with its number', () {
    final ExampleRun run = _run([
      {
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 'missing',
          'path': '/',
          'value': <String, Object?>{},
        },
      },
    ])..runAll();

    expect(run.processed, 1);
    expect(run.log.single.heading, 'Error INTEGRITY_ERROR');
    expect(run.log.single.details['messageNumber'], 1);
  });

  test('logs an error a surface reports', () async {
    final ExampleRun run = _run([_createSurface])..runAll();

    await run.surfaces.single.dispatchError(
      A2uiRendererError(
        code: 'TEST',
        surfaceId: 'test',
        message: 'Failed.',
        details: {'reason': 'test'},
      ),
    );

    expect(run.log.single.heading, 'Error TEST');
    expect(run.log.single.details, {
      'code': 'TEST',
      'surfaceId': 'test',
      'message': 'Failed.',
      'details': {'reason': 'test'},
    });
  });

  testWidgets('logs an error a surface reports when it first appears', (
    tester,
  ) async {
    final ExampleRun run = _run([
      _createSurface,
      {
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 'test',
          'path': '/',
          'value': {'name': 'abc', 'pattern': '('},
        },
      },
      {
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 'test',
          'components': [
            {
              'id': 'root',
              'component': 'Text',
              'text': {
                'call': 'formatString',
                'args': {
                  'value': r'${regex(value: ${/name}, pattern: ${/pattern})}',
                },
                'returnType': 'string',
              },
            },
          ],
        },
      },
    ]);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ListenableBuilder(
            listenable: run,
            builder: (context, _) => Column(
              children: [
                Text('log: ${run.log.length}'),
                for (final surface in run.surfaces)
                  A2uiSurface(surface: surface),
              ],
            ),
          ),
        ),
      ),
    );
    run.runAll();
    await tester.pump();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text('log: 1'), findsOneWidget);
  });

  test('drops a deleted surface', () {
    final ExampleRun run = _run([
      _createSurface,
      {
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 'test'},
      },
    ]);

    run.advance();
    expect(run.surfaces.single.id, 'test');

    run.advance();
    expect(run.surfaces, isEmpty);
    expect(run.log, isEmpty);
  });
}
