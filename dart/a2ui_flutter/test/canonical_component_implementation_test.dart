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

// Deliberately does NOT import `package:json_schema_builder` (and needs no
// `hide ValidationResult`!) to verify zero-schema-library Flutter authoring.
import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'ComponentImplementation.define renders, binds reactively, and dispatches '
    'actions without importing json_schema_builder',
    (WidgetTester tester) async {
      final actions = <A2uiRendererAction>[];

      final Catalog<ComponentImplementation, FunctionImplementation> catalog =
          CatalogImplementation(
            id: 'urn:a2ui:flutter-canonical-test:v1',
            protocolVersion: A2uiProtocolVersion.v1_0,
            components: [
              ComponentImplementation.define(
                name: 'GreetingCard',
                description: 'Displays a bound greeting and an action button.',
                parameters: [
                  ParameterDefinition.string(
                    'message',
                    dynamic: true,
                    required: true,
                  ),
                  ParameterDefinition.action('onAck'),
                  ParameterDefinition.child('footer'),
                ],
                builder: (context, node, props, buildChild) {
                  final String message = props.string('message') ?? '';
                  final NodeAction? onAck = props.action('onAck');
                  final ComponentNode<ComponentImplementation>? footer = props
                      .child('footer');
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(message),
                      if (onAck != null)
                        ElevatedButton(
                          onPressed: onAck,
                          child: const Text('Acknowledge'),
                        ),
                      if (footer != null) buildChild(footer),
                    ],
                  );
                },
              ),
              ComponentImplementation.define(
                name: 'FooterNote',
                parameters: [
                  ParameterDefinition.string(
                    'text',
                    dynamic: true,
                    required: true,
                  ),
                ],
                builder: (context, node, props, buildChild) =>
                    Text(props.string('text') ?? ''),
              ),
            ],
          );

      final processor = MessageProcessor<ComponentImplementation>(
        catalogs: [catalog],
        onAction: actions.add,
      );

      processor.processMessages([
        {
          'version': '1.0',
          'createSurface': {'surfaceId': 'main', 'catalogId': catalog.id},
        },
        {
          'version': '1.0',
          'updateDataModel': {
            'surfaceId': 'main',
            'path': '/',
            'value': {'greeting': 'Hello Flutter!'},
          },
        },
        {
          'version': '1.0',
          'updateComponents': {
            'surfaceId': 'main',
            'components': [
              {
                'id': 'root',
                'component': 'GreetingCard',
                'message': {'@path': '/greeting'},
                'onAck': {
                  'event': {'name': 'ack'},
                },
                'footer': 'foot1',
              },
              {
                'id': 'foot1',
                'component': 'FooterNote',
                'text': 'Zero JSON Schema!',
              },
            ],
          },
        },
      ]);

      final SurfaceModel<ComponentImplementation> surface = processor.model
          .getSurface('main')!;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: A2uiSurface(surface: surface)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Hello Flutter!'), findsOneWidget);
      expect(find.text('Zero JSON Schema!'), findsOneWidget);

      // Reactive data update rebuilds widget.
      processor.processMessages([
        {
          'version': '1.0',
          'updateDataModel': {
            'surfaceId': 'main',
            'path': '/greeting',
            'value': 'Updated Reactively!',
          },
        },
      ]);
      await tester.pumpAndSettle();
      expect(find.text('Updated Reactively!'), findsOneWidget);

      // Action tap dispatches A2uiClientAction.
      await tester.tap(find.text('Acknowledge'));
      await tester.pumpAndSettle();
      expect(actions, hasLength(1));
      expect(actions.single.name, 'ack');
    },
  );
}
