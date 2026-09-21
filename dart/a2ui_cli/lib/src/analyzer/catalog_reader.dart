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

/// Reads a catalog JSON Schema into the shape code generation needs.
///
/// This deliberately does not reuse `Catalog.fromJson` from `a2ui_core`. That
/// parser exists to serve renderers and the validator, so it produces resolved
/// `Schema` objects and leaves references that point outside the document
/// alone. Code generation needs the opposite: the raw JSON, every `oneOf`
/// branch intact, and the external `common_types.json` references composed in,
/// because that is where a component's `accessibility` and `checks` properties
/// come from.
///
/// Keeping the two separate means the runtime's catalog model can change shape
/// without breaking the generator, and the generator can hold on to schema
/// detail the runtime has no use for.
library;

import 'package:a2ui_core/a2ui_core.dart' show A2uiReturnType;

/// A component definition parsed from a catalog JSON Schema.
class CatalogComponentDefinition {
  final String name;
  final String? description;
  final Map<String, dynamic> rawSchema;
  final Map<String, dynamic> properties;
  final Set<String> requiredProperties;

  CatalogComponentDefinition({
    required this.name,
    this.description,
    required this.rawSchema,
    this.properties = const {},
    this.requiredProperties = const {},
  });
}

/// A function definition parsed from a catalog JSON Schema.
class CatalogFunctionDefinition {
  final String name;
  final String? description;
  final A2uiReturnType returnType;
  final Map<String, dynamic> rawSchema;
  final Map<String, dynamic> parameters;
  final Set<String> requiredParameters;

  CatalogFunctionDefinition({
    required this.name,
    this.description,
    required this.returnType,
    required this.rawSchema,
    this.parameters = const {},
    this.requiredParameters = const {},
  });
}

/// A catalog document, parsed for code generation.
class CodegenCatalog {
  final String id;
  final String version;
  final Map<String, CatalogComponentDefinition> components;
  final Map<String, CatalogFunctionDefinition> functions;

  CodegenCatalog({
    required this.id,
    required this.version,
    required List<CatalogComponentDefinition> components,
    required List<CatalogFunctionDefinition> functions,
  }) : components = {for (final c in components) c.name: c},
       functions = {for (final f in functions) f.name: f};

  static dynamic _resolveJsonPointer(
    Map<String, dynamic> rootDoc,
    String pointer,
  ) {
    if (!pointer.startsWith('#/')) return null;
    final segments = pointer
        .substring(2)
        .split('/')
        .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
    dynamic curr = rootDoc;
    for (final seg in segments) {
      if (curr is Map && curr.containsKey(seg)) {
        curr = curr[seg];
      } else {
        return null;
      }
    }
    return curr;
  }

  /// Schemas for the `common_types.json` definitions a catalog may compose in.
  ///
  /// Catalog components inherit shared behaviour through `allOf` refs into the
  /// protocol's common types document. That document is not bundled with the
  /// catalog, so the refs cannot be followed; the shapes they contribute are
  /// fixed by the specification and are reproduced here instead. Anything not
  /// listed contributes no properties, which is the previous behaviour.
  static const Map<String, Map<String, dynamic>> _commonTypeSubSchemas = {
    'ComponentCommon': {
      'properties': {
        'accessibility': {
          r'$ref':
              'https://a2ui.org/specification/v0_9/'
              'common_types.json#/\$defs/AccessibilityAttributes',
          'description': 'Accessibility properties',
        },
      },
    },
    'Checkable': {
      'properties': {
        'checks': {
          'type': 'array',
          'description':
              'Client-side validation rules evaluated against this component.',
          'items': {
            r'$ref':
                'https://a2ui.org/specification/v0_9/'
                'common_types.json#/\$defs/CheckRule',
          },
        },
      },
    },
  };

  static void _collectSubSchemas(
    Map<String, dynamic> schema,
    Map<String, dynamic> rootDoc,
    List<Map<String, dynamic>> result,
    Set<String> visited,
  ) {
    if (schema['allOf'] is List) {
      for (final sub in schema['allOf'] as List) {
        if (sub is! Map) continue;
        final subMap = Map<String, dynamic>.from(sub);
        final ref = subMap[r'$ref'] as String?;
        if (ref != null) {
          if (ref.startsWith('#/')) {
            if (!visited.contains(ref)) {
              visited.add(ref);
              final target = _resolveJsonPointer(rootDoc, ref);
              if (target is Map) {
                _collectSubSchemas(
                  Map<String, dynamic>.from(target),
                  rootDoc,
                  result,
                  visited,
                );
              }
            }
          } else {
            final defName = ref.split('/').last;
            final known = _commonTypeSubSchemas[defName];
            if (known != null && !visited.contains(ref)) {
              visited.add(ref);
              result.add(known);
            }
          }
        } else {
          _collectSubSchemas(subMap, rootDoc, result, visited);
        }
      }
    }
    if (schema['properties'] is Map || schema['description'] != null) {
      result.add(schema);
    }
  }

  /// Parses a catalog from its A2UI catalog JSON Schema representation.
  static CodegenCatalog fromJson(Map<String, dynamic> json) {
    final catalogId =
        json['catalogId'] as String? ?? json['id'] as String? ?? 'default';
    String version = 'v0.9.1';
    final explicitVersion =
        json['protocolVersion'] as String? ??
        json['version'] as String? ??
        json['specVersion'] as String?;
    if (explicitVersion != null && explicitVersion.isNotEmpty) {
      var v = explicitVersion.trim();
      if (!v.startsWith('v')) v = 'v$v';
      v = v.replaceAll('_', '.');
      if (v == 'v0.9') v = 'v0.9.1';
      version = v;
    } else {
      final idToCheck =
          json['catalogId'] as String? ??
          json[r'$id'] as String? ??
          json[r'$schema'] as String? ??
          '';
      final match = RegExp(r'/(v\d+(_\d+)*)/').firstMatch(idToCheck);
      if (match != null) {
        var v = match.group(1)!;
        v = v.replaceAll('_', '.');
        if (v == 'v0.9') v = 'v0.9.1';
        version = v;
      }
    }

    final permittedNames = <String>{};
    final oneOf = json[r'$defs']?['anyComponent']?['oneOf'];
    if (oneOf is List) {
      for (final item in oneOf) {
        if (item is Map && item[r'$ref'] is String) {
          final refStr = item[r'$ref'] as String;
          if (refStr.startsWith('#/components/')) {
            permittedNames.add(refStr.split('/').last);
          }
        }
      }
    }

    final components = <CatalogComponentDefinition>[];
    final rawComponents = json['components'];
    if (rawComponents is Map) {
      for (final entry in rawComponents.entries) {
        final compName = entry.key.toString();
        if (permittedNames.isNotEmpty && !permittedNames.contains(compName)) {
          continue;
        }

        final compMap = entry.value is Map
            ? Map<String, dynamic>.from(entry.value as Map)
            : <String, dynamic>{};

        final subSchemas = <Map<String, dynamic>>[];
        _collectSubSchemas(compMap, json, subSchemas, <String>{});

        final props = <String, dynamic>{};
        final requiredProps = <String>{};
        String? compDesc = compMap['description'] as String?;

        for (final s in subSchemas) {
          if (compDesc == null && s['description'] is String) {
            compDesc = s['description'] as String;
          }
          if (s['properties'] is Map) {
            props.addAll(Map<String, dynamic>.from(s['properties'] as Map));
          }
          if (s['required'] is List) {
            requiredProps.addAll(
              (s['required'] as List).map((e) => e.toString()),
            );
          }
        }

        components.add(
          CatalogComponentDefinition(
            name: compName,
            description: compDesc,
            rawSchema: compMap,
            properties: props,
            requiredProperties: requiredProps,
          ),
        );
      }
    }

    final functions = <CatalogFunctionDefinition>[];
    final rawFunctions = json['functions'];
    if (rawFunctions is Map) {
      for (final entry in rawFunctions.entries) {
        final fnName = entry.key.toString();
        final fnMap = entry.value is Map
            ? Map<String, dynamic>.from(entry.value as Map)
            : <String, dynamic>{};

        final argsSchema = fnMap['properties']?['args'];
        final params = argsSchema is Map && argsSchema['properties'] is Map
            ? Map<String, dynamic>.from(argsSchema['properties'] as Map)
            : <String, dynamic>{};

        final reqList = argsSchema is Map && argsSchema['required'] is List
            ? (argsSchema['required'] as List).map((e) => e.toString()).toSet()
            : <String>{};

        final returnTypeStr = fnMap['returnType'] as String? ?? 'any';

        functions.add(
          CatalogFunctionDefinition(
            name: fnName,
            description: fnMap['description'] as String?,
            returnType: A2uiReturnType.fromJson(returnTypeStr),
            rawSchema: fnMap,
            parameters: params,
            requiredParameters: reqList,
          ),
        );
      }
    }

    return CodegenCatalog(
      id: catalogId,
      version: version,
      components: components,
      functions: functions,
    );
  }
}
