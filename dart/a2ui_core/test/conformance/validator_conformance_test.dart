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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import '../support/renderer_catalog.dart';
import 'conformance_harness.dart';

/// Conformance cases in `core/validator_v0_9.yaml` that are expected to fail.
const Map<String, String> _v09ExpectedFailures = {};

/// Cases in `core/validator_v1_0.yaml` expected to fail.
const Map<String, String> _v10ExpectedFailures = {};

/// The `validate` cases in `core/reserved_keys.yaml` expected to fail.
const Map<String, String> _reservedKeysExpectedFailures = {};

/// Cases in `core/composition_constraints.yaml` expected to fail.
const Map<String, String> _compositionExpectedFailures = {};

/// Cases in `core/validation_result.yaml` expected to fail.
const Map<String, String> _validationResultExpectedFailures = {};

/// Cases in `core/error_responses.yaml` expected to fail.
const Map<String, String> _errorResponsesExpectedFailures = {};

/// Runs the shared validator suites against [MessageProcessor.processMessages],
/// the entry point for checking a payload on its own: the `validate` cases of
/// `core/validator_v0_9.yaml`, `core/validator_v1_0.yaml`,
/// `core/reserved_keys.yaml`, `core/composition_constraints.yaml`,
/// `core/validation_result.yaml` and `core/error_responses.yaml`.
///
/// Cases targeting a protocol version this SDK does not implement are skipped
/// with a reason, so the suite doubles as the implementation checklist.
void main() {
  _registerValidatorSuite(
    'core/validator_v0_9.yaml',
    expectedFailures: _v09ExpectedFailures,
  );
  _registerValidatorSuite(
    'core/validator_v1_0.yaml',
    expectedFailures: _v10ExpectedFailures,
  );
  _registerValidatorSuite(
    'core/reserved_keys.yaml',
    expectedFailures: _reservedKeysExpectedFailures,
  );
  _registerValidatorSuite(
    'core/composition_constraints.yaml',
    expectedFailures: _compositionExpectedFailures,
  );
  _registerValidatorSuite(
    'core/validation_result.yaml',
    expectedFailures: _validationResultExpectedFailures,
  );
  _registerValidatorSuite(
    'core/error_responses.yaml',
    expectedFailures: _errorResponsesExpectedFailures,
  );
}

void _registerValidatorSuite(
  String suite, {
  Map<String, String> expectedFailures = const {},
}) {
  // Other actions in a shared suite, such as `process_messages`, run in the
  // message-processor harness.
  final List<ConformanceTestCase> cases = [
    for (final ConformanceTestCase testCase in loadConformanceSuite(suite))
      if ((testCase['action'] ?? 'validate') == 'validate') testCase,
  ];

  group('conformance $suite', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    runConformanceSuite(
      cases,
      _runCase,
      expectedFailures: expectedFailures,
      skipReason: _skipReason,
    );
  });
}

/// Why a case cannot run yet, or null when it can.
String? _skipReason(ConformanceTestCase testCase) {
  final String? version = caseVersion(testCase);
  if (version != null && compareVersions(version, 'v0.9') < 0) {
    return 'Targets protocol v$version, which this SDK does not implement.';
  }
  return null;
}

void _runCase(Map<String, Object?> testCase) {
  final List<Map<String, Object?>> steps = _steps(testCase);
  final List<Map<String, Object?>> allPayloads = _collectPayloads(steps);
  final String version = _versionOf(testCase, allPayloads);
  final bool strict = (testCase['strictMode'] as bool?) ?? true;
  final emittedErrors = <ErrorMessage>[];
  final processor = MessageProcessor<ComponentApi>(
    catalogs: _catalogsFor(_documentsFor(testCase), allPayloads, version),
    validationConfig:
        strict ? ValidationConfig.strict : ValidationConfig.relaxed,
    outboundListener: (RendererToAgentMessage msg) {
      if (msg is ErrorMessage) emittedErrors.add(msg);
    },
  );
  addTearDown(processor.dispose);

  for (var stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    _runValidatorStep(
      processor,
      testCase,
      steps[stepIndex],
      isLastStep: stepIndex == steps.length - 1,
      version: version,
      emittedErrors: emittedErrors,
    );
  }
}

List<Map<String, Object?>> _collectPayloads(List<Map<String, Object?>> steps) =>
    [
      for (final Map<String, Object?> step in steps)
        if (step['messages'] ?? step['payload'] case final List<Object?> raw)
          for (final Object? item in raw)
            if (item is Map) item.cast<String, Object?>(),
    ];

void _runValidatorStep(
  MessageProcessor<ComponentApi> processor,
  Map<String, Object?> testCase,
  Map<String, Object?> step, {
  required bool isLastStep,
  required String version,
  required List<ErrorMessage> emittedErrors,
}) {
  if (!step.containsKey('messages') && !step.containsKey('payload')) return;
  final Object? normalizedPayload = _normalizeStepPayload(
    step['messages'] ?? step['payload'],
  );
  final Object? expectError = step['expectError'] ??
      step['expect_error'] ??
      (isLastStep
          ? (testCase['expectError'] ?? testCase['expect_error'])
          : null);
  emittedErrors.clear();
  void run() => processor.processMessages(normalizedPayload);

  if (expectError != null) {
    final Object? firstRaw = switch (normalizedPayload) {
      final List<Object?> list when list.isNotEmpty => list.first,
      _ => normalizedPayload,
    };
    expect(
      run,
      throwsA(
        _matchesError(
          expectError,
          rawMessage: firstRaw,
          defaultVersion: version,
          emittedErrors: emittedErrors,
        ),
      ),
      reason: testCase['name'] as String?,
    );
    return;
  }

  expect(run, returnsNormally, reason: testCase['name'] as String?);
  final Object? expectBlock =
      step['expect'] ?? (isLastStep ? testCase['expect'] : null);
  if (expectBlock is Map<String, Object?>) {
    _assertExpectedSurfaces(processor, expectBlock);
  }
}

Object? _normalizeStepPayload(Object? rawPayload) => switch (rawPayload) {
      final List<Object?> list => [
          for (final Object? item in list)
            item is Map ? item.cast<String, Object?>() : item,
        ],
      final Map<Object?, Object?> map => map.cast<String, Object?>(),
      _ => rawPayload,
    };

void _assertExpectedSurfaces(
  MessageProcessor<ComponentApi> processor,
  Map<String, Object?> expectBlock,
) {
  final Object? surfaces = expectBlock['surfaces'];
  if (surfaces is! Map<String, Object?>) return;
  for (final MapEntry<String, Object?> entry in surfaces.entries) {
    final SurfaceModel<ComponentApi>? surface = processor.model.getSurface(
      entry.key,
    );
    expect(surface, isNotNull, reason: 'Surface ${entry.key} should exist');
    final resolver = NodeResolver<ComponentApi>(surface!);
    addTearDown(resolver.dispose);

    final Map<String, ComponentNode<ComponentApi>> nodes = _collectSurfaceNodes(
      resolver.rootNode.peek(),
    );
    final expectedSurface = entry.value as Map<String, Object?>?;
    final Object? expectedComponents = expectedSurface?['components'];
    if (expectedComponents is Map<String, Object?>) {
      _assertSurfaceComponentProps(nodes, expectedComponents);
    }
  }
}

Map<String, ComponentNode<ComponentApi>> _collectSurfaceNodes(Object? root) {
  final nodes = <String, ComponentNode<ComponentApi>>{};
  final visited = Set<ComponentNode<ComponentApi>>.identity();
  void collect(Object? value) {
    if (value is ComponentNode<ComponentApi>) {
      if (!visited.add(value)) return;
      nodes.putIfAbsent(value.componentId, () => value);
      collect(value.props.peek());
    } else if (value is Map) {
      value.values.forEach(collect);
    } else if (value is List) {
      value.forEach(collect);
    }
  }

  collect(root);
  return nodes;
}

void _assertSurfaceComponentProps(
  Map<String, ComponentNode<ComponentApi>> nodes,
  Map<String, Object?> expectedComponents,
) {
  for (final MapEntry<String, Object?> compEntry
      in expectedComponents.entries) {
    final ComponentNode<ComponentApi>? node = nodes[compEntry.key];
    expect(node, isNotNull, reason: 'Component ${compEntry.key}');
    final expComp = compEntry.value! as Map<String, Object?>;
    final Map<String, dynamic> props = node!.props.peek();
    for (final field in const [
      'validationResult',
      'isValid',
      'validationErrors',
      'validationResults',
    ]) {
      if (expComp.containsKey(field)) {
        expect(
          _unwrapResolved(props[field]),
          equals(expComp[field]),
          reason: '${compEntry.key}.$field',
        );
      }
    }
  }
}

Object? _unwrapResolved(Object? value) => switch (value) {
      final ResolvedBinding<Object?> b => _unwrapResolved(b.value),
      final ValidationResult vr => vr.toJson(),
      final List<Object?> list => list.map(_unwrapResolved).toList(),
      final Map<Object?, Object?> map => <String, Object?>{
          for (final MapEntry<Object?, Object?> e in map.entries)
            '${e.key}': _unwrapResolved(e.value),
        },
      _ => value,
    };

/// The catalog documents a case declares, inline or by path.
///
/// A case either lists its catalogs under `catalogPaths` or states one under
/// `catalog`, which is the document itself unless it carries a
/// `catalog_schema` path. A `catalog` block holding only a `protocolVersion`
/// declares no document. A case declaring none is checked against the SDK's
/// basic catalog for its version (see [_catalogsFor]).
List<Map<String, Object?>> _documentsFor(Map<String, Object?> testCase) {
  if (testCase['catalogPath'] case final String path) {
    return [_document(path)];
  }
  if (testCase['catalogPaths'] case final List<Object?> paths) {
    return [
      for (final Object? path in paths)
        if (path is String) _document(path),
    ];
  }
  if (testCase['catalog'] case final Map<String, Object?> catalog) {
    return _catalogBlockDocuments(catalog);
  }
  return [];
}

List<Map<String, Object?>> _catalogBlockDocuments(
  Map<String, Object?> catalog,
) {
  final Object? rawSchema =
      catalog['catalog_schema'] ?? catalog['catalogSchema'];
  if (rawSchema != null) {
    final Map<String, Object?> schema = _document(rawSchema);
    return [
      {
        if (catalog['protocolVersion'] != null &&
            !schema.containsKey('protocolVersion'))
          'protocolVersion': catalog['protocolVersion'],
        ...schema,
      },
    ];
  }
  if (catalog.containsKey('components') || catalog.containsKey('catalogId')) {
    return [catalog];
  }
  return [];
}

/// The protocol version a case's payloads declare, else the one the case
/// declares, else v0.9.
///
/// A catalog document written before v1.0 declares no version, so the
/// catalogs a case builds take this one.
String _versionOf(
  Map<String, Object?> testCase,
  List<Map<String, Object?>> payloads,
) {
  for (final envelope in payloads) {
    if (envelope['version'] case final String version
        when A2uiProtocolVersion.tryParse(version) != null) {
      return version;
    }
  }
  if (caseVersion(testCase) case final String v) {
    return v.startsWith('v') ? v : 'v$v';
  }
  return 'v0.9';
}

/// The steps a case runs, whether it declares one payload or several.
List<Map<String, Object?>> _steps(Map<String, Object?> testCase) {
  final Object? steps = testCase['steps'];
  if (steps is List<Object?>) return steps.cast<Map<String, Object?>>();
  return [testCase];
}

/// Reads a catalog or common-types document, inline or by path.
Map<String, Object?> _document(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is String) {
    final file = File(resolveConformancePath(value));
    if (!file.existsSync()) {
      throw StateError('Conformance schema not found: ${file.path}');
    }
    return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
  }
  throw StateError('Case declares no catalog schema.');
}

/// Builds the catalogs a payload is validated against from the documents a
/// case declares.
///
/// The suite's fixtures name the catalog `standard` in the document but `std`
/// in the payloads that use it. The processor resolves the catalog a surface
/// names against the ones it supports, so the mismatch would reject those
/// payloads outright, which is not what these cases are testing — they are
/// about the component graph. So a case declaring one document has it
/// registered under every id the payload names, and catalog resolution keeps
/// its own coverage in `processor_test.dart`.
///
/// A case declaring several documents states the catalogs it means to mix, so
/// each is registered under the id it carries and no aliasing applies.
List<Catalog<ComponentApi, FunctionImplementation>> _catalogsFor(
  List<Map<String, Object?>> documents,
  List<Map<String, Object?>> payload,
  String version,
) {
  if (documents.length > 1) {
    return [
      for (final Map<String, Object?> document in documents)
        rendererCatalog(document, protocolVersion: version),
    ];
  }

  final Set<String> ids = {
    for (final String id in _catalogIdsNamedBy(payload))
      if (!_isIntentionallyUnknownCatalogId(id)) id,
  };
  if (documents.isEmpty) {
    final Catalog<ComponentApi, FunctionImplementation> defaultBasic =
        basicCatalogFor(version);
    return [
      defaultBasic,
      for (final String id in ids)
        if (id != defaultBasic.id) basicCatalogFor(version, asCatalogId: id),
    ];
  }
  return _singleDocumentCatalogs(documents.single, ids, version);
}

bool _isIntentionallyUnknownCatalogId(String id) =>
    id.contains('unknown') ||
    id.contains('unregistered') ||
    id.contains('nonexistent');

List<Catalog<ComponentApi, FunctionImplementation>> _singleDocumentCatalogs(
  Map<String, Object?> document,
  Set<String> ids,
  String version,
) {
  final docId = document['catalogId'] as String?;
  if (docId != null) ids.add(docId);
  if (ids.isEmpty) ids.add('standard');

  final bool isBasicDoc =
      docId == BasicCatalog.v0_9Id || docId == BasicCatalog.v1_0Id;
  final String docVersion = switch (docId) {
    BasicCatalog.v0_9Id => 'v0.9',
    BasicCatalog.v1_0Id => 'v1.0',
    _ => (document['protocolVersion'] as String?) ?? version,
  };
  return [
    for (final String id in ids)
      isBasicDoc
          ? basicCatalogFor(docVersion, asCatalogId: id)
          : rendererCatalog(
              document,
              asCatalogId: id,
              protocolVersion: docVersion,
            ),
  ];
}

/// The catalog ids the `createSurface` messages in [payload] name.
Set<String> _catalogIdsNamedBy(List<Map<String, Object?>> payload) => <String>{
      for (final Map<String, Object?> envelope in payload)
        if (envelope['createSurface'] case final Map<String, Object?> body)
          if (body['catalogId'] case final String id) id,
    };

/// Matches the error a case expects, by category, message, code, and path.
Matcher _matchesError(
  Object? expectError, {
  Object? rawMessage,
  String defaultVersion = 'v0.9',
  List<ErrorMessage> emittedErrors = const [],
}) {
  if (expectError is String) {
    return _messageMatches(expectError);
  }
  final Map<String, Object?> expected =
      (expectError! as Map).cast<String, Object?>();
  final matchers = <Matcher>[
    _categoryMatches(expected['category'] as String?),
    if (expected['message'] case final String message) _messageMatches(message),
    matchesErrorFields(
      expected,
      rawMessage: rawMessage,
      defaultVersion: defaultVersion,
      capturedErrorMessage:
          emittedErrors.isNotEmpty ? emittedErrors.last : null,
    ),
  ];
  return allOf(matchers);
}

Matcher _categoryMatches(String? category) => switch (category) {
      'ParseError' => isA<A2uiParseError>(),
      'ValidationError' => anyOf(
          isA<A2uiValidationError>(),
          isA<A2uiIntegrityError>(),
          isA<A2uiRecursionError>(),
          isA<A2uiCatalogError>(),
        ),
      'CatalogError' => isA<A2uiCatalogError>(),
      'IntegrityError' => isA<A2uiIntegrityError>(),
      'RecursionError' => anyOf(
          isA<A2uiRecursionError>(),
          isA<A2uiIntegrityError>(),
        ),
      'DataError' => isA<A2uiDataError>(),
      'StateError' => isA<A2uiStateError>(),
      _ => isA<A2uiError>(),
    };

Matcher _messageMatches(String pattern) => isA<A2uiError>().having(
      (e) => e.message,
      'message',
      anyOf(
        contains(pattern),
        matches(RegExp(_align(pattern), caseSensitive: false)),
      ),
    );

/// Widens a case's expected message to the wording this SDK uses.
///
/// The suite spells some messages the way the Python SDK's JSON Schema
/// library reports them. The reference harness does the same alignment for
/// Pydantic's wording; this is the Dart column of the same table.
String _align(String pattern) {
  if (pattern.contains('is not of type')) {
    return '($pattern|is not of type)';
  }
  if (pattern.contains('is not reachable from')) {
    return '($pattern|Unreachable components)';
  }
  if (pattern.contains('Dangling reference')) {
    return '($pattern|references non-existent component)';
  }
  if (pattern.contains('Circular component reference')) {
    return '($pattern|Circular reference detected)';
  }
  if (pattern.contains('Self-referencing component')) {
    return '($pattern|Self-reference detected)';
  }
  return pattern;
}
