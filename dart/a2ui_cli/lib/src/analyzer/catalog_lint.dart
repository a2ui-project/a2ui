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

  /// Creates a [CatalogLintFinding].
  const CatalogLintFinding({
    required this.severity,
    required this.code,
    required this.message,
  });

  @override
  bool operator ==(Object other) =>
      other is CatalogLintFinding &&
      other.severity == severity &&
      other.code == code &&
      other.message == message;

  @override
  int get hashCode => Object.hash(severity, code, message);

  @override
  String toString() => '${severity.name}: $message';
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

const Set<String> _commonTypesDefs = {
  'AccessibilityAttributes',
  'Action',
  'CallId',
  'CheckRule',
  'Checkable',
  'Child',
  'ChildList',
  'ComponentCommon',
  'ComponentId',
  'DataBinding',
  'DynamicBoolean',
  'DynamicNumber',
  'DynamicString',
  'DynamicStringList',
  'DynamicValue',
  'Extensions',
  'FunctionCall',
  'FunctionCommon',
  'FunctionResponse',
  'IndexSystemFunction',
  'Surface',
};

/// Checks a parsed catalog JSON document against deterministic A2UI catalog
/// schema rules.
///
/// Validates core catalog metadata and version rules via `a2ui_core`, Unicode
/// UAX 31 identifier naming on component, function, property, and parameter
/// names, the reserved `Surface` component name, `requiresUserActivation: true`
/// on agent-callable functions, and redundant `ComponentCommon` wrapping or
/// property redeclaration.
List<CatalogLintFinding> lintCatalog(Map<String, Object?> catalogJson) {
  final findings = <CatalogLintFinding>[];

  final Object? rawId = catalogJson['catalogId'];
  if (rawId is! String || rawId.isEmpty) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
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
  _lintLeafDefs(defs, findings: findings);

  if (isV1) {
    _lintExternalRefs(catalogJson, findings: findings);
  }
  _lintMissingDefRefs(catalogJson, defs: defs, findings: findings);

  var inlined = catalogJson;
  try {
    final Object? resolved = inlineLocalRefs(catalogJson, catalogJson);
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
  required List<CatalogLintFinding> findings,
}) {
  for (final MapEntry<String, Object?> entry in defs.entries) {
    final String defName = entry.key;
    if (defName == 'anyComponent' ||
        defName == 'anyFunction' ||
        defName == 'theme') {
      continue;
    }
    if (_definesComponentDiscriminator(entry.value)) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
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
    for (final member in members) {
      if (member is Map && _hasComponentConst(member['properties'])) {
        return true;
      }
    }
  }
  return false;
}

bool _hasComponentConst(Object? properties) {
  if (properties is! Map) return false;
  final Object? component = properties['component'];
  return component is Map && component.containsKey('const');
}

void _lintExternalRefs(
  Object? node, {
  required List<CatalogLintFinding> findings,
  String pointer = '',
}) {
  if (node is Map) {
    for (final MapEntry<Object?, Object?> entry in node.entries) {
      final String escaped = '${entry.key}'
          .replaceAll('~', '~0')
          .replaceAll('/', '~1');
      final nextPointer = '$pointer/$escaped';
      final Object? value = entry.value;
      if (entry.key == r'$ref' &&
          value is String &&
          !_isSupportedV1Ref(value)) {
        findings.add(
          CatalogLintFinding(
            severity: LintSeverity.error,
            code: 'unsupported_external_ref',
            message:
                "Unsupported external \$ref '$value' at $nextPointer: a v1.0 "
                'catalog may only reference local definitions (#/...) or '
                'common_types.json.',
          ),
        );
      }
      _lintExternalRefs(value, findings: findings, pointer: nextPointer);
    }
  } else if (node is List) {
    for (var i = 0; i < node.length; i++) {
      _lintExternalRefs(node[i], findings: findings, pointer: '$pointer/$i');
    }
  }
}

bool _isSupportedV1Ref(String ref) {
  if (ref.startsWith('#')) return true;
  final int hash = ref.indexOf('#');
  final String document = hash < 0 ? ref : ref.substring(0, hash);
  return document == 'catalog.json' ||
      document.split('/').last == 'common_types.json';
}

void _lintMissingDefRefs(
  Object? node, {
  required Map<String, Object?> defs,
  required List<CatalogLintFinding> findings,
}) {
  if (node is Map) {
    if (node[r'$ref'] case final String ref) {
      _checkDefRef(ref, defs: defs, findings: findings);
    }
    for (final Object? value in node.values) {
      _lintMissingDefRefs(value, defs: defs, findings: findings);
    }
  } else if (node is List) {
    for (final Object? item in node) {
      _lintMissingDefRefs(item, defs: defs, findings: findings);
    }
  }
}

void _checkDefRef(
  String ref, {
  required Map<String, Object?> defs,
  required List<CatalogLintFinding> findings,
}) {
  if (ref.startsWith(r'#/$defs/')) {
    final String defName = ref
        .substring(r'#/$defs/'.length)
        .split('/')
        .first
        .replaceAll('~1', '/')
        .replaceAll('~0', '~');
    if (!defs.containsKey(defName) && !_commonTypesDefs.contains(defName)) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'unresolved_local_ref',
          message: "Unresolvable schema reference: '$ref'.",
        ),
      );
    }
    return;
  }
  if (!_isCommonTypesDocumentRef(ref)) return;
  final int hash = ref.indexOf('#');
  final String fragment = hash < 0 ? '' : ref.substring(hash);
  if (!fragment.startsWith(r'#/$defs/') ||
      !_commonTypesDefs.contains(
        fragment.substring(r'#/$defs/'.length).split('/').first,
      )) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'unresolved_local_ref',
        message: "Unresolvable common_types.json reference: '$ref'.",
      ),
    );
  }
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
  if (compName == Catalog.reservedComponentName) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'reserved_component_name',
        message:
            "Component name 'Surface' is reserved for the root surface "
            "container in 'allowedParents' and cannot be defined in "
            "'components'.",
      ),
    );
  } else if (!isValidUax31Identifier(compName)) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_identifier',
        message: "Invalid UAX 31 component identifier '$compName'.",
      ),
    );
  }

  if (rawSchema is! Map) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        message: "Component '$compName' schema must be an object.",
      ),
    );
    return;
  }

  _lintComponentStructure(compName, rawSchema, findings: findings);

  final Object effectiveSchema = inlinedSchema ?? rawSchema;
  final seenProps = <String>{};
  for (final String propName in _collectPropertyNames(effectiveSchema)) {
    if (seenProps.add(propName) && !isValidUax31Identifier(propName)) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_identifier',
          message:
              "Invalid UAX 31 property identifier '$propName' in component "
              "'$compName'.",
        ),
      );
    }
  }

  _lintComponentCommonUsage(
    compName: compName,
    rawSchema: rawSchema,
    defs: defs,
    isV1: isV1,
    findings: findings,
  );
}

void _lintComponentStructure(
  String compName,
  Map<Object?, Object?> rawSchema, {
  required List<CatalogLintFinding> findings,
}) {
  if (rawSchema.containsKey('oneOf') || rawSchema.containsKey('anyOf')) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
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
          message: "Component '$compName': ${e.message}",
        ),
      );
    }
  }
}

void _lintComponentCommonUsage({
  required String compName,
  required Map<Object?, Object?> rawSchema,
  required Map<String, Object?> defs,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  final int commonRefCount = _countComponentCommonRefs(
    rawSchema,
    defs,
    visitedDefs: <String>{},
  );
  final Set<String> declaredOwnProps = _collectDeclaredOwnProperties(rawSchema);

  if (isV1) {
    if (commonRefCount > 0) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.warning,
          code: 'redundant_component_common',
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
            message:
                "Component '$compName' redeclares 'ComponentCommon' property "
                "'$prop' while already referencing 'ComponentCommon'.",
          ),
        );
      }
    }
  }
}

int _countComponentCommonRefs(
  Object? schema,
  Map<String, Object?> defs, {
  required Set<String> visitedDefs,
}) {
  if (schema is! Map) return 0;
  var count = 0;

  if (schema[r'$ref'] case final String ref) {
    if (_isComponentCommonRef(ref)) {
      count++;
    } else if (ref.startsWith(r'#/$defs/')) {
      final String defName = ref
          .substring(r'#/$defs/'.length)
          .replaceAll('~1', '/')
          .replaceAll('~0', '~');
      if (visitedDefs.add(defName) && defs.containsKey(defName)) {
        count += _countComponentCommonRefs(
          defs[defName],
          defs,
          visitedDefs: visitedDefs,
        );
        visitedDefs.remove(defName);
      }
    }
  }

  if (schema['allOf'] case final List<Object?> members) {
    for (final member in members) {
      count += _countComponentCommonRefs(
        member,
        defs,
        visitedDefs: visitedDefs,
      );
    }
  }

  return count;
}

bool _isComponentCommonRef(String ref) =>
    ref == r'#/$defs/ComponentCommon' ||
    ref == r'common_types.json#/$defs/ComponentCommon' ||
    ref.endsWith(r'/common_types.json#/$defs/ComponentCommon');

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
  if (schema['allOf'] case final List<Object?> members) {
    for (final member in members) {
      yield* _collectPropertyNames(member);
    }
  }
}

Iterable<String> _collectParameterNames(Object? schema) sync* {
  if (schema is! Map) return;
  if (schema.containsKey('properties') || schema.containsKey('allOf')) {
    yield* _collectPropertyNames(schema);
    return;
  }
  if (schema['type'] is! String &&
      !schema.containsKey(r'$ref') &&
      !schema.containsKey('oneOf') &&
      !schema.containsKey('anyOf') &&
      !schema.containsKey('not') &&
      schema.values.every((Object? v) => v is Map || v is bool)) {
    yield* schema.keys.whereType<String>();
  }
}

void _lintFunctions({
  required Object? rawFunctions,
  required Object? inlinedFunctions,
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  if (rawFunctions == null) return;
  if (rawFunctions is! Map && rawFunctions is! List) {
    findings.add(
      const CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
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
    if (!seenNames.add(fn.name)) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          message:
              "Catalog declares more than one function named '${fn.name}'.",
        ),
      );
    }

    if (fn.name.startsWith('@')) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'reserved_function_name',
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
            message:
                "Invalid UAX 31 argument identifier '$argName' in function "
                "'${fn.name}'.",
          ),
        );
      }
    }

    _lintFunctionMetadata(
      fn.name,
      fn.definition,
      isV1: isV1,
      findings: findings,
    );
  }
}

final class _ExtractedFunction {
  final String name;
  final Map<Object?, Object?> definition;
  final Object? inlinedArgs;

  const _ExtractedFunction({
    required this.name,
    required this.definition,
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
    final Object? rawDef = entry.value;
    if (rawDef is! Map) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          message: "Function '$rawKey' schema must be an object.",
        ),
      );
      continue;
    }
    final Object inlinedDef = inlinedMap[rawKey] ?? rawDef;
    extracted.add(
      _ExtractedFunction(
        name: rawKey,
        definition: rawDef,
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
    final Object? rawEntry = rawList[i];
    if (rawEntry is! Map) {
      findings.add(
        const CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          message: 'Function definition entry must be an object.',
        ),
      );
      continue;
    }
    final Object? rawName = rawEntry['name'];
    if (rawName is! String || rawName.isEmpty) {
      findings.add(
        const CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          message: "Function definition missing non-empty 'name' string.",
        ),
      );
      continue;
    }
    final Object? inlinedEntry = i < inlinedList.length
        ? inlinedList[i]
        : rawEntry;
    extracted.add(
      _ExtractedFunction(
        name: rawName,
        definition: rawEntry,
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
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  final bool? requiresActivation = _parseRequiresActivation(
    fnName,
    definition['requiresUserActivation'],
    findings: findings,
  );
  final AllowedCallers? allowedCallers = _parseAllowedCallers(
    fnName,
    definition['allowedCallers'],
    findings: findings,
  );

  if (requiresActivation == true &&
      allowedCallers != null &&
      allowedCallers != AllowedCallers.rendererOnly) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'user_activation_allows_agent',
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
    _extractReturnTypeString(definition),
    isV1: isV1,
    findings: findings,
  );
}

bool? _parseRequiresActivation(
  String fnName,
  Object? rawActivation, {
  required List<CatalogLintFinding> findings,
}) {
  if (rawActivation == null) return null;
  if (rawActivation is! bool) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
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
  required List<CatalogLintFinding> findings,
}) {
  if (rawCallers == null) return null;
  if (rawCallers is! String) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
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
        message: "Function '$fnName': ${e.message}",
      ),
    );
    return null;
  }
}

void _lintFunctionReturnType(
  String fnName,
  String? returnTypeStr, {
  required bool isV1,
  required List<CatalogLintFinding> findings,
}) {
  if (returnTypeStr == null) return;
  try {
    final A2uiReturnType parsedReturn = A2uiReturnType.fromJson(returnTypeStr);
    if (!isV1 && parsedReturn == A2uiReturnType.validationResult) {
      findings.add(
        CatalogLintFinding(
          severity: LintSeverity.error,
          code: 'invalid_catalog_schema',
          message:
              "Function '$fnName' declares returnType 'validationResult', "
              'which requires protocolVersion 1.0 or later.',
        ),
      );
    }
  } on A2uiError catch (e) {
    findings.add(
      CatalogLintFinding(
        severity: LintSeverity.error,
        code: 'invalid_catalog_schema',
        message: "Function '$fnName': ${e.message}",
      ),
    );
  }
}

String? _extractReturnTypeString(Map<Object?, Object?> definition) {
  final Object? props = definition['properties'];
  if (props is Map) {
    final Object? nestedReturn = props['returnType'];
    if (nestedReturn is Map && nestedReturn['const'] is String) {
      return nestedReturn['const']! as String;
    }
  }
  final Object? directReturn = definition['returnType'];
  return directReturn is String ? directReturn : null;
}
