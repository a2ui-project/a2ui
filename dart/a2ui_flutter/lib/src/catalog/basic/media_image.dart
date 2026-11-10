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

// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';

/// The image at [url], a media URL the URL security policy already allowed:
/// decoded in memory for a `data:` URL, and fetched otherwise.
///
/// [errorBuilder] builds the widget shown when the image can't be decoded or
/// loaded.
Widget mediaImage(
  String url, {
  BoxFit? fit,
  String? semanticLabel,
  bool excludeFromSemantics = false,
  required ImageErrorWidgetBuilder errorBuilder,
}) {
  if (url.length > 5 && url.substring(0, 5).toLowerCase() == 'data:') {
    final UriData? data = Uri.tryParse(url)?.data;
    if (data == null) {
      return Builder(
        builder: (context) => errorBuilder(
          context,
          const FormatException('Invalid data URL'),
          null,
        ),
      );
    }
    return Image.memory(
      data.contentAsBytes(),
      fit: fit,
      semanticLabel: semanticLabel,
      excludeFromSemantics: excludeFromSemantics,
      errorBuilder: errorBuilder,
    );
  }
  return Image.network(
    url,
    fit: fit,
    semanticLabel: semanticLabel,
    excludeFromSemantics: excludeFromSemantics,
    errorBuilder: errorBuilder,
  );
}
