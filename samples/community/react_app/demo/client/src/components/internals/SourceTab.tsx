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

import {highlightTsx} from '../../services/highlight';
import type {TurnState} from '../../services/session';
import {Code, TabEmpty} from './Code';

/** The ReactApp sources as the model wrote them, with the checks they went through. */
export function SourceTab({turn}: {turn: TurnState}) {
  const debug = turn.debug;
  if (!debug) {
    return <TabEmpty>The app&apos;s source appears here when the turn completes.</TabEmpty>;
  }
  if (debug.reactApps.length === 0) {
    return <TabEmpty>This turn has no ReactApp; native components covered everything.</TabEmpty>;
  }
  const transpileMs = turn.frameTimings?.transpileMs;
  return (
    <div className="tab-stack">
      <p className="tab-caption">
        The agent checked {debug.reactApps.length === 1 ? 'this app' : 'these apps'} before sending:
        one default export, imports only from <code>react</code> and <code>a2ui</code>, valid data
        paths.
        {debug.retries > 0
          ? ` The first draft failed and was regenerated once.`
          : ' It passed on the first try.'}{' '}
        The app frame transpiled the TSX with Sucrase
        {transpileMs !== undefined ? ` in ${transpileMs.toFixed(1)} ms` : ''}.
      </p>
      {debug.reactApps.map(app => (
        <section key={`${app.surfaceId}/${app.id}`} className="source">
          <header className="source-head">
            <span className="source-title">{app.title ?? app.id}</span>
            <span className="source-meta">
              {app.surfaceId} / {app.id} · {app.source.split('\n').length} lines
            </span>
          </header>
          <dl className="source-facts">
            <dt>dataPaths</dt>
            <dd>{app.dataPaths?.length ? app.dataPaths.join(', ') : 'any (no allowlist)'}</dd>
            <dt>functions</dt>
            <dd>{app.functions?.length ? app.functions.join(', ') : 'any (no allowlist)'}</dd>
          </dl>
          <Code testId="react-source" tokens={highlightTsx(app.source)} lineNumbers />
        </section>
      ))}
      {debug.attempts.length > 1 && (
        <section className="source">
          <header className="source-head">
            <span className="source-title">Checks</span>
          </header>
          <ul className="diagnostics">
            {debug.attempts.map(attempt => (
              <li key={attempt.attempt}>
                Attempt {attempt.attempt}: {attempt.ok ? 'passed' : attempt.errors.join(' · ')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
