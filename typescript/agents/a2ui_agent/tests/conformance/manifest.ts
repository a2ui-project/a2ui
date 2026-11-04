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

import {mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';

import {afterEach} from 'vitest';

export type CaseStatus = 'passed' | 'failed' | 'skipped' | 'xfailed';

export interface ActiveCase {
  suite: string;
  name: string;
  knownFailure?: string;
  version?: string;
}

let activeCase: ActiveCase | undefined;

export function setActiveCase(current: ActiveCase | undefined): void {
  activeCase = current;
}

interface Outcome {
  status: CaseStatus;
  reason?: string;
}

const manifestRecords = new Map<
  string,
  {suite: string; name: string; outcomes: Map<string, Outcome>}
>();

function combineOutcomes(outcomes: ReadonlyMap<string, Outcome>): Outcome {
  for (const target of ['failed', 'xfailed'] as const) {
    for (const outcome of outcomes.values()) {
      if (outcome.status === target) {
        return outcome;
      }
    }
  }
  for (const outcome of outcomes.values()) {
    if (outcome.status === 'passed') {
      return {status: 'passed'};
    }
  }
  for (const outcome of outcomes.values()) {
    if (outcome.reason) {
      return {status: 'skipped', reason: outcome.reason};
    }
  }
  return {status: 'skipped', reason: 'skipped'};
}

/**
 * Records one executed-case manifest entry for the TypeScript agent harness when
 * `A2UI_CONFORMANCE_MANIFEST_DIR` is set, merging outcomes across protocol versions.
 */
export function recordCase(
  suite: string,
  testCase: string,
  status: CaseStatus,
  reason?: string,
  versionKey = 'default',
): void {
  const manifestDir = process.env['A2UI_CONFORMANCE_MANIFEST_DIR'];
  if (!manifestDir) {
    return;
  }
  mkdirSync(manifestDir, {recursive: true});
  const key = `${suite}::${testCase}`;
  let entry = manifestRecords.get(key);
  if (!entry) {
    entry = {suite, name: testCase, outcomes: new Map()};
    manifestRecords.set(key, entry);
  }
  entry.outcomes.set(versionKey, {status, reason});

  const lines: string[] = [];
  for (const item of manifestRecords.values()) {
    const merged = combineOutcomes(item.outcomes);
    const record: Record<string, string> = {
      harness: 'ts-agent',
      suite: item.suite,
      case: item.name,
      status: merged.status,
    };
    if (merged.reason) {
      record['reason'] = merged.reason;
    }
    lines.push(JSON.stringify(record));
  }
  const workerId = process.env['VITEST_WORKER_ID'] ?? '0';
  const filePath = join(manifestDir, `ts-agent-${process.pid}-${workerId}.jsonl`);
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Registers a Vitest `afterEach` hook in the current suite that records the outcome of the
 * active conformance case from `ctx.task.result?.state`.
 */
export function registerAfterEachManifestRecorder(): void {
  afterEach(ctx => {
    const current = activeCase;
    activeCase = undefined;
    if (!current) {
      return;
    }
    const state = ctx.task.result?.state;
    if (ctx.task.fails) {
      // Vitest flips `task.result.state` for `test.fails` after `afterEach` completes, so
      // `state === 'fail'` inside `afterEach` means the expected failure threw as expected.
      if (state === 'fail') {
        recordCase(
          current.suite,
          current.name,
          'xfailed',
          current.knownFailure ?? 'known failure',
          current.version,
        );
      } else {
        recordCase(current.suite, current.name, 'failed', 'Expected test to fail', current.version);
      }
      return;
    }
    if (state === 'pass') {
      recordCase(current.suite, current.name, 'passed', undefined, current.version);
    } else {
      const message = ctx.task.result?.errors?.[0]?.message ?? 'test failed';
      recordCase(current.suite, current.name, 'failed', message, current.version);
    }
  });
}
