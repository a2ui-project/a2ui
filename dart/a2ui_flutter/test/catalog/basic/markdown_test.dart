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
      expect(find.text('# $v'), findsOneWidget);
    }
    expect(find.textContaining('md:'), findsNothing);
  });

  testWidgets('shows markdown as written without a builder', (tester) async {
    await pumpComponents(tester, [
      {'id': 'root', 'component': 'Text', 'text': '**a**'},
    ], catalog: _catalog);

    expect(find.text('**a**'), findsOneWidget);
  });
}
