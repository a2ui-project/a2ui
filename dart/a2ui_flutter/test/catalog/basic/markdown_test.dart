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
import 'package:flutter_test/flutter_test.dart';

import '../../support/basic_test_catalog.dart';
import '../../support/surface_harness.dart';

final CatalogImplementation _catalog = basicTestCatalog([
  BasicComponents.column,
  BasicComponents.text,
]);

/// Lays the surfaces out under an [A2uiMarkdown] that renders markdown as
/// `md:` followed by the source, recording each base style in [styles].
SurfaceHost _markdownHost(List<TextStyle> styles) =>
    (surfaces) => A2uiMarkdown(
      builder: (context, markdown, style) {
        styles.add(style);
        return Text('md:$markdown');
      },
      child: scrollingHost(surfaces),
    );

/// The style of the span of a basic Text whose text is [text].
TextStyle? _style(WidgetTester tester, String text) {
  final Iterable<TextSpan> spans = tester
      .widgetList<Text>(find.byType(Text))
      .map((widget) => widget.textSpan)
      .whereType<TextSpan>()
      .expand((span) => span.children ?? const <InlineSpan>[])
      .whereType<TextSpan>()
      .where((span) => span.text == text);
  return spans.single.style;
}

void main() {
  testWidgets('renders body text through the markdown builder', (tester) async {
    final styles = <TextStyle>[];
    await pumpComponents(
      tester,
      [
        {
          'id': 'root',
          'component': 'Column',
          'children': ['plain', 'body'],
        },
        {'id': 'plain', 'component': 'Text', 'text': '**a**'},
        {'id': 'body', 'component': 'Text', 'text': '_b_', 'variant': 'body'},
      ],
      catalog: _catalog,
      host: _markdownHost(styles),
    );

    expect(find.text('md:**a**'), findsOneWidget);
    expect(find.text('md:_b_'), findsOneWidget);
    expect(
      styles.first,
      DefaultTextStyle.of(tester.element(find.text('md:**a**'))).style,
    );
  });

  testWidgets('keeps headings and captions plain', (tester) async {
    const variants = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption'];
    await pumpComponents(
      tester,
      [
        {
          'id': 'root',
          'component': 'Column',
          'children': [for (final v in variants) v],
        },
        for (final v in variants)
          {'id': v, 'component': 'Text', 'text': '# $v', 'variant': v},
      ],
      catalog: _catalog,
      host: _markdownHost([]),
    );

    for (final v in variants) {
      expect(find.text(v), findsOneWidget);
    }
    expect(find.textContaining('md:'), findsNothing);
  });

  testWidgets('removes markdown markers without a builder', (tester) async {
    const cases = {
      '**bold** and *italic* and _under_ and `code`':
          'bold and italic and '
          'under and code',
      '## Sub\n\n> quoted [link](https://a.b) ~~gone~~':
          'Sub\n\nquoted link '
          'gone',
      '**`config.yaml`** and ~~**old**~~': 'config.yaml and old',
      r'\*not italic\* \# not heading': '*not italic* # not heading',
      'the `__init__` method': 'the __init__ method',
      '## Closed ##\nbody': 'Closed\nbody',
    };
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Column',
        'children': [for (var i = 0; i < cases.length; i++) 't$i'],
      },
      for (final (int i, String text) in cases.keys.indexed)
        {'id': 't$i', 'component': 'Text', 'text': text},
    ], catalog: _catalog);

    for (final String plain in cases.values) {
      expect(find.text(plain), findsOneWidget);
    }
  });

  testWidgets('styles each markdown heading by its level without a '
      'builder', (tester) async {
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Column',
        'children': ['h2', 'h6', 'h1', 'h3', 'mixed'],
      },
      {'id': 'h2', 'component': 'Text', 'text': '  ## Title\n'},
      {'id': 'h6', 'component': 'Text', 'text': '###### Small'},
      {'id': 'h1', 'component': 'Text', 'text': '# Learn C#'},
      {'id': 'h3', 'component': 'Text', 'text': '### Closed ###'},
      {'id': 'mixed', 'component': 'Text', 'text': '# Top\n## Next\nbody line'},
    ], catalog: _catalog);

    final TextTheme theme = Theme.of(tester.element(find.text('Title')))
        .textTheme;
    expect(_style(tester, 'Title')?.fontSize, theme.headlineMedium!.fontSize);
    expect(_style(tester, 'Small')?.fontSize, theme.titleMedium!.fontSize);
    expect(_style(tester, 'Learn C#')?.fontSize, theme.headlineLarge!.fontSize);
    expect(_style(tester, 'Closed')?.fontSize, theme.headlineSmall!.fontSize);
    expect(find.text('Top\nNext\nbody line'), findsOneWidget);
    expect(_style(tester, 'Top')?.fontSize, theme.headlineLarge!.fontSize);
    expect(_style(tester, 'Next')?.fontSize, theme.headlineMedium!.fontSize);
    expect(_style(tester, '\nbody line'), isNull);
  });

  testWidgets('styles inline markdown without a builder', (tester) async {
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Column',
        'children': ['inline', 'nested', 'plain'],
      },
      {
        'id': 'inline',
        'component': 'Text',
        'text': '*it* **bold** ~~old~~ `a_b`',
      },
      {
        'id': 'nested',
        'component': 'Text',
        'text': '**`config.yaml`** [**see**](https://a.b)',
      },
      {'id': 'plain', 'component': 'Text', 'text': r'2 * 3 \* 4'},
    ], catalog: _catalog);

    expect(find.text('it bold old a_b'), findsOneWidget);
    expect(_style(tester, 'it')?.fontStyle, FontStyle.italic);
    expect(_style(tester, 'bold')?.fontWeight, FontWeight.bold);
    expect(_style(tester, 'old')?.decoration, TextDecoration.lineThrough);
    expect(_style(tester, 'a_b')?.fontFamily, 'monospace');

    expect(find.text('config.yaml see'), findsOneWidget);
    final TextStyle config = _style(tester, 'config.yaml')!;
    expect(config.fontWeight, FontWeight.bold);
    expect(config.fontFamily, 'monospace');
    expect(_style(tester, 'see')?.fontWeight, FontWeight.bold);

    expect(
      tester.widget<Text>(find.text('2 * 3 * 4')).data,
      '2 * 3 * 4',
      reason: 'text without markdown stays a plain Text',
    );
  });

  testWidgets('starts list items with a bullet that is not read out without '
      'a builder', (tester) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Text',
        'text': '- item_one\n  * two\n+ 2 * 3 * 4',
      },
    ], catalog: _catalog);

    final InlineSpan span = tester.widget<Text>(find.byType(Text)).textSpan!;
    expect(
      span.toPlainText(includeSemanticsLabels: false),
      '\u2022 item_one\n  \u2022 two\n\u2022 2 * 3 * 4',
    );
    expect(find.bySemanticsLabel('item_one\n  two\n2 * 3 * 4'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('renders inline markdown but no headings or bullets in other '
      'variants', (tester) async {
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Column',
        'children': ['caption', 'list'],
      },
      {
        'id': 'caption',
        'component': 'Text',
        'text': '# A **b**',
        'variant': 'caption',
      },
      {'id': 'list', 'component': 'Text', 'text': '- c', 'variant': 'h2'},
    ], catalog: _catalog);

    final TextTheme theme = Theme.of(tester.element(find.text('A b')))
        .textTheme;
    final Text caption = tester.widget<Text>(find.text('A b'));
    expect(caption.style?.fontSize, theme.bodySmall!.fontSize);
    expect(_style(tester, 'A ')?.fontSize, isNull);
    expect(_style(tester, 'b')?.fontWeight, FontWeight.bold);
    expect(tester.widget<Text>(find.text('- c')).data, '- c');
  });

  testWidgets('removes markers in time linear in the text', (tester) async {
    String repeat(String s, int n) => List.filled(n, s).join();
    final List<String> texts = [
      repeat('[', 50000),
      repeat('[a](', 12500),
      repeat(' *a', 16000),
      repeat(' _a', 16000),
      '# a${repeat(' ', 50000)}x',
    ];
    final stopwatch = Stopwatch()..start();
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Column',
        'children': [for (var i = 0; i < texts.length; i++) 't$i'],
      },
      for (final (int i, String text) in texts.indexed)
        {'id': 't$i', 'component': 'Text', 'text': text},
    ], catalog: _catalog);

    // Quadratic patterns take tens of seconds on these texts.
    expect(stopwatch.elapsed, lessThan(const Duration(seconds: 5)));
    expect(find.byType(Text), findsNWidgets(texts.length));
  });
}
