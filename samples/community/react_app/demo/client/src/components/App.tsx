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

import {renderMarkdown} from '@a2ui/markdown-it';
import {MarkdownContext} from '@a2ui/react';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {DemoSession} from '../lib/session';
import {AboutPanel} from './AboutPanel';
import {Composer} from './Composer';
import {EmptyState} from './EmptyState';
import {Header} from './Header';
import {useShowInternals} from './show_internals';
import {TurnView} from './TurnView';

export function App({session}: {session: DemoSession}) {
  const turns = useSyncExternalStore(session.subscribe, session.getTurns);
  const [showInternals, setShowInternals] = useShowInternals();
  const [aboutOpen, setAboutOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = turns.some(turn => turn.status === 'streaming');
  const lastTurnId = turns.at(-1)?.id;

  useEffect(() => {
    if (lastTurnId) {
      endRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
    }
  }, [lastTurnId]);

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <div className="page">
        <Header
          showInternals={showInternals}
          onShowInternalsChange={setShowInternals}
          aboutOpen={aboutOpen}
          onAboutToggle={() => setAboutOpen(open => !open)}
        />
        {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
        <main className="column" aria-live="polite">
          {turns.length === 0 ? (
            <EmptyState onPick={prompt => session.send(prompt)} />
          ) : (
            turns.map(turn => (
              <TurnView key={turn.id} turn={turn} session={session} showInternals={showInternals} />
            ))
          )}
          <div ref={endRef} />
        </main>
        <Composer busy={busy} compact={turns.length > 0} onSend={text => session.send(text)} />
      </div>
    </MarkdownContext.Provider>
  );
}
