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

import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/catalog.dart';
import '../core/component_model.dart';
import '../core/messages.dart';
import '../core/surface_group_model.dart';
import '../core/surface_model.dart';
import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../validation/component_graph.dart';
import '../validation/validator.dart';

/// The central processor for A2UI messages on renderer side.
///
/// It consumes the agent-to-renderer messages
/// (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`)
/// and builds the surface state a renderer draws from. An agent can also run
/// it headlessly, to evaluate the UI its own payload would produce.
///
/// Not to be confused with the Agent SDK's `A2uiRequestProcessor`, which runs
/// the other way: it parses model output into the payloads this consumes.
///
/// Checks a batch against the surface it joins, which needs that state. For
/// checking a payload on its own, before any surface exists, see
/// [A2uiValidator.validate].
///
/// Validation is phased rather than a single pass: [processPayload] checks
/// envelopes as it parses, a surface's theme is checked when the surface is
/// created, and each batch of components is checked against its surface's
/// catalog and against the surface's existing component graph as the batch
/// arrives. The graph checks resolve references against what the surface
/// already holds, which a payload-scoped validator cannot see, so an
/// incremental update is checked rather than waved through. Each of those
/// checks runs on the validator for that surface's catalog, from
/// [validatorFor].
class MessageProcessor<T extends ComponentApi> {
  final SurfaceGroupModel<T> groupModel;
  final List<Catalog<T, FunctionImplementation>> catalogs;

  /// The protocol version this processor accepts, on envelopes and in the
  /// validators it builds.
  final A2uiProtocolVersion protocolVersion;

  /// The shared `common_types.json` definitions the validators resolve
  /// against.
  ///
  /// Defaults to the copy this package publishes for [protocolVersion]; pass
  /// a different document to override it, or an empty map to leave the shared
  /// types unchecked.
  final Map<String, Object?> commonTypesSchema;

  /// One validator per catalog, built on first use.
  final Map<String, A2uiValidator<T, FunctionImplementation>> _validators = {};

  MessageProcessor({
    required this.catalogs,
    this.protocolVersion = A2uiProtocolVersion.v0_9,
    Map<String, Object?>? commonTypesSchema,
    void Function(A2uiClientAction)? onAction,
  }) : commonTypesSchema =
           commonTypesSchema ?? A2uiValidator.commonTypesFor(protocolVersion),
       groupModel = SurfaceGroupModel<T>() {
    if (onAction != null) {
      groupModel.onAction.addListener(onAction);
    }
  }

  /// The validator for [catalog].
  ///
  /// A component belongs to exactly one catalog, so a validator is scoped to
  /// one rather than handed the whole supported set: a processor that
  /// supports several catalogs must not accept a component of one surface's
  /// catalog on a surface created against another. Each surface records the
  /// catalog it was created with, and every check below goes through the
  /// validator for that catalog.
  ///
  /// Built once per catalog and reused. The validator caches resolved
  /// component schemas, which a fresh instance per batch would rebuild on
  /// every message.
  A2uiValidator<T, FunctionImplementation> validatorFor(
    Catalog<T, FunctionImplementation> catalog,
  ) => _validators.putIfAbsent(
    catalog.id,
    () => A2uiValidator<T, FunctionImplementation>(
      catalog: catalog,
      commonTypesSchema: commonTypesSchema,
      protocolVersion: protocolVersion,
    ),
  );

  /// Parses a raw payload, then processes it.
  ///
  /// Envelope validation happens here, as the payload is parsed: every message
  /// must declare a protocol version this SDK implements and carry exactly one
  /// update type. Neither check needs a catalog, which is what lets a payload
  /// be parsed before each message is matched to the surface, and so the
  /// catalog, it belongs to. Returns the parsed messages.
  ///
  /// Throws [A2uiValidationError] for a malformed envelope, including one
  /// mixing update types, before any message reaches the models.
  List<A2uiMessage> processPayload(List<Map<String, Object?>> payload) {
    final List<A2uiMessage> messages = A2uiValidator.parseMessagesFor(
      payload,
      protocolVersion: protocolVersion,
    );
    processMessages(messages);
    return messages;
  }

  /// Processes a list of messages.
  void processMessages(List<A2uiMessage> messages) {
    for (final message in messages) {
      _processMessage(message);
    }
  }

  void _processMessage(A2uiMessage message) {
    if (message is CreateSurfaceMessage) {
      _processCreateSurface(message);
    } else if (message is UpdateComponentsMessage) {
      _processUpdateComponents(message);
    } else if (message is UpdateDataModelMessage) {
      _processUpdateDataModel(message);
    } else if (message is DeleteSurfaceMessage) {
      _processDeleteSurface(message);
    }
  }

  void _processCreateSurface(CreateSurfaceMessage message) {
    final Catalog<T, FunctionImplementation> catalog = catalogs.firstWhere(
      (c) => c.id == message.catalogId,
      orElse: () =>
          throw A2uiStateError('Catalog not found: ${message.catalogId}'),
    );

    if (groupModel.getSurface(message.surfaceId) != null) {
      throw A2uiStateError('Surface ${message.surfaceId} already exists.');
    }

    // The theme arrives once, with the surface, so it is checked here rather
    // than on every later message.
    validatorFor(catalog).validateTheme(message.theme);

    final surface = SurfaceModel<T>(
      message.surfaceId,
      catalog: catalog,
      theme: message.theme ?? {},
      sendDataModel: message.sendDataModel,
    );
    groupModel.addSurface(surface);
  }

  void _processUpdateComponents(UpdateComponentsMessage message) {
    final SurfaceModel<T>? surface = groupModel.getSurface(message.surfaceId);
    if (surface == null) {
      throw A2uiStateError('Surface not found: ${message.surfaceId}');
    }

    // Pass 1: validation.
    //
    // Every component in the batch is checked before any of them is applied,
    // so a batch that is rejected leaves the surface exactly as it was. Without
    // this, a valid component followed by an invalid one was committed before
    // the error surfaced, leaving the surface in a half-updated state that no
    // message describes.
    for (final Map<String, dynamic> compJson in message.components) {
      final id = compJson['id'] as String?;
      final type = compJson['component'] as String?;

      if (id == null) {
        throw A2uiValidationError("Component missing an 'id'.");
      }

      final ComponentModel? existing = surface.componentsModel.get(id);
      if (existing == null && type == null) {
        throw A2uiValidationError(
          "Cannot create component $id without a 'component' type.",
        );
      }

      // A component that names a type is checked against the surface's
      // catalog here, while the batch can still be rejected whole. A component
      // that names none is an update to one this surface already holds, which
      // the catalog was consulted for when it first arrived.
      if (type != null) {
        validatorFor(surface.catalog).validateComponent(compJson);
      }
    }

    // The batch as a graph, against the surface it is about to join: duplicate
    // ids, references that name no component here or on the surface, cycles
    // and over-deep chains. Resolving against the surface is what a
    // payload-scoped validator cannot do, so an incremental update is checked
    // here rather than waved through.
    validatorFor(surface.catalog).validateComponentBatch(
      [
        for (final Map<String, dynamic> c in message.components)
          c.cast<String, Object?>(),
      ],
      [for (final ComponentModel c in surface.componentsModel.all) c.toJson()],
    );

    // Data-model paths and nested function calls, which need no surface state.
    checkPathsAndRecursion(message.toJson());

    // Pass 2: mutation. Only reached when the whole batch is valid.
    for (final Map<String, dynamic> compJson in message.components) {
      final id = compJson['id'] as String;
      final type = compJson['component'] as String?;

      final ComponentModel? existing = surface.componentsModel.get(id);
      final props = Map<String, dynamic>.from(compJson)
        ..remove('id')
        ..remove('component');

      if (existing != null) {
        if (type != null && type != existing.type) {
          // Recreate if type changes
          surface.componentsModel.removeComponent(id);
          surface.componentsModel.addComponent(ComponentModel(id, type, props));
        } else {
          existing.properties = props;
        }
      } else {
        surface.componentsModel.addComponent(ComponentModel(id, type!, props));
      }
    }
  }

  void _processUpdateDataModel(UpdateDataModelMessage message) {
    final SurfaceModel<T>? surface = groupModel.getSurface(message.surfaceId);
    if (surface == null) {
      throw A2uiStateError('Surface not found: ${message.surfaceId}');
    }

    surface.dataModel.set(message.path ?? '/', message.value);
  }

  void _processDeleteSurface(DeleteSurfaceMessage message) {
    groupModel.deleteSurface(message.surfaceId);
  }

  /// Generates client capabilities.
  Map<String, dynamic> getClientCapabilities({
    bool includeInlineCatalogs = false,
  }) {
    final v09 = <String, dynamic>{
      'supportedCatalogIds': catalogs.map((c) => c.id).toList(),
    };

    if (includeInlineCatalogs) {
      v09['inlineCatalogs'] = catalogs.map(_generateInlineCatalog).toList();
    }

    return {'v0.9': v09};
  }

  Map<String, dynamic> _generateInlineCatalog(
    Catalog<T, FunctionImplementation> catalog,
  ) {
    final components = <String, dynamic>{};
    for (final MapEntry<String, T> entry in catalog.components.entries) {
      final Map<String, dynamic> jsonSchema = entry.value.schema.toJsonMap();
      _processRefs(jsonSchema);

      // Wrap in A2UI envelope
      components[entry.key] = {
        'allOf': [
          {'\$ref': 'common_types.json#/\$defs/ComponentCommon'},
          {
            'properties': {
              'component': {'const': entry.key},
              ...?(jsonSchema['properties'] as Map<String, dynamic>?),
            },
            'required': ['component', ...?(jsonSchema['required'] as List?)],
          },
        ],
      };
    }

    final List<Map<String, Object>> functions = catalog.functions.values.map((
      f,
    ) {
      final Map<String, dynamic> jsonSchema = f.argumentSchema.toJsonMap();
      _processRefs(jsonSchema);
      return {
        'name': f.name,
        'returnType': f.returnType.jsonValue,
        'parameters': jsonSchema,
      };
    }).toList();

    Map<String, dynamic>? theme;
    if (catalog.themeSchema != null) {
      theme = catalog.themeSchema!.toJsonMap();
      _processRefs(theme);
      theme = theme['properties'] as Map<String, dynamic>?;
    }

    return {
      'catalogId': catalog.id,
      'components': components,
      if (functions.isNotEmpty) 'functions': functions,
      'theme': ?theme,
    };
  }

  void _processRefs(Object? node) {
    if (node is! Map) return;

    if (node['description'] is String &&
        (node['description'] as String).startsWith('REF:')) {
      final desc = node['description'] as String;
      final List<String> parts = desc.substring(4).split('|');
      final String ref = parts[0];
      final String? actualDesc = parts.length > 1 ? parts[1] : null;

      node.clear();
      node['\$ref'] = ref;
      if (actualDesc != null) {
        node['description'] = actualDesc;
      }
      return;
    }

    node.forEach((key, value) {
      if (value is Map) {
        _processRefs(value);
      } else if (value is List) {
        for (final Object? item in value) {
          if (item is Map) {
            _processRefs(item);
          }
        }
      }
    });
  }

  /// Aggregates data models for surfaces with sendDataModel enabled.
  Map<String, dynamic>? getClientDataModel() {
    final surfaces = <String, dynamic>{};
    for (final SurfaceModel<T> surface in groupModel.allSurfaces) {
      if (surface.sendDataModel) {
        surfaces[surface.id] = surface.dataModel.get('/');
      }
    }

    if (surfaces.isEmpty) return null;

    return {'version': 'v0.9', 'surfaces': surfaces};
  }
}

extension SchemaExtension on Schema {
  Map<String, dynamic> toJsonMap() => _deepCopy(value);

  static Map<String, dynamic> _deepCopy(Map<dynamic, dynamic> map) {
    return map.map((key, value) {
      if (value is Map) {
        return MapEntry(key as String, _deepCopy(value));
      }
      if (value is List) {
        return MapEntry(
          key as String,
          value.map((item) => item is Map ? _deepCopy(item) : item).toList(),
        );
      }
      return MapEntry(key as String, value);
    });
  }
}
