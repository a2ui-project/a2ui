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

import 'dart:async';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

const String _catId = 'https://example.com/finance.json';

final class _ScrollImpl extends FunctionImplementation {
  final List<Map<String, dynamic>> seenCalls = <Map<String, dynamic>>[];

  _ScrollImpl()
    : super(
        name: 'scrollIntoView',
        returnType: A2uiReturnType.boolean,
        allowedCallers: AllowedCallers.rendererOrAgent,
        argumentSchema: Schema.fromMap({
          'type': 'object',
          'properties': {
            'elementId': {'type': 'string'},
          },
          'required': ['elementId'],
        }),
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    seenCalls.add(args);
    return true;
  }
}

void main() {
  group('End-to-end Agent Function & Renderer Function RPC', () {
    test('round-trips callAgentFunction and callRendererFunction between '
        'MessageProcessor and RendererMessageRouter', () async {
      final quote = AgentFunction(
        name: 'fetchQuote',
        returnType: A2uiReturnType.string,
        argumentSchema: Schema.fromMap({
          'type': 'object',
          'properties': {
            'symbol': {'type': 'string'},
          },
          'required': ['symbol'],
        }),
        handler: (args, ctx) => '${args['symbol']}: \$175.00',
      );
      final scrollImpl = _ScrollImpl();

      // Agent catalog holds both the AgentFunction and the schema for
      // scrollIntoView.
      final CatalogApi agentCatalog = Catalog(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: [
          ComponentApi(
            name: 'Text',
            schema: Schema.fromMap({
              'type': 'object',
              'properties': {
                'text': {r'$ref': r'common_types.json#/$defs/DynamicString'},
              },
              'required': ['text'],
            }),
          ),
        ],
        functions: [scrollImpl],
        agentFunctions: [quote],
      );

      // Renderer catalog implements only scrollIntoView; fetchQuote is
      // unimplemented locally so the renderer forwards it via
      // callAgentFunction.
      final rendererCatalog = Catalog<ComponentApi, FunctionImplementation>(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: agentCatalog.components.values.toList(),
        functions: [scrollImpl],
      );

      final registry = AgentFunctionRegistry([agentCatalog]);
      final rendererCalls = RendererFunctionCalls();
      final router = RendererMessageRouter(
        agentFunctions: registry,
        rendererCalls: rendererCalls,
      );

      late MessageProcessor rendererProcessor;
      rendererProcessor = MessageProcessor(
        catalogs: [rendererCatalog],
        outboundListener: (RendererToAgentMessage outbound) async {
          if (router.handles(outbound)) {
            final List<AgentToRendererMessage> replies = await router.dispatch(
              outbound,
            );
            if (replies.isNotEmpty) {
              rendererProcessor.processMessages(replies);
            }
          }
        },
      );

      final outboundPayload = <Map<String, Object?>>[
        {
          'version': A2uiProtocolVersion.v1_0.jsonValue,
          'createSurface': {'surfaceId': 'main', 'catalogId': _catId},
        },
        {
          'version': A2uiProtocolVersion.v1_0.jsonValue,
          'updateComponents': {
            'surfaceId': 'main',
            'components': [
              {
                'id': 'root',
                'component': 'Text',
                'text': {
                  '@call': 'fetchQuote',
                  'args': {'symbol': 'GOOG'},
                },
              },
            ],
          },
        },
      ];

      // 1. Agent-side strict payload validation succeeds.
      MessageProcessor.forAgent(
        catalogs: [agentCatalog],
        validationConfig: ValidationConfig.strict,
      ).processMessages(outboundPayload);

      // 2. Renderer processes payload, triggers callAgentFunction on the
      // binding, receives agentFunctionResponse, and updates the resolved node.
      rendererProcessor.processMessages(outboundPayload);
      final SurfaceModel<ComponentApi> surface = rendererProcessor.model
          .getSurface('main')!;
      final NodeResolver<ComponentApi> resolver = NodeResolver(surface);
      final ComponentNode rootNode = resolver.rootNode.value!;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      final textBinding =
          rootNode.props.value['text']! as ResolvedBinding<Object?>;
      expect(textBinding.value, 'GOOG: \$175.00');
      resolver.dispose();

      // 3. Agent initiates callRendererFunction -> renderer executes
      // scrollIntoView -> router resolves Future.
      final (
        CallRendererFunctionMessage callMsg,
        Future<Object?> resultFut,
      ) = rendererCalls.call(
        catalogId: _catId,
        name: 'scrollIntoView',
        args: const {'elementId': 'row-42'},
        surfaceId: 'main',
        functionCallId: 'rcall-e2e',
      );
      await rendererProcessor.processMessagesAsync([callMsg]);
      expect(await resultFut, isTrue);
      expect(scrollImpl.seenCalls, [
        {'elementId': 'row-42'},
      ]);
    });
  });
}
