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
    test('exposes each version as its wire value', () {
      expect(A2uiProtocolVersion.v0_9.jsonValue, 'v0.9');
      expect(A2uiProtocolVersion.v0_9_1.jsonValue, 'v0.9.1');
      expect(A2uiProtocolVersion.v1_0.jsonValue, 'v1.0');
    });

    test('implements v0.9, v0.9.1 and v1.0', () {
      expect(A2uiProtocolVersion.values, [
        A2uiProtocolVersion.v0_9,
        A2uiProtocolVersion.v0_9_1,
        A2uiProtocolVersion.v1_0,
      ]);
      expect(
        A2uiProtocolVersion.supportedVersions,
        "'v0.9', 'v0.9.1', 'v1.0'",
      );
    });

    test('parses and round-trips every version', () {
      for (final A2uiProtocolVersion version in A2uiProtocolVersion.values) {
        expect(A2uiProtocolVersion.fromJson(version.jsonValue), version);
        expect(A2uiProtocolVersion.parse(version.jsonValue), version);
        expect(A2uiProtocolVersion.tryParse(version.jsonValue), version);
      }
    });

    test('parses v0.9.1 as its own version, distinct from v0.9', () {
      final A2uiProtocolVersion version = A2uiProtocolVersion.parse('v0.9.1');
      expect(version, A2uiProtocolVersion.v0_9_1);
      expect(version, isNot(A2uiProtocolVersion.v0_9));
      expect(version.jsonValue, 'v0.9.1');
    });

    test('reports major and minor numbers', () {
      expect(A2uiProtocolVersion.v0_9.major, 0);
      expect(A2uiProtocolVersion.v0_9.minor, 9);
      expect(A2uiProtocolVersion.v0_9_1.major, 0);
      expect(A2uiProtocolVersion.v0_9_1.minor, 9);
      expect(A2uiProtocolVersion.v1_0.major, 1);
      expect(A2uiProtocolVersion.v1_0.minor, 0);
    });

    test('orders versions by release', () {
      const A2uiProtocolVersion v09 = A2uiProtocolVersion.v0_9;
      const A2uiProtocolVersion v091 = A2uiProtocolVersion.v0_9_1;
      const A2uiProtocolVersion v10 = A2uiProtocolVersion.v1_0;
      expect(v09.compareTo(v091), isNegative);
      expect(v091.compareTo(v10), isNegative);
      expect(v10.compareTo(v09), isPositive);
      expect(v091.compareTo(v091), 0);
      expect([v10, v09, v091]..sort(), [v09, v091, v10]);
    });

    test('isAtLeast compares against a minimum version', () {
      expect(
          A2uiProtocolVersion.v1_0.isAtLeast(A2uiProtocolVersion.v0_9), isTrue);
      expect(
          A2uiProtocolVersion.v1_0.isAtLeast(A2uiProtocolVersion.v1_0), isTrue);
      expect(
        A2uiProtocolVersion.v0_9_1.isAtLeast(A2uiProtocolVersion.v0_9),
        isTrue,
      );
      expect(
        A2uiProtocolVersion.v0_9.isAtLeast(A2uiProtocolVersion.v0_9_1),
        isFalse,
      );
      expect(A2uiProtocolVersion.v0_9.isAtLeast(A2uiProtocolVersion.v1_0),
          isFalse);
    });

    test('parse rejects an unknown version; tryParse returns null', () {
      for (final version in ['v0.8', 'v1.1', '0.9', '1.0', 'v0_9', '']) {
        expect(A2uiProtocolVersion.tryParse(version), isNull, reason: version);
        expect(
          () => A2uiProtocolVersion.parse(version),
          throwsA(isA<A2uiValidationError>()),
          reason: version,
        );
      }
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
      for (final version in ['v0.8', 'v1.1', '0.9', '']) {
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
      final payload = {'version': 'v2.0'};
      expect(
        () => A2uiProtocolVersion.fromJson('v2.0', details: payload),
        throwsA(
          isA<A2uiValidationError>().having(
            (e) => e.details,
            'details',
            same(payload),
          ),
        ),
      );
    });

    test('exposes the bare semantic version catalogs declare', () {
      expect(A2uiProtocolVersion.v0_9.semverValue, '0.9');
      expect(A2uiProtocolVersion.v0_9_1.semverValue, '0.9.1');
      expect(A2uiProtocolVersion.v1_0.semverValue, '1.0');
    });

    group('tryParseSemVer', () {
      test('accepts the catalog, wire and full spellings of a version', () {
        for (final spelling in ['1.0', 'v1.0', '1.0.0', 'v1.0.0', ' 1.0 ']) {
          expect(
            A2uiProtocolVersion.tryParseSemVer(spelling),
            A2uiProtocolVersion.v1_0,
            reason: spelling,
          );
        }
        expect(
          A2uiProtocolVersion.tryParseSemVer('0.9'),
          A2uiProtocolVersion.v0_9,
        );
        expect(
          A2uiProtocolVersion.tryParseSemVer('0.9.0'),
          A2uiProtocolVersion.v0_9,
        );
        expect(
          A2uiProtocolVersion.tryParseSemVer('v0.9.1'),
          A2uiProtocolVersion.v0_9_1,
        );
      });

      test('ignores pre-release and build suffixes', () {
        expect(
          A2uiProtocolVersion.tryParseSemVer('1.0.0-rc.1'),
          A2uiProtocolVersion.v1_0,
        );
        expect(
          A2uiProtocolVersion.tryParseSemVer('1.0.0+build.7'),
          A2uiProtocolVersion.v1_0,
        );
      });

      test('returns null for unknown and malformed versions', () {
        for (final spelling in ['0.8', '1.1', '2.0', '1.0.1', 'one', '', 'v']) {
          expect(
            A2uiProtocolVersion.tryParseSemVer(spelling),
            isNull,
            reason: spelling,
          );
        }
      });
    });
  });
}
