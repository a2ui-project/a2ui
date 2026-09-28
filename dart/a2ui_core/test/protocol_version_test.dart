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
import 'package:test/test.dart';

void main() {
  group('A2uiProtocolVersion', () {
    test('exposes v0.9 as its wire value', () {
      expect(A2uiProtocolVersion.v0_9.jsonValue, 'v0.9');
    });

    test('implements exactly one version', () {
      expect(A2uiProtocolVersion.values, [A2uiProtocolVersion.v0_9]);
      expect(A2uiProtocolVersion.supportedVersions, "'v0.9'");
    });

    test('parses the supported version', () {
      expect(A2uiProtocolVersion.fromJson('v0.9'), A2uiProtocolVersion.v0_9);
    });

    test('rejects an unspecified version', () {
      expect(
        () => A2uiProtocolVersion.fromJson(null),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.message,
            'message',
            contains("must declare a 'version' field"),
          ),
        ),
      );
    });

    test('rejects a version that is not a string', () {
      expect(
        () => A2uiProtocolVersion.fromJson(123),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('rejects earlier and later protocol versions', () {
      for (final version in ['v0.8', 'v1.0', 'v0.9.1', '0.9', '']) {
        expect(
          () => A2uiProtocolVersion.fromJson(version),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              contains('Unsupported A2UI protocol version'),
            ),
          ),
          reason: version,
        );
      }
    });

    test('carries the offending payload as error details', () {
      final payload = {'version': 'v1.0'};
      expect(
        () => A2uiProtocolVersion.fromJson('v1.0', details: payload),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.details,
            'details',
            same(payload),
          ),
        ),
      );
    });
  });
}
