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

import 'catalogs.dart';

/// The keys of a component that are not its properties, so that no function
/// call is nested in them.
const Set<String> _envelopeKeys = {'id', 'component', 'catalogId', 'metadata'};

/// Reads the decoded messages of one payload into messages of the protocol
/// version [catalogs] target, checking each the way a renderer holding
/// [catalogs] would check it on its own.
///
/// A direct JSON parser reads what the model wrote with it, and the Express
/// compiler for v1.0 the messages it compiled.
///
/// A payload may update a surface created by an earlier response, so a
/// message is checked against the surfaces the payload creates and nothing
/// else: its components against their catalog's schemas, and the functions
/// they call against their catalog's signatures. The checks that need the
/// whole surface, such as a reachable root, are `A2uiRequestProcessor`'s.
///
/// Before v1.0 every component and call of a surface belongs to the catalog
/// the surface names. From v1.0 a component or a function call may name a
/// catalog of its own, and one that names none belongs to its surface's
/// catalog, as a renderer resolves it. A surface the payload does not create
/// has a catalog the payload does not state, so a component or call of it
/// that names none is checked against the first catalog declaring it.
class MessageReader {
  /// The first of [catalogs] is the one a component is checked against when
  /// its surface is not created by the payload and no catalog declares it.
  ///
  /// Throws [A2uiCatalogError] if [catalogs] is empty or they target
  /// different versions.
  MessageReader(this.catalogs) : version = catalogsProtocolVersion(catalogs);

  final List<CatalogApi> catalogs;

  /// The protocol version [catalogs] target, which every message is read as.
  final A2uiProtocolVersion version;

  bool get _v1 => version.isAtLeast(A2uiProtocolVersion.v1_0);

  late final Map<String, PayloadValidator<ComponentApi, FunctionApi>>
  _validators = {
    for (final CatalogApi catalog in catalogs)
      catalog.id: PayloadValidator(catalog: catalog),
  };

  /// Checks each `callRendererFunction` as a renderer holding [catalogs]
  /// would, the function's `allowedCallers` included. It holds no surface,
  /// so the surface a call names is not looked up.
  late final MessageProcessor<ComponentApi> _calls = MessageProcessor.forAgent(
    catalogs: catalogs,
    defaultVersion: version,
  );

  /// Reads [envelope], the next message of a payload.
  ///
  /// [surfaces] maps each surface the payload created so far to its catalog
  /// id, or to null for a v1.0 surface that names none, and is updated with
  /// this message.
  ///
  /// Throws [A2uiValidationError] if [envelope] is not a message of
  /// [version], or names or uses anything the catalogs do not declare.
  AgentToRendererMessage read(Object? envelope, Map<String, String?> surfaces) {
    if (envelope is! Map<String, Object?>) {
      throw A2uiValidationError(
        'A direct JSON payload must be a list of message objects, got '
        '${envelope.runtimeType}.',
      );
    }
    final AgentToRendererMessage message = AgentToRendererMessage.parseAll([
      envelope,
    ], protocolVersion: version).messages.single;
    if (_v1) {
      _checkV1(message, surfaces);
    } else {
      _checkV0_9(message, surfaces);
    }
    return message;
  }

  void _checkV0_9(
    AgentToRendererMessage message,
    Map<String, String?> surfaces,
  ) {
    switch (message) {
      case CreateSurfaceMessage(:final String surfaceId, :final catalogId?):
        _validator(
          catalogId,
          "Surface '$surfaceId'",
        ).validateTheme(message.theme);
        surfaces[surfaceId] = catalogId;
      case UpdateComponentsMessage():
        for (final Map<String, Object?> component in message.components) {
          final PayloadValidator<ComponentApi, FunctionApi> validator =
              _validators[surfaces[message.surfaceId] ??
                  _declaring(component['component'], components: true) ??
                  catalogs.first.id]!;
          validator.validateComponent(component);
        }
      case DeleteSurfaceMessage():
        surfaces.remove(message.surfaceId);
      default:
        break;
    }
  }

  void _checkV1(AgentToRendererMessage message, Map<String, String?> surfaces) {
    switch (message) {
      case CreateSurfaceMessage(:final String surfaceId):
        if (message.catalogId case final String catalogId) {
          _validator(catalogId, "Surface '$surfaceId'");
        }
        surfaces[surfaceId] = message.catalogId;
        for (final Map<String, Object?> component in message.components ?? []) {
          _checkComponent(component, surfaceId, surfaces);
        }
      case UpdateComponentsMessage(:final String surfaceId):
        for (final Map<String, Object?> component in message.components) {
          _checkComponent(component, surfaceId, surfaces);
        }
      case DeleteSurfaceMessage():
        surfaces.remove(message.surfaceId);
      case CallRendererFunctionMessage():
        _calls.checkRendererFunctionCall(message);
      default:
        break;
    }
  }

  /// Checks a v1.0 [component] of surface [surfaceId] against the catalog it
  /// belongs to, and each function call in it against the catalog the call
  /// belongs to.
  ///
  /// Throws [A2uiValidationError] if the component or a call names no
  /// catalog on a surface that names none, names a catalog that is not
  /// active, or does not match its catalog.
  void _checkComponent(
    Map<String, Object?> component,
    String surfaceId,
    Map<String, String?> surfaces,
  ) {
    final bool created = surfaces.containsKey(surfaceId);

    /// The catalog an item names, else its surface's, else the first catalog
    /// declaring it.
    String resolve(Object? named, String subject, String? declaring) {
      if (named != null) {
        if (named is String) return named;
        throw A2uiValidationError("$subject has a non-string 'catalogId'.");
      }
      if (!created) return declaring ?? catalogs.first.id;
      return surfaces[surfaceId] ??
          (throw A2uiValidationError(
            "$subject names no catalogId, and surface '$surfaceId' names no "
            'catalog.',
          ));
    }

    final Object? id = component['id'];
    final String catalogId = resolve(
      component['catalogId'],
      "Component '$id'",
      _declaring(component['component'], components: true),
    );
    // Given its catalog's id, the validator checks the calls that name that
    // catalog, and the others are checked below, each against its own.
    _validator(
      catalogId,
      "Component '$id'",
    ).validateComponent({...component, 'catalogId': catalogId});

    void visit(Object? node) {
      switch (node) {
        case final List<Object?> items:
          items.forEach(visit);
        case final Map<Object?, Object?> map:
          final Object? name = map['@call'];
          if (name is String &&
              !name.startsWith('@') &&
              map['catalogId'] != catalogId) {
            final String callCatalog = resolve(
              map['catalogId'],
              "Function call '$name' in component '$id'",
              _declaring(name, components: false),
            );
            _validator(
              callCatalog,
              "Function call '$name' in component '$id'",
            ).validateFunctionArgs(name, _args(map), componentId: id);
          }
          map.values.forEach(visit);
      }
    }

    for (final MapEntry<String, Object?> entry in component.entries) {
      if (!_envelopeKeys.contains(entry.key)) visit(entry.value);
    }
  }

  /// The validator of the active catalog [catalogId], which [subject] names.
  ///
  /// Throws [A2uiValidationError] if no active catalog has that id.
  PayloadValidator<ComponentApi, FunctionApi> _validator(
    String catalogId,
    String subject,
  ) =>
      _validators[catalogId] ??
      (throw A2uiValidationError(
        "$subject names catalog '$catalogId', which is not active. Active "
        'catalogs: ${_validators.keys.join(', ')}.',
      ));

  /// The id of the first catalog declaring a component or, when [components]
  /// is false, a function named [name], or null if none does.
  String? _declaring(Object? name, {required bool components}) {
    for (final CatalogApi catalog in catalogs) {
      if ((components ? catalog.components : catalog.functions).containsKey(
        name,
      )) {
        return catalog.id;
      }
    }
    return null;
  }
}

/// The arguments of [call], or none.
Map<String, Object?> _args(Map<Object?, Object?> call) =>
    switch (call['args']) {
      final Map<Object?, Object?> args => args.cast<String, Object?>(),
      null => const {},
      _ => throw A2uiValidationError(
        "The 'args' of a call to '${call['@call']}' must be an object.",
      ),
    };
