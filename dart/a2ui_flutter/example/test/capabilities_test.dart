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

// The Dart side of the capabilities scenario, in process: the metadata a
// renderer sends decides which catalog the agent's prompt names, and a
// request without it gets no A2UI prompt at all.

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:a2ui_flutter_example/chat_session.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_client.dart';

/// The metadata the example's session stands for: a v1.0 renderer of the
/// basic catalog.
const Map<String, Object?> v1Metadata = {
  'a2uiRendererCapabilities': {
    '1.0': {
      'supportedCatalogIds': [BasicCatalog.v1_0Id],
    },
  },
};

void main() {
  group('readRendererCapabilities', () {
    test('yields the advertised v1.0 catalog', () {
      expect(readRendererCapabilities(v1Metadata), {
        '1.0': {
          'supportedCatalogIds': [BasicCatalog.v1_0Id],
        },
      });
    });

    test('yields null for absent metadata and for another version', () {
      expect(readRendererCapabilities(null), isNull);
      expect(readRendererCapabilities(const {}), isNull);
      // v0.9 capabilities are not an offer of v1.0.
      expect(
        readRendererCapabilities(const {
          'a2uiClientCapabilities': {
            'v0.9': {
              'supportedCatalogIds': [BasicCatalog.v0_9Id],
            },
          },
        }),
        isNull,
      );
      expect(
        readRendererCapabilities(v1Metadata, A2uiProtocolVersion.v0_9),
        isNull,
      );
    });

    test('rejects capabilities that are not an object', () {
      expect(
        () => readRendererCapabilities(const {'a2uiRendererCapabilities': 1}),
        throwsA(isA<A2uiCatalogError>()),
      );
    });
  });

  group('the processor the capabilities resolve to', () {
    // The example's format, whose prompt names the catalog by its id.
    final generator = A2uiGenerator(
      catalogs: [
        CatalogConfig(basicCatalog()),
        CatalogConfig(BasicCatalog.v0_9()),
      ],
      inferenceFormatFactory: ChatSession.defaultFormat,
    );

    test('names only the advertised catalog in its prompt', () {
      final Map<String, Object?>? capabilities = readRendererCapabilities(
        v1Metadata,
      );
      final A2uiRequestProcessor processor = generator.createProcessor(
        A2uiRendererCapabilities.fromJson(capabilities!),
      );
      expect(processor.activeCatalogs.map((c) => c.id), [BasicCatalog.v1_0Id]);
      expect(processor.promptSnippet, contains(BasicCatalog.v1_0Id));
      expect(processor.promptSnippet, isNot(contains(BasicCatalog.v0_9Id)));
    });

    test('names the v0.9 catalog for a v0.9 renderer', () {
      final Map<String, Object?>? capabilities = readRendererCapabilities(
        const {
          'a2uiClientCapabilities': {
            'v0.9': {
              'supportedCatalogIds': [BasicCatalog.v0_9Id],
            },
          },
        },
        A2uiProtocolVersion.v0_9,
      );
      final A2uiRequestProcessor processor = generator.createProcessor(
        A2uiRendererCapabilities.fromJson(capabilities!),
      );
      expect(processor.activeCatalogs.map((c) => c.id), [BasicCatalog.v0_9Id]);
      expect(processor.promptSnippet, contains(BasicCatalog.v0_9Id));
      expect(processor.promptSnippet, isNot(contains(BasicCatalog.v1_0Id)));
    });
  });

  group('ChatSession', () {
    test('sends a prompt that names only the v1.0 basic catalog', () async {
      final client = FakeClient([
        ['Hello.'],
      ]);
      final session = ChatSession(client: client);
      addTearDown(session.dispose);

      await session.send('Hi.');

      final String prompt = client.systemPrompts.single;
      expect(prompt, startsWith(appInstructions));
      expect(prompt, contains(BasicCatalog.v1_0Id));
      expect(prompt, isNot(contains(BasicCatalog.v0_9Id)));
      expect(prompt, contains('<a2ui-json>'));
    });

    test('carries no A2UI snippet of its own, only the processor\'s', () {
      // Without a processor there is nothing to add to the instructions, which
      // is what a renderer that sends no capabilities gets.
      expect(appInstructions, isNot(contains('<a2ui')));
      expect(appInstructions, isNot(contains(BasicCatalog.v1_0Id)));
    });
  });
}
