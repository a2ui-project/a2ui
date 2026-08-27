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

/// One agent turn, from startup to messages ready for a renderer.
///
/// Shows the intended shape of an integration. Most of the SDK is still
/// stubbed, so running this throws [UnimplementedError].
void main() {
  // 1. Agent startup. Register every catalog the agent supports, narrowed to
  //    the components and functions it uses.
  final generator = A2uiGenerator<CatalogComponent, CatalogFunction>(
    catalogs: [
      CatalogConfig.fromPath(
        'specification/v0_9_1/catalogs/basic/catalog.json',
        transformers: [
          ComponentPruningTransformer(['Card', 'Column', 'Text', 'Button']),
          FunctionPruningTransformer(['required', 'email']),
        ],
      ),
    ],
    examples: {
      'a confirmation card': [
        CreateSurfaceMessage(
          surfaceId: 'confirmation',
          catalogId:
              'https://a2ui.org/specification/v0_9/'
              'catalogs/basic/catalog.json',
        ),
      ],
    },
  );

  // 2. Per request. Negotiate against what the renderer says it can render.
  //    `a2uiClientCapabilities` arrives in transport metadata.
  final capabilities = A2uiRendererCapabilities.fromJson({
    'v0.9': {
      'supportedCatalogIds': [
        'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      ],
    },
  });
  final A2uiRequestProcessor<CatalogComponent, CatalogFunction> processor =
      generator.createProcessor(capabilities);

  // 3. Inference. Prepend your own preamble, then call your model.
  final systemPrompt =
      'You are a helpful assistant.\n\n${processor.promptSnippet}';
  final String modelOutput = callYourModel(systemPrompt);

  // 4. Parse and validate, in the order the model emitted.
  final List<ResponsePart> parts = processor.parseResponse(modelOutput);

  // 5. Deliver. Text goes to the chat transcript; messages go to the renderer.
  for (final part in parts) {
    switch (part) {
      case TextPart(:final String text):
        sendTextToUser(text);
      case A2uiPart(:final List<A2uiMessage> a2ui):
        sendA2uiToRenderer(a2ui);
      case ResponsePart():
        break;
    }
  }
}

/// Stands in for your model call.
String callYourModel(String systemPrompt) =>
    throw UnimplementedError('Wire this up to your model.');

/// Stands in for delivering conversational text.
void sendTextToUser(String text) {}

/// Stands in for delivering A2UI messages to a renderer.
void sendA2uiToRenderer(List<A2uiMessage> messages) {}
