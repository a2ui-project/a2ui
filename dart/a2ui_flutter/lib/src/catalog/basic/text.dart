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

import 'dart:math' as math;

import 'package:a2ui_core/a2ui_core.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';
import 'markdown.dart';

/// Builds the basic `Text` component: `text` in the inherited text style,
/// with the font size and weight of the style its `variant` names from the
/// ambient [TextTheme].
///
/// A `body` Text, the default, renders its text as Markdown through the
/// enclosing [A2uiMarkdown]. Without one, it shows the text with its Markdown
/// markers removed, in the style of a heading when the text is one heading.
Widget buildText(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final String text = props.string('text') ?? '';
  final TextTheme theme = Theme.of(context).textTheme;
  TextStyle? styleOf(String? variant) => switch (variant) {
    'h1' => theme.headlineLarge,
    'h2' => theme.headlineMedium,
    'h3' => theme.headlineSmall,
    'h4' => theme.titleLarge,
    'h5' => theme.titleMedium,
    'caption' => theme.bodySmall,
    _ => null,
  };
  final TextStyle? style = styleOf(props.string('variant'));
  if (style != null) return Text(text, style: _sized(style));
  if (A2uiMarkdown.maybeOf(context) case final A2uiMarkdownBuilder markdown) {
    return markdown(context, text, DefaultTextStyle.of(context).style);
  }
  if (_heading.firstMatch(text.trim()) case final RegExpMatch heading) {
    return Text(
      _withoutMarkers(heading[2]!),
      style: _sized(styleOf('h${math.min(heading[1]!.length, 5)}')),
    );
  }
  return Text(_withoutMarkers(text));
}

/// The font size and weight of [style].
TextStyle? _sized(TextStyle? style) => style == null
    ? null
    : TextStyle(fontSize: style.fontSize, fontWeight: style.fontWeight);

/// A text that is one heading: its `#` markers and its content.
final RegExp _heading = RegExp(r'^(#{1,6})[ \t]+([^\n]+)$');

/// The Markdown markers [_withoutMarkers] removes. Each keeps its first
/// group, or nothing when it has none.
final List<RegExp> _markers = [
  RegExp(r'^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?)', multiLine: true),
  RegExp(r'!?\[([^\]]*)\]\([^)]*\)'),
  RegExp(r'\*\*(.+?)\*\*'),
  RegExp(r'__(.+?)__'),
  RegExp(r'~~(.+?)~~'),
  RegExp(r'`([^`]+)`'),
  RegExp(r'(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])'),
  RegExp(r'(?<!\w)_(?![\s_])(.+?)(?<![\s_])_(?!\w)'),
];

/// [markdown] without heading and quote markers, emphasis, strikethrough and
/// code delimiters, and with each link or image replaced by its text.
String _withoutMarkers(String markdown) => _markers.fold(
  markdown,
  (text, marker) =>
      text.replaceAllMapped(marker, (m) => m.groupCount > 0 ? m[1]! : ''),
);
