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

import {REACT_APP_BRIDGE_EVENT, type ReactAppBridgeEvent} from '@a2ui-labs/react-app';
import {A2uiSurface} from '@a2ui/react';
import {useEffect, useRef, useState} from 'react';
import type {DemoSession, TurnState} from '../lib/session';
import {AppSkeleton} from './AppSkeleton';
import {Chevron} from './glyphs';
import {InternalsPanel} from './internals/InternalsPanel';

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
    root.addEventListener(REACT_APP_BRIDGE_EVENT, onBridge);
    return () => root.removeEventListener(REACT_APP_BRIDGE_EVENT, onBridge);
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
        {turn.kind === 'action' ? (
          <>
            <span className="turn-prompt-label">Pressed</span>
            {turn.prompt}
          </>
        ) : (
          turn.prompt
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
            </div>
          ) : null;
        })}
        {turn.pendingApp && (
          <AppSkeleton title={turn.pendingApp.title} height={turn.pendingApp.height} />
        )}
        {turn.error && (
          <p className="turn-note turn-error" role="alert" data-testid="turn-error">
            {turn.error.split('\n')[0]}
          </p>
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
