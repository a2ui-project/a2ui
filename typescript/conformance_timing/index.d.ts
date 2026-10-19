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

/** One segment of a `PayloadTemplate` in conformance/conformance_schema.json. */
export type PayloadSegment = string | {repeat: string; separator?: string};

/** A case of a conformance suite, as the suite holds it. */
export type ConformanceCase = Record<string, any>;

/** Options for the timing functions. */
export interface TimingOptions {
  /** How many timed runs each operation gets. Defaults to `DEFAULT_RUNS`. */
  runs?: number;
}

export const REPO_ROOT: string;
export const CONFORMANCE_DIR: string;
export const DEFAULT_RUNS: number;

export function loadConformanceSuite(suite: string): ConformanceCase[];
export function readRepositoryJson(relativePath: string): any;
export function writePayload(template: PayloadSegment[], size: number): string;
export function median(times: number[]): number;
export function compareMedianTimes(
  measured: () => void,
  baseline: () => void,
  options?: TimingOptions,
): {measuredMs: number; baselineMs: number; ratio: number};
export function measureGrowth(
  testCase: ConformanceCase,
  prepare: (payload: string, size: number) => () => void,
  options?: TimingOptions,
): {sizes: number[]; medianMs: number[]; ratio: number};
export function measureOverhead(
  testCase: ConformanceCase,
  prepareOperation: (payload: string) => () => void,
  prepareBaseline: (payload: string) => () => void,
  options?: TimingOptions,
): {medianMs: number[]; ratio: number};
