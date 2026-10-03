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
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

/// A single decoded conformance test case map from a YAML suite.
typedef ConformanceTestCase = Map<String, Object?>;

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
/// semantics when the case name is listed.
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
  Map<String, String> expectedFailures = const {},
  void Function(String message) onSkip = markTestSkipped,
}) async {
  final name = testCase['name']! as String;
  final String? reason = expectedFailures[name];
  if (reason == null) {
    await body();
    return;
  }

  Object? caughtError;
  try {
    await body();
  } catch (error) {
    caughtError = error;
  }

  if (caughtError != null) {
    onSkip('expected failure: $reason ($caughtError)');
    return;
  }

  fail(
    'Test "$name" passed unexpectedly; remove "$name" from expectedFailures.',
  );
}

/// Registers a `test(...)` for each entry in [cases], wrapping execution in
/// [runConformanceCase] with [expectedFailures].
void runConformanceSuite(
  List<ConformanceTestCase> cases,
  FutureOr<void> Function(ConformanceTestCase testCase) runCase, {
  Map<String, String> expectedFailures = const {},
  String? Function(ConformanceTestCase testCase)? skipReason,
  void Function(String message) onSkip = markTestSkipped,
}) {
  for (final testCase in cases) {
    final name = testCase['name']! as String;
    test(
      name,
      () => runConformanceCase(
        testCase,
        () => runCase(testCase),
        expectedFailures: expectedFailures,
        onSkip: onSkip,
      ),
      skip: skipReason?.call(testCase),
    );
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
/// `A2uiDataError` exposes `path` directly; `A2uiValidationError` gains `path`
/// in B2a.
(bool, String?) extractErrorPath(A2uiError error) {
  if (error is A2uiDataError) {
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

/// Matches `code` and `path` expectations declared in an `expectError` block
/// against a thrown [A2uiError].
///
/// When `expectError` specifies `code` or `path`:
/// - If the thrown [A2uiError] exposes that field, asserts equality with the
///   expected value.
/// - If the thrown [A2uiError] does not expose the field, invokes
///   [onUnassertedField] (defaulting to [markTestSkipped]) with
///   `"code/path not asserted: ..."` rather than silently passing.
Matcher matchesErrorFields(
  Map<String, Object?> expectedError, {
  void Function(String message) onUnassertedField = markTestSkipped,
}) =>
    _ErrorFieldsMatcher(
      expectedCode: expectedError['code'] as String?,
      expectedPath: expectedError['path'] as String?,
      onUnassertedField: onUnassertedField,
    );

class _ErrorFieldsMatcher extends Matcher {
  final String? expectedCode;
  final String? expectedPath;
  final void Function(String message) onUnassertedField;

  const _ErrorFieldsMatcher({
    this.expectedCode,
    this.expectedPath,
    required this.onUnassertedField,
  });

  @override
  bool matches(Object? item, Map<dynamic, dynamic> matchState) {
    if (item is! A2uiError) {
      matchState['reason'] = 'is not an A2uiError';
      return false;
    }

    final unasserted = <String>[];

    if (expectedCode != null) {
      final String? actualCode = extractErrorCode(item);
      if (actualCode == null) {
        unasserted.add('code "$expectedCode"');
      } else if (actualCode != expectedCode) {
        matchState['reason'] =
            'has code "$actualCode" instead of "$expectedCode"';
        return false;
      }
    }

    if (expectedPath != null) {
      final (bool supported, String? actualPath) = extractErrorPath(item);
      if (!supported) {
        unasserted.add('path "$expectedPath"');
      } else if (actualPath != expectedPath) {
        matchState['reason'] =
            'has path "$actualPath" instead of "$expectedPath"';
        return false;
      }
    }

    if (unasserted.isNotEmpty) {
      onUnassertedField(
        'code/path not asserted: ${item.runtimeType} does not expose '
        '${unasserted.join(', ')}',
      );
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
