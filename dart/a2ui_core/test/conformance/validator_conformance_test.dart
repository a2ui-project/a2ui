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
const Map<String, String> _v10ExpectedFailures = {
  'test_custom_catalog_1_0':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_component_nesting_depth_limit_exceeded_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_component_nesting_depth_within_limit':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_data_model_nesting_depth_limit_exceeded_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_incremental_update_circular_reference_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_incremental_update_duplicate_component_id_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_incremental_update_same_component_id_across_messages':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_incremental_update_self_reference_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_incremental_update_without_root':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_multi_surface_independent_roots':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_multi_surface_missing_root_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_circular_reference_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_dangling_child_reference_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_missing_root_component_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_orphaned_component_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_plain_string_property_not_treated_as_child_ref':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_self_reference_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_structured_array_item_dangling_child_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_template_child_reachable':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_topology_template_dangling_reference_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_v10_uax31_invalid_identifier_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_validator_1_0':
      'The v1.0 common types and validator rules are not embedded yet.',
};

/// The `validate` cases in `core/reserved_keys.yaml` expected to fail.
const Map<String, String> _reservedKeysExpectedFailures = {
  'test_escaped_doubled_at_unescaping':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_plain_object_escaped_doubled_at_key':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_plain_object_with_literal_path_and_call':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_reserved_at_call_index':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_reserved_at_call_valid':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_reserved_at_path_valid':
      'The v1.0 common types and validator rules are not embedded yet.',
};

/// Cases in `core/composition_constraints.yaml` expected to fail.
const Map<String, String> _compositionExpectedFailures = {
  'test_composition_surface_implicit_parent_container':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_composition_unallowed_child_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_composition_unallowed_parent_error':
      'The v1.0 common types and validator rules are not embedded yet.',
};

/// Cases in `core/validation_result.yaml` expected to fail.
const Map<String, String> _validationResultExpectedFailures = {
  'test_validation_result_boolean_fallback':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_validation_result_dynamic_object_return':
      'The v1.0 common types and validator rules are not embedded yet.',
};

/// Cases in `core/index_function.yaml` expected to fail.
const Map<String, String> _indexFunctionExpectedFailures = {
  'test_index_function_in_collection_loop':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_index_function_nested_path':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_index_function_outside_loop_error':
      'The v1.0 common types and validator rules are not embedded yet.',
  'test_index_function_with_offset':
      'The v1.0 common types and validator rules are not embedded yet.',
};

/// Runs the shared validator suites against [MessageProcessor.processMessages],
/// the entry point for checking a payload on its own: the `validate` cases of
/// `core/validator_v0_9.yaml`, `core/validator_v1_0.yaml`,
/// `core/reserved_keys.yaml`, `core/composition_constraints.yaml`,
/// `core/validation_result.yaml` and `core/index_function.yaml`.
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
    'core/index_function.yaml',
    expectedFailures: _indexFunctionExpectedFailures,
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
  final List<Map<String, Object?>> allPayloads = [
    for (final Map<String, Object?> step in steps)
      if (step['messages'] ?? step['payload'] case final List<Object?> raw)
        for (final Object? item in raw) (item as Map).cast<String, Object?>(),
  ];

  final String version = _versionOf(testCase, allPayloads);
  final processor = MessageProcessor<ComponentApi>(
    catalogs: _catalogsFor(
      _documentsFor(testCase, version),
      allPayloads,
      version,
    ),
    commonTypesSchema: _commonTypesFor(testCase),
    // The validator cases are about what a renderer rejects, so the graph
    // checks are on, as in the other SDKs' harnesses.
    validationConfig: ValidationConfig.strict,
  );

  for (var stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    final Map<String, Object?> step = steps[stepIndex];
    final Object? rawPayload = step['messages'] ?? step['payload'];
    if (rawPayload is! List) continue;
    final List<Map<String, Object?>> payload = [
      for (final Object? item in rawPayload)
        (item as Map).cast<String, Object?>(),
    ];

    final Object? expectError = step['expectError'] ??
        step['expect_error'] ??
        (stepIndex == steps.length - 1
            ? (testCase['expectError'] ?? testCase['expect_error'])
            : null);
    void run() => processor.processMessages(payload);

    if (expectError != null) {
      expect(
        run,
        throwsA(_matchesError(expectError)),
        reason: testCase['name'] as String?,
      );
    } else {
      expect(run, returnsNormally, reason: testCase['name'] as String?);
    }
  }
}

/// The catalog documents a case declares, inline or by path.
///
/// A case either lists its catalogs under `catalogPaths` or states one under
/// `catalog`, which is the document itself unless it carries a
/// `catalog_schema` path. A case naming none is checked against the v0.9
/// basic catalog.
List<Map<String, Object?>> _documentsFor(
  Map<String, Object?> testCase,
  String version,
) {
  final List<Map<String, Object?>> documents = [];
  if (testCase['catalogPaths'] case final List<Object?> paths) {
    for (final path in paths) {
      if (path is String) documents.add(_document(path));
    }
  } else if (testCase['catalog'] case final Map<String, Object?> catalog) {
    documents.add(
      catalog.containsKey('catalog_schema')
          ? _document(catalog['catalog_schema'])
          : catalog,
    );
  }

  if (documents.isEmpty) {
    documents.add(
      _document(
        compareVersions(version, 'v1.0') >= 0
            ? 'catalogs/basic/v1/catalog.json'
            : 'specification/v0_9/catalogs/basic/catalog.json',
      ),
    );
  }
  return documents;
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
    if (envelope['version'] case final String version) return version;
  }
  return caseVersion(testCase) ?? 'v0.9';
}

/// The shared common-types document a case declares, or null to use the copy
/// this package publishes for the protocol version.
Map<String, Object?>? _commonTypesFor(Map<String, Object?> testCase) {
  if (testCase['catalog'] case final Map<String, Object?> catalog) {
    if (catalog.containsKey('common_types_schema')) {
      return _document(catalog['common_types_schema']);
    }
  }
  return null;
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

  final Map<String, Object?> document = documents.single;
  final Set<String> ids = _catalogIdsNamedBy(payload);
  if (ids.isEmpty) {
    ids.add(document['catalogId'] as String? ?? 'standard');
  }
  return [
    for (final String id in ids)
      rendererCatalog(document, asCatalogId: id, protocolVersion: version),
  ];
}

/// The catalog ids the `createSurface` messages in [payload] name.
Set<String> _catalogIdsNamedBy(List<Map<String, Object?>> payload) => <String>{
      for (final Map<String, Object?> envelope in payload)
        if (envelope['createSurface'] case final Map<String, Object?> body)
          if (body['catalogId'] case final String id) id,
    };

/// Matches the error a case expects, by category, message, code, and path.
///
/// `details` is not asserted. It carries the field path and code a Pydantic
/// model reports, which this SDK does not model; the category, message, code,
/// and path pin the same behaviour.
Matcher _matchesError(Object? expectError) {
  if (expectError is String) {
    return _messageMatches(expectError);
  }
  final Map<String, Object?> expected =
      (expectError! as Map).cast<String, Object?>();
  final matchers = <Matcher>[
    _categoryMatches(expected['category'] as String?),
    if (expected['message'] case final String message) _messageMatches(message),
    matchesErrorFields(expected),
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
      'RecursionError' => isA<A2uiRecursionError>(),
      'DataError' => isA<A2uiDataError>(),
      'StateError' => isA<A2uiStateError>(),
      _ => isA<A2uiError>(),
    };

Matcher _messageMatches(String pattern) => isA<A2uiError>().having(
      (e) => e.message,
      'message',
      matches(RegExp(_align(pattern), caseSensitive: false)),
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
