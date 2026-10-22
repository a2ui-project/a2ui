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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// What each e2e turn asks the model for.
const String loginFormRequest =
    'Show a login form with email and password fields and a "Sign in" '
    'button.';

/// Checks that [messages] are written against the protocol version [catalog]
/// targets and build a login form from [catalog], as a renderer holding only
/// [catalog] would apply them.
///
/// The renderer validates each message against the catalog, and throws on
/// the first one it rejects. [llmOutput] is printed with any failure.
void expectLoginForm(
  CatalogApi catalog,
  List<AgentToRendererMessage> messages, {
  required String llmOutput,
}) {
  expect(messages, isNotEmpty, reason: 'LLM output:\n$llmOutput');
  expect(
    messages.map((m) => m.version),
    everyElement(catalog.protocolVersion!.jsonValue),
  );
  final createSurface = messages.first as CreateSurfaceMessage;
  expect(createSurface.catalogId, catalog.id);

  final MessageProcessor<ComponentApi> renderer = MessageProcessor.forAgent(
    catalogs: [catalog],
    defaultVersion: catalog.protocolVersion,
    // `parseResponse` checked the surface graph already.
    validationConfig: null,
  );
  addTearDown(renderer.model.dispose);
  renderer.processMessages(AgentToRendererMessagePayload(messages));

  expectLoginFormSurface(
    renderer.model.getSurface(createSurface.surfaceId)!,
    llmOutput: llmOutput,
  );
}

/// Checks that [surface] holds the fields and the button of a login form.
void expectLoginFormSurface(
  SurfaceModel<ComponentApi> surface, {
  required String llmOutput,
}) {
  expect(
    surface.componentsModel.all.map((c) => c.type),
    containsAll(<String>['TextField', 'Button']),
    reason: 'LLM output:\n$llmOutput',
  );
}
