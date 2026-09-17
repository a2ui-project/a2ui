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

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';

extension type _TextData.fromMap(JsonMap _json) {
  factory _TextData({required Object text, String? variant}) =>
      _TextData.fromMap({'text': text, 'variant': variant});

  Object get text => _json['text'] as Object;
  String? get variant => _json['variant'] as String?;
}

/// A block of styled text.
///
/// This widget displays a string of text, analogous to Flutter's [Text] widget.
/// The content is taken from the `text` parameter, which can be a literal
/// string or a data model binding.
///
/// ## Parameters:
///
/// - `text`: The text to display. This supports markdown.
/// - `variant`: A hint for the text size and style. One of 'h1', 'h2',
///   'h3', 'h4', 'h5', 'caption', 'body'.
final text = CatalogItem(
  name: 'Text',
  dataSchema: S.object(
    description: 'A block of styled text.',
    properties: {
      'text': A2uiSchemas.stringReference(
        description:
            '''While simple Markdown is supported (without HTML or image references), utilizing dedicated UI components is generally preferred for a richer and more structured presentation.''',
      ),
      'variant': S.string(
        description: 'A hint for the base text style.',
        enumValues: ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'],
      ),
    },
    required: ['text'],
  ),
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "Text",
          "text": "Hello World"
        }
      ]
    ''',
  ],
  widgetBuilder: (itemContext) {
    final textData = _TextData.fromMap(itemContext.data as JsonMap);

    return BoundString(
      dataContext: itemContext.dataContext,
      value: textData.text,
      builder: (context, value) {
        final TextTheme textTheme = Theme.of(context).textTheme;
        final String variant = textData.variant ?? 'body';
        final TextStyle? baseStyle = switch (variant) {
          'h1' => textTheme.headlineLarge,
          'h2' => textTheme.headlineMedium,
          'h3' => textTheme.headlineSmall,
          'h4' => textTheme.titleLarge,
          'h5' => textTheme.titleMedium,
          'caption' => textTheme.bodySmall,
          _ => DefaultTextStyle.of(context).style,
        };
        final double verticalPadding = switch (variant) {
          'h1' => 20.0,
          'h2' => 16.0,
          'h3' => 12.0,
          'h4' => 8.0,
          'h5' => 4.0,
          _ => 0.0,
        };

        return Padding(
          padding: EdgeInsets.symmetric(vertical: verticalPadding),
          child: MarkdownBody(
            data: value ?? '',
            styleSheet: MarkdownStyleSheet.fromTheme(
              Theme.of(context),
            ).copyWith(p: baseStyle),
          ),
        );
      },
    );
  },
);
