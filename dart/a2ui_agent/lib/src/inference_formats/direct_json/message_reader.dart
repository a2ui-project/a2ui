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

/// The fields each v0.9 message body may carry, from `server_to_client.json`,
/// which closes both the envelope and the body.
const Map<String, Set<String>> _bodyFields = {
  'createSurface': {'surfaceId', 'catalogId', 'theme', 'sendDataModel'},
  'updateComponents': {'surfaceId', 'components'},
  'updateDataModel': {'surfaceId', 'path', 'value'},
  'deleteSurface': {'surfaceId'},
};

/// Reads the decoded messages of one direct JSON payload into v0.9 messages,
/// checking each the way a renderer holding [catalogs] would check it on its
/// own.
///
/// A payload may update a surface created by an earlier response, so a
/// message is checked against the surfaces the payload creates and nothing
/// else: its components against their catalog's schemas, and the functions
/// they call against their catalog's signatures. The checks that need the
/// whole surface, such as a reachable root, are `A2uiRequestProcessor`'s.
class MessageReader {
  /// The first of [catalogs] is the one a component is checked against when
  /// its surface is not created by the payload and no catalog declares it.
  MessageReader(this.catalogs);

  final List<SchemaCatalog> catalogs;

  late final Map<String, PayloadValidator<ComponentApi, FunctionApi>>
  _validators = {
    for (final SchemaCatalog catalog in catalogs)
      catalog.id: PayloadValidator(
        catalog: catalog,
        protocolVersion: A2uiProtocolVersion.v0_9,
      ),
  };

  /// Reads [envelope], the next message of a payload.
  ///
  /// [surfaces] maps each surface the payload created so far to its catalog
  /// id, and is updated with this message.
  ///
  /// Throws [A2uiValidationError] if [envelope] is not a v0.9 message, or
  /// names or uses anything the catalogs do not declare.
  AgentToRendererMessage read(Object? envelope, Map<String, String> surfaces) {
    if (envelope is! Map<String, Object?>) {
      throw A2uiValidationError(
        'A direct JSON payload must be a list of message objects, got '
        '${envelope.runtimeType}.',
        details: envelope,
      );
    }
    final AgentToRendererMessage message = AgentToRendererMessage.parseAll([
      envelope,
    ], protocolVersion: A2uiProtocolVersion.v0_9).messages.single;
    _checkFields(envelope);
    switch (message) {
      case CreateSurfaceMessage():
        final PayloadValidator<ComponentApi, FunctionApi> validator =
            _validators[message.catalogId] ??
            (throw A2uiValidationError(
              "Surface '${message.surfaceId}' names catalog "
              "'${message.catalogId}', which is not active. Active catalogs: "
              '${_validators.keys.join(', ')}.',
              details: envelope,
            ));
        validator.validateTheme(message.theme);
        surfaces[message.surfaceId] = message.catalogId;
      case UpdateComponentsMessage():
        if (message.components.isEmpty) {
          throw A2uiValidationError(
            "The update of surface '${message.surfaceId}' has no components.",
            details: envelope,
          );
        }
        for (final Map<String, Object?> component in message.components) {
          final PayloadValidator<ComponentApi, FunctionApi> validator =
              _validatorFor(component, surfaces[message.surfaceId]);
          validator.validateComponent(component);
          _checkCalls(component, validator);
        }
      case DeleteSurfaceMessage():
        surfaces.remove(message.surfaceId);
      default:
        break;
    }
    return message;
  }

  /// The validator for the catalog [component] belongs to: its surface's,
  /// else the first catalog declaring its type, else the first catalog.
  PayloadValidator<ComponentApi, FunctionApi> _validatorFor(
    Map<String, Object?> component,
    String? surfaceCatalogId,
  ) {
    if (surfaceCatalogId != null) return _validators[surfaceCatalogId]!;
    for (final SchemaCatalog catalog in catalogs) {
      if (catalog.components.containsKey(component['component'])) {
        return _validators[catalog.id]!;
      }
    }
    return _validators[catalogs.first.id]!;
  }
}

/// Rejects a field the envelope or its body does not declare.
void _checkFields(Map<String, Object?> envelope) {
  final String type = envelope.keys.firstWhere(_bodyFields.containsKey);
  for (final String key in envelope.keys) {
    if (key != 'version' && key != type) {
      throw A2uiValidationError(
        "A '$type' message has no field '$key'.",
        details: envelope,
      );
    }
  }
  final Set<String> allowed = _bodyFields[type]!;
  for (final Object? key in (envelope[type]! as Map).keys) {
    if (!allowed.contains(key)) {
      throw A2uiValidationError(
        "A '$type' message has no field '$type.$key'. Its fields are: "
        '${allowed.join(', ')}.',
        details: envelope,
      );
    }
  }
}

/// Checks each function call in [value] against the catalog of [validator].
void _checkCalls(
  Object? value,
  PayloadValidator<ComponentApi, FunctionApi> validator,
) {
  switch (value) {
    case {'call': final String name}:
      if (!validator.catalog.functions.containsKey(name)) {
        throw A2uiValidationError(
          "Catalog '${validator.catalog.id}' declares no function named "
          "'$name'.",
          details: value,
        );
      }
      final Object args = value['args'] ?? const <String, Object?>{};
      if (args is! Map<String, Object?>) {
        throw A2uiValidationError(
          "The 'args' of a call to '$name' must be an object.",
          details: value,
        );
      }
      validator.validateFunction(name, args);
      for (final Object? arg in args.values) {
        _checkCalls(arg, validator);
      }
    case Map():
      for (final Object? child in value.values) {
        _checkCalls(child, validator);
      }
    case List():
      for (final Object? child in value) {
        _checkCalls(child, validator);
      }
  }
}
