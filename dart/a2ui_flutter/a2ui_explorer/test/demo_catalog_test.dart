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
import 'package:flutter_test/flutter_test.dart';

/// Runs [components] on one surface whose data model is [data], and renders
/// the surface.
Future<ExampleRun> _render(
  WidgetTester tester,
  List<Map<String, Object?>> components, {
  Map<String, Object?> data = const {},
}) async {
  const surfaceId = 'test';
  final run = ExampleRun(
    Example(
      fileName: 'test.json',
      name: 'Test',
      description: '',
      json: jsonEncode({
        'messages': [
          {
            'version': 'v0.9',
            'createSurface': {
              'surfaceId': surfaceId,
              'catalogId': BasicCatalog.v0_9Id,
            },
          },
          {
            'version': 'v0.9',
            'updateDataModel': {
              'surfaceId': surfaceId,
              'path': '/',
              'value': data,
            },
          },
          {
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': surfaceId,
              'components': components,
            },
          },
        ],
      }),
    ),
  )..runAll();
  addTearDown(run.dispose);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: A2uiSurface(surface: run.surfaces.single)),
    ),
  );
  return run;
}

void main() {
  testWidgets('CustomGrid lays its children out in two columns in a '
      'horizontal List', (tester) async {
    final ExampleRun run = await _render(tester, [
      {
        'id': 'root',
        'component': 'List',
        'direction': 'horizontal',
        'children': ['grid'],
      },
      {
        'id': 'grid',
        'component': 'CustomGrid',
        'children': ['a', 'b', 'c'],
      },
      {'id': 'a', 'component': 'Text', 'text': 'A'},
      {'id': 'b', 'component': 'Text', 'text': 'B'},
      {'id': 'c', 'component': 'Text', 'text': 'C'},
    ]);

    final Rect a = tester.getRect(find.text('A'));
    final Rect b = tester.getRect(find.text('B'));
    final Rect c = tester.getRect(find.text('C'));
    expect(a.right, lessThan(b.left));
    expect(a.top, b.top);
    expect(c.left, a.left);
    expect(c.top, greaterThan(a.bottom));
    expect(run.log, isEmpty);
  });
}
