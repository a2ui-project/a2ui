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

/// Builds the basic `Image` component: the image at an `http` or `https`
/// `url`, sized by `variant`, resized by `fit` (`cover` for a header without
/// one) and labelled for accessibility by `description`. Any other URL, and
/// an image that fails to load, shows a broken-image icon.
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
  const Widget broken = Icon(Icons.broken_image);
  final Widget image = url.startsWith('http://') || url.startsWith('https://')
      ? Image.network(
          url,
          fit:
              BoxFit.values.asNameMap()[props.string('fit')] ??
              (variant == 'header' ? BoxFit.cover : BoxFit.fill),
          semanticLabel: description,
          excludeFromSemantics: description.isEmpty,
          errorBuilder: (context, error, stackTrace) => broken,
        )
      : broken;
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
