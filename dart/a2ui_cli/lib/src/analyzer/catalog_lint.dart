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

/// Severity level of a [CatalogLintFinding].
enum LintSeverity {
  /// A protocol or schema violation that makes the catalog invalid.
  error,

  /// A non-fatal schema issue such as redundant envelope composition.
  warning,
}

/// A deterministic diagnostic reported by [lintCatalog].
final class CatalogLintFinding {
  /// Whether this finding is a fatal [LintSeverity.error] or a
  /// [LintSeverity.warning].
  final LintSeverity severity;

  /// Stable machine-readable rule identifier (for example,
  /// `'reserved_component_name'` or `'redundant_component_common'`).
  final String code;

  /// Human-readable diagnostic message describing the finding.
  final String message;

  /// Optional RFC 6901 JSON Pointer locating the offending node within the
  /// catalog document (for example, `'/components/Surface'`).
  final String? path;

  /// Creates a [CatalogLintFinding].
  const CatalogLintFinding({
    required this.severity,
    required this.code,
    required this.message,
    this.path,
  });

  @override
  bool operator ==(Object other) =>
      other is CatalogLintFinding &&
      other.severity == severity &&
      other.code == code &&
      other.message == message &&
      other.path == path;

  @override
  int get hashCode => Object.hash(severity, code, message, path);

  @override
  String toString() {
    final location = path != null && path!.isNotEmpty ? ' ($path)' : '';
    return '${severity.name}[$code]$location: $message';
  }
}

const Set<String> _v1AllowedRootKeys = {
  r'$schema',
  r'$id',
  'protocolVersion',
  r'$defs',
  'title',
  'description',
  'catalogId',
  'metadata',
  'instructions',
  'components',
  'functions',
};

const List<String> _optionalRootStringKeys = [
  r'$schema',
  r'$id',
  'title',
  'description',
  'instructions',
];

const Set<String> _v1ComponentCommonProps = {
  'id',
  'catalogId',
  'accessibility',
  'metadata',
};

const Set<String> _v09ComponentCommonProps = {'id', 'accessibility'};

const Set<String> _v09CommonTypesDefs = {
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

const Set<String> _v1CommonTypesDefs = {
  ..._v09CommonTypesDefs,
  'Child',
  'Extensions',
  'FunctionCommon',
};

const Set<String> _v09ReturnTypes = {
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'any',
  'void',
};

const Set<String> _v1ReturnTypes = {..._v09ReturnTypes, 'validationResult'};

String _escapePointer(String token) =>
    token.replaceAll('~', '~0').replaceAll('/', '~1');

String _unescapePointer(String token) =>
    token.replaceAll('~1', '/').replaceAll('~0', '~');

/// Checks a parsed catalog JSON document against deterministic A2UI catalog
/// schema rules.
///
/// Validates core catalog metadata and version rules via `a2ui_core`, v1.0
/// Unicode UAX 31 identifier naming, component and function discriminators,
/// the reserved `Surface` component name, v1.0 `requiresUserActivation: true`
/// on agent-callable functions, and redundant `ComponentCommon` or
/// `FunctionCommon` wrapping.
List<CatalogLintFinding> lintCatalog(Map<String, Object?> catalogJson) {
  final findings = <CatalogLintFinding>[];

  final Object? rawId = catalogJson['catalogId'];
  if (rawId is! String || rawId.isEmpty) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '/catalogId',
        message:
            "Catalog document must declare a non-empty string 'catalogId'.",
      ),
    );
  }

  final A2uiProtocolVersion? version = _parseVersion(
    catalogJson['protocolVersion'],
    findings,
  );
  final bool isV1 = version?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;

  _lintRootFields(catalogJson, isV1: isV1, findings: findings);

  final Map<String, Object?> defs = _extractDefs(
    catalogJson[r'$defs'],
    findings: findings,
  );
  _lintLeafDefs(defs, isV1: isV1, findings: findings);
  _lintRefs(
    catalogJson,
    catalogJson: catalogJson,
    isV1: isV1,
    findings: findings,
  );

  final Map<String, Object?> normalizedCatalog = _normalizeSelfCatalogRefs(
    catalogJson,
  );
  var inlined = normalizedCatalog;
  try {
    final Object? resolved = inlineLocalRefs(
      normalizedCatalog,
      normalizedCatalog,
    );
    if (resolved is Map<String, Object?>) {
      inlined = resolved;
    }
  } on A2uiError catch (e) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'unresolved_local_ref',
        message: e.message,
      ),
    );
  }

  _lintComponents(
    rawComponents: catalogJson['components'],
    inlinedComponents: inlined['components'],
    defs: defs,
    isV1: isV1,
    findings: findings,
  );

  _lintFunctions(
    rawFunctions: catalogJson['functions'],
    inlinedFunctions: inlined['functions'],
    defs: defs,
    isV1: isV1,
    findings: findings,
  );

  final bool hasErrors = findings.any(
    (CatalogLintFinding f) => f.severity == LintSeverity.error,
  );
  if (!hasErrors) {
    try {
      Catalog.fromJson(catalogJson);
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

A2uiProtocolVersion? _parseVersion(
  Object? rawVersion,
  List<CatalogLintFinding> findings,
) {
  if (rawVersion == null) return null;
  if (rawVersion is! String) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '/protocolVersion',
        message: "Catalog 'protocolVersion' must be a string.",
      ),
    );
    return null;
  }
  final A2uiProtocolVersion? parsed = A2uiProtocolVersion.tryParseSemVer(
    rawVersion,
  );
  if (parsed == null) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '/protocolVersion',
        message:
            "Unsupported catalog 'protocolVersion' '$rawVersion'; supported "
            'versions are ${A2uiProtocolVersion.supportedVersions}.',
      ),
    );
  }
  return parsed;
}

void _lintRootFields(
  Map<String, Object?> catalogJson, {
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  for (final String key in _optionalRootStringKeys) {
    final Object? value = catalogJson[key];
    if (value != null && value is! String) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: '/${_escapePointer(key)}',
          message: "Catalog '$key' must be a string.",
        ),
      );
    }
  }

  final Object? rawMetadata = catalogJson['metadata'];
  if (rawMetadata != null) {
    try {
      validateMetadata(rawMetadata);
    } on A2uiError catch (e) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: '/metadata',
          message: e.message,
        ),
      );
    }
  }

  if (isV1) {
    for (final String key in catalogJson.keys) {
      if (!_v1AllowedRootKeys.contains(key)) {
        findings.add(
          CatalogLintFinding(
            severity: LintSeverity.error,
            code: 'invalid_catalog_schema',
            path: '/${_escapePointer(key)}',
            message:
                "Unexpected top-level property '$key' in v1.0 catalog document.",
          ),
        );
      }
    }
  }
}

Map<String, Object?> _extractDefs(
  Object? rawDefs, {
  required List<CatalogLintFinding> findings,
}) {
  if (rawDefs == null) return const {};
  if (rawDefs is! Map) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: r'/$defs',
        message: r"Catalog '$defs' must be an object.",
      ),
    );
    return const {};
  }
  return <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in rawDefs.entries)
      if (entry.key is String) entry.key! as String: entry.value,
  };
}

void _lintLeafDefs(
  Map<String, Object?> defs, {
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  for (final MapEntry<String, Object?> entry in defs.entries) {
    final String defName = entry.key;
    if (defName == 'anyComponent' || defName == 'anyFunction') {
      continue;
    }
    final defPath = '/\$defs/${_escapePointer(defName)}';
    if (defName == 'theme') {
      if (isV1) {
        findings.add(
          CatalogLintFinding(
            severity: LintSeverity.error,
            code: 'invalid_catalog_schema',
            path: defPath,
            message:
                r"Definition '$defs/theme' is not supported in v1.0 catalogs.",
          ),
        );
      }
      continue;
    }
    if (_definesComponentDiscriminator(entry.value)) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: defPath,
          message:
              "Definition '\$defs/$defName' defines a component schema; "
              "declare components under 'components' instead of '\$defs'.",
        ),
      );
    }
  }
}

bool _definesComponentDiscriminator(Object? schema) {
  if (schema is! Map) return false;
  if (_hasComponentConst(schema['properties'])) return true;
  if (schema['allOf'] case final List<Object?> members) {
    return members.any(_definesComponentDiscriminator);
  }
  return false;
}

bool _hasComponentConst(Object? properties) {
  if (properties is! Map) return false;
  final Object? component = properties['component'];
  return component is Map && component.containsKey('const');
}

Map<String, Object?> _normalizeSelfCatalogRefs(
  Map<String, Object?> catalogJson,
) => _rewriteCatalogSelfRefs(catalogJson)! as Map<String, Object?>;

Object? _rewriteCatalogSelfRefs(Object? node) {
  if (node is List) {
    return <Object?>[
      for (final Object? item in node) _rewriteCatalogSelfRefs(item),
    ];
  }
  if (node is! Map) return node;
  return <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in node.entries)
      if (entry.key is String)
        entry.key! as String:
            entry.key == r'$ref' &&
                entry.value is String &&
                (entry.value! as String).startsWith('catalog.json#')
            ? (entry.value! as String).substring('catalog.json'.length)
            : _rewriteCatalogSelfRefs(entry.value),
  };
}

void _lintRefs(
  Object? node, {
  required Map<String, Object?> catalogJson,
  required bool isV1,
  required List<CatalogLintFinding> findings,
  String pointer = '',
}) {
  if (node is Map) {
    for (final MapEntry<Object?, Object?> entry in node.entries) {
      final nextPointer = '$pointer/${_escapePointer('${entry.key}')}';
      final Object? value = entry.value;
      if (entry.key == r'$ref' && value is String) {
        _checkSingleRef(
          value,
          pointer: nextPointer,
          catalogJson: catalogJson,
          isV1: isV1,
          findings: findings,
        );
      }
      _lintRefs(
        value,
        catalogJson: catalogJson,
        isV1: isV1,
        findings: findings,
        pointer: nextPointer,
      );
    }
  } else if (node is List) {
    for (var i = 0; i < node.length; i++) {
      _lintRefs(
        node[i],
        catalogJson: catalogJson,
        isV1: isV1,
        findings: findings,
        pointer: '$pointer/$i',
      );
    }
  }
}

void _checkSingleRef(
  String ref, {
  required String pointer,
  required Map<String, Object?> catalogJson,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  final Set<String> allowedCommonDefs = isV1
      ? _v1CommonTypesDefs
      : _v09CommonTypesDefs;

  if (ref.startsWith('#') ||
      ref == 'catalog.json' ||
      ref.startsWith('catalog.json#')) {
    final String fragment = ref.startsWith('catalog.json')
        ? ref.substring('catalog.json'.length)
        : ref;
    if (!_isResolvableLocalFragment(
      fragment,
      catalogJson: catalogJson,
      allowedCommonDefs: allowedCommonDefs,
    )) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'unresolved_local_ref',
          path: pointer,
          message: "Unresolvable schema reference: '$ref'.",
        ),
      );
    }
    return;
  }

  if (_isCommonTypesDocumentRef(ref)) {
    if (!_isAllowedCommonTypesRef(ref, allowedCommonDefs)) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'unresolved_local_ref',
          path: pointer,
          message:
              "Unresolvable or disallowed common_types.json reference: '$ref'.",
        ),
      );
    }
    return;
  }

  if (isV1) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'unsupported_external_ref',
        path: pointer,
        message:
            "Unsupported external \$ref '$ref' at $pointer: a v1.0 catalog "
            'may only reference local definitions (#/...) or '
            'common_types.json.',
      ),
    );
  }
}

bool _isResolvableLocalFragment(
  String fragment, {
  required Map<String, Object?> catalogJson,
  required Set<String> allowedCommonDefs,
}) {
  if (!fragment.startsWith('#/') || fragment.length <= 2) return false;
  final Object? resolved = _followPointer(catalogJson, fragment.substring(1));
  if (resolved is Map) return true;
  if (!fragment.startsWith(r'#/$defs/')) return false;
  final String rest = fragment.substring(r'#/$defs/'.length);
  if (rest.isEmpty || rest.contains('/')) return false;
  return allowedCommonDefs.contains(_unescapePointer(rest));
}

bool _isAllowedCommonTypesRef(String ref, Set<String> allowedCommonDefs) {
  final int hash = ref.indexOf('#');
  if (hash < 0) return false;
  final String fragment = ref.substring(hash);
  if (!fragment.startsWith(r'#/$defs/')) return false;
  final String rest = fragment.substring(r'#/$defs/'.length);
  if (rest.isEmpty || rest.contains('/')) return false;
  return allowedCommonDefs.contains(_unescapePointer(rest));
}

Object? _followPointer(Object? root, String pointer) {
  if (pointer.isEmpty) return root;
  if (!pointer.startsWith('/')) return null;
  var current = root;
  for (final String rawToken in pointer.substring(1).split('/')) {
    final String token = _unescapePointer(rawToken);
    if (current is Map) {
      if (!current.containsKey(token)) return null;
      current = current[token];
    } else if (current is List) {
      final int? index = int.tryParse(token);
      if (index == null || index < 0 || index >= current.length) return null;
      current = current[index];
    } else {
      return null;
    }
  }
  return current;
}

bool _isCommonTypesDocumentRef(String ref) {
  final int hash = ref.indexOf('#');
  final String document = hash < 0 ? ref : ref.substring(0, hash);
  return document.split('/').last == 'common_types.json';
}

void _lintComponents({
  required Object? rawComponents,
  required Object? inlinedComponents,
  required Map<String, Object?> defs,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  if (rawComponents == null) return;
  if (rawComponents is! Map) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '/components',
        message:
            "Catalog 'components' must be an object mapping names to schemas.",
      ),
    );
    return;
  }

  final Map<Object?, Object?> inlinedMap = inlinedComponents is Map
      ? inlinedComponents
      : rawComponents;

  for (final MapEntry<Object?, Object?> entry in rawComponents.entries) {
    final Object? rawKey = entry.key;
    if (rawKey is! String) continue;
    _lintSingleComponent(
      compName: rawKey,
      rawSchema: entry.value,
      inlinedSchema: inlinedMap[rawKey],
      defs: defs,
      isV1: isV1,
      findings: findings,
    );
  }
}

void _lintSingleComponent({
  required String compName,
  required Object? rawSchema,
  required Object? inlinedSchema,
  required Map<String, Object?> defs,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  final compPath = '/components/${_escapePointer(compName)}';

  if (compName == Catalog.reservedComponentName) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'reserved_component_name',
        path: compPath,
        message:
            "Component name 'Surface' is reserved for the root surface "
            "container in 'allowedParents' and cannot be defined in "
            "'components'.",
      ),
    );
  } else if (isV1 && !isValidUax31Identifier(compName)) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_identifier',
        path: compPath,
        message: "Invalid UAX 31 component identifier '$compName'.",
      ),
    );
  }

  if (rawSchema is! Map) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: compPath,
        message: "Component '$compName' schema must be an object.",
      ),
    );
    return;
  }

  _lintComponentStructure(
    compName,
    rawSchema,
    compPath: compPath,
    findings: findings,
  );

  final Object effectiveSchema = inlinedSchema ?? rawSchema;
  _lintComponentDiscriminator(
    compName,
    effectiveSchema,
    compPath: compPath,
    isV1: isV1,
    findings: findings,
  );

  if (isV1) {
    final seenProps = <String>{};
    for (final String propName in _collectPropertyNames(effectiveSchema)) {
      if (seenProps.add(propName) && !isValidUax31Identifier(propName)) {
        findings.add(
          CatalogLintFinding(
            severity: LintSeverity.error,
            code: 'invalid_identifier',
            path: '$compPath/properties/${_escapePointer(propName)}',
            message:
                "Invalid UAX 31 property identifier '$propName' in component "
                "'$compName'.",
          ),
        );
      }
    }
  }

  _lintComponentCommonUsage(
    compName: compName,
    rawSchema: rawSchema,
    compPath: compPath,
    defs: defs,
    isV1: isV1,
    findings: findings,
  );
}

void _lintComponentDiscriminator(
  String compName,
  Object schema, {
  required String compPath,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  final (bool found, Object? constVal) = _findDiscriminatorConst(
    schema,
    'component',
  );
  if (found) {
    if (constVal != compName) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_discriminator',
          path: '$compPath/properties/component',
          message:
              "Component '$compName' declares 'properties.component.const' "
              "as '${constVal ?? '<missing>'}'; expected '$compName'.",
        ),
      );
    }
  } else if (isV1 && compName != Catalog.reservedComponentName) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'missing_discriminator',
        path: compPath,
        message:
            "Component '$compName' in a v1.0 catalog must declare "
            "'properties.component.const' equal to '$compName'.",
      ),
    );
  }
}

(bool, Object?) _findDiscriminatorConst(Object? schema, String propKey) {
  if (schema is! Map) return (false, null);
  if (schema['properties'] case final Map<Object?, Object?> props) {
    if (props.containsKey(propKey)) {
      final Object? disc = props[propKey];
      return (true, disc is Map ? disc['const'] : null);
    }
  }
  if (schema['allOf'] case final List<Object?> members) {
    for (final member in members) {
      final (bool found, Object? val) = _findDiscriminatorConst(
        member,
        propKey,
      );
      if (found) return (true, val);
    }
  }
  return (false, null);
}

void _lintComponentStructure(
  String compName,
  Map<Object?, Object?> rawSchema, {
  required String compPath,
  required List<CatalogLintFinding> findings,
}) {
  if (rawSchema.containsKey('oneOf') || rawSchema.containsKey('anyOf')) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: compPath,
        message:
            "Component '$compName' must not use 'oneOf' or 'anyOf' at the "
            'component root.',
      ),
    );
  }

  for (final key in ['allowedParents', 'allowedChildren']) {
    final Object? listVal = rawSchema[key];
    if (listVal != null &&
        (listVal is! List || listVal.any((Object? item) => item is! String))) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: '$compPath/$key',
          message:
              "Component '$compName' declares '$key' that is not a list of "
              'component type names.',
        ),
      );
    }
  }

  final Object? rawMetadata = rawSchema['metadata'];
  if (rawMetadata != null) {
    try {
      validateMetadata(rawMetadata);
    } on A2uiError catch (e) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: '$compPath/metadata',
          message: "Component '$compName': ${e.message}",
        ),
      );
    }
  }
}

void _lintComponentCommonUsage({
  required String compName,
  required Map<Object?, Object?> rawSchema,
  required String compPath,
  required Map<String, Object?> defs,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  final int commonRefCount = _countEnvelopeRefs(
    rawSchema,
    defs,
    targetDefName: 'ComponentCommon',
    visitedDefs: <String>{},
  );
  final Set<String> declaredOwnProps = _collectDeclaredOwnProperties(rawSchema);

  if (isV1) {
    if (commonRefCount > 0) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.warning,
          code: 'redundant_component_common',
          path: compPath,
          message:
              "Component '$compName' wraps 'ComponentCommon', which protocol "
              'v1.0 already composes at the message envelope level.',
        ),
      );
    }
    for (final prop in declaredOwnProps) {
      if (_v1ComponentCommonProps.contains(prop)) {
        findings.add(
          CatalogLintFinding(
            severity: LintSeverity.warning,
            code: 'redundant_component_common',
            path: '$compPath/properties/${_escapePointer(prop)}',
            message:
                "Component '$compName' redeclares 'ComponentCommon' envelope "
                "property '$prop', which protocol v1.0 already composes at "
                'the message envelope level.',
          ),
        );
      }
    }
    return;
  }

  if (commonRefCount > 1) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.warning,
        code: 'redundant_component_common',
        path: compPath,
        message:
            "Component '$compName' references 'ComponentCommon' "
            '$commonRefCount times; reference it at most once.',
      ),
    );
  }
  if (commonRefCount >= 1) {
    for (final prop in declaredOwnProps) {
      if (_v09ComponentCommonProps.contains(prop)) {
        findings.add(
          CatalogLintFinding(
            severity: LintSeverity.warning,
            code: 'redundant_component_common',
            path: '$compPath/properties/${_escapePointer(prop)}',
            message:
                "Component '$compName' redeclares 'ComponentCommon' property "
                "'$prop' while already referencing 'ComponentCommon'.",
          ),
        );
      }
    }
  }
}

int _countEnvelopeRefs(
  Object? schema,
  Map<String, Object?> defs, {
  required String targetDefName,
  required Set<String> visitedDefs,
}) {
  if (schema is! Map) return 0;
  var count = 0;

  if (schema[r'$ref'] case final String ref) {
    if (_isNamedCommonDefRef(ref, targetDefName)) {
      count++;
    } else {
      final String? localDef = _extractLocalDefName(ref);
      if (localDef != null &&
          visitedDefs.add(localDef) &&
          defs.containsKey(localDef)) {
        count += _countEnvelopeRefs(
          defs[localDef],
          defs,
          targetDefName: targetDefName,
          visitedDefs: visitedDefs,
        );
        visitedDefs.remove(localDef);
      }
    }
  }

  if (schema['allOf'] case final List<Object?> members) {
    for (final member in members) {
      count += _countEnvelopeRefs(
        member,
        defs,
        targetDefName: targetDefName,
        visitedDefs: visitedDefs,
      );
    }
  }

  return count;
}

String? _extractLocalDefName(String ref) {
  final String normalized = ref.startsWith('catalog.json#')
      ? ref.substring('catalog.json'.length)
      : ref;
  if (!normalized.startsWith(r'#/$defs/')) return null;
  final String rest = normalized.substring(r'#/$defs/'.length);
  if (rest.isEmpty || rest.contains('/')) return null;
  return _unescapePointer(rest);
}

bool _isNamedCommonDefRef(String ref, String defName) =>
    ref == '#/\$defs/$defName' ||
    ref == 'catalog.json#/\$defs/$defName' ||
    ref == 'common_types.json#/\$defs/$defName' ||
    ref.endsWith('/common_types.json#/\$defs/$defName');

Set<String> _collectDeclaredOwnProperties(Object? schema) {
  final result = <String>{};
  void visit(Object? node) {
    if (node is! Map) return;
    if (node['properties'] case final Map<Object?, Object?> props) {
      result.addAll(props.keys.whereType<String>());
    }
    if (node['allOf'] case final List<Object?> members) {
      for (final member in members) {
        visit(member);
      }
    }
  }

  visit(schema);
  return result;
}

Iterable<String> _collectPropertyNames(Object? schema) sync* {
  if (schema is! Map) return;
  if (schema['properties'] case final Map<Object?, Object?> properties) {
    yield* properties.keys.whereType<String>();
  }
  for (final key in const ['allOf', 'anyOf', 'oneOf']) {
    if (schema[key] case final List<Object?> members) {
      for (final member in members) {
        yield* _collectPropertyNames(member);
      }
    }
  }
}

Iterable<String> _collectParameterNames(Object? schema) sync* {
  if (schema is! Map) return;
  if (schema.containsKey('properties') ||
      schema.containsKey('allOf') ||
      schema.containsKey('anyOf') ||
      schema.containsKey('oneOf')) {
    yield* _collectPropertyNames(schema);
    return;
  }
  if (schema['type'] is! String &&
      !schema.containsKey(r'$ref') &&
      !schema.containsKey('not') &&
      schema.values.every((Object? v) => v is Map || v is bool)) {
    yield* schema.keys.whereType<String>().where(
      (String k) => !k.startsWith(r'$'),
    );
  }
}

void _lintFunctions({
  required Object? rawFunctions,
  required Object? inlinedFunctions,
  required Map<String, Object?> defs,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  if (rawFunctions == null) return;
  if (isV1 && rawFunctions is! Map) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '/functions',
        message:
            "Catalog 'functions' in a v1.0 catalog must be an object mapping "
            'function names to definitions.',
      ),
    );
    return;
  }
  if (rawFunctions is! Map && rawFunctions is! List) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '/functions',
        message:
            "Catalog 'functions' must be an object or a list of definitions.",
      ),
    );
    return;
  }

  final List<_ExtractedFunction> functions = _extractFunctions(
    rawFunctions: rawFunctions,
    inlinedFunctions: inlinedFunctions,
    findings: findings,
  );

  final seenNames = <String>{};
  for (final fn in functions) {
    _lintSingleFunction(
      fn,
      seenNames: seenNames,
      defs: defs,
      isV1: isV1,
      findings: findings,
    );
  }
}

void _lintSingleFunction(
  _ExtractedFunction fn, {
  required Set<String> seenNames,
  required Map<String, Object?> defs,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  if (!seenNames.add(fn.name)) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: fn.path,
        message: "Catalog declares more than one function named '${fn.name}'.",
      ),
    );
  }

  if (isV1) {
    if (fn.name.startsWith('@')) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'reserved_function_name',
          path: fn.path,
          message:
              "Function name '${fn.name}' starts with '@', which is reserved "
              'for system functions.',
        ),
      );
    } else if (!isValidUax31Identifier(fn.name)) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_identifier',
          path: fn.path,
          message: "Invalid UAX 31 function identifier '${fn.name}'.",
        ),
      );
    }

    final seenArgs = <String>{};
    for (final String argName in _collectParameterNames(fn.inlinedArgs)) {
      if (seenArgs.add(argName) && !isValidUax31Identifier(argName)) {
        findings.add(
          CatalogLintFinding(
            severity: LintSeverity.error,
            code: 'invalid_identifier',
            path: fn.path,
            message:
                "Invalid UAX 31 argument identifier '$argName' in function "
                "'${fn.name}'.",
          ),
        );
      }
    }
  }

  if (fn.fromMap) {
    _lintFunctionDiscriminator(fn, isV1: isV1, findings: findings);
    if (isV1) {
      _lintFunctionCommonUsage(fn, defs: defs, findings: findings);
    }
  }

  _lintFunctionMetadata(
    fn.name,
    fn.definition,
    fnPath: fn.path,
    isV1: isV1,
    findings: findings,
  );
}

void _lintFunctionDiscriminator(
  _ExtractedFunction fn, {
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  final Object effectiveDef = fn.inlinedDefinition;
  if (isV1) {
    final (bool hasAtCall, Object? atCallConst) = _findDiscriminatorConst(
      effectiveDef,
      '@call',
    );
    final (bool hasLegacyCall, _) = _findDiscriminatorConst(
      effectiveDef,
      'call',
    );
    if (hasAtCall) {
      if (atCallConst != fn.name) {
        findings.add(
          CatalogLintFinding(
            severity: LintSeverity.error,
            code: 'invalid_discriminator',
            path: '${fn.path}/properties/@call',
            message:
                "Function '${fn.name}' declares 'properties.@call.const' as "
                "'${atCallConst ?? '<missing>'}'; expected '${fn.name}'.",
          ),
        );
      }
    } else if (hasLegacyCall) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_discriminator',
          path: '${fn.path}/properties/call',
          message:
              "Function '${fn.name}' in a v1.0 catalog declares legacy "
              "'properties.call'; use 'properties.@call.const' equal to "
              "'${fn.name}'.",
        ),
      );
    } else if (!fn.definition.containsKey('parameters') &&
        !fn.name.startsWith('@')) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'missing_discriminator',
          path: fn.path,
          message:
              "Function '${fn.name}' in a v1.0 catalog must declare "
              "'properties.@call.const' equal to '${fn.name}'.",
        ),
      );
    }
    return;
  }

  final (bool hasCall, Object? callConst) = _findDiscriminatorConst(
    effectiveDef,
    'call',
  );
  if (hasCall && callConst != fn.name) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_discriminator',
        path: '${fn.path}/properties/call',
        message:
            "Function '${fn.name}' declares 'properties.call.const' as "
            "'${callConst ?? '<missing>'}'; expected '${fn.name}'.",
      ),
    );
  }
}

void _lintFunctionCommonUsage(
  _ExtractedFunction fn, {
  required Map<String, Object?> defs,
  required List<CatalogLintFinding> findings,
}) {
  final int commonRefCount = _countEnvelopeRefs(
    fn.definition,
    defs,
    targetDefName: 'FunctionCommon',
    visitedDefs: <String>{},
  );
  if (commonRefCount > 0) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.warning,
        code: 'redundant_function_common',
        path: fn.path,
        message:
            "Function '${fn.name}' wraps 'FunctionCommon', which protocol "
            "v1.0 already composes at the 'FunctionCall' envelope level.",
      ),
    );
  }

  final Set<String> ownProps = _collectDeclaredOwnProperties(fn.definition);
  if (ownProps.contains('catalogId')) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.warning,
        code: 'redundant_function_common',
        path: '${fn.path}/properties/catalogId',
        message:
            "Function '${fn.name}' redeclares 'FunctionCommon' envelope "
            "property 'catalogId', which protocol v1.0 already composes at "
            "the 'FunctionCall' envelope level.",
      ),
    );
  }
}

final class _ExtractedFunction {
  final String name;
  final String path;
  final bool fromMap;
  final Map<Object?, Object?> definition;
  final Object inlinedDefinition;
  final Object? inlinedArgs;

  const _ExtractedFunction({
    required this.name,
    required this.path,
    required this.fromMap,
    required this.definition,
    required this.inlinedDefinition,
    required this.inlinedArgs,
  });
}

List<_ExtractedFunction> _extractFunctions({
  required Object rawFunctions,
  required Object? inlinedFunctions,
  required List<CatalogLintFinding> findings,
}) {
  if (rawFunctions is Map) {
    return _extractMapFunctions(
      rawFunctions: rawFunctions,
      inlinedFunctions: inlinedFunctions,
      findings: findings,
    );
  }
  return _extractListFunctions(
    rawList: rawFunctions as List<Object?>,
    inlinedFunctions: inlinedFunctions,
    findings: findings,
  );
}

List<_ExtractedFunction> _extractMapFunctions({
  required Map<Object?, Object?> rawFunctions,
  required Object? inlinedFunctions,
  required List<CatalogLintFinding> findings,
}) {
  final extracted = <_ExtractedFunction>[];
  final Map<Object?, Object?> inlinedMap = inlinedFunctions is Map
      ? inlinedFunctions
      : rawFunctions;
  for (final MapEntry<Object?, Object?> entry in rawFunctions.entries) {
    final Object? rawKey = entry.key;
    if (rawKey is! String) continue;
    final fnPath = '/functions/${_escapePointer(rawKey)}';
    final Object? rawDef = entry.value;
    if (rawDef is! Map) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: fnPath,
          message: "Function '$rawKey' schema must be an object.",
        ),
      );
      continue;
    }
    final Object inlinedDef = inlinedMap[rawKey] ?? rawDef;
    extracted.add(
      _ExtractedFunction(
        name: rawKey,
        path: fnPath,
        fromMap: true,
        definition: rawDef,
        inlinedDefinition: inlinedDef,
        inlinedArgs: _extractArgsFromMapFunction(inlinedDef),
      ),
    );
  }
  return extracted;
}

List<_ExtractedFunction> _extractListFunctions({
  required List<Object?> rawList,
  required Object? inlinedFunctions,
  required List<CatalogLintFinding> findings,
}) {
  final extracted = <_ExtractedFunction>[];
  final List<Object?> inlinedList = inlinedFunctions is List
      ? inlinedFunctions
      : rawList;
  for (var i = 0; i < rawList.length; i++) {
    final fnPath = '/functions/$i';
    final Object? rawEntry = rawList[i];
    if (rawEntry is! Map) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: fnPath,
          message: 'Function definition entry must be an object.',
        ),
      );
      continue;
    }
    final Object? rawName = rawEntry['name'];
    if (rawName is! String || rawName.isEmpty) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: '$fnPath/name',
          message: "Function definition missing non-empty 'name' string.",
        ),
      );
      continue;
    }
    final Object inlinedEntry =
        (i < inlinedList.length ? inlinedList[i] : rawEntry) ?? rawEntry;
    extracted.add(
      _ExtractedFunction(
        name: rawName,
        path: fnPath,
        fromMap: false,
        definition: rawEntry,
        inlinedDefinition: inlinedEntry,
        inlinedArgs: inlinedEntry is Map ? inlinedEntry['parameters'] : null,
      ),
    );
  }
  return extracted;
}

Object? _extractArgsFromMapFunction(Object? fnDef) => switch (fnDef) {
  {'properties': {'args': final Object? args}} => args,
  {'parameters': final Object? args} => args,
  _ => null,
};

void _lintFunctionMetadata(
  String fnName,
  Map<Object?, Object?> definition, {
  required String fnPath,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  final bool? requiresActivation = _parseRequiresActivation(
    fnName,
    definition['requiresUserActivation'],
    fnPath: fnPath,
    findings: findings,
  );
  final AllowedCallers? allowedCallers = _parseAllowedCallers(
    fnName,
    definition['allowedCallers'],
    fnPath: fnPath,
    findings: findings,
  );

  if (isV1 &&
      requiresActivation == true &&
      allowedCallers != null &&
      allowedCallers != AllowedCallers.rendererOnly) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'user_activation_allows_agent',
        path: '$fnPath/allowedCallers',
        message:
            "Function '$fnName' sets 'requiresUserActivation: true' with "
            "'allowedCallers: ${allowedCallers.jsonValue}'; functions "
            'requiring user activation cannot be agent-callable and must use '
            "'rendererOnly'.",
      ),
    );
  }

  _lintFunctionReturnType(
    fnName,
    definition,
    fnPath: fnPath,
    isV1: isV1,
    findings: findings,
  );
}

bool? _parseRequiresActivation(
  String fnName,
  Object? rawActivation, {
  required String fnPath,
  required List<CatalogLintFinding> findings,
}) {
  if (rawActivation == null) return null;
  if (rawActivation is! bool) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '$fnPath/requiresUserActivation',
        message:
            "Function '$fnName' 'requiresUserActivation' must be a boolean.",
      ),
    );
    return null;
  }
  return rawActivation;
}

AllowedCallers? _parseAllowedCallers(
  String fnName,
  Object? rawCallers, {
  required String fnPath,
  required List<CatalogLintFinding> findings,
}) {
  if (rawCallers == null) return null;
  if (rawCallers is! String) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '$fnPath/allowedCallers',
        message: "Function '$fnName' 'allowedCallers' must be a string.",
      ),
    );
    return null;
  }
  try {
    return AllowedCallers.fromJson(rawCallers);
  } on A2uiError catch (e) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: '$fnPath/allowedCallers',
        message: "Function '$fnName': ${e.message}",
      ),
    );
    return null;
  }
}

void _lintFunctionReturnType(
  String fnName,
  Map<Object?, Object?> definition, {
  required String fnPath,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  if (isV1) {
    _lintV1ReturnType(fnName, definition, fnPath: fnPath, findings: findings);
    return;
  }
  _lintPreV1ReturnType(fnName, definition, fnPath: fnPath, findings: findings);
}

void _lintV1ReturnType(
  String fnName,
  Map<Object?, Object?> definition, {
  required String fnPath,
  required List<CatalogLintFinding> findings,
}) {
  final returnPath = '$fnPath/returnType';
  if (!definition.containsKey('returnType')) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: returnPath,
        message:
            "Function '$fnName' in a v1.0 catalog must declare a string "
            "'returnType'.",
      ),
    );
    return;
  }
  final Object? rawReturn = definition['returnType'];
  if (rawReturn is! String) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: returnPath,
        message: "Function '$fnName' 'returnType' must be a string.",
      ),
    );
    return;
  }
  if (!_v1ReturnTypes.contains(rawReturn)) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: returnPath,
        message:
            "Function '$fnName' declares unknown returnType '$rawReturn'; "
            'expected one of ${_v1ReturnTypes.join(', ')}.',
      ),
    );
  }
}

void _lintPreV1ReturnType(
  String fnName,
  Map<Object?, Object?> definition, {
  required String fnPath,
  required List<CatalogLintFinding> findings,
}) {
  if (definition.containsKey('returnType')) {
    _checkPreV1ReturnTypeString(
      fnName,
      definition['returnType'],
      path: '$fnPath/returnType',
      findings: findings,
    );
  }
  if (definition['properties'] case final Map<Object?, Object?> props
      when props.containsKey('returnType')) {
    final Object? nested = props['returnType'];
    if (nested is! Map || !nested.containsKey('const')) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          path: '$fnPath/properties/returnType',
          message:
              "Function '$fnName' 'properties.returnType' must declare a "
              "string 'const'.",
        ),
      );
      return;
    }
    _checkPreV1ReturnTypeString(
      fnName,
      nested['const'],
      path: '$fnPath/properties/returnType/const',
      findings: findings,
    );
  }
}

void _checkPreV1ReturnTypeString(
  String fnName,
  Object? rawValue, {
  required String path,
  required List<CatalogLintFinding> findings,
}) {
  if (rawValue is! String) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: path,
        message: "Function '$fnName' 'returnType' must be a string.",
      ),
    );
    return;
  }
  if (rawValue == 'validationResult') {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: path,
        message:
            "Function '$fnName' declares returnType 'validationResult', "
            'which requires protocolVersion 1.0 or later.',
      ),
    );
    return;
  }
  if (!_v09ReturnTypes.contains(rawValue)) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        path: path,
        message:
            "Function '$fnName' declares unknown returnType '$rawValue'; "
            'expected one of ${_v09ReturnTypes.join(', ')}.',
      ),
    );
  }
}
