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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import 'test_catalog.dart';

void main() {
  group('FlutterComponentImplementation', () {
    test('creates implementation with name, schema, and builder', () {
      final schema = Schema.object(properties: {'title': Schema.string()});
      final impl = FlutterComponentImplementation(
        name: 'Custom',
        schema: schema,
        builder: (context, node, buildChild) => const SizedBox.shrink(),
      );

      expect(impl.name, 'Custom');
      expect(impl.schema, schema);
      expect(impl.builder, isNotNull);
    });

    test('NodePropsAccessors extracts typed values correctly', () {
      final Catalog<FlutterComponentImplementation, FunctionImplementation>
      catalog = createTestCatalog();
      final surface = SurfaceModel<FlutterComponentImplementation>(
        'test-surface',
        catalog: catalog,
      );

      final processor = MessageProcessor<FlutterComponentImplementation>(
        catalogs: [catalog],
        protocolVersion: A2uiProtocolVersion.v0_9,
      );
      processor.groupModel.addSurface(surface);

      processor.processMessages(
        AgentToRendererMessagePayload.fromJson({
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': 'test-surface',
            'components': [
              {
                'id': 'root',
                'component': 'TestContainer',
                'children': ['text-1'],
                'justify': 'center',
                'align': 'stretch',
              },
              {
                'id': 'text-1',
                'component': 'TestText',
                'text': 'Hello World',
                'variant': 'h1',
              },
            ],
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9),
      );

      final resolver = NodeResolver<FlutterComponentImplementation>(surface);
      addTearDown(resolver.dispose);

      final ComponentNode<FlutterComponentImplementation>? root =
          resolver.rootNode.value;
      expect(root, isNotNull);
      expect(root!.stringValue('justify'), 'center');
      expect(root.stringValue('align'), 'stretch');

      final List<ComponentNode<FlutterComponentImplementation>> children = root
          .childNodes('children');
      expect(children.length, 1);

      final ComponentNode<FlutterComponentImplementation> child =
          children.first;
      expect(child.stringValue('text'), 'Hello World');
      expect(child.stringValue('variant'), 'h1');
    });
  });
}
