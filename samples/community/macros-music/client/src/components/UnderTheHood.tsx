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

import {useState} from 'react';

import type {AgentTurn, TurnDebug} from '../api';

type Tab = 'express' | 'wire' | 'tools';

/** Shows what the model wrote, what the renderer received, and the cost. */
export function UnderTheHood({
  debug,
  messages,
}: {
  debug: TurnDebug;
  messages: AgentTurn['messages'];
}) {
  const [tab, setTab] = useState<Tab>('express');
  const source =
    debug.mode === 'live' ? debug.model : debug.mode === 'action' ? 'button action' : 'scripted';
  return (
    <details className="ln-hood" data-testid="under-the-hood">
      <summary>
        <span className="ln-hood-label">Under the hood</span>
        <span className="ln-hood-stats" data-testid="hood-stats">
          {debug.macroCalls.length} macro {debug.macroCalls.length === 1 ? 'call' : 'calls'} →{' '}
          {debug.transportComponentCount} components · {debug.latencyMs.toLocaleString()} ms ·{' '}
          {source}
        </span>
      </summary>
      <div className="ln-hood-body">
        <dl className="ln-hood-facts">
          <dt>Macros used</dt>
          <dd>{debug.macroCalls.join(', ') || 'none'}</dd>
          <dt>Components</dt>
          <dd>
            {debug.inferenceComponentCount} written by the model, {debug.transportComponentCount}{' '}
            sent to the renderer
          </dd>
          {debug.inputTokens != null && (
            <>
              <dt>Tokens</dt>
              <dd>
                {debug.inputTokens.toLocaleString()} in · {debug.outputTokens?.toLocaleString()} out
              </dd>
            </>
          )}
          {debug.attempts > 1 && (
            <>
              <dt>Attempts</dt>
              <dd>{debug.attempts} (the first reply failed validation and was retried)</dd>
            </>
          )}
          {debug.error && (
            <>
              <dt>Error</dt>
              <dd className="ln-hood-error">{debug.error}</dd>
            </>
          )}
        </dl>
        <div className="ln-hood-tabs" role="tablist">
          {(
            [
              ['express', 'Model output (Express)'],
              ['wire', 'A2UI v1.0 messages'],
              ['tools', `Tool calls (${debug.toolCalls.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className="ln-hood-tab"
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <pre className="ln-code" data-testid={`hood-${tab}`}>
          {tab === 'express' && (debug.modelOutput || '(none)')}
          {tab === 'wire' && JSON.stringify(messages, null, 2)}
          {tab === 'tools' &&
            (debug.toolCalls.map(c => `${c.name}(${JSON.stringify(c.args)})`).join('\n') ||
              'No tool calls.')}
        </pre>
      </div>
    </details>
  );
}
