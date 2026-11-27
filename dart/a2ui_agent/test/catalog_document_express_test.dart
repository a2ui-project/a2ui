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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

void main() {
  group('Catalog Document & canonical model support in a2ui_agent', () {
    final catalogDoc = <String, Object?>{
      'formatVersion': '1.0',
      'catalogId': 'urn:a2ui:agent-doc-test:v1',
      'protocolVersion': '1.0',
      'title': 'Agent Doc Test',
      'types': {
        'Weight': {'type': 'number', 'description': 'Flex grow weight.'},
      },
      'components': [
        {
          'name': 'Stack',
          'description': 'Stacks children vertically.',
          'parameters': [
            {
              'name': 'children',
              'type': 'childList',
              'required': true,
              'description': 'Child component IDs.',
            },
            {'name': 'weight', 'type': 'ref', 'ref': 'Weight'},
          ],
        },
        {
          'name': 'ActionCard',
          'description': 'Interactive card with choices.',
          'checkable': true,
          'parameters': [
            {
              'name': 'title',
              'type': 'string',
              'dynamic': true,
              'required': true,
              'description': 'Card headline.',
            },
            {
              'name': 'variant',
              'type': 'enum',
              'values': ['compact', 'expanded'],
              'default': 'compact',
              'description': 'Layout density.',
            },
            {
              'name': 'items',
              'type': 'array',
              'items': {
                'type': 'object',
                'properties': [
                  {'name': 'label', 'type': 'string', 'required': true},
                  {'name': 'value', 'type': 'string', 'required': true},
                ],
              },
            },
            {
              'name': 'onSubmit',
              'type': 'action',
              'description': 'Triggered on submit.',
            },
          ],
        },
      ],
      'functions': [
        {
          'name': 'searchCatalog',
          'description': 'Searches items on the agent.',
          'returnType': 'array',
          'parameters': [
            {'name': 'query', 'type': 'string', 'required': true},
            {'name': 'limit', 'type': 'integer', 'default': 10},
            {
              'name': 'options',
              'type': 'object',
              'properties': [
                {'name': 'fuzzy', 'type': 'boolean', 'default': true},
              ],
            },
          ],
        },
      ],
    };

    test('FileSystemCatalogProvider auto-detects Catalog Documents', () {
      final Directory tmpDir = Directory.systemTemp.createTempSync(
        'a2ui-agent-doc-',
      );
      addTearDown(() => tmpDir.deleteSync(recursive: true));
      final file = File('${tmpDir.path}/custom.catalog.json')
        ..writeAsStringSync(jsonEncode(catalogDoc));

      final provider = FileSystemCatalogProvider(file.path);
      final CatalogApi loaded = provider.load();
      expect(loaded.id, 'urn:a2ui:agent-doc-test:v1');
      expect(loaded.components.keys, containsAll(['Stack', 'ActionCard']));
      expect(loaded.functions.keys, contains('searchCatalog'));
    });

    test('ExpressPromptGenerator, ExpressCompiler, and ExpressDecompiler '
        'work end-to-end on a Catalog Document', () {
      final CatalogApi catalog = Catalog.fromJson(catalogDoc);
      final promptGen = ExpressPromptGenerator([catalog]);
      final String snippet = promptGen.generate();

      expect(snippet, contains('• ActionCard('));
      expect(snippet, contains('title'));
      expect(snippet, contains('variant? (static)'));
      expect(snippet, contains('onSubmit? (action)'));
      expect(snippet, contains('checks?'));
      expect(snippet, contains("Must be one of: 'compact', 'expanded'"));
      expect(snippet, contains('List of maps with keys:'));
      expect(snippet, contains('* label'));
      expect(snippet, contains('* value'));

      // Compile Express source against the Catalog Document.
      final compiler = ExpressCompiler([catalog]);
      final List<AgentToRendererMessage> messages = compiler.compile('''
surface("s1")
card = ActionCard("Hello", variant="expanded", onSubmit=Event("submit"))
root = Stack([card])
''');
      expect(messages, isNotEmpty);

      // Decompile back to Express.
      final decompiler = ExpressDecompiler([catalog]);
      final String express = decompiler.decompile(messages);
      expect(express, contains('ActionCard('));
      expect(express, contains('Stack('));
    });

    test(
      'AgentFunction.define applies top-level and nested defaults cleanly',
      () async {
        Map<String, dynamic>? receivedArgs;
        final catalog = Catalog<ComponentApi, FunctionApi>(
          id: 'urn:a2ui:agent-fn-defaults:v1',
          protocolVersion: A2uiProtocolVersion.v1_0,
          types: const {'PageSize': IntegerType(defaultValue: 25)},
          components: [
            ComponentApi.define(
              name: 'Box',
              parameters: [ParameterDefinition.string('label')],
            ),
          ],
          functions: [
            AgentFunction.define(
              name: 'search',
              returnType: A2uiReturnType.array,
              parameters: [
                ParameterDefinition.string('query', required: true),
                ParameterDefinition.ref('pageSize', ref: 'PageSize'),
                ParameterDefinition.object(
                  'filters',
                  properties: [
                    ParameterDefinition.boolean(
                      'activeOnly',
                      defaultValue: true,
                    ),
                  ],
                ),
              ],
              handler: (Map<String, dynamic> args, _) {
                receivedArgs = args;
                return <String>['item-1'];
              },
            ),
          ],
        );

        final processor = RendererToAgentMessageProcessor(catalogs: [catalog]);

        final ProcessResult result = await processor.processMessage({
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 's1',
            'functionCallId': 'call-1',
            'callFunction': {
              '@call': 'search',
              'catalogId': catalog.id,
              'args': {
                'query': 'widgets',
                'filters': const <String, Object?>{},
              },
            },
          },
        });

        expect(receivedArgs, isNotNull);
        expect(receivedArgs!['query'], 'widgets');
        expect(receivedArgs!['pageSize'], 25);
        expect(
          (receivedArgs!['filters']! as Map<String, Object?>)['activeOnly'],
          isTrue,
        );
        expect(result.handled, isTrue);
        expect(result.replies, hasLength(1));
      },
    );

    test('ExpressPromptGenerator preserves canonical ObjectType with path key '
        'instead of misclassifying as wire envelope', () {
      final catalog = Catalog<ComponentApi, FunctionApi>(
        id: 'urn:a2ui:canonical-path-prop:v1',
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: [
          ComponentApi.define(
            name: 'NavItem',
            parameters: [
              ParameterDefinition.object(
                'destination',
                required: true,
                properties: [
                  ParameterDefinition.string('path', required: true),
                ],
              ),
            ],
          ),
        ],
      );
      final promptGen = ExpressPromptGenerator([catalog]);
      final String snippet = promptGen.generate();
      expect(snippet, contains('NavItem('));
      expect(snippet, contains('Map with keys:'));
      expect(snippet, contains('* path'));
    });

    test(
      'AgentFunction.define handles 0-param canonical functions and multi-hop '
      'RefType default chains',
      () async {
        Map<String, dynamic>? receivedArgs;
        var zeroCalled = false;
        final catalog = Catalog<ComponentApi, FunctionApi>(
          id: 'urn:a2ui:agent-fn-multihop:v1',
          protocolVersion: A2uiProtocolVersion.v1_0,
          types: const {
            'BaseLimit': IntegerType(defaultValue: 10),
            'DefaultLimit': RefType(ref: 'BaseLimit', defaultValue: 5),
          },
          components: const [],
          functions: [
            AgentFunction.define(
              name: 'ping',
              returnType: A2uiReturnType.string,
              handler: (args, _) {
                zeroCalled = true;
                return 'pong';
              },
            ),
            AgentFunction.define(
              name: 'listItems',
              returnType: A2uiReturnType.array,
              parameters: [
                ParameterDefinition.ref('limit', ref: 'DefaultLimit'),
              ],
              handler: (args, _) {
                receivedArgs = args;
                return const <Object?>[];
              },
            ),
          ],
        );

        final processor = RendererToAgentMessageProcessor(catalogs: [catalog]);
        final ProcessResult pingRes = await processor.processMessage({
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 's1',
            'functionCallId': 'call-ping',
            'callFunction': {'@call': 'ping', 'catalogId': catalog.id},
          },
        });
        expect(pingRes.handled, isTrue);
        expect(zeroCalled, isTrue);

        final ProcessResult listRes = await processor.processMessage({
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 's1',
            'functionCallId': 'call-list',
            'callFunction': {
              '@call': 'listItems',
              'catalogId': catalog.id,
              'args': const <String, Object?>{},
            },
          },
        });
        expect(listRes.handled, isTrue);
        expect(receivedArgs, isNotNull);
        expect(receivedArgs!['limit'], 5);
      },
    );
  });
}
