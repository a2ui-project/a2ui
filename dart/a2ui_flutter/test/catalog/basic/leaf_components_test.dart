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
import 'package:a2ui_flutter/v0_9/basic_catalog.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/surface_harness.dart';

final CatalogImplementation _catalog = basicTestCatalog([
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

    testWidgets('marks heading variants and markdown heading lines as '
        'headings of their level', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final texts = <String, Map<String, Object?>>{
        'h1': {'text': 'One', 'variant': 'h1'},
        'h2': {'text': 'Two', 'variant': 'h2'},
        'h3': {'text': 'Three', 'variant': 'h3'},
        'h4': {'text': 'Four', 'variant': 'h4'},
        'h5': {'text': 'Five', 'variant': 'h5'},
        'md1': {'text': '# Hash one'},
        'md3': {'text': '  ### Hash three\n', 'variant': 'body'},
        'md6': {'text': '###### Hash six'},
        'caption': {'text': 'Caption', 'variant': 'caption'},
        'body': {'text': 'Body', 'variant': 'body'},
        'plain': {'text': 'Plain'},
        'seven': {'text': '####### Seven'},
        'lines': {'text': '# Title\nbody'},
        'quote': {'text': '> Quote'},
      };
      await pumpComponents(tester, [
        {'id': 'root', 'component': 'Column', 'children': texts.keys.toList()},
        for (final MapEntry(:key, :value) in texts.entries)
          {'id': key, 'component': 'Text', ...value},
      ], catalog: _catalog);

      (bool, int) headingOf(String text) {
        final SemanticsData data = tester
            .getSemantics(find.text(text))
            .getSemanticsData();
        expect(data.label, text);
        return (data.flagsCollection.isHeader, data.headingLevel);
      }

      for (final (text, level) in [
        ('One', 1),
        ('Two', 2),
        ('Three', 3),
        ('Four', 4),
        ('Five', 5),
        ('Hash one', 1),
        ('Hash three', 3),
        ('Hash six', 6),
      ]) {
        expect(headingOf(text), (true, level), reason: text);
      }
      for (final text in [
        'Caption',
        'Body',
        'Plain',
        '####### Seven',
        'Title\nbody',
        'Quote',
      ]) {
        expect(headingOf(text), (false, 0), reason: text);
      }
      handle.dispose();
    });

    testWidgets('keeps the heading flag off the texts beside a heading in a '
        'card or a labelled component', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpComponents(tester, [
        {
          'id': 'root',
          'component': 'Column',
          'children': ['card', 'labelled'],
        },
        {'id': 'card', 'component': 'Card', 'child': 'cardColumn'},
        {
          'id': 'cardColumn',
          'component': 'Column',
          'children': ['cardTitle', 'cardBody'],
        },
        {
          'id': 'cardTitle',
          'component': 'Text',
          'text': 'Card title',
          'variant': 'h2',
        },
        {'id': 'cardBody', 'component': 'Text', 'text': 'Card body'},
        {
          'id': 'labelled',
          'component': 'Column',
          'children': ['labelledTitle', 'labelledBody'],
          'accessibility': {'label': 'Greeting'},
        },
        {'id': 'labelledTitle', 'component': 'Text', 'text': '### Hello'},
        {'id': 'labelledBody', 'component': 'Text', 'text': 'Labelled body'},
      ], catalog: _catalog);

      SemanticsData dataOf(String text) =>
          tester.getSemantics(find.text(text)).getSemanticsData();
      for (final (text, level) in [('Card title', 2), ('Hello', 3)]) {
        final SemanticsData heading = dataOf(text);
        expect(heading.label, text);
        expect(heading.flagsCollection.isHeader, isTrue, reason: text);
        expect(heading.headingLevel, level, reason: text);
      }
      for (final text in ['Card body', 'Labelled body']) {
        final SemanticsData body = dataOf(text);
        expect(body.label, contains(text));
        expect(body.label, isNot(contains('Card title')), reason: text);
        expect(body.label, isNot(contains('Hello')), reason: text);
        expect(body.flagsCollection.isHeader, isFalse, reason: text);
        expect(body.headingLevel, 0, reason: text);
      }
      handle.dispose();
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
