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
/// The messages are read as the protocol version [catalogs] target, so a
/// v1.0 `callRendererFunction` is checked against the function it names, as
/// `MessageProcessor.forAgent` checks it.
///
/// Throws [A2uiValidationError] for a surface, component or function call
/// naming a catalog outside [catalogs], as for anything else a payload names
/// that the catalogs do not declare, and otherwise the [A2uiError] a renderer
/// would report for the first message it rejects.
void validatePayloads(
  List<CatalogApi> catalogs,
  Iterable<List<AgentToRendererMessage>> payloads,
) {
  if (payloads.every((payload) => payload.isEmpty)) return;
  final Set<String> active = {for (final CatalogApi c in catalogs) c.id};
  for (final payload in payloads) {
    for (final message in payload) {
      for (final (String subject, String catalogId) in _catalogsNamed(
        message,
      )) {
        if (!active.contains(catalogId)) {
          throw A2uiValidationError(
            "$subject names catalog '$catalogId', which is not active. "
            'Active catalogs: ${active.join(', ')}.',
          );
        }
      }
    }
  }
  // The processor links copies of the catalogs so cross-catalog references
  // resolve, leaving [catalogs] as they are.
  final MessageProcessor<ComponentApi> renderer = MessageProcessor.forAgent(
    catalogs: catalogs,
    defaultVersion: catalogs.isEmpty
        ? A2uiProtocolVersion.v0_9
        : catalogsProtocolVersion(catalogs),
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

/// The catalogs [message] names, each with what names it: the surface it
/// creates, and from v1.0 its components and the function calls it makes.
Iterable<(String, String)> _catalogsNamed(
  AgentToRendererMessage message,
) sync* {
  final bool v1 =
      A2uiProtocolVersion.tryParse(
        message.version,
      )?.isAtLeast(A2uiProtocolVersion.v1_0) ??
      false;
  switch (message) {
    case CreateSurfaceMessage(:final String surfaceId, :final catalogId):
      if (catalogId != null) yield ("Surface '$surfaceId'", catalogId);
      if (!v1) return;
      for (final Map<String, Object?> component in message.components ?? []) {
        yield* _componentCatalogs(component);
      }
    case UpdateComponentsMessage(:final components) when v1:
      for (final Map<String, Object?> component in components) {
        yield* _componentCatalogs(component);
      }
    case CallRendererFunctionMessage(:final callFunction):
      yield* _callCatalogs(callFunction);
    default:
      break;
  }
}

/// The catalog [component] names, and those its function calls name.
Iterable<(String, String)> _componentCatalogs(
  Map<String, Object?> component,
) sync* {
  if (component['catalogId'] case final String catalogId) {
    yield ("Component '${component['id']}'", catalogId);
  }
  // `metadata` holds no calls, as `MessageProcessor` reads it.
  for (final MapEntry<String, Object?> entry in component.entries) {
    if (entry.key != 'catalogId' && entry.key != 'metadata') {
      yield* _callCatalogs(entry.value);
    }
  }
}

/// The catalogs the v1.0 function calls in [value] name.
Iterable<(String, String)> _callCatalogs(Object? value) sync* {
  switch (value) {
    case final List<Object?> items:
      for (final item in items) {
        yield* _callCatalogs(item);
      }
    case final Map<Object?, Object?> map:
      if (map case {
        '@call': final String name,
        'catalogId': final String catalogId,
      }) {
        yield ("Function call '$name'", catalogId);
      }
      for (final Object? child in map.values) {
        yield* _callCatalogs(child);
      }
  }
}
