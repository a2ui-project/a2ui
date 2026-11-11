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

import {highlightJson} from '../../services/highlight';
import type {TurnState} from '../../services/session';
import {Code, TabEmpty} from './Code';

/** A one-line summary of an A2UI message: its kind, surface and size. */
function summarize(message: Record<string, unknown>): {kind: string; detail: string} {
  const kind = Object.keys(message).find(key => key !== 'version') ?? 'message';
  const body = (message[kind] ?? {}) as {
    surfaceId?: string;
    components?: Array<{id?: string; component?: string}>;
    path?: string;
  };
  const parts = [body.surfaceId ? `surface ${body.surfaceId}` : ''];
  if (body.components?.length) {
    const names = body.components.map(c => c.component ?? '?');
    parts.push(
      `${names.length} component${names.length === 1 ? '' : 's'}: ${[...new Set(names)].join(', ')}`,
    );
  }
  if (body.path) {
    parts.push(`path ${body.path}`);
  }
  return {kind, detail: parts.filter(Boolean).join(' · ')};
}

/** The compiled messages the agent sent over SSE, one collapsible block each. */
export function JsonTab({turn}: {turn: TurnState}) {
  const messages = turn.debug?.messages;
  if (!messages) {
    return <TabEmpty>The A2UI messages appear here when the turn completes.</TabEmpty>;
  }
  return (
    <div className="tab-stack">
      <p className="tab-caption">
        {messages.length} message{messages.length === 1 ? '' : 's'}, sent as one <code>a2ui</code>{' '}
        server-sent event each, in the order the Express statements closed.
      </p>
      <ol className="message-list">
        {messages.map((message, index) => {
          const {kind, detail} = summarize(message);
          return (
            <li key={index}>
              <details className="message" data-testid="json-message">
                <summary>
                  <span className="message-index">{index + 1}</span>
                  <span className="message-kind">{kind}</span>
                  <span className="message-detail">{detail}</span>
                </summary>
                <Code tokens={highlightJson(JSON.stringify(message, null, 2))} />
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
