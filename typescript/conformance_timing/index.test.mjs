/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  compareMedianTimes,
  loadConformanceSuite,
  measureGrowth,
  median,
  readRepositoryJson,
  writePayload,
} from './index.mjs';

/** Spins for about `ms` milliseconds. */
function busy(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Wait.
  }
}

describe('writePayload', () => {
  it('copies text and writes each repeat n times with its separator', () => {
    assert.equal(
      writePayload(['[', {repeat: '"item_{i}"', separator: ', '}, ']'], 3),
      '["item_0", "item_1", "item_2"]',
    );
  });

  it('joins copies without a separator when none is given', () => {
    assert.equal(writePayload([{repeat: '{i}{i}'}], 3), '001122');
  });

  it('writes no copies at size 0', () => {
    assert.equal(writePayload(['a', {repeat: 'x', separator: ','}, 'b'], 0), 'ab');
  });

  it('rejects an unknown segment', () => {
    assert.throws(() => writePayload([{text: 'x'}], 1), /Unknown payload segment/);
  });
});

describe('median', () => {
  it('returns the middle time of an odd count', () => {
    assert.equal(median([5, 1, 3]), 3);
  });

  it('returns the upper middle time of an even count, and keeps its input', () => {
    const times = [4, 1, 3, 2];
    assert.equal(median(times), 3);
    assert.deepEqual(times, [4, 1, 3, 2]);
  });
});

describe('compareMedianTimes', () => {
  it('runs each operation once untimed and then the given number of times', () => {
    let measured = 0;
    let baseline = 0;
    compareMedianTimes(
      () => measured++,
      () => baseline++,
      {runs: 3},
    );
    assert.equal(measured, 4);
    assert.equal(baseline, 4);
  });

  it('reports a slower operation with a ratio above 1', () => {
    const {ratio, measuredMs, baselineMs} = compareMedianTimes(
      () => busy(8),
      () => busy(2),
    );
    assert.ok(measuredMs > baselineMs);
    assert.ok(ratio > 2, `ratio ${ratio}`);
  });
});

describe('measureGrowth', () => {
  const testCase = {
    name: 'test_growth',
    action: 'measure_growth',
    operation: 'spin',
    payload: [{repeat: 'x'}],
    sizes: [2, 8],
    max_ratio: 8,
  };

  it('passes an operation whose time grows in proportion to the payload', () => {
    const result = measureGrowth(testCase, payload => () => busy(payload.length * 0.5));
    assert.deepEqual(result.sizes, [2, 8]);
    assert.ok(result.ratio <= 8, `ratio ${result.ratio}`);
  });

  it('fails an operation whose time grows with the square of the payload', () => {
    assert.throws(
      () => measureGrowth(testCase, payload => () => busy(payload.length ** 2 * 0.1)),
      /spin at 8 against 2/,
    );
  });
});

describe('suite files', () => {
  it('loads a conformance suite', () => {
    const cases = loadConformanceSuite('core/message_processor_scaling.yaml');
    assert.ok(cases.length > 0);
    assert.ok(cases.every(c => c.action === 'measure_growth'));
  });

  it('reads a JSON file by its path from the repository root', () => {
    assert.equal(readRepositoryJson('catalogs/basic/v1/catalog.json').protocolVersion, '1.0');
  });
});
