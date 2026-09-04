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
import '../primitives/cancellation.dart';
import '../primitives/reactivity.dart';
import 'contexts.dart';

/// A definition of a UI component's API.
abstract class ComponentApi {
  String get name;
  Schema get schema;
}

/// A component definition parsed from a catalog JSON Schema.
class CatalogComponentDefinition implements ComponentApi {
  @override
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

  @override
  Schema get schema {
    try {
      return Schema.fromMap(Map<String, Object?>.from(rawSchema));
    } catch (_) {
      return Schema.object(properties: {});
    }
  }
}

/// The type of value a function returns.
enum A2uiReturnType {
  string,
  number,
  boolean,
  array,
  object,
  any,
  void_;

  /// The JSON value used in the A2UI protocol.
  String get jsonValue => this == void_ ? 'void' : name;

  /// Parses from the JSON string representation.
  static A2uiReturnType fromJson(String value) {
    if (value == 'void') return void_;
    return values.byName(value);
  }
}

/// A definition of a UI function's API.
abstract class FunctionApi {
  String get name;
  A2uiReturnType get returnType;
  Schema get argumentSchema;
}

/// A function implementation that can be registered with a catalog.
abstract class FunctionImplementation extends FunctionApi {
  /// Executes the function. Can return a static value or a [ReadonlySignal].
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]);
}

/// A function definition parsed from a catalog JSON Schema.
class CatalogFunctionDefinition extends FunctionImplementation {
  @override
  final String name;
  final String? description;
  @override
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

  @override
  Schema get argumentSchema {
    try {
      final argsMap = rawSchema['properties']?['args'];
      if (argsMap is Map) {
        return Schema.fromMap(Map<String, Object?>.from(argsMap));
      }
    } catch (_) {}
    return Schema.object(properties: {});
  }

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    throw UnsupportedError(
      'Catalog function "$name" was loaded from schema and has no Dart client execution handler.',
    );
  }
}

/// A collection of available components and functions.
class Catalog<T extends ComponentApi> {
  final String id;
  final String version;
  final Map<String, T> components;
  final Map<String, FunctionImplementation> functions;
  final Schema? themeSchema;

  Catalog({
    required this.id,
    this.version = 'v0.9.1',
    required List<T> components,
    List<FunctionImplementation> functions = const [],
    this.themeSchema,
  }) : components = {for (var c in components) c.name: c},
       functions = {for (var f in functions) f.name: f};

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
          } else if (ref.contains('ComponentCommon')) {
            result.add({
              'properties': {
                'accessibility': {
                  'type': 'any',
                  'description': 'Accessibility properties',
                },
              },
            });
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

  /// Parses a Catalog from an A2UI catalog JSON Schema representation.
  static Catalog<CatalogComponentDefinition> fromJson(
    Map<String, dynamic> json,
  ) {
    final catalogId =
        json['catalogId'] as String? ?? json['id'] as String? ?? 'default';
    final version = 'v0.9.1';

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

    return Catalog<CatalogComponentDefinition>(
      id: catalogId,
      version: version,
      components: components,
      functions: functions,
    );
  }
}
