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

/// What one run of [userSnippet] produced, so a test can assert on each step
/// of the blueprint's example rather than only on its final output.
class UserSnippetResult {
  /// Step 1: the long-lived generator created at agent startup.
  final A2uiGenerator<CatalogComponent, CatalogFunction> generator;

  /// Step 2: the processor negotiated for this request.
  final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor;

  /// Step 3: the snippet the agent prepends its own preamble to before
  /// calling the model.
  final String promptSnippet;

  /// Step 3: what the model returned.
  final String llmOutput;

  /// Step 4: the parsed, validated response, with text and A2UI blocks in the
  /// order the model emitted them.
  final List<ResponsePart> responseParts;

  /// Step 5: the A2UI messages delivered to the renderer, flattened out of
  /// [responseParts] in order.
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
///
/// This is deliberately a transcription of the blueprint's Python rather than
/// idiomatic application code: it is how the published example reads once the
/// SDK is implemented, and the test around it is what stops the example and
/// the API drifting apart.
///
/// The pieces the blueprint leaves to the agent author are parameters here:
/// [examples] stands in for `load_examples("./prompts/examples/**")`, and
/// [callLlm] for `myagent.call_llm(prompt_snippet, request_context)`. The
/// blueprint's second, custom catalog is left out: this SDK is scoped to the
/// published basic catalog, and a catalog loaded from disk exercises
/// [CatalogConfig.fromPath] rather than anything in the example's flow.
UserSnippetResult userSnippet({
  required A2uiRendererCapabilities rendererCapabilities,
  required String Function(String promptSnippet) callLlm,
  Map<String, List<A2uiMessage>>? examples,
}) {
  // 1. Agent startup: initialize the long-lived A2uiGenerator with the agent's
  //    catalog. Prompt examples passed here are validated during processor
  //    creation (createProcessor) against the active negotiated catalogs, and
  //    an example using components or structures the active catalog does not
  //    support raises an error.
  final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
    catalogs: [CatalogConfig(basicCatalog())],
    examples: examples,
  );

  // 2. In the request handler: retrieve the processor pre-negotiated against
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
