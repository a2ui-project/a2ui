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

import 'package:test/test.dart';

import 'suites.dart';

/// Harness identifier written to each executed-case manifest entry.
const String harnessName = 'dart-agent';

class _VersionOutcome {
  const _VersionOutcome(this.status, this.reason);

  final String status;
  final String? reason;
}

class _CaseEntry {
  final Map<SuiteVersion?, _VersionOutcome> outcomes = {};

  (String status, String? reason) combined() {
    String? failedReason;
    var hasFailed = false;
    String? xfailedReason;
    var hasXfailed = false;
    var hasPassed = false;
    String? skippedReason;

    for (final _VersionOutcome outcome in outcomes.values) {
      switch (outcome.status) {
        case 'failed':
          hasFailed = true;
          failedReason ??= outcome.reason;
        case 'xfailed':
          hasXfailed = true;
          xfailedReason ??= outcome.reason;
        case 'passed':
          hasPassed = true;
          skippedReason ??= outcome.reason;
        case 'skipped':
          skippedReason ??= outcome.reason;
      }
    }

    if (hasFailed) {
      return ('failed', failedReason ?? skippedReason);
    }
    if (hasXfailed) {
      return ('xfailed', xfailedReason ?? skippedReason);
    }
    if (hasPassed) {
      return ('passed', skippedReason);
    }
    return ('skipped', skippedReason);
  }
}

final Map<String, Map<(String, String), _CaseEntry>> _recordsByDir = {};

/// Records the outcome of conformance case [name] in [suite] to the
/// executed-case manifest when `A2UI_CONFORMANCE_MANIFEST_DIR` (or
/// [manifestDir]) is set.
///
/// A case executed in both [SuiteVersion]s is written once: `failed` if either
/// run failed, `xfailed` if either run was an expected failure, `passed` if at
/// least one run passed (keeping any v0.9 lowering skip [reason]), and
/// `skipped` otherwise.
void recordCase(
  String suite,
  String name, {
  required String status,
  String? reason,
  SuiteVersion? version,
  String? manifestDir,
}) {
  final String? dir =
      manifestDir ?? Platform.environment['A2UI_CONFORMANCE_MANIFEST_DIR'];
  if (dir == null || dir.isEmpty) return;

  final Map<(String, String), _CaseEntry> entries = _recordsByDir.putIfAbsent(
    dir,
    () => {},
  );
  final _CaseEntry entry = entries.putIfAbsent((suite, name), _CaseEntry.new);
  final String? normalizedReason = reason != null && reason.trim().isNotEmpty
      ? reason.trim()
      : null;
  entry.outcomes[version] = _VersionOutcome(status, normalizedReason);

  Directory(dir).createSync(recursive: true);
  final file = File('$dir/$harnessName-$pid-${Isolate.current.hashCode}.jsonl');
  final buffer = StringBuffer();
  for (final MapEntry<(String, String), _CaseEntry>(
        key: (String recordSuite, String recordName),
        value: _CaseEntry caseEntry,
      )
      in entries.entries) {
    final (String combinedStatus, String? combinedReason) = caseEntry
        .combined();
    final record = <String, Object?>{
      'harness': harnessName,
      'suite': recordSuite,
      'case': recordName,
      'status': combinedStatus,
      'reason': ?combinedReason,
    };
    buffer.writeln(jsonEncode(record));
  }
  file.writeAsStringSync(buffer.toString(), flush: true);
}

/// Registers group-scoped `setUp` and `tearDown` hooks that record each test in
/// [caseNames] to the executed-case manifest for [suite].
void registerSuiteManifestRecorder(String suite, Set<String> caseNames) {
  if (Zone.current[#test.declarer] == null ||
      Zone.current[#test.invoker] != null) {
    return;
  }

  String? skipReason;
  StreamSubscription<Object?>? messageSubscription;

  setUp(() {
    skipReason = null;
    final Object? invoker = Zone.current[#test.invoker];
    if (invoker == null) return;
    // ignore: avoid_dynamic_calls
    final Object? liveTest = (invoker as dynamic).liveTest;
    // ignore: avoid_dynamic_calls
    final messages = (liveTest as dynamic).onMessage as Stream<Object?>;
    messageSubscription = messages.listen((Object? message) {
      // ignore: avoid_dynamic_calls
      if ('${(message as dynamic).type}' == 'skip') {
        // ignore: avoid_dynamic_calls
        final text = (message as dynamic).text as String;
        if (text.trim().isNotEmpty) {
          skipReason = text.trim();
        }
      }
    });
  });

  tearDown(() async {
    await messageSubscription?.cancel();
    messageSubscription = null;
    final Object? invoker = Zone.current[#test.invoker];
    if (invoker == null) return;
    // ignore: avoid_dynamic_calls
    final Object? liveTest = (invoker as dynamic).liveTest;
    // ignore: avoid_dynamic_calls
    final caseName = (liveTest as dynamic).individualName as String;
    if (!caseNames.contains(caseName)) return;

    // ignore: avoid_dynamic_calls
    final groups = (liveTest as dynamic).groups as List<Object?>;
    var groupName = '';
    if (groups.isNotEmpty) {
      // ignore: avoid_dynamic_calls
      groupName = (groups.last as dynamic).name as String;
    }
    final SuiteVersion? version = groupName.endsWith(SuiteVersion.v0_9.label)
        ? SuiteVersion.v0_9
        : groupName.endsWith(SuiteVersion.v1_0.label)
        ? SuiteVersion.v1_0
        : null;

    // ignore: avoid_dynamic_calls
    final result = '${(liveTest as dynamic).state.result}';
    switch (result) {
      case 'success':
        recordCase(suite, caseName, status: 'passed', version: version);
      case 'skipped':
        recordCase(
          suite,
          caseName,
          status: 'skipped',
          reason: skipReason,
          version: version,
        );
      default:
        // ignore: avoid_dynamic_calls
        final errors = (liveTest as dynamic).errors as List<Object?>;
        String? failureReason;
        if (errors.isNotEmpty) {
          // ignore: avoid_dynamic_calls
          failureReason = '${(errors.first as dynamic).error}';
        }
        recordCase(
          suite,
          caseName,
          status: 'failed',
          reason: failureReason,
          version: version,
        );
    }
  });
}
