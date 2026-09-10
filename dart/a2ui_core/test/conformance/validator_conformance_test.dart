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

/// Runs the shared `conformance/core/validator.yaml` suite against
/// [MessageProcessor.processMessages], the entry point for checking a payload
/// on its own.
///
/// Cases targeting a protocol version this SDK does not implement are skipped
/// with a reason, so the suite doubles as the implementation checklist.
void main() {
  final List<Map<String, Object?>> cases = loadConformanceSuite(
    'core/validator.yaml',
  );

  group('conformance core/validator.yaml', () {
    test('suite is not empty', () => expect(cases, isNotEmpty));

    for (final testCase in cases) {
      test(
        testCase['name']! as String,
        () => _runCase(testCase),
        skip: _skipReason(testCase),
      );
    }
  });
}

/// Why a case cannot run yet, or null when it can.
String? _skipReason(Map<String, Object?> testCase) {
  final String? version = caseVersion(testCase);
  if (version != null && version != '0.9') {
    return 'Targets protocol v$version; this SDK implements v0.9 only.';
  }
  return null;
}

void _runCase(Map<String, Object?> testCase) {
  final config = testCase['catalog']! as Map<String, Object?>;
  final Map<String, Object?> catalogDocument = _document(
    config['catalog_schema'],
  );
  final Map<String, Object?>? commonTypes =
      config.containsKey('common_types_schema')
      ? _document(config['common_types_schema'])
      : null;

  for (final Map<String, Object?> step in _steps(testCase)) {
    final List<Map<String, Object?>> payload =
        (step['payload']! as List<Object?>).cast<Map<String, Object?>>();
    // A fresh processor per step, as the reference Python harness does: each
    // step is an independent payload, not a continuation of the previous one.
    final processor = MessageProcessor<ComponentApi>(
      catalogs: [_catalogFor(catalogDocument, payload)],
      protocolVersion: A2uiProtocolVersion.v0_9,
      commonTypesSchema: commonTypes,
    );

    // An incremental payload presupposes a surface the client already holds.
    // The case carries only the payload, so that surface is established here
    // before the payload is applied; without it every incremental case would
    // fail as "surface not found" rather than on what it means to test.
    _seedReferencedSurfaces(processor, payload);

    final Object? expectError =
        step['expect_error'] ?? testCase['expect_error'];
    // A case states one payload and expects a verdict on it, so the payload is
    // treated as a finished render: applied, then checked for completeness on
    // every surface it creates. Without the second step a missing root or an
    // unreachable component would go unreported, since neither is settled
    // while messages are still arriving.
    void run() {
      processor.processMessages(
        A2uiMessage.parseAll(
          payload,
          protocolVersion: A2uiProtocolVersion.v0_9,
        ),
      );
      for (final String id in _surfacesCreatedBy(payload)) {
        processor.checkSurfaceComplete(id);
      }
    }

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

/// The surfaces [payload] creates, which are the ones it renders in full.
Set<String> _surfacesCreatedBy(List<Map<String, Object?>> payload) => {
  for (final Map<String, Object?> envelope in payload)
    if (envelope['createSurface'] case final Map<String, Object?> body)
      if (body['surfaceId'] case final String id) id,
};

/// Creates any surface [payload] updates but does not itself create.
///
/// A payload that only updates components is incremental: it describes a
/// change to a surface the client already has. The suite states the payload
/// alone, so the surface it assumes is created here, empty, and the payload is
/// then applied to it. References into it still resolve against nothing, which
/// is what the dangling-reference cases rely on.
void _seedReferencedSurfaces(
  MessageProcessor<ComponentApi> processor,
  List<Map<String, Object?>> payload,
) {
  final created = <String>{
    for (final Map<String, Object?> envelope in payload)
      if (envelope['createSurface'] case final Map<String, Object?> body)
        if (body['surfaceId'] case final String id) id,
  };
  final referenced = <String>{
    for (final Map<String, Object?> envelope in payload)
      for (final String key in const ['updateComponents', 'updateDataModel'])
        if (envelope[key] case final Map<String, Object?> body)
          if (body['surfaceId'] case final String id)
            if (!created.contains(id)) id,
  };
  if (referenced.isEmpty) return;

  processor.processMessages([
    for (final String id in referenced)
      CreateSurfaceMessage(
        surfaceId: id,
        catalogId: processor.catalogs.single.id,
      ),
  ]);
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

/// Builds the catalog a payload is validated against from the one document a
/// case declares.
///
/// The suite's fixtures name the catalog `standard` in the document but `std`
/// in the payloads that use it. The processor resolves the catalog a surface
/// names against the ones it supports, so the mismatch would reject those
/// payloads outright, which is not what these cases are testing — they are
/// about the component graph. So the document is registered under the id the
/// payload names, and catalog resolution keeps its own coverage in
/// `processor_test.dart`.
Catalog<ComponentApi, FunctionImplementation> _catalogFor(
  Map<String, Object?> document,
  List<Map<String, Object?>> payload,
) {
  String id = document['catalogId'] as String? ?? 'standard';
  for (final envelope in payload) {
    final Object? body = envelope['createSurface'];
    if (body is Map<String, Object?> && body['catalogId'] is String) {
      id = body['catalogId']! as String;
      break;
    }
  }
  return rendererCatalog(document, asCatalogId: id);
}

/// Matches the error a case expects, by category and message.
///
/// `details` is not asserted. It carries the field path and code a Pydantic
/// model reports, which this SDK does not model; the category and message
/// pin the same behaviour.
Matcher _matchesError(Object? expectError) {
  if (expectError is String) {
    return _messageMatches(expectError);
  }
  final Map<String, Object?> expected = (expectError! as Map)
      .cast<String, Object?>();
  final Matcher category = _categoryMatches(expected['category'] as String?);
  final Object? message = expected['message'];
  if (message is! String) return category;
  return allOf(category, _messageMatches(message));
}

Matcher _categoryMatches(String? category) => switch (category) {
  'ParseError' => isA<A2uiParseError>(),
  'ValidationError' => isA<A2uiValidationError>(),
  'CatalogError' => isA<A2uiCatalogError>(),
  'IntegrityError' => isA<A2uiIntegrityError>(),
  'RecursionError' => isA<A2uiRecursionError>(),
  'CompileError' => isA<A2uiCompileError>(),
  'DataError' => isA<A2uiDataError>(),
  'StateError' => isA<A2uiStateError>(),
  _ => isA<A2uiError>(),
};

Matcher _messageMatches(String pattern) => isA<A2uiError>().having(
  (e) => e.message,
  'message',
  matches(RegExp(_align(pattern))),
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
  return pattern;
}
