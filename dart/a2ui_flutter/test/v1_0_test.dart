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
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/surface_harness.dart';

/// A v1.0 `createSurface` message on the basic catalog that carries
/// [components] and [dataModel].
Map<String, Object?> _createSurface(
  List<Map<String, Object?>> components, {
  Map<String, Object?>? dataModel,
}) => {
  'version': 'v1.0',
  'createSurface': {
    'surfaceId': testSurfaceId,
    'catalogId': BasicCatalog.v1_0Id,
    'components': components,
    'dataModel': ?dataModel,
  },
};

/// Renders [components] on a v1.0 surface of [catalog], the v1.0 basic
/// catalog unless given another.
Future<SurfaceHarness> _pump(
  WidgetTester tester,
  List<Map<String, Object?>> components, {
  Map<String, Object?>? dataModel,
  CatalogImplementation? catalog,
}) => pumpSurface(tester, [
  _createSurface(components, dataModel: dataModel),
], catalog: catalog ?? basicCatalog());

Map<String, Object?> _bind(String path) => {'@path': path};

void main() {
  testWidgets('renders a createSurface carrying its components and data', (
    tester,
  ) async {
    final SurfaceHarness harness = await _pump(
      tester,
      [
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            '@call': 'formatString',
            'args': {'value': r'Hello, ${/name}'},
          },
        },
      ],
      dataModel: {'name': 'Ada'},
    );

    expect(find.text('Hello, Ada'), findsOneWidget);
    expect(harness.errors, isEmpty);
  });

  testWidgets('shows each template item its @index', (tester) async {
    await _pump(
      tester,
      [
        {
          'id': 'root',
          'component': 'List',
          'children': {'componentId': 'item', 'path': '/items'},
        },
        {
          'id': 'item',
          'component': 'Text',
          'text': {
            '@call': '@index',
            'args': {'offset': 1},
          },
        },
      ],
      dataModel: {
        'items': ['a', 'b'],
      },
    );

    expect(find.text('1'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
  });

  group('user activation', () {
    testWidgets('runs openUrl from a tap', (tester) async {
      final opened = <Uri>[];
      final SurfaceHarness harness = await _pump(tester, [
        {
          'id': 'root',
          'component': 'Button',
          'child': 'label',
          'action': {
            'functionCall': {
              '@call': 'openUrl',
              'args': {'url': 'https://example.com/docs'},
            },
          },
        },
        {'id': 'label', 'component': 'Text', 'text': 'Docs'},
      ], catalog: basicCatalog(openUrl: opened.add));

      await tester.tap(find.text('Docs'));
      await tester.pump();

      expect(opened, [Uri.parse('https://example.com/docs')]);
      expect(harness.actions, isEmpty);
      expect(harness.errors, isEmpty);
    });

    testWidgets('refuses openUrl bound to a property', (tester) async {
      final opened = <Uri>[];
      final SurfaceHarness harness = await _pump(tester, [
        {
          'id': 'root',
          'component': 'Text',
          'text': {
            '@call': 'openUrl',
            'args': {'url': 'https://example.com/docs'},
          },
        },
      ], catalog: basicCatalog(openUrl: opened.add));

      expect(opened, isEmpty);
      expect(harness.errorCodes, ['EXPRESSION_ERROR']);
    });
  });

  group('checks', () {
    List<Map<String, Object?>> form(Object? condition) => [
      {
        'id': 'root',
        'component': 'Column',
        'children': ['name', 'send'],
      },
      {
        'id': 'name',
        'component': 'TextField',
        'label': 'Name',
        'value': _bind('/name'),
        'checks': [
          {'condition': condition, 'message': 'Name is required.'},
        ],
      },
      {
        'id': 'send',
        'component': 'Button',
        'child': 'sendLabel',
        'action': {
          'event': {'name': 'send'},
        },
        'checks': [
          {'condition': condition, 'message': 'Name is required.'},
        ],
      },
      {'id': 'sendLabel', 'component': 'Text', 'text': 'Send'},
    ];

    bool sendEnabled(WidgetTester tester) =>
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).enabled;

    InputDecoration decoration(WidgetTester tester) =>
        tester.widget<TextField>(find.byType(TextField)).decoration!;

    testWidgets('a failing rule disables the button and shows an error', (
      tester,
    ) async {
      final SurfaceHarness harness = await _pump(
        tester,
        form({
          '@call': 'required',
          'args': {'value': _bind('/name')},
        }),
        dataModel: {'name': ''},
      );

      expect(sendEnabled(tester), isFalse);
      expect(decoration(tester).errorText, isNotNull);

      await tester.enterText(find.byType(TextField), 'Ada');
      await tester.pump();

      expect(harness.data('/name'), 'Ada');
      expect(sendEnabled(tester), isTrue);
      expect(decoration(tester).errorText, isNull);
    });

    testWidgets('a false boolean result acts as an error', (tester) async {
      await _pump(
        tester,
        form(_bind('/ok')),
        dataModel: {'name': '', 'ok': false},
      );

      expect(sendEnabled(tester), isFalse);
      expect(decoration(tester).errorText, 'Name is required.');
    });
  });

  group('basic components', () {
    testWidgets('TextField does not check validationRegexp', (tester) async {
      await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'TextField',
            'label': 'Zip',
            'value': _bind('/zip'),
            'validationRegexp': '[0-9]{5}',
          },
        ],
        dataModel: {'zip': ''},
      );

      await tester.enterText(find.byType(TextField), 'abc');
      await tester.pump();

      expect(
        tester.widget<TextField>(find.byType(TextField)).decoration!.errorText,
        isNull,
      );
    });

    testWidgets('Icon follows a bound svgPath', (tester) async {
      final SurfaceHarness harness = await _pump(
        tester,
        [
          {
            'id': 'root',
            'component': 'Icon',
            'name': {'svgPath': _bind('/path')},
          },
        ],
        dataModel: {'path': 'M0 0h12v12H0z'},
      );

      expect(find.byType(Icon), findsNothing);

      harness.surface().dataModel.set('/path', 'not a path');
      await tester.pump();

      expect(find.byIcon(Icons.help_outline), findsOneWidget);
    });
  });
}
