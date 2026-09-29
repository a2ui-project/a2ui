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

/// One agent turn in the Express format.
///
/// [callLlm] sends the system prompt and the user's message to the model and
/// returns its complete response.
Future<List<AgentToRendererMessage>> respond({
  required SchemaCatalog catalog,
  required A2uiRendererCapabilities rendererCapabilities,
  required String userMessage,
  required Future<String> Function(String systemPrompt, String userMessage)
  callLlm,
}) async {
  // 1. At agent startup: register the catalogs the agent supports.
  final generator = A2uiGenerator(
    catalogs: [CatalogConfig(catalog)],
    inferenceFormatFactory: const ExpressFormatFactory(),
  );

  // 2. Per request: negotiate with the renderer's capabilities.
  final A2uiRequestProcessor processor = generator.createProcessor(
    rendererCapabilities,
  );

  // 3. Call the LLM with the prompt snippet.
  final String llmOutput = await callLlm(processor.promptSnippet, userMessage);

  // 4. Parse the response.
  final List<ResponsePart> parts = processor.parseResponse(llmOutput);

  // 5. Deliver the A2UI messages to the renderer.
  return [
    for (final A2uiPart part in parts.whereType<A2uiPart>()) ...part.a2ui,
  ];
}
