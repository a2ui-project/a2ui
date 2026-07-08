// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  group('check_dart_coverage.dart script tests', () {
    late File tempFile;
    const String scriptPath = '../../../../../scripts/check_dart_coverage.dart';

    setUp(() {
      tempFile = File('test_lcov.info');
    });

    tearDown(() {
      if (tempFile.existsSync()) {
        tempFile.deleteSync();
      }
    });

    ProcessResult runScript(String lcovPath) {
      return Process.runSync('dart', [scriptPath, lcovPath]);
    }

    test('exits with 1 when file does not exist', () {
      final ProcessResult res = runScript('non_existent_file.info');
      expect(res.exitCode, equals(1));
      expect(res.stdout.toString(), contains('Error: LCOV file not found'));
    });

    test('exits with 1 when no lines found (empty file)', () {
      tempFile.writeAsStringSync('');
      final ProcessResult res = runScript(tempFile.path);
      expect(res.exitCode, equals(1));
      expect(
        res.stdout.toString(),
        contains('Error: No lines found in LCOV report.'),
      );
    });

    test('exits with 1 when coverage is below 90%', () {
      tempFile.writeAsStringSync('SF:lib/foo.dart\nLF:10\nLH:5\n');
      final ProcessResult res = runScript(tempFile.path);
      expect(res.exitCode, equals(1));
      expect(
        res.stdout.toString(),
        contains('FAIL: Code coverage (50.00%) is below the 90% target!'),
      );
    });

    test('exits with 0 when coverage is 90% or above', () {
      tempFile.writeAsStringSync('SF:lib/foo.dart\nLF:10\nLH:9\n');
      final ProcessResult res = runScript(tempFile.path);
      expect(res.exitCode, equals(0));
      expect(
        res.stdout.toString(),
        contains('PASS: Code coverage (90.00%) meets the 90% target!'),
      );
    });
  });
}
