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

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:meta/meta.dart' show internal;

import '../primitives/constants.dart';
import '../primitives/logging.dart';
import '../primitives/simple_items.dart';
import 'catalog_item.dart';
import 'client_function.dart';
import 'data_model.dart';

/// Represents a collection of UI components that a generative AI model can use
/// to construct a user interface.
///
/// A [Catalog] serves three primary purposes:
///
/// 1. Holds a list of [CatalogItem]s, which define the available widgets.
/// 2. Holds a list of [ClientFunction]s, which define available functions.
/// 3. Provides a mechanism to build a Flutter widget from a JSON-like data
///    structure ([JsonMap]).
/// 4. Dynamically generates a [Schema] that describes the structure of all
///    supported widgets and functions, which can be provided to the AI model.
/// 5. Provides instructions for the generated UI, which should be incorporated
///    into the system prompt.
@immutable
interface class Catalog {
  /// Creates a new catalog with the given list of items.
  const Catalog(
    this.items, {
    this.functions = const [],
    this.catalogId,
    this.catalogIdAliases = const [],
    this.systemPromptFragments = const [],
  });

  /// The list of [CatalogItem]s available in this catalog.
  final Iterable<CatalogItem> items;

  /// The list of [ClientFunction]s available in this catalog.
  final Iterable<ClientFunction> functions;

  /// A string that uniquely identifies this catalog.
  ///
  /// The recommended format for this string is reverse-domain name notation,
  /// e.g. 'com.example.my_catalog'.
  final String? catalogId;

  /// Alternate catalog IDs that should also resolve to this catalog.
  final List<String> catalogIdAliases;

  /// Instructions for UI generation.
  ///
  /// This can include explanation when to use which catalog items.
  ///
  /// The items will be incorporated into the system prompt.
  final List<String> systemPromptFragments;

  /// If an item or function with the same name already exists in the catalog,
  /// it will be replaced with the new one.
  Catalog copyWith({
    List<CatalogItem>? newItems,
    List<ClientFunction>? newFunctions,
    String? catalogId,
    List<String>? catalogIdAliases,
    List<String>? systemPromptFragments,
  }) {
    final Map<String, CatalogItem> itemsByName = {
      for (final item in items) item.name: item,
    };
    if (newItems != null) {
      itemsByName.addAll({for (final item in newItems) item.name: item});
    }

    final Map<String, ClientFunction> functionsByName = {
      for (final func in functions) func.name: func,
    };
    if (newFunctions != null) {
      functionsByName.addAll({
        for (final func in newFunctions) func.name: func,
      });
    }

    return Catalog(
      itemsByName.values,
      functions: functionsByName.values,
      catalogId: catalogId ?? this.catalogId,
      catalogIdAliases: catalogIdAliases ?? this.catalogIdAliases,
      systemPromptFragments:
          systemPromptFragments ?? this.systemPromptFragments,
    );
  }

  /// Returns a new [Catalog] instance containing the items from this catalog
  /// with the specified items removed.
  Catalog copyWithout({
    Iterable<CatalogItem>? itemsToRemove,
    Iterable<ClientFunction>? functionsToRemove,
    String? catalogId,
    List<String>? catalogIdAliases,
    List<String>? systemPromptFragments,
  }) {
    List<CatalogItem> updatedItems = items.toList();
    if (itemsToRemove != null) {
      final Set<String> namesToRemove = itemsToRemove
          .map<String>((item) => item.name)
          .toSet();
      updatedItems = items
          .where((item) => !namesToRemove.contains(item.name))
          .toList();
    }

    List<ClientFunction> updatedFunctions = functions.toList();
    if (functionsToRemove != null) {
      final Set<String> namesToRemove = functionsToRemove
          .map<String>((func) => func.name)
          .toSet();
      updatedFunctions = functions
          .where((func) => !namesToRemove.contains(func.name))
          .toList();
    }

    return Catalog(
      updatedItems,
      functions: updatedFunctions,
      catalogId: catalogId ?? this.catalogId,
      catalogIdAliases: catalogIdAliases ?? this.catalogIdAliases,
      systemPromptFragments:
          systemPromptFragments ?? this.systemPromptFragments,
    );
  }

  /// Builds a Flutter widget from a JSON-like data structure.
  Widget buildWidget(CatalogItemContext itemContext) {
    final String widgetType = itemContext.type;
    final CatalogItem? item = items.firstWhereOrNull(
      (item) => item.name == widgetType,
    );
    if (item == null) {
      throw CatalogItemNotFoundException(widgetType, catalogId: catalogId);
    }

    genUiLogger.info('Building widget ${item.name} with id ${itemContext.id}');
    return KeyedSubtree(
      key: ValueKey(itemContext.id),
      child: item.widgetBuilder(
        CatalogItemContext(
          data: itemContext.data,
          id: itemContext.id,
          type: itemContext.type,
          buildChild: (String childId, [DataContext? childDataContext]) =>
              itemContext.buildChild(
                childId,
                childDataContext ?? itemContext.dataContext,
              ),
          dispatchEvent: itemContext.dispatchEvent,
          buildContext: itemContext.buildContext,
          dataContext: itemContext.dataContext,
          getComponent: itemContext.getComponent,
          getCatalogItem: (String type) =>
              items.firstWhereOrNull((item) => item.name == type),
          surfaceId: itemContext.surfaceId,
          reportError: itemContext.reportError,
        ),
      ),
    );
  }

  /// The catalog id used to register this catalog with `a2ui_core` and to match
  /// a live surface back to it: [catalogId] when set, otherwise a synthesized
  /// id for an inline catalog. The advertised id ([toCapabilitiesJson]), the
  /// registered runtime id ([coreCatalogFor]), and `SurfaceController`'s lookup
  /// all use this, so an inline catalog's id cannot diverge between them.
  @internal
  String get effectiveCatalogId => catalogId ?? 'inline_catalog_$hashCode';

  /// Whether this catalog matches [id], either as its canonical ID or one of
  /// its [catalogIdAliases].
  bool matchesId(String id) =>
      effectiveCatalogId == id || catalogIdAliases.contains(id);

  /// Generates a JSON map suitable for inclusion in an inline catalog array
  /// within `A2UiClientCapabilities`.
  ///
  /// This differs from [definition] because `a2ui_client_capabilities.json`
  /// expects `components` to be a direct map of name to schema, and `functions`
  /// to be an array of objects.
  JsonMap toCapabilitiesJson() {
    return {
      'catalogId': effectiveCatalogId,
      'components': {
        for (final item in items) item.name: item.dataSchema.value,
      },
      'functions': [
        for (final func in functions)
          {
            'name': func.name,
            'description': func.description,
            'parameters': func.argumentSchema.value,
            'returnType': func.returnType.value,
          },
      ],
    };
  }

  /// A dynamically generated [Schema] that describes all widgets in the
  /// catalog.
  ///
  /// This schema is a "one-of" object, where the `widget` property can be one
  /// of the schemas from the [items] in the catalog. This is used to inform
  /// the generative AI model about the available UI components and their
  /// expected data structures.
  Schema get definition {
    final Map<String, Schema> componentProperties = {
      for (var item in items) item.name: item.dataSchema,
    };

    final Map<String, Schema> functionProperties = {
      for (var func in functions) func.name: func.argumentSchema,
    };

    return S.object(
      title: 'A2UI Catalog Description Schema',
      description:
          'A schema for a custom Catalog Description including A2UI '
          'components and styles.',
      properties: {
        'components': S.object(
          title: 'A2UI Components',
          description:
              'A schema that defines a catalog of A2UI components. '
              'Each key is a component name, and each value is the JSON '
              'schema for that component\'s properties.',
          properties: componentProperties,
        ),
        'styles': S.object(
          title: 'A2UI Styles',
          description:
              'A schema that defines a catalog of A2UI styles. Each key is a '
              'style name, and each value is the JSON schema for that style\'s '
              'properties.',
          properties: {},
        ),
        'functions': S.object(
          title: 'A2UI Functions',
          description:
              'A schema that defines a catalog of A2UI functions. Each key is '
              'a function name, and each value is the JSON schema for that '
              'function\'s arguments.',
          properties: functionProperties,
        ),
      },
      required: ['components', 'styles', 'functions'],
    );
  }

  /// A dynamically generated [Schema] representing the catalog, including
  /// all custom components, functions, and specification defs.
  Schema get fullSchema {
    final Map<String, dynamic> components = {
      for (final item in items)
        item.name: {
          'type': 'object',
          'allOf': [
            {r'$ref': '$commonTypesSchemaId#/\$defs/ComponentCommon'},
            {r'$ref': r'#/$defs/CatalogComponentCommon'},
            {
              'type': 'object',
              'properties': {
                'component': {'const': item.name},
                ...((item.dataSchema.value['properties']
                        as Map<String, dynamic>?) ??
                    const <String, dynamic>{}),
              },
              'required': {
                'component',
                if (item.dataSchema.value['required'] is List)
                  ...(item.dataSchema.value['required'] as List),
              }.toList(),
            },
          ],
          'unevaluatedProperties': false,
        },
    };

    final Map<String, dynamic> functions = {
      for (final func in this.functions)
        func.name: {
          'type': 'object',
          'description': func.description,
          'properties': {
            'call': {'const': func.name},
            'args': func.argumentSchema.value,
            'returnType': {'const': func.returnType.value},
          },
          'required': ['call', 'args'],
          'unevaluatedProperties': false,
        },
    };

    final Map<String, dynamic> catalogJson = {
      r'$schema': 'https://json-schema.org/draft/2020-12/schema',
      r'$id': 'https://a2ui.org/specification/v0_9/catalog.json',
      'title': 'A2UI Catalog',
      'description': 'Custom catalog of A2UI components and functions.',
      if (catalogId != null) 'catalogId': catalogId,
      'components': components,
      if (functions.isNotEmpty) 'functions': functions,
      r'$defs': {
        'CatalogComponentCommon': {
          'type': 'object',
          'properties': {
            'id': {
              'type': 'string',
              'description':
                  'A unique identifier for this component instance within '
                  'the surface. This ID is used to refer to the component '
                  'in layout children arrays or event handlers.',
            },
          },
          'required': ['id'],
        },
        'theme': {
          'type': 'object',
          'properties': {
            'primaryColor': {
              'type': 'string',
              'description':
                  'The primary brand color used for highlights (e.g., '
                  'primary buttons, active borders). Renderers may generate '
                  'variants of this color for different contexts. Format: '
                  "Hexadecimal code (e.g., '#00BFFF').",
              'pattern': r'^#[0-9a-fA-F]{6}$',
            },
            'iconUrl': {
              'type': 'string',
              'format': 'uri',
              'description':
                  'A URL for an image that identifies the agent or tool '
                  'associated with the surface.',
            },
            'agentDisplayName': {
              'type': 'string',
              'description':
                  'Text to be displayed next to the surface to identify '
                  'the agent or tool that created it.',
            },
          },
          'additionalProperties': true,
        },
        'anyComponent': components.isEmpty
            ? {'not': <String, dynamic>{}}
            : {
                'oneOf': [
                  for (final name in components.keys)
                    {r'$ref': '#/components/$name'},
                ],
                'discriminator': {'propertyName': 'component'},
              },
        'anyFunction': functions.isEmpty
            ? {'not': <String, dynamic>{}}
            : {
                'oneOf': [
                  for (final name in functions.keys)
                    {r'$ref': '#/functions/$name'},
                ],
              },
      },
    };
    return Schema.fromMap(catalogJson);
  }
}

/// An exception thrown when a requested item is not found in the [Catalog].
class CatalogItemNotFoundException implements Exception {
  /// Creates a new [CatalogItemNotFoundException].
  const CatalogItemNotFoundException(this.widgetType, {this.catalogId});

  /// The type of the widget that was not found.
  final String widgetType;

  /// The ID of the catalog that was searched.
  final String? catalogId;

  @override
  String toString() {
    final buffer = StringBuffer();
    buffer.write(
      'CatalogItemNotFoundException: Item "$widgetType" '
      'was not found in catalog',
    );
    if (catalogId != null) {
      buffer.write(' "$catalogId"');
    }
    return buffer.toString();
  }
}

class _CatalogItemComponentApi implements core.ComponentApi {
  _CatalogItemComponentApi(this._item);
  final CatalogItem _item;

  @override
  String get name => _item.name;

  @override
  Schema get schema => _item.dataSchema;
}

/// Builds the `a2ui_core` [core.Catalog] for [catalog], used when constructing
/// a [core.SurfaceModel] so `a2ui_core` lookups see real component metadata
/// instead of an empty stub.
@internal
core.Catalog<core.ComponentApi, core.FunctionImplementation> coreCatalogFor(
  Catalog catalog,
) => core.Catalog<core.ComponentApi, core.FunctionImplementation>(
  id: catalog.effectiveCatalogId,
  components: catalog.items
      .map<core.ComponentApi>(_CatalogItemComponentApi.new)
      .toList(growable: false),
);

/// Builds the `a2ui_core` [core.Catalog] instances for [catalog] and all of its
/// [Catalog.catalogIdAliases], used when constructing a [core.MessageProcessor]
/// so `a2ui_core` can resolve surfaces whether they specify the canonical ID
/// or any of its aliases.
@internal
List<core.Catalog<core.ComponentApi, core.FunctionImplementation>>
allCoreCatalogsFor(Catalog catalog) {
  final List<core.ComponentApi> components = catalog.items
      .map<core.ComponentApi>(_CatalogItemComponentApi.new)
      .toList(growable: false);
  // A `Set` keeps insertion order (canonical ID first) while dropping aliases
  // that repeat the canonical ID or each other, so `a2ui_core` never sees two
  // catalogs registered under the same ID.
  final Set<String> ids = {
    catalog.effectiveCatalogId,
    ...catalog.catalogIdAliases,
  };
  return [
    for (final String id in ids)
      core.Catalog<core.ComponentApi, core.FunctionImplementation>(
        id: id,
        components: components,
      ),
  ];
}
