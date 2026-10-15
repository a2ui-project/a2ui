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

import '../utils/catalogs.dart';

/// Checks [payloads] the way a renderer holding [catalogs] would, applying
/// them in order to surfaces that start empty.
///
/// Each payload is one render: every surface it creates must be complete.
///
/// Throws [A2uiValidationError] for a surface naming a catalog outside
/// [catalogs], as for anything else a payload names that the catalogs do not
/// declare, and otherwise the [A2uiError] a renderer would report for the
/// first message it rejects.
///
/// Checking payloads for v1.0 catalogs is not implemented yet and throws
/// [UnimplementedError].
void validatePayloads(
  List<CatalogApi> catalogs,
  Iterable<List<AgentToRendererMessage>> payloads,
) {
  if (payloads.every((payload) => payload.isEmpty)) return;
  if (catalogs.isNotEmpty &&
      catalogsProtocolVersion(catalogs).isAtLeast(A2uiProtocolVersion.v1_0)) {
    throw UnimplementedError('Checking payloads of protocol v1.0');
  }
  for (final payload in payloads) {
    for (final CreateSurfaceMessage message
        in payload.whereType<CreateSurfaceMessage>()) {
      if (catalogs.every((CatalogApi c) => c.id != message.catalogId)) {
        throw A2uiValidationError(
          "Surface '${message.surfaceId}' names catalog "
          "'${message.catalogId}', which is not active. Active catalogs: "
          '${catalogs.map((c) => c.id).join(', ')}.',
        );
      }
    }
  }
  // The processor links copies of the catalogs so cross-catalog references
  // resolve, leaving [catalogs] as they are.
  final MessageProcessor<ComponentApi> renderer = MessageProcessor.forAgent(
    catalogs: catalogs,
    defaultVersion: A2uiProtocolVersion.v0_9,
    // A surface may arrive across several messages of one payload, so the
    // checks that span messages wait for the whole payload below. Undeclared
    // types, duplicate ids, cycles, depth and paths are checked per message.
    validationConfig: const ValidationConfig(
      allowOrphanComponents: true,
      allowDanglingReferences: true,
      allowMissingRoot: true,
    ),
  );
  try {
    for (final payload in payloads) {
      renderer.processMessages(AgentToRendererMessagePayload(payload));
      // Each payload is one render: every surface it creates must be
      // complete once the whole payload is applied.
      for (final CreateSurfaceMessage message
          in payload.whereType<CreateSurfaceMessage>()) {
        renderer.model
            .getSurface(message.surfaceId)
            ?.componentsModel
            .validateTopology(ValidationConfig.strict);
      }
    }
  } finally {
    renderer.model.dispose();
  }
}
