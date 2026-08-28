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

import '../test_catalogs.dart';

/// What one run of [userSnippet] produced, step by step.
class UserSnippetResult {
  /// Step 1: the long-lived generator created at agent startup.
  final A2uiGenerator<CatalogComponent, CatalogFunction> generator;

  /// Step 2: the processor negotiated for this request.
  final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor;

  /// Step 3: the snippet the agent prepends its preamble to.
  final String promptSnippet;

  /// Step 3: what the model returned.
  final String llmOutput;

  /// Step 4: the parsed response, in the order the model emitted it.
  final List<ResponsePart> responseParts;

  /// Step 5: the messages for the renderer, flattened from [responseParts].
  final List<A2uiMessage> a2uiPayload;

  const UserSnippetResult({
    required this.generator,
    required this.processor,
    required this.promptSnippet,
    required this.llmOutput,
    required this.responseParts,
    required this.a2uiPayload,
  });
}

/// The agent turn from the "Code Example" section of
/// `blueprints/modules/a2ui_agent.blueprint.md`, written against the Dart SDK.
UserSnippetResult userSnippet({
  required A2uiRendererCapabilities rendererCapabilities,
  required String Function(String promptSnippet) callLlm,
  Map<String, List<A2uiMessage>>? examples,
}) {
  // 1. Agent startup: initialize the long-lived A2uiGenerator with the
  //    agent's catalog. Examples passed here are validated against the
  //    negotiated catalogs by createProcessor.
  final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
    catalogs: [CatalogConfig(basicCatalog())],
    examples: examples,
  );

  // 2. In the request handler: retrieve the processor pre-negotiated for
  //    the renderer's capabilities.
  final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
      generator.createProcessor(rendererCapabilities);

  // 3. Invoke the LLM to generate the output.
  final String promptSnippet = processor.promptSnippet;
  final String llmOutputText = callLlm(promptSnippet);

  // 4. Parse and validate the output using the processor.
  final List<ResponsePart> responseParts = processor.parseResponse(
    llmOutputText,
  );

  // 5. Deliver the A2UI payloads to the renderer.
  final List<A2uiMessage> a2uiPayload = [
    for (final A2uiPart part in responseParts.whereType<A2uiPart>())
      ...part.a2ui,
  ];

  return UserSnippetResult(
    generator: generator,
    processor: processor,
    promptSnippet: promptSnippet,
    llmOutput: llmOutputText,
    responseParts: responseParts,
    a2uiPayload: a2uiPayload,
  );
}
