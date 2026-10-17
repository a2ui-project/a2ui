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

import '../../utils/catalogs.dart';

/// The fields each v0.9 message body may carry, from `server_to_client.json`,
/// which closes both the envelope and the body.
const Map<String, Set<String>> _bodyFields = {
  'createSurface': {'surfaceId', 'catalogId', 'theme', 'sendDataModel'},
  'updateComponents': {'surfaceId', 'components'},
  'updateDataModel': {'surfaceId', 'path', 'value'},
  'deleteSurface': {'surfaceId'},
};

/// Reads the decoded messages of a direct JSON payload into messages of the
/// protocol version its catalogs target.
///
/// Reading translates: it rejects what is not a message of that version, or
/// carries a field the message does not define, which a typed message could
/// not hold. Checking the messages against the catalogs and the surfaces a
/// renderer holds is `RendererState`'s.
///
/// Reading the messages of v1.0 catalogs is not implemented yet and throws
/// [UnimplementedError].
class MessageReader {
  /// Throws [A2uiCatalogError] if [catalogs] is empty or they target
  /// different versions, and [UnimplementedError] if they target v1.0.
  MessageReader(List<CatalogApi> catalogs) {
    if (catalogsProtocolVersion(catalogs).isAtLeast(A2uiProtocolVersion.v1_0)) {
      throw UnimplementedError('Reading direct JSON messages of protocol v1.0');
    }
  }

  /// Reads [envelope], one message of a payload.
  ///
  /// Throws [A2uiValidationError] if [envelope] is not a v0.9 message, or
  /// carries a field the message does not define.
  AgentToRendererMessage read(Object? envelope) {
    if (envelope is! Map<String, Object?>) {
      throw A2uiValidationError(
        'A direct JSON payload must be a list of message objects, got '
        '${envelope.runtimeType}.',
      );
    }
    final AgentToRendererMessage message = AgentToRendererMessage.parseAll([
      envelope,
    ], protocolVersion: A2uiProtocolVersion.v0_9).messages.single;
    _checkFields(envelope);
    if (message case CreateSurfaceMessage(catalogId: null)) {
      throw A2uiValidationError(
        "Surface '${message.surfaceId}' names no catalogId.",
      );
    }
    return message;
  }
}

/// Rejects a field the envelope or its body does not declare.
void _checkFields(Map<String, Object?> envelope) {
  final String type = envelope.keys.firstWhere(_bodyFields.containsKey);
  for (final String key in envelope.keys) {
    if (key != 'version' && key != type) {
      throw A2uiValidationError("A '$type' message has no field '$key'.");
    }
  }
  final Set<String> allowed = _bodyFields[type]!;
  for (final Object? key in (envelope[type]! as Map).keys) {
    if (!allowed.contains(key)) {
      throw A2uiValidationError(
        "A '$type' message has no field '$type.$key'. Its fields are: "
        '${allowed.join(', ')}.',
      );
    }
  }
}
