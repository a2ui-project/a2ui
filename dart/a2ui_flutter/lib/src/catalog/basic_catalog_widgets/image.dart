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

import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../primitives/logging.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';

Schema _schema() {
  final Map<String, Schema> properties = {
    'url': A2uiSchemas.stringReference(
      description:
          'Asset path (e.g. assets/...) or network URL (e.g. https://...)',
    ),
    'fit': S.string(
      description: 'How the image should be inscribed into the box.',
      enumValues: BoxFit.values.map((e) => e.name).toList(),
    ),
  };
  properties['variant'] = S.string(
    description: '''A hint for the image size and style. One of:
      - icon: Small square icon.
      - avatar: Circular avatar image.
      - smallFeature: Small feature image.
      - mediumFeature: Medium feature image.
      - largeFeature: Large feature image.
      - header: Full-width, full bleed, header image.''',
    enumValues: [
      'icon',
      'avatar',
      'smallFeature',
      'mediumFeature',
      'largeFeature',
      'header',
    ],
  );
  return S.object(
    description:
        'A UI element for displaying image data from a URL or asset path.',
    properties: properties,
  );
}

extension type _ImageData.fromMap(JsonMap _json) {
  factory _ImageData({required JsonMap url, String? fit, String? variant}) =>
      _ImageData.fromMap({'url': url, 'fit': fit, 'variant': variant});

  Object get url => _json['url'] as Object;
  BoxFit? get fit => _json['fit'] != null
      ? BoxFit.values.firstWhere((e) => e.name == _json['fit'] as String)
      : null;
  String? get variant => _json['variant'] as String?;
}

/// A UI element for displaying image data from a URL or other source.
/// The image source is specified by the `url` parameter, which can be a network
/// URL (e.g., `https://...`) or a local asset path (e.g., `assets/...`).
///
/// ## Parameters:
///
/// - `url`: The URL of the image to display. Can be a network URL or a local
///   asset path.
/// - `fit`: How the image should be inscribed into the box. See [BoxFit] for
///   possible values.
/// - `variant`: A usage hint for the image size and style. One of 'icon',
///   'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'.
final CatalogItem image = CatalogItem(
  name: 'Image',
  dataSchema: _schema(),
  exampleData: [
    () => '''
    [
      {
        "id": "root",
        "component": "Image",
        "url": {
          "path": "/imageUrl"
        },
        "variant": "mediumFeature"
      }
    ]
  ''',
  ],
  widgetBuilder: (itemContext) {
    final imageData = _ImageData.fromMap(itemContext.data as JsonMap);

    return BoundString(
      dataContext: itemContext.dataContext,
      value: imageData.url,
      builder: (context, value) {
        if (value == null || value.isEmpty) {
          genUiLogger.warning(
            'Image widget created with no URL at path: '
            '${itemContext.dataContext.path}',
          );
          return const SizedBox.shrink();
        }

        Widget child;
        if (value.startsWith('http')) {
          child = Image.network(
            value,
            fit: imageData.fit,
            frameBuilder:
                (
                  BuildContext context,
                  Widget child,
                  int? frame,
                  bool wasSynchronouslyLoaded,
                ) {
                  if (wasSynchronouslyLoaded) {
                    return child;
                  }
                  return AnimatedOpacity(
                    opacity: frame == null ? 0 : 1,
                    duration: const Duration(seconds: 1),
                    curve: Curves.easeOut,
                    child: child,
                  );
                },
            loadingBuilder:
                (
                  BuildContext context,
                  Widget child,
                  ImageChunkEvent? loadingProgress,
                ) {
                  if (loadingProgress == null) {
                    return child;
                  }
                  return Center(
                    child: CircularProgressIndicator(
                      value: loadingProgress.expectedTotalBytes != null
                          ? loadingProgress.cumulativeBytesLoaded /
                                loadingProgress.expectedTotalBytes!
                          : null,
                    ),
                  );
                },
            errorBuilder:
                (BuildContext context, Object error, StackTrace? stackTrace) {
                  return const Icon(Icons.broken_image);
                },
          );
        } else {
          child = Image.asset(
            value,
            fit: imageData.fit,
            frameBuilder:
                (
                  BuildContext context,
                  Widget child,
                  int? frame,
                  bool wasSynchronouslyLoaded,
                ) {
                  if (wasSynchronouslyLoaded) {
                    return child;
                  }
                  return AnimatedOpacity(
                    opacity: frame == null ? 0 : 1,
                    duration: const Duration(seconds: 1),
                    curve: Curves.easeOut,
                    child: child,
                  );
                },
            errorBuilder:
                (BuildContext context, Object error, StackTrace? stackTrace) {
                  return const Icon(Icons.broken_image);
                },
          );
        }

        if (imageData.variant == 'avatar') {
          child = CircleAvatar(child: child);
        }

        if (imageData.variant == 'header') {
          return SizedBox(width: double.infinity, child: child);
        }

        final double size = switch (imageData.variant) {
          'icon' || 'avatar' => 32.0,
          'smallFeature' => 50.0,
          'mediumFeature' => 150.0,
          'largeFeature' => 400.0,
          _ => 150.0,
        };

        return SizedBox(width: size, height: size, child: child);
      },
    );
  },
);
