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
  BasicComponents.text,
  BasicComponents.button,
  BasicComponents.row,
  BasicComponents.column,
  BasicComponents.card,
  BasicComponents.divider,
]);

void main() {
  group('Text', () {
    testWidgets('renders a bound number as JavaScript would', (tester) async {
      await pumpComponents(
        tester,
        [
          {
            'id': 'root',
            'component': 'Text',
            'text': {'path': '/count'},
          },
        ],
        catalog: _catalog,
        data: {'count': 3.0},
      );

      expect(find.text('3'), findsOneWidget);
    });

    testWidgets('takes each variant\'s font size and weight from the text '
        'theme', (tester) async {
      const variants = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'];
      await pumpComponents(tester, [
        {
          'id': 'root',
          'component': 'Column',
          'children': [for (final v in variants) v],
        },
        for (final v in variants)
          {'id': v, 'component': 'Text', 'text': v, 'variant': v},
      ], catalog: _catalog);

      final TextTheme theme = Theme.of(
        tester.element(find.text('h1')),
      ).textTheme;
      TextStyle? styleOf(String text) =>
          tester.widget<Text>(find.text(text)).style;
      for (final (variant, expected) in [
        ('h1', theme.headlineLarge!),
        ('h2', theme.headlineMedium!),
        ('h3', theme.headlineSmall!),
        ('h4', theme.titleLarge!),
        ('h5', theme.titleMedium!),
        ('caption', theme.bodySmall!),
      ]) {
        final TextStyle style = styleOf(variant)!;
        expect(style.fontSize, expected.fontSize, reason: variant);
        expect(style.fontWeight, expected.fontWeight, reason: variant);
        expect(style.color, isNull, reason: variant);
      }
      expect(styleOf('body'), isNull);
    });
  });

  group('Card', () {
    testWidgets('renders its child on a card', (tester) async {
      await pumpComponents(tester, [
        {'id': 'root', 'component': 'Card', 'child': 'label'},
        {'id': 'label', 'component': 'Text', 'text': 'Inside'},
      ], catalog: _catalog);

      expect(
        find.descendant(of: find.byType(Card), matching: find.text('Inside')),
        findsOneWidget,
      );
    });
  });

  group('Divider', () {
    testWidgets('is horizontal by default', (tester) async {
      await pumpComponents(tester, [
        {'id': 'root', 'component': 'Divider'},
      ], catalog: _catalog);

      expect(find.byType(Divider), findsOneWidget);
      expect(find.byType(VerticalDivider), findsNothing);
    });

    testWidgets('is 24 high in a Row in a scroll view when vertical', (
      tester,
    ) async {
      await pumpComponents(tester, [
        {
          'id': 'root',
          'component': 'Row',
          'children': ['a', 'line', 'b'],
        },
        {'id': 'a', 'component': 'Text', 'text': 'A'},
        {'id': 'line', 'component': 'Divider', 'axis': 'vertical'},
        {'id': 'b', 'component': 'Text', 'text': 'B'},
      ], catalog: _catalog);

      expect(tester.getSize(find.byType(VerticalDivider)).height, 24);
    });
  });
}
