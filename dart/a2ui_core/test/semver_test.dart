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

/// The rule table is ported from `typescript/web_core`: the
/// `isCatalogVersionCompatible` cases in `processing/adapters/adapters.test.ts`
/// and the precedence cases in `common/semver.test.ts`.
void main() {
  group('isCatalogVersionCompatible', () {
    const compatible = <(String, String)>[
      // Exact canonical matches across formatting variations.
      ('v1.0', 'v1.0'),
      ('V1.0', 'v1.0'),
      ('v1.0', 'V1.0'),
      ('1.0', 'v1.0'),
      ('v1.0.0', '1.0'),
      ('v1_0', '1.0.0'),
      ('v0.9', 'v0.9'),
      ('V0.9', '0.9'),
      ('0.9', 'V0.9'),
      ('v0_9', '0.9'),
      ('v0.9.1', '0.9.1'),
      ('v0_9_1', '0.9.1'),
      // v0.9 and v0.9.1 are schema-compatible in both directions.
      ('v0.9', 'v0.9.1'),
      ('v0.9.1', 'v0.9'),
      // From 1.0, releases within one major version are compatible.
      ('v1.0', 'v1.1'),
      ('v1.1', 'v1.0'),
      ('v1.0', 'v1.0.0-beta.1'),
      // v0.8 matches only itself.
      ('v0.8', 'v0.8'),
      ('0.8', 'v0.8'),
      ('v0.8', '0.8.0'),
      // Identifiers that are not versions match after normalization.
      ('Vcustom', 'vcustom'),
      ('custom', 'Vcustom'),
    ];
    const incompatible = <(String, String)>[
      ('v1.0', 'v2.0'),
      ('v2.0', 'v1.0'),
      ('v0.9', 'v1.0'),
      ('v1.0', 'v0.9'),
      ('v0.8', 'v0.9'),
      ('v0.9', 'v0.8'),
      // Below 1.0 a minor release is a breaking release.
      ('v0.9', 'v0.10'),
      ('v0.9.1', 'v0.9.2'),
      ('custom', 'other'),
      // A version and an identifier never match.
      ('v1.0', 'custom'),
      ('', 'v1.0'),
      ('v1.0', ''),
      ('', ''),
    ];

    for (final (String catalog, String message) in compatible) {
      test("'$catalog' serves '$message'", () {
        expect(isCatalogVersionCompatible(catalog, message), isTrue);
      });
    }
    for (final (String catalog, String message) in incompatible) {
      test("'$catalog' does not serve '$message'", () {
        expect(isCatalogVersionCompatible(catalog, message), isFalse);
      });
    }
  });

  group('isVersionAtLeast', () {
    test('accepts the minimum and later versions in any spelling', () {
      expect(isVersionAtLeast('v1.0', 'v1.0'), isTrue);
      expect(isVersionAtLeast('1.0', 'v1.0'), isTrue);
      expect(isVersionAtLeast('1.0.0', 'v1.0'), isTrue);
      expect(isVersionAtLeast('v1.2', 'v1.0'), isTrue);
      expect(isVersionAtLeast('2.0', 'v1.0'), isTrue);
    });

    test('rejects earlier, null, and non-semantic versions', () {
      expect(isVersionAtLeast('v0.9', 'v1.0'), isFalse);
      expect(isVersionAtLeast('v0.9.1', 'v1.0'), isFalse);
      expect(isVersionAtLeast(null, 'v1.0'), isFalse);
      expect(isVersionAtLeast('custom', 'v1.0'), isFalse);
      expect(isVersionAtLeast('', 'v1.0'), isFalse);
    });
  });

  group('compareVersions', () {
    test('orders by major, minor and patch numerically', () {
      expect(compareVersions('v0.9', 'v1.0'), isNegative);
      expect(compareVersions('v1.0', 'v0.9'), isPositive);
      expect(compareVersions('v0.9', 'v0.9.1'), isNegative);
      expect(compareVersions('v0.9', 'v0.10'), isNegative);
      expect(compareVersions('1.2', '1.10'), isNegative);
      expect(compareVersions('v1.0', '1.0.0'), 0);
      expect(compareVersions('V1_0', 'v1.0'), 0);
    });

    test('ranks a pre-release below its release', () {
      const ascending = [
        '1.0.0-alpha',
        '1.0.0-alpha.1',
        '1.0.0-alpha.beta',
        '1.0.0-beta',
        '1.0.0-beta.2',
        '1.0.0-beta.11',
        '1.0.0-rc.1',
        '1.0.0',
      ];
      for (var i = 0; i < ascending.length - 1; i++) {
        expect(
          compareVersions(ascending[i], ascending[i + 1]),
          isNegative,
          reason: '${ascending[i]} < ${ascending[i + 1]}',
        );
        expect(
          compareVersions(ascending[i + 1], ascending[i]),
          isPositive,
          reason: '${ascending[i + 1]} > ${ascending[i]}',
        );
      }
    });

    test('ignores build metadata', () {
      expect(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
      expect(compareVersions('1.0.0-alpha+001', '1.0.0-alpha'), 0);
    });

    test('ranks a malformed version below every valid one', () {
      expect(compareVersions('garbage', 'v0.1'), isNegative);
      expect(compareVersions('v0.1', 'garbage'), isPositive);
      expect(compareVersions('garbage', 'other'), 0);
      // Leading zeros are not valid SemVer.
      expect(compareVersions('01.0', 'v0.1'), isNegative);
      expect(compareVersions('', ''), 0);
    });
  });
}
