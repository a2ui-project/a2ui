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
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/widgets.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

const String testCatalogId = 'https://a2ui.org/test/catalog.json';

/// Simple test component that renders text.
final testTextImplementation = FlutterComponentImplementation(
  name: 'TestText',
  schema: Schema.object(
    properties: {
      'text': CommonSchemas.dynamicString,
      'variant': Schema.string(),
    },
    required: ['text'],
  ),
  builder: (context, node, buildChild) {
    final String text = node.stringValue('text') ?? '';
    return Text(text);
  },
);

/// Simple test container that renders child components vertically.
final testContainerImplementation = FlutterComponentImplementation(
  name: 'TestContainer',
  schema: Schema.object(
    properties: {
      'children': CommonSchemas.childList,
      'child': CommonSchemas.componentId,
      'justify': Schema.string(),
      'align': Schema.string(),
    },
  ),
  builder: (context, node, buildChild) {
    final List<ComponentNode<FlutterComponentImplementation>> children = node
        .childNodes('children');
    final ComponentNode<FlutterComponentImplementation>? child = node.childNode(
      'child',
    );

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (child != null) buildChild(child),
        for (final c in children) buildChild(c),
      ],
    );
  },
);

/// Creates a test catalog for verifying the framework adapter core.
Catalog<FlutterComponentImplementation, FunctionImplementation>
createTestCatalog({
  List<FlutterComponentImplementation> components = const [],
}) {
  return Catalog<FlutterComponentImplementation, FunctionImplementation>(
    id: testCatalogId,
    components: [
      testTextImplementation,
      testContainerImplementation,
      ...components,
    ],
    functions: const [],
  );
}
