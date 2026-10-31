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

import 'conformance_harness.dart';

void main() {
  group('runConformanceCase', () {
    test('marks test skipped when listed in expectedFailures and body fails',
        () async {
      final skippedMessages = <String>[];
      await runConformanceCase(
        const {'name': 'failing_case'},
        () => fail('not implemented yet'),
        expectedFailures: const {
          'failing_case': 'pending v1.0 validator support',
        },
        onSkip: skippedMessages.add,
      );

      expect(skippedMessages, hasLength(1));
      expect(
        skippedMessages.single,
        allOf(
          contains('expected failure: pending v1.0 validator support'),
          contains('not implemented yet'),
        ),
      );
    });

    test('marks test skipped when listed in expectedFailures and async throws',
        () async {
      final skippedMessages = <String>[];
      await runConformanceCase(
        const {'name': 'async_failing_case'},
        () async {
          await Future<void>.delayed(Duration.zero);
          throw StateError('async failure');
        },
        expectedFailures: const {
          'async_failing_case': 'pending async RPC support',
        },
        onSkip: skippedMessages.add,
      );

      expect(skippedMessages, hasLength(1));
      expect(
        skippedMessages.single,
        allOf(
          contains('expected failure: pending async RPC support'),
          contains('async failure'),
        ),
      );
    });

    test(
        'live markTestSkipped integration marks listed failing test as skipped',
        () async {
      await runConformanceCase(
        const {'name': 'live_expected_failure'},
        () => fail('expected failure in live test'),
        expectedFailures: const {
          'live_expected_failure': 'exercising default markTestSkipped hook',
        },
      );
    });

    test('throws TestFailure when listed in expectedFailures and body succeeds',
        () async {
      final skippedMessages = <String>[];
      Object? caught;
      try {
        await runConformanceCase(
          const {'name': 'now_passing_case'},
          () {
            expect(1 + 1, equals(2));
          },
          expectedFailures: const {
            'now_passing_case': 'should have failed',
          },
          onSkip: skippedMessages.add,
        );
      } catch (error) {
        caught = error;
      }

      expect(skippedMessages, isEmpty);
      expect(
        caught,
        isA<TestFailure>().having(
          (e) => e.message,
          'message',
          allOf(
            contains('now_passing_case'),
            contains('passed unexpectedly'),
            contains('remove'),
            contains('expectedFailures'),
          ),
        ),
      );
    });

    test('passes normally when not listed in expectedFailures and body passes',
        () async {
      final skippedMessages = <String>[];
      var executed = false;
      await runConformanceCase(
        const {'name': 'normal_passing_case'},
        () {
          executed = true;
        },
        expectedFailures: const {
          'other_case': 'unrelated reason',
        },
        onSkip: skippedMessages.add,
      );

      expect(executed, isTrue);
      expect(skippedMessages, isEmpty);
    });

    test('propagates error when not listed in expectedFailures and body fails',
        () async {
      final skippedMessages = <String>[];
      await expectLater(
        () => runConformanceCase(
          const {'name': 'normal_failing_case'},
          () => throw StateError('unexpected failure'),
          expectedFailures: const {
            'other_case': 'unrelated reason',
          },
          onSkip: skippedMessages.add,
        ),
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            equals('unexpected failure'),
          ),
        ),
      );
      expect(skippedMessages, isEmpty);
    });
  });

  group('runConformanceSuite', () {
    final executedCases = <String>[];
    final skippedMessages = <String>[];

    runConformanceSuite(
      const [
        {'name': 'suite_passing_case'},
        {'name': 'suite_expected_failure_case'},
        {'name': 'suite_version_skipped_case', 'protocolVersion': 'v0.8'},
      ],
      (testCase) {
        final name = testCase['name']! as String;
        executedCases.add(name);
        if (name == 'suite_expected_failure_case') {
          fail('known failure');
        }
      },
      expectedFailures: const {
        'suite_expected_failure_case': 'pending feature implementation',
      },
      skipReason: (testCase) =>
          caseVersion(testCase) == '0.8' ? 'v0.8 not supported' : null,
      onSkip: skippedMessages.add,
    );

    tearDownAll(() {
      expect(
        executedCases,
        unorderedEquals(['suite_passing_case', 'suite_expected_failure_case']),
      );
      expect(skippedMessages, hasLength(1));
      expect(
        skippedMessages.single,
        contains('expected failure: pending feature implementation'),
      );
    });
  });

  group('matchesErrorFields', () {
    test('asserts expectError.code when error exposes code', () {
      final matchingError = A2uiValidationError(
        'Parent not allowed',
        code: 'UNALLOWED_PARENT',
      );
      final wrongCodeError = A2uiValidationError(
        'Parent not allowed',
        code: 'VALIDATION_ERROR',
      );

      expect(
        matchingError,
        matchesErrorFields(const {'code': 'UNALLOWED_PARENT'}),
      );
      expect(
        wrongCodeError,
        isNot(matchesErrorFields(const {'code': 'UNALLOWED_PARENT'})),
      );
    });

    test('asserts expectError.path when error exposes path property', () {
      final matchingDataError = A2uiDataError(
        'Invalid pointer',
        path: '/items/01',
      );
      final wrongPathDataError = A2uiDataError(
        'Invalid pointer',
        path: '/items/0',
      );
      final nullPathDataError = A2uiDataError('Invalid pointer');
      final matchingValidationError = A2uiValidationError(
        'Unallowed child',
        path: '/components/0/children/1',
        code: 'UNALLOWED_CHILD',
      );

      expect(
        matchingDataError,
        matchesErrorFields(const {'path': '/items/01'}),
      );
      expect(
        wrongPathDataError,
        isNot(matchesErrorFields(const {'path': '/items/01'})),
      );
      expect(
        nullPathDataError,
        isNot(matchesErrorFields(const {'path': '/items/01'})),
      );
      expect(
        matchingValidationError,
        matchesErrorFields(const {
          'code': 'UNALLOWED_CHILD',
          'path': '/components/0/children/1',
        }),
      );
    });

    test('fails by default when expectError.path is absent on thrown error',
        () {
      final errorWithoutPath = A2uiParseError('Missing field');

      expect(
        () => expect(
          errorWithoutPath,
          matchesErrorFields(const {'path': 'messages.0.version'}),
        ),
        throwsA(
          isA<TestFailure>().having(
            (e) => e.message,
            'message',
            allOf(
              contains('code/path not asserted'),
              contains('messages.0.version'),
            ),
          ),
        ),
      );
    });

    test('invokes custom onUnassertedField when expectError.path is absent',
        () {
      final skippedMessages = <String>[];
      final errorWithoutPath = A2uiParseError('Missing field');

      expect(
        errorWithoutPath,
        matchesErrorFields(
          const {'path': 'messages.0.version'},
          onUnassertedField: skippedMessages.add,
        ),
      );
      expect(skippedMessages, hasLength(1));
      expect(
        skippedMessages.single,
        allOf(
          contains('code/path not asserted'),
          contains('messages.0.version'),
        ),
      );
    });
  });

  group('assertKnownKeys', () {
    test('succeeds when all keys are allowed', () {
      assertKnownKeys(
        const {'name': 'c1', 'action': 'validate'},
        const {'name', 'action', 'description'},
        'case',
      );
    });

    test('fails when an unknown key is present', () {
      expect(
        () => assertKnownKeys(
          const {'name': 'c1', 'bogus': true},
          const {'name'},
          'case',
        ),
        throwsA(
          isA<TestFailure>().having(
            (e) => e.message,
            'message',
            contains('Unhandled keys at case: [bogus]'),
          ),
        ),
      );
    });
  });

  group('recordManifest', () {
    test('writes passed, xfailed, and skipped records to manifestDir',
        () async {
      final Directory tempDir = Directory.systemTemp.createTempSync(
        'a2ui_manifest_test_',
      );
      addTearDown(() => tempDir.deleteSync(recursive: true));

      await runConformanceCase(
        const {'name': 'passing_case'},
        () {},
        suite: 'core/sample.yaml',
        manifestDir: tempDir.path,
      );
      await runConformanceCase(
        const {'name': 'xfailing_case'},
        () => fail('expected gap'),
        suite: 'core/sample.yaml',
        expectedFailures: const {'xfailing_case': 'known gap'},
        onSkip: (_) {},
        manifestDir: tempDir.path,
      );
      await runConformanceCase(
        const {'name': 'unsupported_case'},
        () => fail('should not run'),
        suite: 'core/sample.yaml',
        unsupported: const {'unsupported_case': 'not implemented'},
        onSkip: (_) {},
        manifestDir: tempDir.path,
      );

      final List<File> files = tempDir.listSync().whereType<File>().toList();
      expect(files, hasLength(1));
      final List<Map<String, Object?>> records = files.single
          .readAsLinesSync()
          .map((line) => jsonDecode(line) as Map<String, Object?>)
          .toList();
      expect(
        records,
        equals([
          {
            'harness': 'dart-core',
            'suite': 'core/sample.yaml',
            'case': 'passing_case',
            'status': 'passed',
          },
          {
            'harness': 'dart-core',
            'suite': 'core/sample.yaml',
            'case': 'xfailing_case',
            'status': 'xfailed',
            'reason': 'known gap',
          },
          {
            'harness': 'dart-core',
            'suite': 'core/sample.yaml',
            'case': 'unsupported_case',
            'status': 'skipped',
            'reason': 'not implemented',
          },
        ]),
      );
    });
  });
}
