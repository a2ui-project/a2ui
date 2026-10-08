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

import 'package:flutter/widgets.dart';

/// Builds the widget that renders [markdown] with [style] as its base text
/// style.
typedef A2uiMarkdownBuilder =
    Widget Function(BuildContext context, String markdown, TextStyle style);

/// Renders the markdown of the basic `Text` components below it.
///
/// A Text with the `body` variant, or none, is built by [builder]. Headings
/// and captions stay plain text. Without an [A2uiMarkdown] above it, a Text
/// shows its text as written.
class A2uiMarkdown extends InheritedWidget {
  const A2uiMarkdown({super.key, required this.builder, required super.child});

  /// Builds the widget for one Text's markdown.
  final A2uiMarkdownBuilder builder;

  /// The [builder] of the nearest enclosing [A2uiMarkdown], if any.
  static A2uiMarkdownBuilder? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<A2uiMarkdown>()?.builder;

  @override
  bool updateShouldNotify(A2uiMarkdown oldWidget) =>
      builder != oldWidget.builder;
}
