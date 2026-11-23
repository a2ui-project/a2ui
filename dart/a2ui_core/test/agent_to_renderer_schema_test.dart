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

import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_core/src/core/agent_to_renderer_schemas.g.dart';
import 'package:test/test.dart';

import 'conformance/conformance_harness.dart';

void main() {
  group('embedded agent-to-renderer schemas', () {
    for (final (String name, String embedded, String source) in [
      (
        'v0.9',
        agentToRendererV0_9Json,
        'specification/v0_9/json/server_to_client.json',
      ),
      (
        'v0.9.1',
        agentToRendererV0_9_1Json,
        'specification/v0_9_1/json/server_to_client.json',
      ),
      (
        'v1.0',
        agentToRendererV1_0Json,
        'specification/v1_0/json/agent_to_renderer.json',
      ),
    ]) {
      test('embed the $name document verbatim', () {
        expect(
          embedded,
          File(resolveConformancePath('../$source')).readAsStringSync(),
          reason:
              'lib/src/core/agent_to_renderer_schemas.g.dart has drifted '
              'from $source. Run `dart run tool/generate_protocol_schemas.dart`.',
        );
      });
    }
  });

  group('AgentToRendererMessage.schemaFor', () {
    Object? createSurfaceProperties(A2uiProtocolVersion version) =>
        ((AgentToRendererMessage.schemaFor(version)[r'$defs']!
                    as Map<String, Object?>)['CreateSurfaceMessage']!
                as Map<String, Object?>)['properties']!
            as Map<String, Object?>;

    test('picks the document by protocol version', () {
      expect(
        AgentToRendererMessage.schemaFor(A2uiProtocolVersion.v0_9)[r'$id'],
        'https://a2ui.org/specification/v0_9/server_to_client.json',
      );
      expect(createSurfaceProperties(A2uiProtocolVersion.v0_9), {
        'version': {'const': 'v0.9'},
        'createSurface': anything,
      });
      // The v0.9.1 document keeps the v0.9 `$id` and accepts either version.
      expect(
        AgentToRendererMessage.schemaFor(A2uiProtocolVersion.v0_9_1)[r'$id'],
        'https://a2ui.org/specification/v0_9/server_to_client.json',
      );
      expect(createSurfaceProperties(A2uiProtocolVersion.v0_9_1), {
        'version': {
          'enum': ['v0.9', 'v0.9.1'],
        },
        'createSurface': anything,
      });
      expect(
        AgentToRendererMessage.schemaFor(A2uiProtocolVersion.v1_0)[r'$id'],
        'https://a2ui.org/specification/v1_0/agent_to_renderer.json',
      );
    });

    test('lists a message for each type the version allows', () {
      for (final A2uiProtocolVersion version in A2uiProtocolVersion.values) {
        final Map<String, Object?> schema = AgentToRendererMessage.schemaFor(
          version,
        );
        final defs = schema[r'$defs']! as Map<String, Object?>;
        final messageTypes = <String>[];
        for (final entry in schema['oneOf']! as List<Object?>) {
          final ref = (entry! as Map<String, Object?>)[r'$ref']! as String;
          final message =
              defs[ref.substring(r'#/$defs/'.length)]! as Map<String, Object?>;
          final properties = message['properties']! as Map<String, Object?>;
          messageTypes.addAll(properties.keys.where((k) => k != 'version'));
        }
        expect(
          messageTypes,
          AgentToRendererMessage.typesFor(version),
          reason: version.jsonValue,
        );
      }
    });

    test('hands out a fresh document each call', () {
      final Map<String, Object?> first = AgentToRendererMessage.schemaFor(
        A2uiProtocolVersion.v1_0,
      );
      first.remove(r'$defs');

      expect(
        AgentToRendererMessage.schemaFor(A2uiProtocolVersion.v1_0),
        contains(r'$defs'),
      );
    });
  });
}
