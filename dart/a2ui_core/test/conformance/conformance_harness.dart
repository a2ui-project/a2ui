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

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

/// A single decoded conformance test case map from a YAML suite.
typedef ConformanceTestCase = Map<String, Object?>;

/// Common metadata keys allowed at the top level of every conformance case.
const Set<String> caseMetadataKeys = {
  'action',
  'description',
  'features',
  'name',
};

/// Keys recognized inside an `expectError` block by [matchesErrorFields] and
/// suite error assertions.
const Set<String> knownExpectErrorKeys = {
  'category',
  'code',
  'details',
  'functionCallId',
  'message',
  'path',
  'rendererError',
  'surfaceId',
};

/// Fails the current test if [obj] contains any keys not in [allowed].
void assertKnownKeys(
  Map<String, Object?> obj,
  Set<String> allowed,
  String where,
) {
  final List<String> unknown =
      obj.keys.where((k) => !allowed.contains(k)).toList()..sort();
  if (unknown.isNotEmpty) {
    fail('Unhandled keys at $where: $unknown');
  }
}

/// Appends an executed-case manifest entry when
/// `A2UI_CONFORMANCE_MANIFEST_DIR` (or [manifestDir]) is set.
void recordManifest(
  String suite,
  String name,
  String status, [
  String? reason,
  String? manifestDir,
]) {
  final String? dir =
      manifestDir ?? Platform.environment['A2UI_CONFORMANCE_MANIFEST_DIR'];
  if (dir == null || dir.isEmpty) return;
  Directory(dir).createSync(recursive: true);
  final file = File(
    p.join(dir, 'dart-core-$pid-${Isolate.current.hashCode}.jsonl'),
  );
  final record = <String, Object?>{
    'harness': 'dart-core',
    'suite': suite,
    'case': name,
    'status': status,
    if (reason != null && reason.isNotEmpty) 'reason': reason,
  };
  file.writeAsStringSync(
    '${jsonEncode(record)}\n',
    mode: FileMode.append,
    flush: true,
  );
}

String resolveConformancePath(String relativePath) {
  final String root = _conformanceRoot();
  final String inConformance = p.normalize(p.join(root, relativePath));
  if (File(inConformance).existsSync()) return inConformance;
  final String inRepo = p.normalize(
    p.join(Directory(root).parent.path, relativePath),
  );
  if (File(inRepo).existsSync()) return inRepo;
  return inConformance;
}

String _conformanceRoot() {
  // Walk up, so the harness works from the package directory and the
  // workspace root.
  Directory dir = Directory.current;
  while (true) {
    final candidate = Directory(p.join(dir.path, 'conformance'));
    if (candidate.existsSync() &&
        File(p.join(candidate.path, 'conformance_schema.json')).existsSync()) {
      return candidate.path;
    }
    final Directory parent = dir.parent;
    if (parent.path == dir.path) {
      throw StateError(
        'Could not locate the conformance/ directory above '
        '${Directory.current.path}.',
      );
    }
    dir = parent;
  }
}

/// Reads a JSON document, such as a catalog, from a path relative to the
/// conformance or repository root.
Map<String, Object?> readConformanceJson(String path) {
  final file = File(resolveConformancePath(path));
  if (!file.existsSync()) {
    throw StateError('Conformance document not found: ${file.path}');
  }
  return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
}

/// Whether a catalog document is built for protocol v1.0 or later, which it
/// states with a `protocolVersion` of 1.x. Catalogs built for v0.9 declare
/// none.
bool isAtLeastV1CatalogDocument(Map<String, Object?> document) {
  final Object? declared = document['protocolVersion'];
  if (declared is! String) return false;
  final String version =
      declared.startsWith('v') ? declared.substring(1) : declared;
  return version.split('.').first == '1';
}

/// Loads a conformance suite, for example `core/data_model.yaml`.
List<ConformanceTestCase> loadConformanceSuite(String suite) {
  final file = File(resolveConformancePath(suite));
  if (!file.existsSync()) {
    throw StateError('Conformance suite not found: ${file.path}');
  }
  final Object? parsed = loadYaml(file.readAsStringSync());
  if (parsed is! YamlList) {
    throw StateError('Conformance suite $suite must be a list of cases.');
  }
  return [
    for (final Object? node in parsed)
      normalizeYaml(node)! as ConformanceTestCase,
  ];
}

/// Converts YAML nodes into plain Dart maps, lists and scalars, which
/// `YamlMap` and `YamlList` are not.
Object? normalizeYaml(Object? node) {
  if (node is YamlMap || node is Map) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry
          in (node as Map).cast<Object?, Object?>().entries)
        entry.key.toString(): normalizeYaml(entry.value),
    };
  }
  if (node is YamlList || node is List) {
    return <Object?>[
      for (final Object? item in node as List) normalizeYaml(item),
    ];
  }
  return node;
}

/// The protocol version a case targets, or null when it declares none.
String? caseVersion(ConformanceTestCase testCase) {
  final Object? topVersion = testCase['protocolVersion'];
  if (topVersion is String) {
    return topVersion.startsWith('v') ? topVersion.substring(1) : topVersion;
  }
  final Object? catalog = testCase['catalog'];
  if (catalog is Map<String, Object?>) {
    final Object? catVersion = catalog['version'] ?? catalog['protocolVersion'];
    if (catVersion is String) {
      return catVersion.startsWith('v') ? catVersion.substring(1) : catVersion;
    }
  }
  return null;
}

/// Executes a single conformance [testCase] [body], applying [expectedFailures]
/// and [unsupported] semantics when the case name is listed, and recording the
/// outcome to the executed-case manifest when [suite] is provided.
///
/// A case listed in [expectedFailures] still runs [body]:
/// - If [body] throws (either a [TestFailure] or an unhandled error), the
///   failure is caught and the test is marked skipped via [onSkip] (which
///   defaults to [markTestSkipped]).
/// - If [body] completes normally without throwing, the test fails via [fail]
///   instructing the caller to remove the case from [expectedFailures].
Future<void> runConformanceCase(
  ConformanceTestCase testCase,
  FutureOr<void> Function() body, {
  String? suite,
  Map<String, String> expectedFailures = const {},
  Map<String, String> unsupported = const {},
  void Function(String message) onSkip = markTestSkipped,
  String? manifestDir,
}) async {
  final name = testCase['name']! as String;
  final String? unsupportedReason = unsupported[name];
  if (unsupportedReason != null) {
    _recordIfSuite(suite, name, 'skipped', unsupportedReason, manifestDir);
    onSkip('unsupported: $unsupportedReason');
    return;
  }

  final String? reason = expectedFailures[name];
  if (reason == null) {
    await _runStandardCase(body, suite, name, manifestDir);
    return;
  }

  await _runExpectedFailureCase(
    body,
    suite: suite,
    name: name,
    reason: reason,
    onSkip: onSkip,
    manifestDir: manifestDir,
  );
}

void _recordIfSuite(
  String? suite,
  String name,
  String status, [
  String? reason,
  String? manifestDir,
]) {
  if (suite != null) {
    recordManifest(suite, name, status, reason, manifestDir);
  }
}

Future<void> _runStandardCase(
  FutureOr<void> Function() body,
  String? suite,
  String name,
  String? manifestDir,
) async {
  try {
    await body();
  } catch (error) {
    _recordIfSuite(suite, name, 'failed', '$error', manifestDir);
    rethrow;
  }
  _recordIfSuite(suite, name, 'passed', null, manifestDir);
}

Future<void> _runExpectedFailureCase(
  FutureOr<void> Function() body, {
  required String? suite,
  required String name,
  required String reason,
  required void Function(String message) onSkip,
  required String? manifestDir,
}) async {
  Object? caughtError;
  try {
    await body();
  } catch (error) {
    caughtError = error;
  }

  if (caughtError != null) {
    _recordIfSuite(suite, name, 'xfailed', reason, manifestDir);
    onSkip('expected failure: $reason ($caughtError)');
    return;
  }

  _recordIfSuite(
    suite,
    name,
    'failed',
    'Passed unexpectedly while listed in expectedFailures.',
    manifestDir,
  );
  fail(
    'Test "$name" passed unexpectedly; remove "$name" from expectedFailures.',
  );
}

/// Registers a `test(...)` for each entry in [cases], wrapping execution in
/// [runConformanceCase] with [expectedFailures] and [unsupported].
void runConformanceSuite(
  List<ConformanceTestCase> cases,
  FutureOr<void> Function(ConformanceTestCase testCase) runCase, {
  String? suite,
  Map<String, String> expectedFailures = const {},
  Map<String, String> unsupported = const {},
  String? Function(ConformanceTestCase testCase)? skipReason,
  void Function(String message) onSkip = markTestSkipped,
  String? manifestDir,
}) {
  _verifyNoUnusedEntries(suite, cases, expectedFailures, unsupported);
  for (final testCase in cases) {
    final name = testCase['name']! as String;
    final String? skip = skipReason?.call(testCase);
    test(
      name,
      () {
        if (skip != null) {
          _recordIfSuite(suite, name, 'skipped', skip, manifestDir);
          markTestSkipped(skip);
          return null;
        }
        return runConformanceCase(
          testCase,
          () => runCase(testCase),
          suite: suite,
          expectedFailures: expectedFailures,
          unsupported: unsupported,
          onSkip: onSkip,
          manifestDir: manifestDir,
        );
      },
    );
  }
}

void _verifyNoUnusedEntries(
  String? suite,
  List<ConformanceTestCase> cases,
  Map<String, String> expectedFailures,
  Map<String, String> unsupported,
) {
  if (suite == null) return;
  final Set<String> caseNames = {
    for (final ConformanceTestCase testCase in cases)
      testCase['name']! as String,
  };
  final List<String> unusedExpected =
      expectedFailures.keys.where((k) => !caseNames.contains(k)).toList();
  final List<String> unusedUnsupported =
      unsupported.keys.where((k) => !caseNames.contains(k)).toList();
  if (unusedExpected.isNotEmpty || unusedUnsupported.isNotEmpty) {
    test('$suite: no unused expectedFailures or unsupported entries', () {
      fail(
        'Unused expectedFailures ($unusedExpected) or '
        'unsupported ($unusedUnsupported) in $suite.',
      );
    });
  }
}

/// Reads the error `code` from [error] if it exposes a non-empty string code.
String? extractErrorCode(A2uiError error) {
  final String code = error.code;
  return code.isEmpty ? null : code;
}

/// Reads the error `path` from [error] if its runtime type exposes a `path`
/// property, returning `(supported, value)`.
///
/// `A2uiDataError` and `A2uiValidationError` expose `path` directly; other
/// error types are checked dynamically.
(bool, String?) extractErrorPath(A2uiError error) {
  if (error is A2uiDataError) {
    return (true, error.path);
  }
  if (error is A2uiValidationError) {
    return (true, error.path);
  }
  try {
    final Object? path = (error as dynamic).path;
    if (path is String?) {
      return (true, path);
    }
  } catch (_) {
    // Error type does not expose `path` yet.
  }
  return (false, null);
}

/// Matches the error type an `expectError.category` names. `ValidationError`
/// and `RecursionError` accept the sibling types the SDKs raise for the same
/// condition.
Matcher categoryMatches(String? category) => switch (category) {
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

/// Matches `code` and `path` expectations declared in an `expectError` block
/// against a thrown [A2uiError].
///
/// When `expectError` specifies `code` or `path`:
/// - If the thrown [A2uiError] exposes that field, asserts equality with the
///   expected value.
/// - If the thrown [A2uiError] does not expose the field, invokes
///   [onUnassertedField] (defaulting to [fail]) with
///   `"code/path not asserted: ..."` rather than silently passing.
///
/// When `expectError.rendererError` is set, the matcher requires an outbound
/// [ErrorMessage]: [capturedErrorMessage], or else the last entry of
/// [emittedErrors]. The list is read when the matcher runs, so a harness can
/// hand over the list its `outboundListener` fills while the payload is still
/// being processed.
Matcher matchesErrorFields(
  Map<String, Object?> expectedError, {
  Object? rawMessage,
  String defaultVersion = 'v0.9',
  ErrorMessage? capturedErrorMessage,
  List<ErrorMessage>? emittedErrors,
  void Function(String message) onUnassertedField = fail,
}) {
  assertKnownKeys(expectedError, knownExpectErrorKeys, 'expectError');
  return _ErrorFieldsMatcher(
    expectedCode: expectedError['code'] as String?,
    expectedPath: expectedError['path'] as String?,
    expectedSurfaceId: expectedError['surfaceId'] as String?,
    expectedFunctionCallId: expectedError['functionCallId'] as String?,
    expectedDetails: expectedError['details'] as List<Object?>?,
    expectedRendererError:
        expectedError['rendererError'] as Map<String, Object?>?,
    rawMessage: rawMessage,
    defaultVersion: defaultVersion,
    capturedErrorMessage: capturedErrorMessage,
    emittedErrors: emittedErrors,
    onUnassertedField: onUnassertedField,
  );
}

class _ErrorFieldsMatcher extends Matcher {
  final String? expectedCode;
  final String? expectedPath;
  final String? expectedSurfaceId;
  final String? expectedFunctionCallId;
  final List<Object?>? expectedDetails;
  final Map<String, Object?>? expectedRendererError;
  final Object? rawMessage;
  final String defaultVersion;
  final ErrorMessage? capturedErrorMessage;
  final List<ErrorMessage>? emittedErrors;
  final void Function(String message) onUnassertedField;

  const _ErrorFieldsMatcher({
    this.expectedCode,
    this.expectedPath,
    this.expectedSurfaceId,
    this.expectedFunctionCallId,
    this.expectedDetails,
    this.expectedRendererError,
    this.rawMessage,
    this.defaultVersion = 'v0.9',
    this.capturedErrorMessage,
    this.emittedErrors,
    required this.onUnassertedField,
  });

  @override
  bool matches(Object? item, Map<dynamic, dynamic> matchState) {
    if (item is! A2uiError) {
      matchState['reason'] = 'is not an A2uiError';
      return false;
    }

    final ErrorMessage? emitted =
        capturedErrorMessage ?? emittedErrors?.lastOrNull;
    if (expectedRendererError != null && emitted == null) {
      matchState['reason'] =
          'expected an outbound rendererError to be emitted, but none was '
          'captured';
      return false;
    }

    // Without an emitted message, the mapped form only backs the `code` and
    // `path` checks, which read the thrown error itself.
    final ErrorMessage mapped = emitted ??
        MessageErrorMapper.map(
          item,
          rawMessage: rawMessage,
          defaultVersion: defaultVersion,
        );
    final unasserted = <String>[];

    if (!_matchesCodeAndPath(item, mapped, unasserted, matchState) ||
        !_matchesContextIds(item, mapped, matchState)) {
      return false;
    }

    if (expectedDetails != null &&
        !_matchesDetails(item, expectedDetails!, matchState)) {
      return false;
    }

    if (expectedRendererError != null &&
        !_matchesRendererError(mapped, expectedRendererError!, matchState)) {
      return false;
    }

    if (unasserted.isNotEmpty) {
      onUnassertedField(
        'code/path not asserted: ${item.runtimeType} does not expose '
        '${unasserted.join(', ')}',
      );
    }

    return true;
  }

  bool _matchesCodeAndPath(
    A2uiError item,
    ErrorMessage mapped,
    List<String> unasserted,
    Map<dynamic, dynamic> matchState,
  ) {
    if (expectedCode != null) {
      final String? actualCode = extractErrorCode(item);
      final String wireCode = mapped.error.code;
      if (actualCode == null) {
        unasserted.add('code "$expectedCode"');
      } else if (actualCode != expectedCode && wireCode != expectedCode) {
        matchState['reason'] = 'has code "$actualCode" (wire "$wireCode") '
            'instead of "$expectedCode"';
        return false;
      }
    }

    if (expectedPath != null) {
      final (bool supported, String? actualPath) = extractErrorPath(item);
      if (!supported) {
        unasserted.add('path "$expectedPath"');
      } else if (actualPath != expectedPath &&
          mapped.error.path != expectedPath) {
        matchState['reason'] =
            'has path "$actualPath" instead of "$expectedPath"';
        return false;
      }
    }
    return true;
  }

  bool _matchesContextIds(
    A2uiError item,
    ErrorMessage mapped,
    Map<dynamic, dynamic> matchState,
  ) {
    if (expectedSurfaceId != null) {
      final String? actualSurfaceId = item.surfaceId ?? mapped.error.surfaceId;
      if (actualSurfaceId != expectedSurfaceId) {
        matchState['reason'] =
            'has surfaceId "$actualSurfaceId" instead of "$expectedSurfaceId"';
        return false;
      }
    }

    if (expectedFunctionCallId != null) {
      final String? actualCallId =
          item.functionCallId ?? mapped.error.functionCallId;
      if (actualCallId != expectedFunctionCallId) {
        matchState['reason'] = 'has functionCallId "$actualCallId" instead of '
            '"$expectedFunctionCallId"';
        return false;
      }
    }
    return true;
  }

  bool _matchesDetails(
    A2uiError item,
    List<Object?> expectedList,
    Map<dynamic, dynamic> matchState,
  ) {
    if (item is! A2uiValidationError) {
      matchState['reason'] =
          'expected A2uiValidationError with details, got ${item.runtimeType}';
      return false;
    }
    for (final entry in expectedList) {
      if (entry is! Map<String, Object?>) continue;
      if (!item.errors.any((d) => _detailMatches(d, entry))) {
        matchState['reason'] =
            'missing expected detail $entry in ${item.errors}';
        return false;
      }
    }
    return true;
  }

  static bool _detailMatches(A2uiErrorDetail d, Map<String, Object?> entry) {
    final expPath = entry['path'] as String?;
    final expCode = entry['code'] as String?;
    final expSurfaceId = entry['surfaceId'] as String?;
    final expMessage = entry['message'] as String?;
    return (expPath == null || d.path == expPath || d.path == '/$expPath') &&
        (expCode == null || d.code == expCode) &&
        (expSurfaceId == null || d.surfaceId == expSurfaceId) &&
        (expMessage == null || _textMatches(d.message, expMessage));
  }

  static bool _textMatches(String actual, String expected) {
    if (actual.toLowerCase().contains(expected.toLowerCase())) return true;
    final String aligned = alignErrorPattern(expected)
        .replaceAll('allowedParents', '(allowedParents|Allowed parents)')
        .replaceAll('allowedChildren', '(allowedChildren|Allowed children)');
    try {
      return RegExp(aligned, caseSensitive: false).hasMatch(actual);
    } on FormatException {
      return false;
    }
  }

  bool _matchesRendererError(
    ErrorMessage actualMessage,
    Map<String, Object?> expectedEnvelope,
    Map<dynamic, dynamic> matchState,
  ) {
    final expVersion = expectedEnvelope['version'] as String?;
    if (expVersion != null && actualMessage.version != expVersion) {
      matchState['reason'] = 'rendererError.version was '
          '"${actualMessage.version}" instead of "$expVersion"';
      return false;
    }
    final expErr = expectedEnvelope['error'] as Map<String, Object?>?;
    if (expErr == null) return true;
    final A2uiRendererError actual = actualMessage.error;
    return _matchesRendererErrorIds(actual, expErr, matchState) &&
        _matchesRendererErrorFields(actual, expErr, matchState);
  }

  static bool _matchesRendererErrorIds(
    A2uiRendererError actual,
    Map<String, Object?> expErr,
    Map<dynamic, dynamic> matchState,
  ) {
    if (expErr.containsKey('surfaceId')) {
      final expSurface = expErr['surfaceId'] as String?;
      if (actual.surfaceId != expSurface) {
        matchState['reason'] = 'rendererError.error.surfaceId was '
            '"${actual.surfaceId}" instead of "$expSurface"';
        return false;
      }
    } else if (expErr.containsKey('functionCallId') &&
        actual.surfaceId != null) {
      matchState['reason'] = 'rendererError.error.surfaceId was '
          '"${actual.surfaceId}" instead of null';
      return false;
    }
    if (expErr.containsKey('functionCallId')) {
      final expCallId = expErr['functionCallId'] as String?;
      if (actual.functionCallId != expCallId) {
        matchState['reason'] = 'rendererError.error.functionCallId was '
            '"${actual.functionCallId}" instead of "$expCallId"';
        return false;
      }
    }
    return true;
  }

  static bool _matchesRendererErrorFields(
    A2uiRendererError actual,
    Map<String, Object?> expErr,
    Map<dynamic, dynamic> matchState,
  ) {
    if (expErr['code'] case final String expCode when actual.code != expCode) {
      matchState['reason'] =
          'rendererError.error.code was "${actual.code}" instead of "$expCode"';
      return false;
    }
    if (expErr.containsKey('path')) {
      final expPath = expErr['path'] as String?;
      if (actual.path != expPath) {
        matchState['reason'] = 'rendererError.error.path was "${actual.path}" '
            'instead of "$expPath"';
        return false;
      }
    }
    if (expErr['message'] case final String expMsg
        when !_textMatches(actual.message, expMsg)) {
      matchState['reason'] = 'rendererError.error.message '
          '"${actual.message}" did not match "$expMsg"';
      return false;
    }
    return true;
  }

  @override
  Description describe(Description description) {
    final parts = <String>[
      if (expectedCode != null) 'code "$expectedCode"',
      if (expectedPath != null) 'path "$expectedPath"',
    ];
    if (parts.isEmpty) {
      return description.add('any A2uiError fields');
    }
    return description.add('A2uiError with ${parts.join(' and ')}');
  }

  @override
  Description describeMismatch(
    Object? item,
    Description mismatchDescription,
    Map<dynamic, dynamic> matchState,
    bool verbose,
  ) {
    if (matchState['reason'] case final String reason) {
      return mismatchDescription.add(reason);
    }
    return mismatchDescription;
  }
}

/// Aligns cross-SDK error message patterns to match equivalent messages.
String alignErrorPattern(String pattern) {
  if (pattern.contains('Catalog not found:')) {
    return '($pattern|is not supported by this processor)';
  }
  if (RegExp(r"Unrecognized function '([^']*)'").firstMatch(pattern)
      case final RegExpMatch match) {
    return "($pattern|declares no function named '${match[1]}')";
  }
  if (pattern.contains('without a type')) {
    return "($pattern|without a 'component' type)";
  }
  if (pattern.contains('Circular reference detected') ||
      pattern.contains('Circular component reference')) {
    return '($pattern|Self-reference detected|Circular reference detected)';
  }
  if (pattern.contains('Self-referencing component')) {
    return '($pattern|Self-reference detected)';
  }
  if (pattern.contains('Dangling reference')) {
    return '($pattern|references non-existent component)';
  }
  if (pattern.contains('Orphaned component') ||
      pattern.contains('is not reachable from')) {
    return '($pattern|is not reachable from|Unreachable components)';
  }
  if (pattern.contains('Validation failed for component') ||
      pattern.contains('is not of type')) {
    return '($pattern|does not match the .* schema|is not of type)';
  }
  if (pattern.contains('Validation failed for theme')) {
    return '($pattern|Theme does not match the theme schema)';
  }
  if (pattern.contains('multiple conflicting update actions')) {
    return '($pattern|must contain exactly one of)';
  }
  if (pattern.contains('beginRendering')) {
    return '($pattern|Unknown A2UI message type)';
  }
  if (pattern.contains('Unsupported protocol version')) {
    return '($pattern|Unsupported A2UI protocol version)';
  }
  if (pattern.contains('Missing required version field')) {
    return "($pattern|must declare a 'version')";
  }
  if (pattern.contains('surfaceId must be a string')) {
    return "($pattern|Field 'createSurface\\.surfaceId' must be a String)";
  }
  return pattern;
}

/// The SDK's basic catalog for protocol [version], registered as
/// [asCatalogId] when given.
///
/// Conformance cases that name no catalog document, or a `catalog` block with
/// only a `protocolVersion`, run against the basic catalog of their version
/// and bind surfaces to it by whatever id they choose, such as `basic`.
Catalog<ComponentApi, FunctionImplementation> basicCatalogFor(
  String version, {
  String? asCatalogId,
}) {
  final Catalog<ComponentApi, FunctionImplementation> basic =
      compareVersions(version, '1.0') >= 0
          ? BasicCatalog.v1_0()
          : BasicCatalog.v0_9();
  if (asCatalogId == null || asCatalogId == basic.id) return basic;
  return Catalog<ComponentApi, FunctionImplementation>(
    id: asCatalogId,
    components: basic.components.values.toList(),
    functions: basic.functions.values.toList(),
    themeSchema: basic.themeSchema,
    definitions: basic.definitions,
    schemaId: basic.schemaId,
    title: basic.title,
    description: basic.description,
    protocolVersion: basic.protocolVersion,
  );
}
