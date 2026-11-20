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
/// ambient [TextTheme], or, for the `body` variant, through the enclosing
/// [A2uiMarkdown] when there is one.
///
/// A Text the [A2uiMarkdown] does not build shows its text without common
/// Markdown markers: heading and quote markers, link and image syntax,
/// emphasis, strikethrough and code delimiters, and backslash escapes. A
/// `body` Text that is one Markdown heading line takes the style of the
/// variant of that level, `h5` for level 6.
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
  TextStyle? style = styleOf(props.string('variant'));
  if (style == null) {
    if (A2uiMarkdown.maybeOf(context) case final A2uiMarkdownBuilder markdown) {
      return markdown(context, text, DefaultTextStyle.of(context).style);
    }
  }
  final String line = text.trim();
  final RegExpMatch? heading = style == null && !line.contains('\n')
      ? _heading.firstMatch(line)
      : null;
  if (heading != null) {
    style = styleOf('h${math.min(heading[1]!.length, 5)}');
  }
  return Text(
    _withoutMarkers(heading == null ? text : line),
    style: style == null
        ? null
        : TextStyle(fontSize: style.fontSize, fontWeight: style.fontWeight),
  );
}

/// The start of a line that is a Markdown heading, with its `#` markers in
/// group 1.
final RegExp _heading = RegExp(r'^ {0,3}(#{1,6})(?:[ \t]|$)');

/// The markers [_withoutMarkers] removes, each with the group of the text
/// it keeps, or null to keep nothing. None of the patterns backtracks over
/// more than one line.
final List<(RegExp, int?)> _markers = [
  (
    RegExp(
      r'^( {0,3}#{1,6}(?:[ \t].*[^ \t])?)[ \t]+#+[ \t]*$',
      multiLine: true,
    ),
    1,
  ),
  (RegExp(r'^ {0,3}(?:#{1,6}(?:[ \t]+|$)|>[ \t]?)', multiLine: true), null),
  (RegExp(r'!?\[([^\[\]\n]*)\]\([^()\[\]\n]*\)'), 1),
  (RegExp(r'\*\*(.+?)\*\*'), 1),
  (RegExp(r'__(.+?)__'), 1),
  (RegExp(r'~~(.+?)~~'), 1),
  (RegExp(r'(?<![\w*])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![\w*])'), 1),
  (RegExp(r'(?<!\w)_(?![\s_])([^_\n]+?)(?<![\s_])_(?!\w)'), 1),
];

/// [markdown] with the [_markers] removed and its backslash escapes and code
/// span delimiters dropped, keeping each escaped character and the text of
/// each code span as written.
String _withoutMarkers(String markdown) {
  String text = markdown.replaceAllMapped(
    _literal,
    (m) => (m[1] ?? m[2]!).replaceAllMapped(
      _punctuation,
      (p) => String.fromCharCode(p[0]!.codeUnitAt(0) + _hiddenOffset),
    ),
  );
  for (final (RegExp marker, int? kept) in _markers) {
    text = text.replaceAllMapped(marker, (m) => kept == null ? '' : m[kept]!);
  }
  return text.replaceAllMapped(
    _hidden,
    (m) => String.fromCharCode(m[0]!.codeUnitAt(0) - _hiddenOffset),
  );
}

/// A code span, with its text in group 1, or a backslash escape, with the
/// escaped character in group 2.
final RegExp _literal = RegExp(r'`([^`\n]+)`|\\([!-/:-@\[-`{-~])');

/// An ASCII punctuation character.
final RegExp _punctuation = RegExp(r'[!-/:-@\[-`{-~]');

/// An ASCII punctuation character [_withoutMarkers] has hidden from the
/// [_markers] by moving it into the private use area.
final RegExp _hidden = RegExp(r'[\uE021-\uE07E]');

/// How far [_withoutMarkers] moves a character it hides.
const int _hiddenOffset = 0xE000;
