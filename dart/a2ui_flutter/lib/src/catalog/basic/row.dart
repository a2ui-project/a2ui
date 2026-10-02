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
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../binding/node_props_accessors.dart';
import '../component_implementation.dart';

MainAxisAlignment _parseMainAxisAlignment(String? alignment) =>
    switch (alignment) {
      'center' => MainAxisAlignment.center,
      'end' => MainAxisAlignment.end,
      'spaceBetween' => MainAxisAlignment.spaceBetween,
      'spaceAround' => MainAxisAlignment.spaceAround,
      'spaceEvenly' => MainAxisAlignment.spaceEvenly,
      'start' || _ => MainAxisAlignment.start,
    };

CrossAxisAlignment _parseCrossAxisAlignment(String? alignment) =>
    switch (alignment) {
      'center' => CrossAxisAlignment.center,
      'end' => CrossAxisAlignment.end,
      'stretch' => CrossAxisAlignment.stretch,
      'start' || _ => CrossAxisAlignment.start,
    };

/// The basic catalog `Row` component implementation.
final flutterRowImplementation = FlutterComponentImplementation(
  name: 'Row',
  schema: Schema.object(
    properties: {
      'children': CommonSchemas.childList,
      'justify': Schema.string(
        enumValues: [
          'center',
          'end',
          'spaceAround',
          'spaceBetween',
          'spaceEvenly',
          'start',
          'stretch',
        ],
      ),
      'align': Schema.string(enumValues: ['start', 'center', 'end', 'stretch']),
    },
    required: ['children'],
  ),
  builder: (context, node, buildChild) {
    final List<ComponentNode<FlutterComponentImplementation>> children = node
        .childNodes('children');
    final String? justify = node.stringValue('justify');
    final String? align = node.stringValue('align');

    return Row(
      mainAxisAlignment: _parseMainAxisAlignment(justify),
      crossAxisAlignment: _parseCrossAxisAlignment(align),
      mainAxisSize: MainAxisSize.min,
      children: [for (final child in children) buildChild(child)],
    );
  },
);
