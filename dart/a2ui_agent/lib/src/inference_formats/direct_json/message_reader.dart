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

/// Reads the decoded messages of a direct JSON payload into messages of the
/// protocol version its catalogs target.
///
/// Reading translates: it rejects what is not a message of that version, or
/// carries a field the message does not define, which a typed message could
/// not hold. Checking the messages against the catalogs and the surfaces a
/// renderer holds is `RendererState`'s.
class MessageReader {
  /// Throws [A2uiCatalogError] if [catalogs] is empty or they target
  /// different versions.
  MessageReader(List<CatalogApi> catalogs)
    : version = catalogsProtocolVersion(catalogs);

  /// The protocol version the catalogs target, which every message is read as.
  final A2uiProtocolVersion version;

  /// Reads [envelope], one message of a payload.
  ///
  /// Throws [A2uiValidationError] if [envelope] is not a message of
  /// [version], or carries a field the message does not define.
  AgentToRendererMessage read(Object? envelope) {
    if (envelope is! Map<String, Object?>) {
      throw A2uiValidationError(
        'A direct JSON payload must be a list of message objects, got '
        '${envelope.runtimeType}.',
      );
    }
    return AgentToRendererMessage.parseAll([
      envelope,
    ], protocolVersion: version).messages.single;
  }
}
