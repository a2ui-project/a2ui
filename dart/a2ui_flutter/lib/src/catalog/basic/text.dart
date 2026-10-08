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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/material.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';
import 'markdown.dart';

/// Builds the basic `Text` component: `text` in the inherited text style,
/// with the font size and weight of the style its `variant` names from the
/// ambient [TextTheme], or, for the `body` variant, through the enclosing
/// [A2uiMarkdown] when there is one.
Widget buildText(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final String text = props.string('text') ?? '';
  final TextTheme theme = Theme.of(context).textTheme;
  final TextStyle? style = switch (props.string('variant')) {
    'h1' => theme.headlineLarge,
    'h2' => theme.headlineMedium,
    'h3' => theme.headlineSmall,
    'h4' => theme.titleLarge,
    'h5' => theme.titleMedium,
    'caption' => theme.bodySmall,
    _ => null,
  };
  if (style == null) {
    if (A2uiMarkdown.maybeOf(context) case final A2uiMarkdownBuilder markdown) {
      return markdown(context, text, DefaultTextStyle.of(context).style);
    }
  }
  return Text(
    text,
    style: style == null
        ? null
        : TextStyle(fontSize: style.fontSize, fontWeight: style.fontWeight),
  );
}
