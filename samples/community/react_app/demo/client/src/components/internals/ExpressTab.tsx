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

import {useMemo, useState} from 'react';
import {highlightExpress, highlightTsx} from '../../services/highlight';
import type {TurnState} from '../../services/session';
import {Code, TabEmpty} from './Code';

/** The raw model output; `r"""` code blocks fold until clicked. */
export function ExpressTab({turn}: {turn: TurnState}) {
  const debug = turn.debug;
  const tokens = useMemo(() => highlightExpress(debug?.express ?? ''), [debug?.express]);
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  if (!debug) {
    return <TabEmpty>The model&apos;s raw output appears here when the turn completes.</TabEmpty>;
  }
  const failed = debug.attempts.filter(attempt => !attempt.ok);
  return (
    <div className="tab-stack">
      <p className="tab-caption">
        What {debug.model} wrote: prose, then an <code>&lt;a2ui&gt;</code> block of Express
        statements. The agent compiles each statement to A2UI as soon as it closes.
        {failed.length > 0 && ` This is the retry; the first draft is below.`}
      </p>
      <Code
        testId="express-code"
        tokens={tokens}
        renderToken={(token, index) => {
          if (token.kind !== 'raw-block') {
            return undefined;
          }
          const body = token.text.replace(/^r"""/, '').replace(/"""$/, '');
          const lines = body.split('\n').filter(line => line.trim()).length;
          if (unfolded.has(index)) {
            return (
              <span key={index} className="raw-block is-open">
                <span className="tok tok-string">r&quot;&quot;&quot;</span>
                {highlightTsx(body).map((t, i) => (
                  <span key={i} className={`tok tok-${t.kind}`}>
                    {t.text}
                  </span>
                ))}
                <span className="tok tok-string">&quot;&quot;&quot;</span>
              </span>
            );
          }
          return (
            <button
              key={index}
              type="button"
              className="raw-fold"
              data-testid="raw-fold"
              onClick={() => setUnfolded(new Set([...unfolded, index]))}
            >
              r&quot;&quot;&quot; {lines} lines of TSX, click to unfold &quot;&quot;&quot;
            </button>
          );
        }}
      />
      {failed.map(attempt => (
        <details key={attempt.attempt} className="attempt">
          <summary>
            Attempt {attempt.attempt}: rejected with {attempt.errors.length} problem
            {attempt.errors.length === 1 ? '' : 's'}
          </summary>
          <ul className="diagnostics">
            {attempt.errors.map(error => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <Code tokens={highlightExpress(attempt.express)} />
        </details>
      ))}
    </div>
  );
}
