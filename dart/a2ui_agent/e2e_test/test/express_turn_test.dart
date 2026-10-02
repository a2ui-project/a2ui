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
  // Follows the steps of `a2ui_agent/example/a2ui_agent_example.dart`.
  test(
    'an Express agent turn produces a surface the renderer accepts',
    () async {
      final SchemaCatalog catalog = loadBasicCatalog();

      // 1. At agent startup: register the catalogs the agent supports.
      final generator = A2uiGenerator(
        catalogs: [CatalogConfig(catalog)],
        inferenceFormatFactory: const ExpressFormatFactory(),
      );

      // 2. Per request: negotiate with the renderer's capabilities.
      final A2uiRequestProcessor processor = generator.createProcessor(
        A2uiRendererCapabilities.forCatalogIds([catalog.id]),
      );

      // 3. Call the LLM with the prompt snippet.
      final String llmOutput = await AiClient().send(
        processor.promptSnippet,
        loginFormRequest,
      );

      print('LLM output:\n$llmOutput');

      // 4. Parse the response.
      final List<ResponsePart> parts = processor.parseResponse(llmOutput);

      // 5. Deliver the A2UI messages to the renderer.
      expectLoginForm(catalog, [
        for (final A2uiPart part in parts.whereType<A2uiPart>()) ...part.a2ui,
      ], llmOutput: llmOutput);
    },
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
