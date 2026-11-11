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

import {
  REACT_APP_BRIDGE_EVENT,
  REACT_APP_ERROR_EVENT,
  type ReactAppBridgeEvent,
  type ReactAppError,
} from '@a2ui-labs/react-app';
import {A2uiSurface} from '@a2ui/react';
import {useEffect, useRef, useState} from 'react';
import type {DemoSession, TurnState} from '../services/session';
import {AppSkeleton} from './AppSkeleton';
import {Chevron} from './glyphs';
import {InternalsPanel} from './internals/InternalsPanel';

/** The DOM event the sandboxed frame element dispatches when the sandbox stops an app. */
const SANDBOX_ERROR_EVENT = 'a2ui-sandbox-error';

interface TurnViewProps {
  turn: TurnState;
  session: DemoSession;
  showInternals: boolean;
}

/** One exchange: the prompt, the answer with its surfaces, and the "How this was built" panel. */
export function TurnView({turn, session, showInternals}: TurnViewProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [internalsOpen, setInternalsOpen] = useState(showInternals);

  useEffect(() => setInternalsOpen(showInternals), [showInternals]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const onBridge = (event: Event) =>
      session.recordBridgeEvent(turn.id, (event as CustomEvent<ReactAppBridgeEvent>).detail);
    const onAppError = (event: Event) => {
      const error = (event as CustomEvent<ReactAppError>).detail;
      const card = (event.target as Element | null)?.closest('[data-surface-id]');
      const surfaceId = card?.getAttribute('data-surface-id') ?? null;
      const app = session
        .getTurns()
        .find(candidate => candidate.id === turn.id)
        ?.debug?.reactApps.find(candidate => candidate.surfaceId === surfaceId);
      session.recordAppError(turn.id, {
        surfaceId,
        componentId: app?.id ?? null,
        phase: error.phase,
        message: error.message,
      });
    };
    const onSandboxError = (event: Event) =>
      session.recordSandboxError(
        turn.id,
        (event as CustomEvent<{code: string; message: string}>).detail,
      );
    root.addEventListener(REACT_APP_BRIDGE_EVENT, onBridge);
    root.addEventListener(REACT_APP_ERROR_EVENT, onAppError);
    root.addEventListener(SANDBOX_ERROR_EVENT, onSandboxError);
    return () => {
      root.removeEventListener(REACT_APP_BRIDGE_EVENT, onBridge);
      root.removeEventListener(REACT_APP_ERROR_EVENT, onAppError);
      root.removeEventListener(SANDBOX_ERROR_EVENT, onSandboxError);
    };
  }, [session, turn.id]);

  const thinking =
    turn.status === 'streaming' && !turn.text && turn.surfaceIds.length === 0 && !turn.pendingApp;

  return (
    <article
      ref={rootRef}
      className="turn"
      data-testid="turn"
      data-turn-id={turn.id}
      data-status={turn.status}
    >
      <p className={`turn-prompt turn-prompt-${turn.kind}`}>
        {turn.kind === 'prompt' ? (
          turn.prompt
        ) : (
          <>
            <span className="turn-prompt-label">
              {turn.kind === 'action' ? 'Pressed' : 'Automatic'}
            </span>
            {turn.prompt}
          </>
        )}
      </p>
      <div className="turn-answer">
        {turn.text && <p className="turn-text">{turn.text.trim()}</p>}
        {thinking && (
          <p className="turn-thinking" data-testid="thinking">
            Thinking
            <span className="dots" aria-hidden="true" />
          </p>
        )}
        {turn.retries.map(retry => (
          <p key={retry.attempt} className="turn-note" data-testid="retry-note">
            The first draft failed {retry.errors.length === 1 ? 'a check' : 'some checks'}; the
            model is fixing it.
          </p>
        ))}
        {turn.surfaceIds.map(surfaceId => {
          const surface = session.processor.model.getSurface(surfaceId);
          return surface ? (
            <div
              key={surfaceId}
              className="surface-card"
              data-testid="surface"
              data-surface-id={surfaceId}
            >
              <A2uiSurface surface={surface} />
              {turn.pendingApp && (
                <AppSkeleton
                  title={turn.pendingApp.title}
                  height={turn.pendingApp.height}
                  embedded
                />
              )}
            </div>
          ) : null;
        })}
        {turn.surfaceIds.length === 0 && turn.pendingApp && (
          <div className="surface-card">
            <AppSkeleton title={turn.pendingApp.title} height={turn.pendingApp.height} />
          </div>
        )}
        {turn.superseded.length > 0 && (
          <p className="turn-note turn-note-quiet" data-testid="superseded-note">
            A later answer rewrote this interface; it now shows there.
          </p>
        )}
        {turn.problems.map(problem => (
          <p key={problem} className="turn-note turn-error" role="alert" data-testid="turn-problem">
            {problem}
          </p>
        ))}
        {turn.error && (
          <div className="turn-note turn-error" role="alert" data-testid="turn-error">
            <p>{turn.error.split('\n')[0]}</p>
            {turn.error.includes('\n') && (
              <ul className="turn-error-details">
                {turn.error
                  .split('\n')
                  .slice(1)
                  .map(line => (
                    <li key={line}>{line}</li>
                  ))}
              </ul>
            )}
          </div>
        )}
        {turn.status !== 'streaming' && (
          <section className="internals" data-testid="internals" data-open={internalsOpen}>
            <button
              type="button"
              className="internals-toggle"
              aria-expanded={internalsOpen}
              data-testid="internals-toggle"
              onClick={() => setInternalsOpen(open => !open)}
            >
              <Chevron open={internalsOpen} />
              How this was built
            </button>
            {internalsOpen && <InternalsPanel turn={turn} session={session} />}
          </section>
        )}
      </div>
    </article>
  );
}
