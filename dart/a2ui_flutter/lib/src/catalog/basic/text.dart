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

/// The basic catalog `Text` component implementation.
final flutterTextImplementation = FlutterComponentImplementation(
  name: 'Text',
  schema: Schema.object(
    properties: {
      'text': CommonSchemas.dynamicString,
      'variant': Schema.string(
        enumValues: ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'],
      ),
    },
    required: ['text'],
  ),
  builder: (context, node, buildChild) {
    final String text = node.stringValue('text') ?? '';
    final String? variant = node.stringValue('variant');

    final TextTheme textTheme = Theme.of(context).textTheme;
    final TextStyle? style = switch (variant) {
      'h1' => textTheme.headlineLarge,
      'h2' => textTheme.headlineMedium,
      'h3' => textTheme.headlineSmall,
      'h4' => textTheme.titleLarge,
      'h5' => textTheme.titleMedium,
      'caption' => textTheme.bodySmall,
      'body' || _ => textTheme.bodyMedium,
    };

    return Text(text, style: style);
  },
);
