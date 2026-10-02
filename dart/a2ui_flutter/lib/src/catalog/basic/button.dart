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

/// The basic catalog `Button` component implementation.
final flutterButtonImplementation = FlutterComponentImplementation(
  name: 'Button',
  schema: Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'child': CommonSchemas.componentId,
          'variant': Schema.string(enumValues: ['primary', 'borderless']),
          'action': CommonSchemas.action,
        },
        required: ['child', 'action'],
      ),
    ],
  ),
  builder: (context, node, buildChild) {
    final ComponentNode<FlutterComponentImplementation>? childNode = node
        .childNode('child');
    final Future<void> Function()? action = node.action('action');
    final String? variant = node.stringValue('variant');

    final Widget childWidget = childNode != null
        ? buildChild(childNode)
        : const SizedBox.shrink();

    if (variant == 'borderless') {
      return TextButton(onPressed: action, child: childWidget);
    }

    return ElevatedButton(onPressed: action, child: childWidget);
  },
);
