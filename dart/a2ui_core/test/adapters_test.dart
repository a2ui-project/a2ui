// Copyright 2026 Google LLC
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
import 'package:test/test.dart';

Matcher _validationError(Pattern message) => throwsA(
      isA<A2uiValidationError>().having(
        (e) => e.message,
        'message',
        contains(message),
      ),
    );

void main() {
  group('V0_9Adapter', () {
    const adapter = V0_9Adapter();

    test('serves v0.9 and v0.9.1', () {
      expect(adapter.version, A2uiProtocolVersion.v0_9);
      expect(adapter.versions, {
        A2uiProtocolVersion.v0_9,
        A2uiProtocolVersion.v0_9_1,
      });
    });

    test('maps createSurface, keeping the theme', () {
      final List<InternalOperation> ops = adapter.toOperations({
        'version': 'v0.9',
        'createSurface': {
          'surfaceId': 's1',
          'catalogId': 'cat',
          'theme': {'primaryColor': '#FF0000'},
          'sendDataModel': true,
        },
      });
      final op = ops.single as CreateSurfaceOp;
      expect(op.version, A2uiProtocolVersion.v0_9);
      expect(op.messageType, 'createSurface');
      expect(op.surfaceId, 's1');
      expect(op.catalogId, 'cat');
      expect(op.theme, {'primaryColor': '#FF0000'});
      expect(op.sendDataModel, isTrue);
      expect(op.components, isNull);
      expect(op.dataModel, isNull);
      expect(op.metadata, isNull);
    });

    test('maps updateComponents, updateDataModel and deleteSurface', () {
      final updateComponents = adapter.toOperations({
        'version': 'v0.9',
        'updateComponents': {
          'surfaceId': 's1',
          'components': [
            {'id': 'root', 'component': 'Text', 'text': 'Hi'},
          ],
        },
      }).single as UpdateComponentsOp;
      expect(updateComponents.surfaceId, 's1');
      expect(updateComponents.components, [
        {'id': 'root', 'component': 'Text', 'text': 'Hi'},
      ]);

      final updateDataModel = adapter.toOperations({
        'version': 'v0.9',
        'updateDataModel': {'surfaceId': 's1', 'path': '/a', 'value': 1},
      }).single as UpdateDataModelOp;
      expect(updateDataModel.path, '/a');
      expect(updateDataModel.value, 1);

      final deleteSurface = adapter.toOperations({
        'version': 'v0.9',
        'deleteSurface': {'surfaceId': 's1'},
      }).single as DeleteSurfaceOp;
      expect(deleteSurface.surfaceId, 's1');
    });

    test('records v0.9.1 on operations from v0.9.1 messages', () {
      final List<InternalOperation> ops = adapter.toOperations({
        'version': 'v0.9.1',
        'deleteSurface': {'surfaceId': 's1'},
      });
      expect(ops.single.version, A2uiProtocolVersion.v0_9_1);
    });

    test('rejects a v1.0 envelope', () {
      expect(
        () => adapter.toOperations({
          'version': 'v1.0',
          'deleteSurface': {'surfaceId': 's1'},
        }),
        _validationError('Invalid v0.9 message'),
      );
    });

    test('rejects the v1.0 function-call actions', () {
      expect(
        () => adapter.toOperations({
          'version': 'v0.9',
          'callRendererFunction': {
            'functionCallId': 'f1',
            'callFunction': {'@call': 'now', 'catalogId': 'cat'},
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => adapter.operationsFor(
          CallRendererFunctionMessage(
            version: 'v0.9',
            functionCallId: 'f1',
            callFunction: {'@call': 'now', 'catalogId': 'cat'},
          ),
        ),
        _validationError("'callRendererFunction' is not defined"),
      );
      expect(
        () => adapter.operationsFor(
          AgentFunctionResponseMessage(
            version: 'v0.9',
            response: const A2uiFunctionResponse.value('f1', 1),
          ),
        ),
        _validationError("'agentFunctionResponse' is not defined"),
      );
    });

    test('rejects the v0.8 beginRendering action', () {
      expect(
        () => adapter.toOperations({
          'version': 'v0.9',
          'beginRendering': {'surfaceId': 's1', 'root': 'root'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('serializes outbound v0.9 messages and rejects v1.0 ones', () {
      final action = ActionMessage(
        version: 'v0.9',
        action: A2uiClientAction(
          name: 'go',
          surfaceId: 's1',
          sourceComponentId: 'b1',
          timestamp: DateTime.utc(2026),
          context: const {},
        ),
      );
      expect(adapter.fromRendererMessage(action), action.toJson());
      expect(
        () => adapter.fromRendererMessage(
          CallAgentFunctionMessage(
            version: 'v0.9',
            surfaceId: 's1',
            functionCallId: 'f1',
            callFunction: {'@call': 'lookup'},
          ),
        ),
        _validationError("'callAgentFunction' is not defined"),
      );
    });
  });

  group('V1_0Adapter', () {
    const adapter = V1_0Adapter();

    test('maps an inline createSurface', () {
      final op = adapter.toOperations({
        'version': 'v1.0',
        'createSurface': {
          'surfaceId': 's1',
          'sendDataModel': true,
          'components': [
            {'id': 'root', 'component': 'Column'},
          ],
          'dataModel': {'key': 'value'},
          'metadata': {
            'extensions': {'tracking': true},
          },
        },
      }).single as CreateSurfaceOp;
      expect(op.version, A2uiProtocolVersion.v1_0);
      expect(op.catalogId, isNull);
      expect(op.theme, isNull);
      expect(op.sendDataModel, isTrue);
      expect(op.components, [
        {'id': 'root', 'component': 'Column'},
      ]);
      expect(op.dataModel, {'key': 'value'});
      expect(op.metadata, {
        'extensions': {'tracking': true},
      });
    });

    test('maps updateComponents, updateDataModel and deleteSurface', () {
      expect(
        adapter.toOperations({
          'version': 'v1.0',
          'updateComponents': {
            'surfaceId': 's1',
            'components': [
              {'id': 'c1', 'component': 'Text'},
            ],
          },
        }).single,
        isA<UpdateComponentsOp>().having((o) => o.surfaceId, 'surfaceId', 's1'),
      );
      final deletion = adapter.toOperations({
        'version': 'v1.0',
        'updateDataModel': {'surfaceId': 's1', 'path': '/a', 'value': null},
      }).single as UpdateDataModelOp;
      expect(deletion.path, '/a');
      expect(deletion.value, isNull);
      expect(
        adapter.toOperations({
          'version': 'v1.0',
          'deleteSurface': {'surfaceId': 's1'},
        }).single,
        isA<DeleteSurfaceOp>(),
      );
    });

    test('maps the function-call messages', () {
      final call = adapter.toOperations({
        'version': 'v1.0',
        'callRendererFunction': {
          'functionCallId': 'f1',
          'callFunction': {'@call': 'now', 'catalogId': 'cat'},
        },
      }).single as CallRendererFunctionOp;
      expect(call.functionCallId, 'f1');
      expect(call.callFunction, {'@call': 'now', 'catalogId': 'cat'});

      final response = adapter.toOperations({
        'version': 'v1.0',
        'agentFunctionResponse': {'functionCallId': 'f1', 'value': 42},
      }).single as AgentFunctionResponseOp;
      expect(response.response.functionCallId, 'f1');
      expect(response.response.value, 42);
    });

    test('rejects v0.9 envelopes and the v0.9 theme', () {
      expect(
        () => adapter.toOperations({
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's1'},
        }),
        _validationError('Invalid v1.0 message'),
      );
      expect(
        () => adapter.toOperations({
          'version': 'v1.0',
          'createSurface': {
            'surfaceId': 's1',
            'theme': {'primaryColor': '#FF0000'},
          },
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects the v0.8 beginRendering action', () {
      expect(
        () => adapter.toOperations({
          'version': 'v1.0',
          'beginRendering': {'surfaceId': 's1', 'root': 'root'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('serializes outbound v1.0 messages', () {
      final call = CallAgentFunctionMessage(
        version: 'v1.0',
        surfaceId: 's1',
        functionCallId: 'f1',
        callFunction: {
          '@call': 'lookup',
          'args': {'q': 'x'},
        },
      );
      expect(adapter.fromRendererMessage(call), call.toJson());
    });
  });

  group('VersionAdapterRegistry', () {
    test('standard routes each version to its adapter', () {
      final registry = VersionAdapterRegistry.standard();
      expect(
        registry.resolve({'version': 'v0.9'}),
        isA<V0_9Adapter>(),
      );
      expect(
        registry.resolve({'version': 'v0.9.1'}),
        isA<V0_9Adapter>(),
      );
      expect(registry.resolve({'version': 'v1.0'}), isA<V1_0Adapter>());
      expect(
        registry.supportedVersions,
        unorderedEquals(A2uiProtocolVersion.values),
      );
    });

    test('rejects a missing or unknown version', () {
      final registry = VersionAdapterRegistry.standard();
      expect(
        () => registry.resolve({
          'deleteSurface': {'surfaceId': 's1'},
        }),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(
        () => registry.resolve({'version': 'v9.9'}),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects a version no registered adapter serves', () {
      final registry = VersionAdapterRegistry(const [V1_0Adapter()]);
      expect(
        () => registry.resolve({'version': 'v0.9'}),
        _validationError("Unsupported protocol version 'v0.9'"),
      );
    });

    test('rejects two adapters serving one version', () {
      expect(
        () => VersionAdapterRegistry(const [V0_9Adapter(), V0_9Adapter()]),
        throwsArgumentError,
      );
    });

    test('a custom registry is honored by MessageProcessor', () {
      final adapter = _RenamingAdapter();
      final processor = MessageProcessor<ComponentApi>(
        catalogs: [MinimalCatalog()],
        adapterRegistry: VersionAdapterRegistry([adapter]),
      );
      processor.processMessages({
        'version': 'v0.9',
        'createSurface': {'surfaceId': 's1', 'catalogId': MinimalCatalog().id},
      });
      expect(adapter.calls, 1);
      expect(processor.groupModel.getSurface('s1'), isNull);
      expect(processor.groupModel.getSurface('renamed-s1'), isNotNull);
    });
  });
}

/// Serves v0.9 like [V0_9Adapter], prefixing every surface id it creates.
class _RenamingAdapter extends V0_9Adapter {
  int calls = 0;

  @override
  List<InternalOperation> operationsFor(AgentToRendererMessage message) {
    calls++;
    return [
      for (final InternalOperation op in super.operationsFor(message))
        if (op is CreateSurfaceOp)
          CreateSurfaceOp(
            version: op.version,
            surfaceId: 'renamed-${op.surfaceId}',
            catalogId: op.catalogId,
          )
        else
          op,
    ];
  }
}
