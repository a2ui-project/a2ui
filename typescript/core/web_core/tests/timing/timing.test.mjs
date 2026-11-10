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
  measureOverhead,
  median,
  readRepositoryJson,
  writePayload,
} from './timing.mjs';

/**
 * A fake clock for the timing functions. `now` reads it, and the operation
 * `spend(ms)` returns advances it by `ms`, so the times these tests compare
 * are exact whatever the machine's load.
 */
function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    spend: ms => () => {
      clock += ms;
    },
  };
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
    const {now} = fakeClock();
    let measured = 0;
    let baseline = 0;
    compareMedianTimes(
      () => measured++,
      () => baseline++,
      {runs: 3, now},
    );
    assert.equal(measured, 4);
    assert.equal(baseline, 4);
  });

  it('reports the median times and their ratio', () => {
    const {now, spend} = fakeClock();
    assert.deepEqual(compareMedianTimes(spend(8), spend(2), {now}), {
      measuredMs: 8,
      baselineMs: 2,
      ratio: 4,
    });
  });

  it('compares medians, so one slow run and the untimed run do not count', () => {
    const {now, spend} = fakeClock();
    // The untimed run comes first, then the five timed runs.
    const costs = [1000, 3, 3, 500, 3, 3];
    let run = 0;
    const result = compareMedianTimes(() => spend(costs[run++])(), spend(1), {now});
    assert.equal(run, 6);
    assert.deepEqual(result, {measuredMs: 3, baselineMs: 1, ratio: 3});
  });

  it('collects full garbage once before warmup and minor garbage before each timed run', () => {
    const {now, spend} = fakeClock();
    const originalGc = globalThis.gc;
    const gcCalls = [];
    globalThis.gc = (...args) => {
      gcCalls.push(args);
    };
    try {
      compareMedianTimes(spend(8), spend(2), {runs: 2, now});
    } finally {
      globalThis.gc = originalGc;
    }
    assert.deepEqual(gcCalls, [
      [],
      [{type: 'minor'}],
      [{type: 'minor'}],
      [{type: 'minor'}],
      [{type: 'minor'}],
    ]);
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
    const {now, spend} = fakeClock();
    const result = measureGrowth(testCase, payload => spend(payload.length), {now});
    assert.deepEqual(result, {sizes: [2, 8], medianMs: [2, 8], ratio: 4});
  });

  it('fails an operation whose time grows with the square of the payload', () => {
    const {now, spend} = fakeClock();
    assert.throws(
      () => measureGrowth(testCase, payload => spend(payload.length ** 2), {now}),
      /spin at 8 against 2: 64\.00 ms against 4\.00 ms, a ratio of 16\.00, above 8/,
    );
  });

  it('passes each size to the operation it prepares', () => {
    const {now, spend} = fakeClock();
    const sizes = [];
    measureGrowth(
      testCase,
      (payload, size) => {
        sizes.push(size);
        return spend(1);
      },
      {now},
    );
    assert.deepEqual(sizes, [8, 2]);
  });
});

describe('measureOverhead', () => {
  const testCase = {
    name: 'test_overhead',
    action: 'measure_overhead',
    operation: 'stream',
    baseline: 'compile',
    payload: [{repeat: 'x'}],
    size: 10,
    max_ratio: 2,
  };

  it('passes an operation within max_ratio of its baseline', () => {
    const {now, spend} = fakeClock();
    const result = measureOverhead(
      testCase,
      () => spend(15),
      () => spend(10),
      {now},
    );
    assert.deepEqual(result, {medianMs: [10, 15], ratio: 1.5});
  });

  it('fails an operation past max_ratio of its baseline', () => {
    const {now, spend} = fakeClock();
    assert.throws(
      () =>
        measureOverhead(
          testCase,
          () => spend(25),
          () => spend(10),
          {now},
        ),
      /stream against compile at 10: .*a ratio of 2\.50, above 2/,
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
