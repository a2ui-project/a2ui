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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

const String _catId = 'https://example.com/finance.json';

void main() {
  group('RendererMessageRouter', () {
    test('routes callAgentFunction and rendererFunctionResponse and ignores '
        'other messages', () async {
      final quote = AgentFunction(
        name: 'fetchQuote',
        argumentSchema: Schema.fromMap({
          'type': 'object',
          'properties': {
            'symbol': {'type': 'string'},
          },
          'required': ['symbol'],
        }),
        returnType: A2uiReturnType.object,
        handler: (args, ctx) => <String, Object?>{
          'symbol': args['symbol'],
          'price': 175.0,
        },
      );
      final CatalogApi cat = Catalog(
        id: _catId,
        protocolVersion: A2uiProtocolVersion.v1_0,
        components: const <ComponentApi>[],
        agentFunctions: [quote],
      );
      final registry = AgentFunctionRegistry([cat]);
      final calls = RendererFunctionCalls();
      final router = RendererMessageRouter(
        agentFunctions: registry,
        rendererCalls: calls,
      );

      final callAgentMsg = <String, Object?>{
        'version': A2uiProtocolVersion.v1_0.jsonValue,
        'callAgentFunction': <String, Object?>{
          'surfaceId': 'main',
          'functionCallId': 'call-1',
          'callFunction': <String, Object?>{
            '@call': 'fetchQuote',
            'catalogId': _catId,
            'args': <String, Object?>{'symbol': 'GOOG'},
          },
        },
      };
      expect(router.handles(callAgentMsg), isTrue);
      final List<AgentToRendererMessage> out1 = await router.dispatch(
        callAgentMsg,
      );
      expect(out1, hasLength(1));
      expect(out1.single, isA<AgentFunctionResponseMessage>());
      final respMsg = out1.single as AgentFunctionResponseMessage;
      expect(respMsg.response.functionCallId, 'call-1');
      expect(respMsg.response.value, {'symbol': 'GOOG', 'price': 175.0});

      final (_, Future<Object?> fut) = calls.call(
        catalogId: _catId,
        name: 'scrollIntoView',
        functionCallId: 'rcall-1',
      );
      final rendererRespMsg = <String, Object?>{
        'version': A2uiProtocolVersion.v1_0.jsonValue,
        'rendererFunctionResponse': <String, Object?>{
          'functionCallId': 'rcall-1',
          'value': true,
        },
      };
      expect(router.handles(rendererRespMsg), isTrue);
      final List<AgentToRendererMessage> out2 = await router.dispatch(
        rendererRespMsg,
      );
      expect(out2, isEmpty);
      expect(await fut, isTrue);

      // Non-RPC messages are not handled and return empty list.
      final actionMsg = <String, Object?>{
        'version': A2uiProtocolVersion.v1_0.jsonValue,
        'action': <String, Object?>{
          'surfaceId': 'main',
          'sourceComponentId': 'btn',
        },
      };
      expect(router.handles(actionMsg), isFalse);
      expect(await router.dispatch(actionMsg), isEmpty);
      expect(router.handles('not-a-map'), isFalse);
    });

    test('throws StateError when matching handler is not configured', () async {
      const emptyRouter = RendererMessageRouter();

      await expectLater(
        () => emptyRouter.dispatch({
          'version': '1.0',
          'callAgentFunction': {
            'surfaceId': 'main',
            'functionCallId': 'c1',
            'callFunction': {'@call': 'fn', 'catalogId': _catId},
          },
        }),
        throwsStateError,
      );

      await expectLater(
        () => emptyRouter.dispatch({
          'version': '1.0',
          'rendererFunctionResponse': {'functionCallId': 'r1', 'value': null},
        }),
        throwsStateError,
      );
    });
  });
}
