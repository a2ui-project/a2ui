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

CrossAxisAlignment _parseCrossAxisAlignment(String? alignment) =>
    switch (alignment) {
      'center' => CrossAxisAlignment.center,
      'end' => CrossAxisAlignment.end,
      'stretch' => CrossAxisAlignment.stretch,
      'start' || _ => CrossAxisAlignment.start,
    };

/// The basic catalog `List` component implementation.
final flutterListImplementation = FlutterComponentImplementation(
  name: 'List',
  schema: Schema.object(
    properties: {
      'children': CommonSchemas.childList,
      'direction': Schema.string(enumValues: ['vertical', 'horizontal']),
      'align': Schema.string(enumValues: ['start', 'center', 'end', 'stretch']),
    },
    required: ['children'],
  ),
  builder: (context, node, buildChild) {
    final List<ComponentNode<FlutterComponentImplementation>> children = node
        .childNodes('children');
    final String? direction = node.stringValue('direction');
    final String? align = node.stringValue('align');

    if (direction == 'horizontal') {
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: _parseCrossAxisAlignment(align),
          children: [for (final child in children) buildChild(child)],
        ),
      );
    }

    return ListView.builder(
      shrinkWrap: true,
      physics: const ClampingScrollPhysics(),
      itemCount: children.length,
      itemBuilder: (context, index) => buildChild(children[index]),
    );
  },
);
