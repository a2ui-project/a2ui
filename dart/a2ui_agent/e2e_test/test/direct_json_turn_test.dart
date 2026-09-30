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

// ignore_for_file: avoid_print

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'test_infra/ai_client.dart';
import 'test_infra/login_form.dart';
import 'test_infra/renderer_catalog.dart';

void main() {
  const timeout = Timeout(Duration(minutes: 3));

  late SchemaCatalog catalog;
  late A2uiRequestProcessor processor;

  setUp(() {
    catalog = loadBasicCatalog();
    // Direct JSON is the default format, so the generator names none.
    processor = A2uiGenerator(
      catalogs: [CatalogConfig(catalog)],
    ).createProcessor(A2uiRendererCapabilities.forCatalogIds([catalog.id]));
  });

  test(
    'a direct JSON agent turn produces a surface the renderer accepts',
    () async {
      final String llmOutput = await AiClient().send(
        processor.promptSnippet,
        loginFormRequest,
      );

      print('LLM output:\n$llmOutput');

      final List<ResponsePart> parts = processor.parseResponse(llmOutput);
      expectLoginForm(catalog, [
        for (final A2uiPart part in parts.whereType<A2uiPart>()) ...part.a2ui,
      ], llmOutput: llmOutput);
    },
    timeout: timeout,
  );

  test(
    'a streamed direct JSON turn builds the surface as it arrives',
    () async {
      final Parser parser = const DirectJsonFormatFactory(
        progressiveKeys: {'text', 'label'},
      ).createFormat(processor.activeCatalogs).createParser();

      // A renderer applying each part as it arrives. A surface is incomplete
      // until the stream ends, so the checks that need a whole surface wait
      // for the end.
      final renderer = MessageProcessor<ComponentApi>(
        catalogs: [rendererCatalog(catalog)],
        protocolVersion: A2uiProtocolVersion.v0_9,
        validationConfig: ValidationConfig.relaxed,
      );
      addTearDown(renderer.groupModel.dispose);

      final llmOutput = StringBuffer();
      var partsBeforeTheEnd = 0;
      String? surfaceId;
      await for (final String chunk in AiClient().sendStream(
        processor.promptSnippet,
        loginFormRequest,
      )) {
        llmOutput.write(chunk);
        for (final A2uiPart part
            in parser.parseChunk(chunk).whereType<A2uiPart>()) {
          partsBeforeTheEnd++;
          surfaceId ??= part.a2ui
              .whereType<CreateSurfaceMessage>()
              .firstOrNull
              ?.surfaceId;
          renderer.processMessages(AgentToRendererMessagePayload(part.a2ui));
        }
      }

      print('LLM output ($partsBeforeTheEnd parts):\n$llmOutput');

      expect(partsBeforeTheEnd, greaterThan(0), reason: '$llmOutput');
      expect(surfaceId, isNotNull, reason: '$llmOutput');
      expectLoginFormSurface(
        renderer.groupModel.getSurface(surfaceId!)!,
        llmOutput: '$llmOutput',
      );

      // The whole response passes the checks a streamed surface skipped.
      final List<ResponsePart> parts = processor.parseResponse('$llmOutput');
      expectLoginForm(catalog, [
        for (final A2uiPart part in parts.whereType<A2uiPart>()) ...part.a2ui,
      ], llmOutput: '$llmOutput');
    },
    timeout: timeout,
  );
}
