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

import 'catalog_lint.dart';

const Set<String> _docRootKeys = {
  r'$schema',
  'formatVersion',
  'catalogId',
  'protocolVersion',
  'title',
  'description',
  'instructions',
  'metadata',
  'types',
  'surfaceProperties',
  'components',
  'functions',
};

const Set<String> _componentOnlyTypes = {
  'child',
  'childList',
  'action',
  'checkRule',
  'accessibility',
};

const Set<String> _validTypes = {
  'string',
  'number',
  'integer',
  'boolean',
  'enum',
  'const',
  'any',
  'object',
  'array',
  'union',
  'dataBinding',
  'functionCall',
  'ref',
  ..._componentOnlyTypes,
};

String _esc(String token) => token.replaceAll('~', '~0').replaceAll('/', '~1');

/// Semantic linter for A2UI Catalog Documents (`formatVersion: "1.0"`).
///
/// Collects all structural and semantic diagnostics with RFC 6901 JSON Pointer
/// locations instead of failing on the first error.
List<CatalogLintFinding> lintCatalogDocument(Map<String, Object?> doc) {
  final findings = <CatalogLintFinding>[];

  void addError(String code, String path, String message) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: code,
        path: path,
        message: message,
      ),
    );
  }

  final Object? formatVersion = doc['formatVersion'];
  if (formatVersion != catalogDocumentFormatVersion) {
    addError(
      'invalid_catalog_schema',
      '/formatVersion',
      "Unsupported catalog document formatVersion '$formatVersion'; expected "
          "'$catalogDocumentFormatVersion'.",
    );
  }

  final Object? catalogId = doc['catalogId'];
  if (catalogId is! String || catalogId.isEmpty) {
    addError(
      'invalid_catalog_schema',
      '/catalogId',
      "Catalog document must declare a non-empty string 'catalogId'.",
    );
  }

  for (final String key in doc.keys) {
    if (!_docRootKeys.contains(key)) {
      addError(
        'invalid_catalog_schema',
        '/${_esc(key)}',
        "Unknown root property '$key' in Catalog Document.",
      );
    }
  }

  A2uiProtocolVersion effectiveVersion = A2uiProtocolVersion.v1_0;
  final Object? rawVersion = doc['protocolVersion'];
  if (rawVersion != null) {
    if (rawVersion is! String) {
      addError(
        'invalid_catalog_schema',
        '/protocolVersion',
        "Catalog 'protocolVersion' must be a string.",
      );
    } else {
      final A2uiProtocolVersion? parsed = A2uiProtocolVersion.tryParseSemVer(
        rawVersion,
      );
      if (parsed == null) {
        addError(
          'invalid_catalog_schema',
          '/protocolVersion',
          "Unsupported catalog 'protocolVersion' '$rawVersion'; supported "
              'versions are ${A2uiProtocolVersion.supportedVersions}.',
        );
      } else {
        effectiveVersion = parsed;
      }
    }
  }

  _lintMetadata(doc['metadata'], '/metadata', addError);

  final definedTypes = <String>{};
  final Object? rawTypes = doc['types'];
  if (rawTypes is Map) {
    for (final Object? key in rawTypes.keys) {
      if (key is String) {
        if (!isValidUax31Identifier(key)) {
          addError(
            'invalid_identifier',
            '/types/${_esc(key)}',
            "Type name '$key' must be a valid UAX #31 identifier.",
          );
        }
        definedTypes.add(key);
      }
    }
    for (final MapEntry<Object?, Object?> entry in rawTypes.entries) {
      final key = '${entry.key}';
      _lintTypeNode(
        entry.value,
        '/types/${_esc(key)}',
        definedTypes: definedTypes,
        allowComponentTypes: false,
        addError: addError,
      );
    }
    // Check direct ref alias cycles in `types`.
    for (final typeName in definedTypes) {
      final visited = <String>{typeName};
      Object? current = rawTypes[typeName];
      while (current is Map && current['type'] == 'ref') {
        final Object? target = current['ref'];
        if (target is! String || !definedTypes.contains(target)) break;
        if (!visited.add(target)) {
          addError(
            'unresolved_local_ref',
            '/types/${_esc(typeName)}/ref',
            "Cyclic local type reference involving '$typeName'.",
          );
          break;
        }
        current = rawTypes[target];
      }
    }
  } else if (rawTypes != null) {
    addError(
      'invalid_catalog_schema',
      '/types',
      "Catalog 'types' must be a JSON object.",
    );
  }

  final Object? rawSp = doc['surfaceProperties'];
  if (rawSp is Map) {
    _lintParameters(
      rawSp['properties'],
      '/surfaceProperties/properties',
      definedTypes: definedTypes,
      allowComponentTypes: false,
      addError: addError,
    );
    final Object? ap = rawSp['additionalProperties'];
    if (ap is Map) {
      _lintTypeNode(
        ap,
        '/surfaceProperties/additionalProperties',
        definedTypes: definedTypes,
        allowComponentTypes: false,
        addError: addError,
      );
    }
  } else if (rawSp != null) {
    addError(
      'invalid_catalog_schema',
      '/surfaceProperties',
      "Catalog 'surfaceProperties' must be a JSON object.",
    );
  }

  // First collect component names so allowedParents/allowedChildren checks can
  // validate references across components in declaration-independent order.
  final componentNames = <String>{};
  final Object? rawComponents = doc['components'];
  if (rawComponents is List) {
    for (var i = 0; i < rawComponents.length; i++) {
      final Object? item = rawComponents[i];
      final path = '/components/$i';
      if (item is! Map) {
        addError(
          'invalid_catalog_schema',
          path,
          'Component entry must be a JSON object.',
        );
        continue;
      }
      final Object? name = item['name'];
      if (name is! String || name.isEmpty) {
        addError(
          'invalid_catalog_schema',
          '$path/name',
          "Component must declare a non-empty string 'name'.",
        );
      } else {
        if (name == Catalog.reservedComponentName) {
          addError(
            'reserved_component_name',
            '$path/name',
            "Component name 'Surface' is reserved and cannot be defined.",
          );
        } else if (!isValidUax31Identifier(name)) {
          addError(
            'invalid_identifier',
            '$path/name',
            "Component name '$name' must be a valid UAX #31 identifier.",
          );
        }
        if (!componentNames.add(name)) {
          addError(
            'duplicate_name',
            '$path/name',
            "Duplicate component name '$name'.",
          );
        }
      }
    }

    for (var i = 0; i < rawComponents.length; i++) {
      final Object? item = rawComponents[i];
      if (item is! Map) continue;
      final path = '/components/$i';
      final Set<String> paramNames = _lintParameters(
        item['parameters'],
        '$path/parameters',
        definedTypes: definedTypes,
        allowComponentTypes: true,
        addError: addError,
      );
      _lintAtLeastOneOf(
        item['atLeastOneOf'],
        '$path/atLeastOneOf',
        paramNames,
        addError,
      );
      _lintAllowedComponents(
        item['allowedParents'],
        '$path/allowedParents',
        componentNames: componentNames,
        allowSurface: true,
        addError: addError,
      );
      _lintAllowedComponents(
        item['allowedChildren'],
        '$path/allowedChildren',
        componentNames: componentNames,
        allowSurface: false,
        addError: addError,
      );
      _lintMetadata(item['metadata'], '$path/metadata', addError);
    }
  } else if (rawComponents != null) {
    addError(
      'invalid_catalog_schema',
      '/components',
      "Catalog 'components' must be a JSON array.",
    );
  }

  final functionNames = <String>{};
  final Object? rawFunctions = doc['functions'];
  if (rawFunctions is List) {
    for (var i = 0; i < rawFunctions.length; i++) {
      final Object? item = rawFunctions[i];
      final path = '/functions/$i';
      if (item is! Map) {
        addError(
          'invalid_catalog_schema',
          path,
          'Function entry must be a JSON object.',
        );
        continue;
      }
      final Object? name = item['name'];
      if (name is! String || name.isEmpty) {
        addError(
          'invalid_catalog_schema',
          '$path/name',
          "Function must declare a non-empty string 'name'.",
        );
      } else {
        if (name.startsWith('@')) {
          addError(
            'reserved_function_name',
            '$path/name',
            "Function name '$name' cannot start with reserved prefix '@'.",
          );
        } else if (!isValidUax31Identifier(name)) {
          addError(
            'invalid_identifier',
            '$path/name',
            "Function name '$name' must be a valid UAX #31 identifier.",
          );
        }
        if (!functionNames.add(name)) {
          addError(
            'duplicate_name',
            '$path/name',
            "Duplicate function name '$name'.",
          );
        }
      }

      final Object? rawReturn = item['returnType'];
      if (rawReturn == null) {
        addError(
          'invalid_catalog_schema',
          '$path/returnType',
          "Function must declare 'returnType'.",
        );
      } else if (rawReturn is Map) {
        final Object? kind = rawReturn['type'];
        if (kind == 'validationResult' &&
            !effectiveVersion.isAtLeast(A2uiProtocolVersion.v1_0)) {
          addError(
            'invalid_catalog_schema',
            '$path/returnType',
            "returnType 'validationResult' requires protocolVersion 1.0+.",
          );
        } else if (kind != 'void' && kind != 'validationResult') {
          _lintTypeNode(
            rawReturn,
            '$path/returnType',
            definedTypes: definedTypes,
            allowComponentTypes: false,
            addError: addError,
          );
        }
      } else if (rawReturn == 'validationResult' &&
          !effectiveVersion.isAtLeast(A2uiProtocolVersion.v1_0)) {
        addError(
          'invalid_catalog_schema',
          '$path/returnType',
          "returnType 'validationResult' requires protocolVersion 1.0+.",
        );
      }

      final reqActivation = item['requiresUserActivation'] == true;
      final Object? callers = item['allowedCallers'];
      if (reqActivation && callers is String && callers != 'rendererOnly') {
        addError(
          'user_activation_allows_agent',
          '$path/allowedCallers',
          'Function declares requiresUserActivation: true with '
              "allowedCallers '$callers'; must be 'rendererOnly'.",
        );
      }

      final Set<String> paramNames = _lintParameters(
        item['parameters'],
        '$path/parameters',
        definedTypes: definedTypes,
        allowComponentTypes: false,
        addError: addError,
      );
      _lintAtLeastOneOf(
        item['atLeastOneOf'],
        '$path/atLeastOneOf',
        paramNames,
        addError,
      );
      final Object? ap = item['additionalParameters'];
      if (ap is Map) {
        _lintTypeNode(
          ap,
          '$path/additionalParameters',
          definedTypes: definedTypes,
          allowComponentTypes: false,
          addError: addError,
        );
      }
    }
  } else if (rawFunctions != null) {
    addError(
      'invalid_catalog_schema',
      '/functions',
      "Catalog 'functions' must be a JSON array.",
    );
  }

  final bool hasErrors = findings.any((f) => f.severity == LintSeverity.error);
  if (!hasErrors) {
    try {
      Catalog.fromDocument(doc);
    } on A2uiError catch (e) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          message: e.message,
        ),
      );
    }
  }

  return List<CatalogLintFinding>.unmodifiable(findings);
}

void _lintMetadata(
  Object? raw,
  String path,
  void Function(String code, String path, String message) addError,
) {
  if (raw == null) return;
  if (raw is! Map) {
    addError('invalid_catalog_schema', path, 'metadata must be a JSON object.');
    return;
  }
  for (final Object? key in raw.keys) {
    if (key != 'extensions') {
      addError(
        'invalid_catalog_schema',
        '$path/${_esc('$key')}',
        "Unknown metadata property '$key'; only 'extensions' is allowed.",
      );
    }
  }
  final Object? ext = raw['extensions'];
  if (ext is Map) {
    for (final Object? key in ext.keys) {
      if (key is! String || !isValidUax31Identifier(key)) {
        addError(
          'invalid_identifier',
          '$path/extensions/${_esc('$key')}',
          "Extension key '$key' must be a valid UAX #31 identifier.",
        );
      }
    }
  } else if (ext != null) {
    addError(
      'invalid_catalog_schema',
      '$path/extensions',
      "metadata 'extensions' must be a JSON object.",
    );
  }
}

Set<String> _lintParameters(
  Object? raw,
  String path, {
  required Set<String> definedTypes,
  required bool allowComponentTypes,
  required void Function(String code, String path, String message) addError,
}) {
  final names = <String>{};
  if (raw == null) return names;
  if (raw is! List) {
    addError(
      'invalid_catalog_schema',
      path,
      'Parameters must be a JSON array.',
    );
    return names;
  }
  for (var i = 0; i < raw.length; i++) {
    final Object? item = raw[i];
    final itemPath = '$path/$i';
    if (item is! Map) {
      addError(
        'invalid_catalog_schema',
        itemPath,
        'Parameter must be a JSON object.',
      );
      continue;
    }
    final Object? name = item['name'];
    if (name is! String || name.isEmpty) {
      addError(
        'invalid_catalog_schema',
        '$itemPath/name',
        "Parameter must declare a non-empty string 'name'.",
      );
    } else {
      if (!isValidUax31Identifier(name)) {
        addError(
          'invalid_identifier',
          '$itemPath/name',
          "Parameter name '$name' must be a valid UAX #31 identifier.",
        );
      }
      if (!names.add(name)) {
        addError(
          'duplicate_name',
          '$itemPath/name',
          "Duplicate parameter name '$name'.",
        );
      }
    }
    _lintTypeNode(
      item,
      itemPath,
      definedTypes: definedTypes,
      allowComponentTypes: allowComponentTypes,
      addError: addError,
    );
  }
  return names;
}

void _lintTypeNode(
  Object? raw,
  String path, {
  required Set<String> definedTypes,
  required bool allowComponentTypes,
  required void Function(String code, String path, String message) addError,
}) {
  if (raw is! Map) {
    addError(
      'invalid_catalog_schema',
      path,
      'Type node must be a JSON object.',
    );
    return;
  }
  final Object? kind = raw['type'];
  if (kind is! String || !_validTypes.contains(kind)) {
    addError(
      'invalid_catalog_schema',
      '$path/type',
      "Unknown or missing type '$kind'.",
    );
    return;
  }
  if (!allowComponentTypes && _componentOnlyTypes.contains(kind)) {
    addError(
      'invalid_catalog_schema',
      '$path/type',
      "Component-only type '$kind' is not allowed in a data-only context.",
    );
  }
  if (kind == 'ref') {
    final Object? ref = raw['ref'];
    if (ref is! String || !definedTypes.contains(ref)) {
      addError(
        'unresolved_local_ref',
        '$path/ref',
        "Unresolved local type reference '$ref'.",
      );
    }
  } else if (kind == 'object') {
    final Set<String> propNames = _lintParameters(
      raw['properties'],
      '$path/properties',
      definedTypes: definedTypes,
      allowComponentTypes: allowComponentTypes,
      addError: addError,
    );
    _lintAtLeastOneOf(
      raw['atLeastOneOf'],
      '$path/atLeastOneOf',
      propNames,
      addError,
    );
    if (raw['additionalProperties'] is Map) {
      _lintTypeNode(
        raw['additionalProperties'],
        '$path/additionalProperties',
        definedTypes: definedTypes,
        allowComponentTypes: allowComponentTypes,
        addError: addError,
      );
    }
  } else if (kind == 'array' && raw['items'] != null) {
    _lintTypeNode(
      raw['items'],
      '$path/items',
      definedTypes: definedTypes,
      allowComponentTypes: allowComponentTypes,
      addError: addError,
    );
  } else if (kind == 'union') {
    final Object? variants = raw['variants'];
    if (variants is! List || variants.length < 2) {
      addError(
        'invalid_catalog_schema',
        '$path/variants',
        'Union type must declare at least 2 variants.',
      );
    } else {
      for (var i = 0; i < variants.length; i++) {
        _lintTypeNode(
          variants[i],
          '$path/variants/$i',
          definedTypes: definedTypes,
          allowComponentTypes: allowComponentTypes,
          addError: addError,
        );
      }
    }
  }
}

void _lintAtLeastOneOf(
  Object? raw,
  String path,
  Set<String> declaredNames,
  void Function(String code, String path, String message) addError,
) {
  if (raw == null) return;
  if (raw is! List || raw.isEmpty) {
    addError(
      'invalid_constraint',
      path,
      'atLeastOneOf must be a non-empty array of parameter name groups.',
    );
    return;
  }
  for (var i = 0; i < raw.length; i++) {
    final Object? group = raw[i];
    final groupPath = '$path/$i';
    if (group is! List || group.isEmpty) {
      addError(
        'invalid_constraint',
        groupPath,
        'atLeastOneOf group must be a non-empty array.',
      );
      continue;
    }
    for (var j = 0; j < group.length; j++) {
      final Object? entry = group[j];
      if (entry is! String || !declaredNames.contains(entry)) {
        addError(
          'invalid_constraint',
          '$groupPath/$j',
          "atLeastOneOf references undeclared parameter '$entry'.",
        );
      }
    }
  }
}

void _lintAllowedComponents(
  Object? raw,
  String path, {
  required Set<String> componentNames,
  required bool allowSurface,
  required void Function(String code, String path, String message) addError,
}) {
  if (raw == null) return;
  if (raw is! List) {
    addError(
      'invalid_constraint',
      path,
      'Allowed component list must be a JSON array.',
    );
    return;
  }
  final seen = <String>{};
  for (var i = 0; i < raw.length; i++) {
    final Object? entry = raw[i];
    final entryPath = '$path/$i';
    if (entry is! String || !isValidUax31Identifier(entry)) {
      addError(
        'invalid_identifier',
        entryPath,
        "Allowed component name '$entry' must be a valid UAX #31 identifier.",
      );
      continue;
    }
    if (!seen.add(entry)) {
      addError(
        'duplicate_name',
        entryPath,
        "Duplicate component name '$entry' in constraint list.",
      );
    }
    if (entry == Catalog.reservedComponentName) {
      if (!allowSurface) {
        addError(
          'invalid_constraint',
          entryPath,
          "'Surface' is only valid in 'allowedParents', not 'allowedChildren'.",
        );
      }
      continue;
    }
    if (!componentNames.contains(entry)) {
      addError(
        'invalid_constraint',
        entryPath,
        "Constraint references undeclared component '$entry'.",
      );
    }
  }
}
