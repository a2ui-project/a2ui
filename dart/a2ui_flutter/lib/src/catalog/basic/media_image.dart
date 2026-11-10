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

import 'dart:typed_data';

// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';

/// Shows the image at [url], a media URL the URL security policy already
/// allowed: decoded in memory for a `data:` URL, and fetched with
/// [Image.network] otherwise.
///
/// Use it in an `A2uiMarkdownBuilder` to load the image sources the
/// sanitizer returns, so an allowed `data:` image shows too:
///
/// ```dart
/// imageBuilder: (uri, title, alt) {
///   final String? src = sanitizeUrl('$uri', UrlContext.media);
///   return src == null
///       ? Text(alt ?? '')
///       : A2uiMediaImage(src, errorBuilder: (_, _, _) => Text(alt ?? ''));
/// },
/// ```
class A2uiMediaImage extends StatelessWidget {
  const A2uiMediaImage(
    this.url, {
    super.key,
    this.fit,
    this.semanticLabel,
    this.excludeFromSemantics = false,
    required this.errorBuilder,
  });

  /// The URL of the image, already checked against the URL security policy.
  final String url;

  /// How the image fills its layout box.
  final BoxFit? fit;

  /// The semantic description of the image.
  final String? semanticLabel;

  /// Whether to leave the image out of the semantics tree.
  final bool excludeFromSemantics;

  /// Builds the widget shown when the image can't be decoded or loaded,
  /// including a malformed `data:` URL.
  final ImageErrorWidgetBuilder errorBuilder;

  @override
  Widget build(BuildContext context) {
    if (!url.toLowerCase().startsWith('data:')) {
      return Image.network(
        url,
        fit: fit,
        semanticLabel: semanticLabel,
        excludeFromSemantics: excludeFromSemantics,
        errorBuilder: errorBuilder,
      );
    }
    // Decoding runs during build, so a malformed URL builds the error widget
    // here instead of throwing before Image.memory can report it.
    Uint8List? bytes;
    Object error = const FormatException('Invalid data URL');
    try {
      bytes = Uri.tryParse(url)?.data?.contentAsBytes();
    } on FormatException catch (e) {
      error = e;
    }
    if (bytes == null) return errorBuilder(context, error, null);
    return Image.memory(
      bytes,
      fit: fit,
      semanticLabel: semanticLabel,
      excludeFromSemantics: excludeFromSemantics,
      errorBuilder: errorBuilder,
    );
  }
}
