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
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../binding/node_props_accessors.dart';
import '../component_implementation.dart';

/// The basic catalog `Image` component implementation.
final flutterImageImplementation = FlutterComponentImplementation(
  name: 'Image',
  schema: Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'url': CommonSchemas.dynamicString,
          'description': CommonSchemas.dynamicString,
          'fit': Schema.string(
            enumValues: ['contain', 'cover', 'fill', 'none', 'scaleDown'],
          ),
          'variant': Schema.string(
            enumValues: [
              'icon',
              'avatar',
              'smallFeature',
              'mediumFeature',
              'largeFeature',
              'header',
            ],
          ),
        },
        required: ['url'],
      ),
    ],
  ),
  builder: (context, node, buildChild) {
    final String url = node.stringValue('url') ?? '';
    final String? description = node.stringValue('description');
    final String? fitStr = node.stringValue('fit');
    final String? variant = node.stringValue('variant');

    final BoxFit fit = switch (fitStr) {
      'contain' => BoxFit.contain,
      'cover' => BoxFit.cover,
      'fill' => BoxFit.fill,
      'none' => BoxFit.none,
      'scaleDown' => BoxFit.scaleDown,
      _ => BoxFit.contain,
    };

    final (double? width, double? height) = switch (variant) {
      'icon' => (24.0, 24.0),
      'avatar' => (48.0, 48.0),
      'smallFeature' => (120.0, 120.0),
      'mediumFeature' => (240.0, 180.0),
      'largeFeature' => (360.0, 240.0),
      'header' => (double.infinity, 200.0),
      _ => (null, null),
    };

    if (url.isEmpty) {
      return Container(
        width: width ?? 100,
        height: height ?? 100,
        color: Colors.grey.shade200,
        child: const Icon(Icons.broken_image, color: Colors.grey),
      );
    }

    Widget imageWidget = Image.network(
      url,
      fit: fit,
      width: width,
      height: height,
      semanticLabel: description,
      errorBuilder: (context, error, stackTrace) => Container(
        width: width ?? 100,
        height: height ?? 100,
        color: Colors.grey.shade200,
        child: const Icon(Icons.broken_image, color: Colors.grey),
      ),
    );

    if (variant == 'avatar') {
      imageWidget = ClipOval(child: imageWidget);
    } else {
      imageWidget = ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: imageWidget,
      );
    }

    return imageWidget;
  },
);
