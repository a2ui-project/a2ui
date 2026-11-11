/*
 * Copyright 2026 Google LLC
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

import {useSyncExternalStore} from 'react';
import {CHECKPOINTS, type DemoSession, type TurnState} from '../../services/session';

const formatMs = (ms: number) => `${Math.round(ms).toLocaleString('en-US')} ms`;

/** The latency waterfall of the turn, with token counts and frame timings. */
export function PerformanceTab({turn, session}: {turn: TurnState; session: DemoSession}) {
  const log = session.bridgeLog(turn.id);
  const entries = useSyncExternalStore(log.subscribe, log.getEntries);
  const t0 = turn.marks.T0 ?? 0;
  const rows = CHECKPOINTS.map(checkpoint => ({
    ...checkpoint,
    at: turn.marks[checkpoint.id] !== undefined ? turn.marks[checkpoint.id]! - t0 : undefined,
  }));
  const span = Math.max(1, ...rows.map(row => row.at ?? 0));
  // Each bar runs from the latest earlier checkpoint to this one, so gaps read as waiting time.
  const starts = rows.map((row, index) =>
    Math.max(
      0,
      ...rows
        .slice(0, index)
        .map(earlier => earlier.at ?? 0)
        .filter(at => at <= (row.at ?? 0)),
    ),
  );
  const calls = entries.filter(entry => entry.request?.method === 'function/call');
  const largest = entries.reduce((max, entry) => Math.max(max, entry.size), 0);
  const usage = turn.debug?.usage;
  const frame = turn.frameTimings;

  return (
    <div className="tab-stack">
      <p className="tab-caption">
        Milliseconds after the request, on this page&apos;s clock. Agent checkpoints are converted
        from the agent&apos;s wall clock.
      </p>
      <ol className="waterfall" data-testid="waterfall">
        {rows.map((row, index) => (
          <li key={row.id} className="waterfall-row" data-checkpoint={row.id}>
            <span className="waterfall-id">{row.id}</span>
            <span className="waterfall-label">
              {row.label}
              <span className="waterfall-where">{row.where}</span>
            </span>
            <span className="waterfall-track">
              {row.at !== undefined && (
                <span
                  className={`waterfall-bar waterfall-${row.where}`}
                  style={{
                    left: `${(starts[index]! / span) * 100}%`,
                    width: `${Math.max(0.6, ((row.at - starts[index]!) / span) * 100)}%`,
                  }}
                />
              )}
            </span>
            <span className="waterfall-ms">{row.at !== undefined ? formatMs(row.at) : '—'}</span>
          </li>
        ))}
      </ol>
      <dl className="stats">
        <div>
          <dt>Model</dt>
          <dd>
            {turn.model ?? '—'}
            {turn.mode === 'replay' ? ' (recorded)' : ''}
          </dd>
        </div>
        <div>
          <dt>Prompt</dt>
          <dd>
            {usage ? `${usage.promptTokens.toLocaleString('en-US')} tokens` : '—'}
            {turn.debug ? ` · ${turn.debug.promptChars.toLocaleString('en-US')} chars system` : ''}
          </dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>
            {usage
              ? `${usage.outputTokens.toLocaleString('en-US')} tokens · ${usage.thoughtsTokens.toLocaleString('en-US')} thinking`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Retries</dt>
          <dd>{turn.debug ? turn.debug.retries : '—'}</dd>
        </div>
        <div>
          <dt>App frame</dt>
          <dd>
            {frame
              ? `runtime ${frame.runtimeReady ?? '—'} · initialized ${frame.initialized ?? '—'} · compiled ${frame.compiled ?? '—'} · rendered ${frame.rendered ?? '—'} ms`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Function calls</dt>
          <dd>
            {calls.length ? summarizeCalls(calls.map(call => call.request!.durationMs)) : 'none'}
          </dd>
        </div>
        <div>
          <dt>Largest bridge message</dt>
          <dd>{largest ? `${(largest / 1024).toFixed(1)} KB` : '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

/** `n calls · median x ms · slowest y ms`. */
function summarizeCalls(durations: number[]): string {
  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const slowest = sorted.at(-1) ?? 0;
  return `${durations.length} · median ${Math.round(median)} ms · slowest ${Math.round(slowest)} ms`;
}
