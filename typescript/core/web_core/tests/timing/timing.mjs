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

// Runs the timing cases of the conformance suites (`measure_growth` and
// `measure_overhead` in conformance/conformance_schema.json) for the
// TypeScript packages. A package supplies the operation to time; this module
// writes the payloads, times the runs and compares the medians, as
// conformance/agent/direct_json/scaling.yaml describes.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

import yaml from 'js-yaml';

/** The repository root. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);

/** The directory holding the language-agnostic conformance suites. */
export const CONFORMANCE_DIR = path.join(REPO_ROOT, 'conformance');

/** How many times each operation is timed, at the least. */
export const DEFAULT_RUNS = 5;

/**
 * Options of the timing functions.
 *
 * @typedef {object} TimingOptions
 * @property {number} [runs] How many timed runs each operation gets;
 *     `DEFAULT_RUNS` when omitted.
 * @property {() => number} [now] The clock, in milliseconds;
 *     `performance.now()` when omitted. A test passes a fake clock that the
 *     operations it times advance, which makes its times exact.
 */

/**
 * Reads a conformance suite.
 *
 * @param {string} suite Path of the suite relative to `conformance/`, such as
 *     `core/message_processor_scaling.yaml`.
 * @returns {Array<Record<string, any>>} The suite's cases.
 */
export function loadConformanceSuite(suite) {
  const cases = yaml.load(fs.readFileSync(path.join(CONFORMANCE_DIR, suite), 'utf8'));
  if (!Array.isArray(cases)) {
    throw new Error(`Conformance suite '${suite}' is not a list of cases.`);
  }
  return cases;
}

/**
 * Reads a JSON file a case names by its path relative to the repository root,
 * such as an entry of `catalogPaths`.
 *
 * @param {string} relativePath Path relative to the repository root.
 * @returns {any} The decoded JSON.
 */
export function readRepositoryJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

/**
 * Writes the payload of a timing case at size `size`, as `PayloadTemplate`
 * in conformance/conformance_schema.json describes: a string segment is
 * copied as it is, and a `repeat` segment is its text written `size` times,
 * with each `{i}` replaced by the number of the copy, counting from 0, and
 * `separator` between the copies.
 *
 * @param {Array<string | {repeat: string, separator?: string}>} template The
 *     case's `payload`.
 * @param {number} size The number of copies of each `repeat` segment.
 * @returns {string} The payload text.
 */
export function writePayload(template, size) {
  return template
    .map(segment => {
      if (typeof segment === 'string') return segment;
      if (segment && typeof segment === 'object' && typeof segment.repeat === 'string') {
        const copies = [];
        for (let i = 0; i < size; i++) {
          copies.push(segment.repeat.replaceAll('{i}', String(i)));
        }
        return copies.join(segment.separator ?? '');
      }
      throw new Error(`Unknown payload segment: ${JSON.stringify(segment)}`);
    })
    .join('');
}

/**
 * Runs garbage collection when Node starts with `--expose-gc`.
 *
 * @param {{type?: 'major' | 'minor'}} [options] V8 garbage collection options.
 */
function collectGarbage(options) {
  if (typeof globalThis.gc !== 'function') return;
  if (options === undefined) {
    globalThis.gc();
  } else {
    globalThis.gc(options);
  }
}

/**
 * The time `body` takes, in milliseconds. When Node runs with `--expose-gc`,
 * the young generation is collected first so that nursery allocations from
 * earlier runs are not charged to this one and old-space `Mark-Compact`
 * does not deoptimize JIT-compiled code between timed runs.
 *
 * Across `DEFAULT_RUNS`, objects promoted during in-run scavenges in larger
 * suites can still cross V8's old-space limit and trigger a `Mark-Compact`
 * inside a timed `body` call; `median` absorbs the resulting single-run
 * outlier.
 *
 * @param {() => void} body The code to time.
 * @param {() => number} now The clock, in milliseconds.
 * @returns {number} The elapsed time.
 */
function time(body, now) {
  collectGarbage({type: 'minor'});
  const start = now();
  body();
  return now() - start;
}

/**
 * The median of `times`.
 *
 * @param {number[]} times At least one time.
 * @returns {number} The middle time, or the upper of the two middle times.
 */
export function median(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Times `measured` against `baseline` and returns the ratio of their median
 * times.
 *
 * Each runs once untimed, so that code compiled on first use is compiled,
 * and then the two run in turn `runs` times each.
 *
 * @param {() => void} measured The operation whose time is the numerator.
 * @param {() => void} baseline The operation whose time is the denominator.
 * @param {TimingOptions} [options] How many timed runs each gets, and the
 *     clock.
 * @returns {{measuredMs: number, baselineMs: number, ratio: number}} The
 *     median times in milliseconds and their ratio.
 */
export function compareMedianTimes(
  measured,
  baseline,
  {runs = DEFAULT_RUNS, now = () => performance.now()} = {},
) {
  collectGarbage();
  baseline();
  measured();
  const baselineTimes = [];
  const measuredTimes = [];
  for (let run = 0; run < runs; run++) {
    baselineTimes.push(time(baseline, now));
    measuredTimes.push(time(measured, now));
  }
  const measuredMs = median(measuredTimes);
  const baselineMs = median(baselineTimes);
  return {measuredMs, baselineMs, ratio: measuredMs / baselineMs};
}

/**
 * Runs a `measure_growth` case: times the operation at the case's two
 * `sizes` and fails when the time at the larger is more than `max_ratio`
 * times the time at the smaller.
 *
 * @param {Record<string, any>} testCase The case, as the suite holds it.
 * @param {(payload: string, size: number) => () => void} prepare Returns the
 *     operation to time on the case's payload written at `size`. Work done in
 *     `prepare`, such as decoding the payload, is not timed.
 * @param {TimingOptions} [options] How many timed runs each size gets, and
 *     the clock.
 * @returns {{sizes: number[], medianMs: number[], ratio: number}} The sizes,
 *     the median time at each, and the ratio of the two.
 */
export function measureGrowth(testCase, prepare, options) {
  assert.equal(testCase.action, 'measure_growth');
  const [smaller, larger] = testCase.sizes;
  const result = compareMedianTimes(
    prepare(writePayload(testCase.payload, larger), larger),
    prepare(writePayload(testCase.payload, smaller), smaller),
    options,
  );
  assertRatio(result, testCase.max_ratio, `${testCase.operation} at ${larger} against ${smaller}`);
  return {
    sizes: [smaller, larger],
    medianMs: [result.baselineMs, result.measuredMs],
    ratio: result.ratio,
  };
}

/**
 * Runs a `measure_overhead` case: times the operation against the case's
 * `baseline` on the payload written at `size`, and fails when it takes more
 * than `max_ratio` times as long.
 *
 * @param {Record<string, any>} testCase The case, as the suite holds it.
 * @param {(payload: string) => () => void} prepareOperation Returns the
 *     `operation` to time on the payload.
 * @param {(payload: string) => () => void} prepareBaseline Returns the
 *     `baseline` to time on the payload.
 * @param {TimingOptions} [options] How many timed runs each gets, and the
 *     clock.
 * @returns {{medianMs: number[], ratio: number}} The median times of the
 *     baseline and the operation, and their ratio.
 */
export function measureOverhead(testCase, prepareOperation, prepareBaseline, options) {
  assert.equal(testCase.action, 'measure_overhead');
  const payload = writePayload(testCase.payload, testCase.size);
  const result = compareMedianTimes(prepareOperation(payload), prepareBaseline(payload), options);
  assertRatio(
    result,
    testCase.max_ratio,
    `${testCase.operation} against ${testCase.baseline} at ${testCase.size}`,
  );
  return {medianMs: [result.baselineMs, result.measuredMs], ratio: result.ratio};
}

function assertRatio({measuredMs, baselineMs, ratio}, maxRatio, what) {
  assert.ok(
    ratio <= maxRatio,
    `Median time of ${what}: ${measuredMs.toFixed(2)} ms against ` +
      `${baselineMs.toFixed(2)} ms, a ratio of ${ratio.toFixed(2)}, above ${maxRatio}.`,
  );
}
