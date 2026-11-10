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
      '- item_one\n- 2 * 3 * 4': '- item_one\n- 2 * 3 * 4',
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

  testWidgets('styles a one-line markdown heading by its level without a '
      'builder', (tester) async {
    await pumpComponents(tester, [
      {
        'id': 'root',
        'component': 'Column',
        'children': ['h2', 'h6', 'h1', 'h3'],
      },
      {'id': 'h2', 'component': 'Text', 'text': '  ## Title\n'},
      {'id': 'h6', 'component': 'Text', 'text': '###### Small'},
      {'id': 'h1', 'component': 'Text', 'text': '# Learn C#'},
      {'id': 'h3', 'component': 'Text', 'text': '### Closed ###'},
    ], catalog: _catalog);

    final TextTheme theme = Theme.of(
      tester.element(find.text('Title')),
    ).textTheme;
    expect(
      tester.widget<Text>(find.text('Title')).style?.fontSize,
      theme.headlineMedium!.fontSize,
    );
    expect(
      tester.widget<Text>(find.text('Small')).style?.fontSize,
      theme.titleMedium!.fontSize,
    );
    expect(
      tester.widget<Text>(find.text('Learn C#')).style?.fontSize,
      theme.headlineLarge!.fontSize,
    );
    expect(
      tester.widget<Text>(find.text('Closed')).style?.fontSize,
      theme.headlineSmall!.fontSize,
    );
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
