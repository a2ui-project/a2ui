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

/// The protocol version [catalogs] target, which is the version of every
/// message a format prompts for, reads and writes with them.
///
/// A catalog that declares no version predates the field, which v1.0 added,
/// so it targets v0.9.
///
/// Catalogs of versions that share message shapes, such as v0.9 and v0.9.1,
/// mix: they target the earliest of their versions, whose messages each of
/// them accepts (see [isCatalogVersionCompatible]).
///
/// Throws [A2uiCatalogError] if [catalogs] is empty, since nothing then
/// states a version, or if they target versions whose messages differ, since
/// a payload is written against one.
A2uiProtocolVersion catalogsProtocolVersion(List<CatalogApi> catalogs) {
  if (catalogs.isEmpty) {
    throw A2uiCatalogError('No catalog states a protocol version.');
  }
  final List<A2uiProtocolVersion> versions = {
    for (final CatalogApi catalog in catalogs)
      catalog.protocolVersion ?? A2uiProtocolVersion.v0_9,
  }.toList()..sort();
  final A2uiProtocolVersion earliest = versions.first;
  if (!versions.every(
    (v) => isCatalogVersionCompatible(v.jsonValue, earliest.jsonValue),
  )) {
    throw A2uiCatalogError(
      'The catalogs target different protocol versions: '
      '${versions.map((v) => v.semverValue).toList()}.',
    );
  }
  return earliest;
}

/// Checks that no two of [catalogs] share an id.
///
/// A format binds each catalog by its id: a surface or a component names its
/// catalog by id, so with two catalogs of one id it could not say which.
///
/// Throws [A2uiCatalogError] naming the first id that repeats.
void checkDistinctIds(List<CatalogApi> catalogs) {
  final ids = <String>{};
  for (final catalog in catalogs) {
    if (!ids.add(catalog.id)) {
      throw A2uiCatalogError(
        "Catalog '${catalog.id}' is bound twice, so its id cannot say which "
        'of the two it names.',
        catalogId: catalog.id,
      );
    }
  }
}

/// Checks that [catalogs] have distinct ids and, if several catalogs are given,
/// that they target A2UI v1.0 or later.
///
/// In Express, when several catalogs are active, components and function calls
/// carry per-item `catalogId` fields, which requires A2UI v1.0 or later.
///
/// Throws [A2uiCatalogError] if any catalog id repeats, if the catalogs target
/// different protocol versions, or if several catalogs target a version before
/// v1.0.
void checkMixedCatalogs(List<CatalogApi> catalogs) {
  checkDistinctIds(catalogs);
  if (catalogs.length > 1) {
    final A2uiProtocolVersion version = catalogsProtocolVersion(catalogs);
    if (!version.isAtLeast(A2uiProtocolVersion.v1_0)) {
      throw A2uiCatalogError(
        'Several catalogs need A2UI v1.0 or later, where components and '
        'function calls carry their own catalogId, but got '
        '${version.semverValue}.',
      );
    }
  }
}

/// The functions of [catalogs] the agent may ask the renderer to run with
/// `callRendererFunction`: those whose `allowedCallers` admits the agent, and
/// which need no user activation, which a call from the agent never has.
List<String> agentCallableFunctions(List<CatalogApi> catalogs) {
  final seen = <String>{};
  return [
    for (final CatalogApi catalog in catalogs)
      if ((catalog.protocolVersion ?? A2uiProtocolVersion.v0_9).isAtLeast(
        A2uiProtocolVersion.v1_0,
      ))
        for (final FunctionApi function in catalog.functions.values)
          if ((function.allowedCallers == AllowedCallers.agentOnly ||
                  function.allowedCallers == AllowedCallers.rendererOrAgent) &&
              !function.requiresUserActivation &&
              seen.add(function.name))
            function.name,
  ];
}

final RegExp _arrayIndexPattern = RegExp(r'^(?:0|[1-9][0-9]*)$');
final RegExp _invalidEscapePattern = RegExp(r'~(?![01])');

const Set<String> _literalValueKeywords = {
  'const',
  'default',
  'enum',
  'examples',
};

const List<String> _schemaCompositeKeywords = [
  'allOf',
  'anyOf',
  'oneOf',
  'not',
];

const Set<String> _schemaMapKeywords = {
  r'$defs',
  'components',
  'definitions',
  'dependencies',
  'dependentSchemas',
  'functions',
  'patternProperties',
  'properties',
  'styles',
};

const Set<String> _preV1CommonTypeDefs = {
  'AccessibilityAttributes',
  'Action',
  'CheckRule',
  'Checkable',
  'ChildList',
  'ComponentCommon',
  'ComponentId',
  'DataBinding',
  'DynamicBoolean',
  'DynamicNumber',
  'DynamicString',
  'DynamicStringList',
  'DynamicValue',
  'FunctionCall',
};

const Set<String> _v1CommonTypeDefs = {
  ..._preV1CommonTypeDefs,
  'CallId',
  'Child',
  'Extensions',
  'FunctionCommon',
  'FunctionResponse',
  'IndexSystemFunction',
  'Surface',
};

Object? _followPointer(Map<String, Object?> document, List<String> segments) {
  Object? current = document;
  for (final segment in segments) {
    if (current is Map && current.containsKey(segment)) {
      current = current[segment];
    } else if (current is List && _arrayIndexPattern.hasMatch(segment)) {
      final int? index = int.tryParse(segment);
      if (index == null || index < 0 || index >= current.length) return null;
      current = current[index];
    } else {
      return null;
    }
  }
  return current;
}

bool _isResolvableLocalRef(
  Map<String, Object?> document,
  String ref,
  Set<String> commonDefs,
) {
  if (ref == '#') return true;
  if (!ref.startsWith('#/')) return false;
  final List<String> rawTokens = ref.substring(2).split('/');
  if (rawTokens.any(_invalidEscapePattern.hasMatch)) return false;
  final List<String> segments = [
    for (final String token in rawTokens)
      token.replaceAll('~1', '/').replaceAll('~0', '~'),
  ];
  if (_followPointer(document, segments) is Map) return true;
  return segments.length == 2 &&
      segments[0] == r'$defs' &&
      commonDefs.contains(segments[1]);
}

bool _isFlatThemeMap(Map<Object?, Object?> value) {
  if (value[r'$ref'] is String) return false;
  final Object? rawType = value['type'];
  if (rawType is String || rawType is List) return false;
  if (value['properties'] is Map) return false;
  return !_schemaCompositeKeywords.any(value.containsKey);
}

bool _isSchemaMapChild(
  Map<Object?, Object?> parent,
  Map<String, Object?> document,
  Object? key,
  Object? value,
) {
  if (value is! Map || key is! String) return false;
  if (_schemaMapKeywords.contains(key)) return true;
  return identical(parent, document) &&
      key == 'theme' &&
      _isFlatThemeMap(value);
}

void _enqueueObjectChildren(
  Map<Object?, Object?> node,
  Map<String, Object?> document,
  bool inSchemaMap,
  List<(Object?, bool)> stack,
) {
  if (inSchemaMap) {
    for (final Object? value in node.values.toList().reversed) {
      stack.add((value, false));
    }
    return;
  }
  for (final MapEntry<Object?, Object?> entry
      in node.entries.toList().reversed) {
    final Object? key = entry.key;
    if (key is! String || !_literalValueKeywords.contains(key)) {
      stack.add((
        entry.value,
        _isSchemaMapChild(node, document, key, entry.value),
      ));
    }
  }
}

/// Validates that every local `#...` `$ref` in [document] resolves.
///
/// Allows `#/$defs/<CommonType>` pointers defined in the protocol version's
/// `common_types.json` so pre-1.0 inline catalogs emitted without `$defs`
/// remain valid, while rejecting undefined catalog-local pointers.
void validateInlineCatalogLocalRefs(
  Map<String, Object?> document,
  String catalogId, {
  A2uiProtocolVersion? protocolVersion,
}) {
  final Set<String> commonDefs =
      (protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false)
      ? _v1CommonTypeDefs
      : _preV1CommonTypeDefs;
  final stack = <(Object?, bool)>[(document, false)];
  while (stack.isNotEmpty) {
    final (Object? node, bool inSchemaMap) = stack.removeLast();
    if (node is List) {
      for (final Object? item in node.reversed) {
        stack.add((item, false));
      }
      continue;
    }
    if (node is! Map) continue;
    if (!inSchemaMap) {
      final Object? ref = node[r'$ref'];
      if (ref is String &&
          ref.startsWith('#') &&
          !_isResolvableLocalRef(document, ref, commonDefs)) {
        throw A2uiCatalogError(
          "Inline catalog '$catalogId' contains an unresolvable local "
          "\$ref '$ref'.",
          catalogId: catalogId,
        );
      }
    }
    _enqueueObjectChildren(node, document, inSchemaMap, stack);
  }
}
