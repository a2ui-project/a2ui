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

import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v1_0';

import {
  AgentErrorReporter,
  MAX_AGENT_ERRORS_PER_MINUTE,
  REACT_APP_ERROR_CODE,
  toAgentError,
  type ReactAppAgentError,
} from './agent_errors.js';
import {reactAppCatalog} from './catalog.js';

const TARGET = {surfaceId: 'plan', componentId: 'chart'};

describe('toAgentError', () => {
  it('builds the generic branch of a v1.0 renderer-to-agent error', () => {
    const error = toAgentError(
      {phase: 'compile', message: 'Unexpected token', line: 3, column: 7, stack: 'at x'},
      TARGET,
    );

    expect(error).toEqual({
      code: REACT_APP_ERROR_CODE,
      message: 'The ReactApp chart failed in phase compile at line 3: Unexpected token',
      surfaceId: 'plan',
      componentId: 'chart',
      phase: 'compile',
      line: 3,
      column: 7,
    });
    // The generic branch: any code but the validation ones, a surfaceId and no functionCallId.
    expect(['VALIDATION_FAILED', 'UNALLOWED_PARENT', 'UNALLOWED_CHILD']).not.toContain(error.code);
    expect('functionCallId' in error).toBeFalse();
  });

  it('cuts long messages', () => {
    const error = toAgentError({phase: 'runtime', message: 'x'.repeat(5000)}, TARGET);

    expect(error.message.length).toBe(1000);
    expect(error.message.endsWith('…')).toBeTrue();
  });
});

describe('AgentErrorReporter', () => {
  let sent: ReactAppAgentError[];
  let clock: number;
  let reporter: AgentErrorReporter;

  beforeEach(() => {
    sent = [];
    clock = 0;
    reporter = new AgentErrorReporter(
      error => sent.push(error),
      () => clock,
    );
  });

  it('reports the first error of each app document, in the agent-facing phases only', () => {
    const results = [
      reporter.report({phase: 'bridge', message: 'timeout'}, 'doc-a', TARGET),
      reporter.report({phase: 'render', message: 'first'}, 'doc-a', TARGET),
      reporter.report({phase: 'runtime', message: 'second'}, 'doc-a', TARGET),
      reporter.report({phase: 'csp', message: 'blocked'}, 'doc-b', TARGET),
    ];

    expect(results).toEqual([false, true, false, true]);
    expect(sent.map(error => [error.phase, error.message.split(': ')[1]])).toEqual([
      ['render', 'first'],
      ['csp', 'blocked'],
    ]);
  });

  it('reports at most MAX_AGENT_ERRORS_PER_MINUTE errors per minute', () => {
    for (let index = 0; index < MAX_AGENT_ERRORS_PER_MINUTE + 2; index++) {
      reporter.report({phase: 'compile', message: `e${index}`}, `doc-${index}`, TARGET);
    }
    expect(sent.length).toBe(MAX_AGENT_ERRORS_PER_MINUTE);

    clock = 60_000;
    expect(reporter.report({phase: 'compile', message: 'later'}, 'doc-later', TARGET)).toBeTrue();
  });

  it('reaches the agent through the surface error channel of web_core', async () => {
    const processor = new MessageProcessor([basicCatalog, reactAppCatalog]);
    processor.processMessages([{version: '1.0', createSurface: {surfaceId: 'plan'}}] as never);
    const surface = processor.model.getSurface('plan')!;
    const forwarded: unknown[] = [];
    processor.model.onError.subscribe(error => {
      forwarded.push({version: '1.0', error});
    });
    const surfaceReporter = new AgentErrorReporter(error => {
      void surface.dispatchError(error);
    });

    surfaceReporter.report({phase: 'load', message: 'No default export'}, 'doc', TARGET);
    await Promise.resolve();

    expect(forwarded).toEqual([
      {
        version: '1.0',
        error: jasmine.objectContaining({
          code: REACT_APP_ERROR_CODE,
          surfaceId: 'plan',
          componentId: 'chart',
          phase: 'load',
        }),
      },
    ]);
    processor.model.dispose();
  });
});
