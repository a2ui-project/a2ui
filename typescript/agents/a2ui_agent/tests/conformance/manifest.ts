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

import {appendFileSync, mkdirSync} from 'fs';
import {join} from 'path';

import {afterEach} from 'vitest';

export type CaseStatus = 'passed' | 'failed' | 'skipped' | 'xfailed';

export interface ActiveCase {
  suite: string;
  name: string;
  knownFailure?: string;
  skipReason?: string;
  unexpectedError?: Error;
  recorded?: boolean;
}

const activeCases = new WeakMap<object, ActiveCase>();

export function setActiveCase(task: object, current: ActiveCase | undefined): void {
  if (current === undefined) {
    activeCases.delete(task);
  } else {
    activeCases.set(task, current);
  }
}

export function getActiveCase(task: object): ActiveCase | undefined {
  return activeCases.get(task);
}

/**
 * Appends one executed-case manifest entry for the TypeScript agent harness when
 * `A2UI_CONFORMANCE_MANIFEST_DIR` is set.
 */
export function recordCase(
  suite: string,
  testCase: string,
  status: CaseStatus,
  reason?: string,
): void {
  const manifestDir = process.env['A2UI_CONFORMANCE_MANIFEST_DIR'];
  if (!manifestDir) {
    return;
  }
  mkdirSync(manifestDir, {recursive: true});
  const record: Record<string, string> = {
    harness: 'ts-agent',
    suite,
    case: testCase,
    status,
  };
  const trimmed = reason?.trim();
  if (trimmed) {
    record['reason'] = trimmed;
  }
  const workerId = process.env['VITEST_WORKER_ID'] ?? '0';
  const filePath = join(manifestDir, `ts-agent-${process.pid}-${workerId}.jsonl`);
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Registers a Vitest `afterEach` hook in the current suite that records the outcome of the
 * active conformance case from `ctx.task.result?.state`.
 */
export function registerAfterEachManifestRecorder(): void {
  afterEach(ctx => {
    const current = activeCases.get(ctx.task);
    activeCases.delete(ctx.task);
    if (!current || current.recorded) {
      return;
    }
    current.recorded = true;
    const state = ctx.task.result?.state;
    if (state === 'skip') {
      const reason = current.skipReason?.trim() || ctx.task.result?.note?.trim() || 'skipped';
      recordCase(current.suite, current.name, 'skipped', reason);
      return;
    }
    if (ctx.task.fails) {
      if (current.unexpectedError) {
        recordCase(
          current.suite,
          current.name,
          'failed',
          current.unexpectedError.message.trim() || 'test failed',
        );
        return;
      }
      const firstError = ctx.task.result?.errors?.[0];
      if (firstError?.name === 'UnknownConformanceKeyError') {
        recordCase(
          current.suite,
          current.name,
          'failed',
          firstError.message?.trim() || 'test failed',
        );
        return;
      }
      // Vitest flips `task.result.state` for `test.fails` after `afterEach` completes, so
      // `state === 'fail'` inside `afterEach` means the expected failure threw as expected.
      if (state === 'fail') {
        recordCase(
          current.suite,
          current.name,
          'xfailed',
          current.knownFailure?.trim() || 'known failure',
        );
      } else {
        recordCase(current.suite, current.name, 'failed', 'Expected test to fail');
      }
      return;
    }
    if (state === 'pass') {
      recordCase(current.suite, current.name, 'passed');
    } else {
      const message = ctx.task.result?.errors?.[0]?.message?.trim() || 'test failed';
      recordCase(current.suite, current.name, 'failed', message);
    }
  });
}
