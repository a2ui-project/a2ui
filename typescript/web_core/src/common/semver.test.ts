/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert';
import {
  parseSemVer,
  compareSemVer,
  isAtLeastVersion,
  normalizeVersionString,
  toCanonicalVersion,
} from './semver.js';

describe('SemVer Utilities (SemVer 2.0.0 Spec)', () => {
  it('correctly parses semver strings with and without leading v', () => {
    assert.deepStrictEqual(parseSemVer('v1.0'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: [],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('V1.0'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: [],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('1.0'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: [],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('v0.9.1'), {
      major: 0,
      minor: 9,
      patch: 1,
      prerelease: [],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('V0.9.1'), {
      major: 0,
      minor: 9,
      patch: 1,
      prerelease: [],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('v0.10.0'), {
      major: 0,
      minor: 10,
      patch: 0,
      prerelease: [],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('v1.10.2'), {
      major: 1,
      minor: 10,
      patch: 2,
      prerelease: [],
      build: [],
    });
    assert.strictEqual(parseSemVer('invalid'), null);
    assert.strictEqual(parseSemVer(undefined), null);
    assert.strictEqual(parseSemVer(null), null);
  });

  it('parses pre-release and build metadata per semver.org spec', () => {
    assert.deepStrictEqual(parseSemVer('1.0.0-alpha'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['alpha'],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('1.0.0-alpha.1'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['alpha', '1'],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('1.0.0-0.3.7'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['0', '3', '7'],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('1.0.0-x.7.z.92'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['x', '7', 'z', '92'],
      build: [],
    });
    assert.deepStrictEqual(parseSemVer('1.0.0+20130313144700'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: [],
      build: ['20130313144700'],
    });
    assert.deepStrictEqual(parseSemVer('1.0.0-beta+exp.sha.5114f85'), {
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['beta'],
      build: ['exp', 'sha', '5114f85'],
    });
  });

  it('rejects invalid versions with leading zeros in numeric components', () => {
    // SemVer 2.0.0 Rule 2: MUST NOT contain leading zeroes
    assert.strictEqual(parseSemVer('01.0.0'), null);
    assert.strictEqual(parseSemVer('1.01.0'), null);
    assert.strictEqual(parseSemVer('1.0.01'), null);
    // SemVer 2.0.0 Rule 9: Numeric pre-release identifiers MUST NOT include leading zeroes
    assert.strictEqual(parseSemVer('1.0.0-01'), null);
    assert.strictEqual(parseSemVer('1.0.0-alpha.01'), null);
    // Single zero is allowed
    assert.ok(parseSemVer('1.0.0-alpha.0') !== null);
    // Trailing hyphens or pluses without identifiers are invalid
    assert.strictEqual(parseSemVer('1.0.0-'), null);
    assert.strictEqual(parseSemVer('1.0.0+'), null);
    assert.strictEqual(parseSemVer('1.0.0-alpha..1'), null);
  });

  it('compares multi-digit minor versions correctly unlike float comparisons', () => {
    assert.ok(compareSemVer('v0.10.0', 'v0.9.1') > 0);
    assert.ok(compareSemVer('v0.9.1', 'v0.10.0') < 0);
    assert.ok(compareSemVer('v1.10.0', 'v1.2.0') > 0);
    assert.ok(compareSemVer('v1.2.0', 'v1.10.0') < 0);
    assert.strictEqual(compareSemVer('v1.0', '1.0.0'), 0);
    assert.strictEqual(compareSemVer('v0.9', '0.9'), 0);
  });

  it('evaluates pre-release precedence per semver.org section 11', () => {
    // Rule 11.3: normal version has higher precedence than pre-release version
    assert.ok(compareSemVer('1.0.0-alpha', '1.0.0') < 0);
    assert.ok(compareSemVer('1.0.0', '1.0.0-alpha') > 0);

    // Rule 11.4 canonical chain from semver.org:
    // 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      assert.ok(
        compareSemVer(chain[i], chain[i + 1]) < 0,
        `Expected ${chain[i]} < ${chain[i + 1]}`,
      );
      assert.ok(
        compareSemVer(chain[i + 1], chain[i]) > 0,
        `Expected ${chain[i + 1]} > ${chain[i]}`,
      );
    }

    // Rule 11.4.3: Numeric identifiers always have lower precedence than non-numeric identifiers
    assert.ok(compareSemVer('1.0.0-1', '1.0.0-alpha') < 0);
    assert.ok(compareSemVer('1.0.0-alpha', '1.0.0-1') > 0);

    // Numeric pre-release compared numerically (2 < 11, not lexical "11" < "2")
    assert.ok(compareSemVer('1.0.0-2', '1.0.0-11') < 0);

    // Numeric pre-release compared safely without Number.MAX_SAFE_INTEGER precision issues
    assert.ok(compareSemVer('1.0.0-9007199254740991', '1.0.0-9007199254740992') < 0);
    assert.ok(compareSemVer('1.0.0-9007199254740992', '1.0.0-9007199254740991') > 0);
    assert.ok(compareSemVer('1.0.0-100000000000000000000', '1.0.0-9999999999999999999') > 0);
  });

  it('ignores build metadata during precedence comparison per semver.org section 10', () => {
    assert.strictEqual(compareSemVer('1.0.0+20130313144700', '1.0.0'), 0);
    assert.strictEqual(compareSemVer('1.0.0-beta+exp.sha.5114f85', '1.0.0-beta'), 0);
    assert.strictEqual(compareSemVer('1.0.0+build.1', '1.0.0+build.2'), 0);
  });

  it('evaluates isAtLeastVersion correctly across versions and pre-releases', () => {
    assert.strictEqual(isAtLeastVersion('v1.0', '1.0'), true);
    assert.strictEqual(isAtLeastVersion('1.0', '1.0'), true);
    assert.strictEqual(isAtLeastVersion('v1.0.0', '1.0'), true);
    assert.strictEqual(isAtLeastVersion('v1.1', '1.0'), true);
    assert.strictEqual(isAtLeastVersion('v2.0.0', '1.0'), true);
    assert.strictEqual(isAtLeastVersion('v0.9.1', '1.0'), false);
    assert.strictEqual(isAtLeastVersion('v0.9', '1.0'), false);
    assert.strictEqual(isAtLeastVersion('v0.8', '1.0'), false);
    assert.strictEqual(isAtLeastVersion(undefined, '1.0'), false);
    assert.strictEqual(isAtLeastVersion('invalid', '1.0'), false);

    // Pre-release version is lower than target release
    assert.strictEqual(isAtLeastVersion('1.0.0-alpha', '1.0.0'), false);
    assert.strictEqual(isAtLeastVersion('1.0.0', '1.0.0-alpha'), true);
  });

  it('normalizes version strings with underscores and leading v/V', () => {
    assert.strictEqual(normalizeVersionString('v1_0'), '1.0');
    assert.strictEqual(normalizeVersionString('V1_0'), '1.0');
    assert.strictEqual(normalizeVersionString('v0_9_1'), '0.9.1');
    assert.strictEqual(normalizeVersionString('V0_9_1'), '0.9.1');
    assert.strictEqual(normalizeVersionString('1_0_0-alpha.1'), '1.0.0-alpha.1');
    assert.strictEqual(normalizeVersionString('v1_0_0-alpha.1'), '1.0.0-alpha.1');
    assert.strictEqual(normalizeVersionString('V1_0_0-alpha.1'), '1.0.0-alpha.1');
    assert.strictEqual(normalizeVersionString('1_0_0-dev_release'), '1.0.0-dev_release');
    assert.strictEqual(normalizeVersionString('v1_0_0-dev_release'), '1.0.0-dev_release');
    assert.strictEqual(normalizeVersionString('1.0.0-dev_release'), '1.0.0-dev_release');
    assert.strictEqual(normalizeVersionString('v1_0+build_123'), '1.0+build_123');
    assert.strictEqual(normalizeVersionString('V1_0+build_123'), '1.0+build_123');
    assert.strictEqual(normalizeVersionString(''), '');
    assert.strictEqual(normalizeVersionString(undefined), '');
    assert.strictEqual(normalizeVersionString(null), '');
  });

  it('canonicalizes version strings correctly with toCanonicalVersion', () => {
    assert.strictEqual(toCanonicalVersion('v1.0'), '1.0');
    assert.strictEqual(toCanonicalVersion('1.0'), '1.0');
    assert.strictEqual(toCanonicalVersion('V1.0'), '1.0');
    assert.strictEqual(toCanonicalVersion('1.0.0'), '1.0');
    assert.strictEqual(toCanonicalVersion('v1.0.0'), '1.0');
    assert.strictEqual(toCanonicalVersion('v1_0'), '1.0');
    assert.strictEqual(toCanonicalVersion('V1_0'), '1.0');
    assert.strictEqual(toCanonicalVersion('v0.9.1'), '0.9.1');
    assert.strictEqual(toCanonicalVersion('0.9.1'), '0.9.1');
    assert.strictEqual(toCanonicalVersion('v0_9_1'), '0.9.1');
    assert.strictEqual(toCanonicalVersion('v0.9'), '0.9');
    assert.strictEqual(toCanonicalVersion('0.9'), '0.9');
    assert.strictEqual(toCanonicalVersion('v0_9'), '0.9');
    assert.strictEqual(toCanonicalVersion('v0.8'), '0.8');
    assert.strictEqual(toCanonicalVersion('0.8.0'), '0.8');
    assert.strictEqual(toCanonicalVersion('1.0.0-beta.1'), '1.0.0-beta.1');
    assert.strictEqual(toCanonicalVersion('1.0.0+build.1'), '1.0.0+build.1');
    assert.strictEqual(toCanonicalVersion('invalid'), null);
    assert.strictEqual(toCanonicalVersion(''), null);
    assert.strictEqual(toCanonicalVersion(null), null);
    assert.strictEqual(toCanonicalVersion(undefined), null);
  });

  it('handles partial objects safely in toSemVer', () => {
    // Partial object missing prerelease and build arrays
    assert.strictEqual(compareSemVer({major: 1} as unknown as string, '1.0.0'), 0);
    assert.strictEqual(compareSemVer({major: 1, minor: 1} as unknown as string, '1.0.0'), 1);
  });
});
