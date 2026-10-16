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

/// Checks what `MessageReader` cannot see in one message: the surfaces a
/// payload creates, applied in order as a renderer holding the catalogs
/// would apply them.
///
/// A message for a surface the payload creates is applied once the surface's
/// `createSurface` has been, so a self-reference, a cycle or an over-deep
/// chain is reported for the message that makes it. A surface the payload
/// does not create may hold components from earlier responses, so its
/// messages are left to `MessageReader`, as are function calls and
/// responses, which a renderer answers rather than applies.
///
/// [check] then checks each created surface of a whole payload: it has a
/// root, no reference to a missing component, and nothing the root does not
/// reach.
class PayloadChecker {
  /// A checker of a payload still arriving, for messages of the protocol
  /// version [catalogs] target.
  ///
  /// It skips a message for a surface before the surface's `createSurface`,
  /// since a renderer would see the message only once the payload is whole.
  PayloadChecker(List<CatalogApi> catalogs, A2uiProtocolVersion version)
    : this._(catalogs, version, const {});

  PayloadChecker._(
    List<CatalogApi> catalogs,
    A2uiProtocolVersion version,
    this._created,
  ) : _processor = MessageProcessor.forAgent(
        catalogs: catalogs,
        defaultVersion: version,
        // A surface may arrive across several messages, so the checks that
        // span them wait for finish.
        validationConfig: const ValidationConfig(
          allowOrphanComponents: true,
          allowDanglingReferences: true,
          allowMissingRoot: true,
        ),
      );

  /// Checks [messages], a whole payload of the protocol version [catalogs]
  /// target, as a renderer holding [catalogs] would apply them.
  ///
  /// Throws [A2uiIntegrityError] for a message that comes before the
  /// `createSurface` of its surface, or for a created surface with no root,
  /// a reference to a component it does not hold, or a component the root
  /// does not reach, and otherwise the [A2uiError] a renderer would report
  /// for the first message it rejects.
  static void check(
    List<CatalogApi> catalogs,
    A2uiProtocolVersion version,
    List<AgentToRendererMessage> messages,
  ) {
    final checker = PayloadChecker._(catalogs, version, {
      for (final CreateSurfaceMessage message
          in messages.whereType<CreateSurfaceMessage>())
        message.surfaceId,
    });
    try {
      messages.forEach(checker.add);
      for (final String surfaceId in checker._created) {
        checker._processor.model
            .getSurface(surfaceId)
            ?.componentsModel
            .validateTopology(ValidationConfig.strict);
      }
    } finally {
      checker.dispose();
    }
  }

  /// The surfaces the whole payload creates, or none for a payload still
  /// arriving.
  final Set<String> _created;

  final MessageProcessor<ComponentApi> _processor;

  /// Applies [message] if it is for a surface this payload has created.
  ///
  /// Throws [A2uiIntegrityError] for a message other than a `deleteSurface`
  /// that comes before the `createSurface` of a surface the whole payload
  /// creates, and otherwise the [A2uiError] a renderer would report for the
  /// message.
  void add(AgentToRendererMessage message) {
    final String? surfaceId = switch (message) {
      CreateSurfaceMessage(:final String surfaceId) ||
      UpdateComponentsMessage(:final String surfaceId) ||
      UpdateDataModelMessage(:final String surfaceId) ||
      DeleteSurfaceMessage(:final String surfaceId) => surfaceId,
      _ => null,
    };
    if (surfaceId == null) return;
    if (message is! CreateSurfaceMessage &&
        _processor.model.getSurface(surfaceId) == null) {
      // Deleting a surface that does not exist does nothing, as a renderer
      // treats it.
      if (_created.contains(surfaceId) && message is! DeleteSurfaceMessage) {
        throw A2uiIntegrityError(
          "A message for surface '$surfaceId' comes before the createSurface "
          'that creates it.',
        );
      }
      return;
    }
    _processor.processMessages([message]);
  }

  /// Releases the surfaces.
  void dispose() => _processor.model.dispose();
}
