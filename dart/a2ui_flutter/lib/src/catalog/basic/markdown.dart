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
import 'package:flutter/widgets.dart';

/// Checks a URL in a Text's markdown against the surface's URL security
/// policy, and returns the URL to use (possibly rewritten), or null when it
/// is blocked.
///
/// Pass link targets as [UrlContext.navigation] and image sources as
/// [UrlContext.media]. A blocked URL is reported once as a `URL_BLOCKED`
/// warning on the surface.
typedef A2uiMarkdownUrlSanitizer =
    String? Function(String url, UrlContext context);

/// Builds the widget that renders [markdown] with [style] as its base text
/// style.
///
/// A builder that renders links or images passes every link target and image
/// source through [sanitizeUrl] first, opening or loading only the URL it
/// returns:
///
/// ```dart
/// Widget markdown(
///   BuildContext context,
///   String markdown,
///   TextStyle style,
///   A2uiMarkdownUrlSanitizer sanitizeUrl,
/// ) => MarkdownBody(
///   data: markdown,
///   onTapLink: (text, href, title) {
///     final String? url =
///         href == null ? null : sanitizeUrl(href, UrlContext.navigation);
///     if (url != null) launchUrl(Uri.parse(url)).ignore();
///   },
///   imageBuilder: (uri, title, alt) {
///     final String? src = sanitizeUrl('$uri', UrlContext.media);
///     final Widget altText = Text(alt ?? '');
///     return src == null
///         ? altText
///         : A2uiMediaImage(src, errorBuilder: (_, _, _) => altText);
///   },
/// );
/// ```
typedef A2uiMarkdownBuilder =
    Widget Function(
      BuildContext context,
      String markdown,
      TextStyle style,
      A2uiMarkdownUrlSanitizer sanitizeUrl,
    );

/// Renders the markdown of the basic `Text` components below it.
///
/// A Text with the `body` variant, or none, is built by [builder]. Every
/// other Text, and every Text without an [A2uiMarkdown] above it, shows its
/// text without common Markdown markers.
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
