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
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/surface_harness.dart';

final WidgetCatalog _catalog = basicTestCatalog([
  BasicComponents.column,
  BasicComponents.icon,
]);

/// The icon names the specification's `Icon.name` enum lists.
List<String> _specNames() {
  final properties =
      BasicComponents.api.components['Icon']!.schema.value['properties']!
          as Map<String, Object?>;
  final name = properties['name']! as Map<String, Object?>;
  for (final Map<String, Object?> option
      in (name['oneOf']! as List<Object?>).cast<Map<String, Object?>>()) {
    if (option['enum'] case final List<Object?> names) {
      return names.cast<String>();
    }
  }
  throw StateError('Icon.name has no enum');
}

IconData? _iconOf(WidgetTester tester) =>
    tester.widget<Icon>(find.byType(Icon)).icon;

void main() {
  testWidgets('maps every name in the specification to its own icon', (
    tester,
  ) async {
    final List<String> names = _specNames();
    expect(names, hasLength(59));
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Column',
        'children': [for (final n in names) n],
      },
      for (final n in names) {'id': n, 'component': 'Icon', 'name': n},
    ], catalog: _catalog);

    final List<IconData?> icons = [
      for (final n in names)
        tester
            .widget<Icon>(
              find.descendant(
                of: find.byKey(NodeKey(n), skipOffstage: false),
                matching: find.byType(Icon),
                skipOffstage: false,
              ),
            )
            .icon,
    ];
    expect(icons, isNot(contains(Icons.help_outline)));
    expect(icons.toSet(), hasLength(names.length));
  });

  for (final (String description, Object? value) in [
    ('an unknown bound name', 'rocket'),
    ('a bound number', 3),
    ('missing bound data', null),
  ]) {
    testWidgets('renders help_outline for $description', (tester) async {
      final SurfaceHarness harness = await pumpComponents(
        tester,
        [
          {
            'id': 'root',
            'component': 'Icon',
            'name': {'path': '/icon'},
          },
        ],
        catalog: _catalog,
        data: {'icon': ?value},
      );

      expect(_iconOf(tester), Icons.help_outline);
      expect(harness.errors, isEmpty);
    });
  }

  group('svgPath', () {
    Finder pathIcon() => find.descendant(
      of: find.byType(A2uiSurface),
      matching: find.byType(CustomPaint),
    );

    testWidgets('draws the path on a 24 by 24 view box', (tester) async {
      await pumpComponents(tester, [
        {
          'id': 'root',
          'component': 'Column',
          'align': 'start',
          'children': ['icon'],
        },
        {
          'id': 'icon',
          'component': 'Icon',
          'name': {'svgPath': 'M0 0h12v12H0z'},
        },
      ], catalog: _catalog);

      expect(find.byType(Icon), findsNothing);
      expect(tester.getSize(pathIcon()), const Size(24, 24));
      expect(
        pathIcon(),
        paints..path(
          includes: const [Offset(6, 6)],
          excludes: const [Offset(18, 18)],
        ),
      );
    });

    testWidgets('takes the icon theme size and color', (tester) async {
      await pumpComponents(
        tester,
        [
          {
            'id': 'root',
            'component': 'Icon',
            'name': {'svgPath': 'M0 0h24v24H0z'},
          },
        ],
        catalog: _catalog,
        host: (surfaces) => IconTheme(
          data: const IconThemeData(size: 48, color: Color(0xFF00FF00)),
          child: Align(
            alignment: Alignment.topLeft,
            child: Column(children: surfaces),
          ),
        ),
      );

      expect(tester.getSize(pathIcon()), const Size(48, 48));
      expect(pathIcon(), paints..path(color: const Color(0xFF00FF00)));
    });

    for (final data in ['', 'not a path', 'M0 0 L10']) {
      testWidgets('renders help_outline for "$data"', (tester) async {
        final SurfaceHarness harness = await pumpComponents(tester, [
          {
            'id': 'root',
            'component': 'Icon',
            'name': {'svgPath': data},
          },
        ], catalog: _catalog);

        expect(_iconOf(tester), Icons.help_outline);
        expect(tester.takeException(), isNull);
        expect(harness.errors, isEmpty);
      });
    }
  });
}
