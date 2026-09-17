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

import 'package:a2ui_flutter/src/catalog/basic_catalog_widgets/text.dart';
import 'package:a2ui_flutter/src/model/catalog_item.dart';
import 'package:a2ui_flutter/src/model/data_model.dart';
import 'package:a2ui_flutter/src/model/ui_models.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Text widget renders literal string', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: text.widgetBuilder(
              CatalogItemContext(
                data: {'text': 'Hello World'},
                id: 'test_text',
                type: 'Text',
                buildChild: (_, [_]) => const SizedBox(),
                dispatchEvent: (UiEvent event) {},
                buildContext: context,
                dataContext: DataContext(InMemoryDataModel(), DataPath.root),
                getComponent: (String componentId) => null,
                getCatalogItem: (String type) => null,
                surfaceId: 'surface1',
                reportError: (e, s) {},
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('Hello World'), findsOneWidget);
  });

  testWidgets('Text widget renders with h1 usage hint', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: text.widgetBuilder(
              CatalogItemContext(
                data: {'text': 'Heading 1', 'variant': 'h1'},
                id: 'test_text_h1',
                type: 'Text',
                buildChild: (_, [_]) => const SizedBox(),
                dispatchEvent: (UiEvent event) {},
                buildContext: context,
                dataContext: DataContext(InMemoryDataModel(), DataPath.root),
                getComponent: (String componentId) => null,
                getCatalogItem: (String type) => null,
                surfaceId: 'surface1',
                reportError: (e, s) {},
              ),
            ),
          ),
        ),
      ),
    );

    // MarkdownBody renders RichText, so find.text still works for simple text.
    final Finder textFinder = find.text('Heading 1');
    expect(textFinder, findsOneWidget);

    // Verify padding
    final Finder paddingFinder = find.ancestor(
      of: textFinder,
      matching: find.byType(Padding),
    );
    expect(paddingFinder, findsOneWidget);
    final Padding paddingWidget = tester.widget<Padding>(paddingFinder);
    expect(paddingWidget.padding, const EdgeInsets.symmetric(vertical: 20.0));

    // Verify MarkdownBody is present
    final Finder markdownBodyFinder = find.byType(MarkdownBody);
    expect(markdownBodyFinder, findsOneWidget);
    final MarkdownBody markdownBody = tester.widget<MarkdownBody>(
      markdownBodyFinder,
    );

    // Verify data
    expect(markdownBody.data, 'Heading 1');

    // Verify styleSheet has correct p style
    final Element context = tester.element(textFinder);
    final TextStyle? expectedStyle = Theme.of(context).textTheme.headlineLarge;
    expect(markdownBody.styleSheet?.p?.fontSize, expectedStyle?.fontSize);
  });

  testWidgets('Text widget renders markdown bold', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: text.widgetBuilder(
              CatalogItemContext(
                data: {'text': 'Hello **Bold**'},
                id: 'test_text_markdown',
                type: 'Text',
                buildChild: (_, [_]) => const SizedBox(),
                dispatchEvent: (UiEvent event) {},
                buildContext: context,
                dataContext: DataContext(InMemoryDataModel(), DataPath.root),
                getComponent: (String componentId) => null,
                getCatalogItem: (String type) => null,
                surfaceId: 'surface1',
                reportError: (e, s) {},
              ),
            ),
          ),
        ),
      ),
    );

    // We can verify that MarkdownBody is present and has the correct data.
    expect(find.byType(MarkdownBody), findsOneWidget);
    final MarkdownBody markdownBody = tester.widget<MarkdownBody>(
      find.byType(MarkdownBody),
    );
    expect(markdownBody.data, 'Hello **Bold**');

    // Flutter test `find.text` matches the whole string.
    // `find.textContaining` matches substring.
    expect(find.textContaining('Bold', findRichText: true), findsOneWidget);
  });

  testWidgets('Text widget respects ambient DefaultTextStyle color', (
    WidgetTester tester,
  ) async {
    const Color requiredColor = Colors.red;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: DefaultTextStyle(
              style: const TextStyle(color: requiredColor),
              child: text.widgetBuilder(
                CatalogItemContext(
                  data: {'text': 'Contrast Text'},
                  id: 'test_contrast',
                  type: 'Text',
                  buildChild: (_, [_]) => const SizedBox(),
                  dispatchEvent: (UiEvent event) {},
                  buildContext: context,
                  dataContext: DataContext(InMemoryDataModel(), DataPath.root),
                  getComponent: (String componentId) => null,
                  getCatalogItem: (String type) => null,
                  surfaceId: 'surface1',
                  reportError: (e, s) {},
                ),
              ),
            ),
          ),
        ),
      ),
    );

    final Finder markdownBodyFinder = find.byType(MarkdownBody);
    final MarkdownBody markdownBody = tester.widget<MarkdownBody>(
      markdownBodyFinder,
    );
    expect(markdownBody.styleSheet?.p?.color, requiredColor);

    final RichText richText = tester.widget(
      find
          .descendant(of: markdownBodyFinder, matching: find.byType(RichText))
          .first,
    );
    expect(richText.text.style?.color, requiredColor);
  });

  testWidgets(
    'Text widget does NOT evaluate expressions implicitly (renders literal)',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: text.widgetBuilder(
                CatalogItemContext(
                  data: {'text': '\${foo}'},
                  id: 'test_text_literal_expression',
                  type: 'Text',
                  buildChild: (_, [_]) => const SizedBox(),
                  dispatchEvent: (UiEvent event) {},
                  buildContext: context,
                  dataContext: DataContext(InMemoryDataModel(), DataPath.root)
                    ..update(DataPath('foo'), 'bar'),
                  getComponent: (String componentId) => null,
                  getCatalogItem: (String type) => null,
                  surfaceId: 'surface1',
                  reportError: (e, s) {},
                ),
              ),
            ),
          ),
        ),
      );

      // Should render "${foo}" literally, NOT "bar".
      expect(find.text('\${foo}'), findsOneWidget);
      expect(find.text('bar'), findsNothing);
    },
  );
}
