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
import 'simple_markdown.dart';

/// Builds the basic `Text` component: `text` in the inherited text style,
/// with the font size and weight of the style its `variant` names from the
/// ambient [TextTheme], or, for the `body` variant, through the enclosing
/// [A2uiMarkdown] when there is one.
///
/// A Text the [A2uiMarkdown] does not build renders its simple Markdown:
/// emphasis, strong text, strikethrough and code spans are styled, link and
/// image syntax shows its text, and quote markers and backslash escapes are
/// removed. A `body` Text also renders headings, each in the style of the
/// variant of its level, `h5` for level 6, and starts list items with a
/// bullet. A Text of another variant removes heading markers and keeps list
/// markers as written.
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
  TextStyle? fontOf(TextStyle? style) => style == null
      ? null
      : TextStyle(fontSize: style.fontSize, fontWeight: style.fontWeight);
  final TextStyle? style = styleOf(props.string('variant'));
  if (style == null) {
    if (A2uiMarkdown.maybeOf(context) case final A2uiMarkdownBuilder markdown) {
      return markdown(context, text, DefaultTextStyle.of(context).style);
    }
  }
  final TextSpan span = simpleMarkdown(
    text,
    blocks: style == null,
    headingStyle: (level) => fontOf(styleOf('h${math.min(level, 5)}')),
  );
  return span.children == null
      ? Text(span.text!, style: fontOf(style))
      : Text.rich(span, style: fontOf(style));
}
