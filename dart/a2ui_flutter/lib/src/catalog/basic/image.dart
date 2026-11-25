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

import 'package:a2ui_core/a2ui_core.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';

/// Builds the basic `Image` component: the image at an `http` or `https`
/// `url`, or inline in a `data:` URL of an `image/*` type, sized by
/// `variant`, resized by `fit` (`cover` for a header without one) and
/// labelled for accessibility by `description`. Any other URL, and an image
/// that fails to load or decode, shows a broken-image icon labelled by the
/// same `description`.
Widget buildImage(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final String url = props.string('url') ?? '';
  if (url.isEmpty) return const SizedBox.shrink();
  final String description = props.string('description') ?? '';
  final String? variant = props.string('variant');
  // The description still says what the image was meant to show when it does
  // not load, as an `alt` text does on the web, so the icon carries it.
  final Widget broken = description.isEmpty
      ? const Icon(Icons.broken_image)
      : Semantics(
          image: true,
          label: description,
          child: const Icon(Icons.broken_image),
        );
  final ImageProvider? provider =
      url.startsWith('http://') || url.startsWith('https://')
      ? NetworkImage(url)
      : _DataUrlImage.tryParse(url);
  final Widget image = provider == null
      ? broken
      : Image(
          image: provider,
          fit:
              BoxFit.values.asNameMap()[props.string('fit')] ??
              (variant == 'header' ? BoxFit.cover : BoxFit.fill),
          semanticLabel: description,
          excludeFromSemantics: description.isEmpty,
          errorBuilder: (context, error, stackTrace) => broken,
        );
  return switch (variant) {
    'icon' => _atStart(SizedBox.square(dimension: 24, child: image)),
    'avatar' => _atStart(
      SizedBox.square(dimension: 40, child: ClipOval(child: image)),
    ),
    'smallFeature' => _atStart(
      ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 100),
        child: image,
      ),
    ),
    'largeFeature' => ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 400),
      child: image,
    ),
    'header' => SizedBox(height: 200, child: image),
    _ => image,
  };
}

/// Keeps [child]'s own size, at the start, inside tight constraints.
Widget _atStart(Widget child) => Align(
  alignment: AlignmentDirectional.topStart,
  widthFactor: 1,
  heightFactor: 1,
  child: child,
);

/// The image inline in a `data:` URL.
///
/// Two are equal when their URLs are, unlike [MemoryImage], so a rebuild with
/// the same URL finds the decoded image in the image cache.
class _DataUrlImage extends MemoryImage {
  _DataUrlImage._(this._url, super.bytes);

  /// The image in [url], or null when [url] is not a valid `data:` URL of an
  /// `image/*` type.
  static _DataUrlImage? tryParse(String url) {
    final UriData? data = Uri.tryParse(url)?.data;
    if (data == null || !data.mimeType.toLowerCase().startsWith('image/')) {
      return null;
    }
    final Uint8List bytes;
    try {
      bytes = data.contentAsBytes();
    } on FormatException {
      return null;
    }
    return _DataUrlImage._(url, bytes);
  }

  final String _url;

  @override
  bool operator ==(Object other) =>
      other is _DataUrlImage && other._url == _url && other.scale == scale;

  @override
  int get hashCode => Object.hash(_url, scale);
}
