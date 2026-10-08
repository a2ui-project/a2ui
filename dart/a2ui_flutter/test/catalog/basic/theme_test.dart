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
  BasicComponents.text,
]);

/// Pumps one surface per theme, the `i`th a Text reading `Surface i`, under
/// [host].
Future<void> _pumpThemed(
  WidgetTester tester,
  List<Map<String, Object?>?> themes, {
  ThemeData? host,
}) async {
  await pumpSurface(
    tester,
    [
      for (final (i, theme) in themes.indexed) ...[
        createSurface(_catalog.id, surfaceId: 's$i', theme: theme),
        updateComponents([
          {'id': 'root', 'component': 'Text', 'text': 'Surface $i'},
        ], surfaceId: 's$i'),
      ],
    ],
    catalog: _catalog,
    host: (surfaces) => Theme(
      data: host ?? ThemeData(),
      child: Column(children: surfaces),
    ),
  );
}

ColorScheme _schemeOf(WidgetTester tester, int surface) =>
    Theme.of(tester.element(find.text('Surface $surface'))).colorScheme;

Finder get _themesInSurfaces =>
    find.descendant(of: find.byType(A2uiSurface), matching: find.byType(Theme));

void main() {
  testWidgets('seeds the primary colors from primaryColor and keeps the '
      'others', (tester) async {
    final host = ThemeData(
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        secondary: Color(0xFF123456),
        surface: Color(0xFF101010),
      ),
    );
    await _pumpThemed(tester, [
      {'primaryColor': '#00BFFF'},
    ], host: host);

    final seeded = ColorScheme.fromSeed(
      seedColor: const Color(0xFF00BFFF),
      brightness: Brightness.dark,
    );
    final ColorScheme scheme = _schemeOf(tester, 0);
    expect(scheme.primary, const Color(0xFF00BFFF));
    expect(scheme.primaryContainer, seeded.primaryContainer);
    expect(scheme.secondary, const Color(0xFF123456));
    expect(scheme.surface, const Color(0xFF101010));
  });

  testWidgets('puts black or white on the primary color', (tester) async {
    final List<(String, Color)> colors = [
      ('#FF0000', Colors.white),
      ('#FFD700', Colors.black),
      ('#00BFFF', Colors.black),
      ('#4285F4', Colors.white),
    ];
    await _pumpThemed(tester, [
      for (final (hex, _) in colors) {'primaryColor': hex},
    ]);

    for (final (i, (hex, on)) in colors.indexed) {
      expect(_schemeOf(tester, i).onPrimary, on, reason: hex);
    }
  });

  testWidgets('adds no theme without a primaryColor', (tester) async {
    await _pumpThemed(tester, [
      null,
      {'agentDisplayName': 'Agent'},
    ]);

    expect(find.text('Surface 1'), findsOneWidget);
    expect(_themesInSurfaces, findsNothing);
  });

  testWidgets('adds one theme above nested basic components', (tester) async {
    await pumpSurface(tester, [
      createSurface(_catalog.id, theme: {'primaryColor': '#FF5722'}),
      updateComponents([
        {
          'id': 'root',
          'component': 'Column',
          'children': ['a', 'b'],
        },
        {'id': 'a', 'component': 'Text', 'text': 'A'},
        {'id': 'b', 'component': 'Text', 'text': 'B'},
      ]),
    ], catalog: _catalog);

    expect(_themesInSurfaces, findsOneWidget);
    expect(
      Theme.of(tester.element(find.text('B'))).colorScheme.primary,
      const Color(0xFFFF5722),
    );
  });
}
