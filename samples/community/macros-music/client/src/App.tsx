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
import {useEffect, useRef, useState} from 'react';

import {api, type AgentInfo, type MacroInfo} from './api';
import {Composer, PromptChips} from './components/Composer';
import {MacroLibrary} from './components/MacroLibrary';
import {TurnView} from './components/TurnView';
import {useConversation} from './conversation';

export function App() {
  const [info, setInfo] = useState<AgentInfo>();
  const [macros, setMacros] = useState<MacroInfo[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const {turns, busy, sendPrompt, processor} = useConversation();
  const feedEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.info().then(setInfo, e => setLoadError(String(e)));
    api.macros().then(setMacros, e => setLoadError(String(e)));
  }, []);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [turns]);

  const prompts = info?.examplePrompts ?? [];
  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <div className="ln-app">
        <header className="ln-header">
          <div className="ln-logo" aria-hidden="true" />
          <div>
            <h1>Liner Notes</h1>
            <p>Music facts, rendered with A2UI v1.0 macros</p>
          </div>
        </header>
        <main className="ln-main">
          <div className="ln-feed" aria-live="polite">
            {loadError && <div className="ln-failure">Can't reach the agent: {loadError}</div>}
            {turns.length === 0 && (
              <div className="ln-empty">
                <h2>What do you want to know?</h2>
                <p>Sixteen artists across seven decades and six continents. Try one of these:</p>
                <PromptChips prompts={prompts} disabled={busy} onPick={sendPrompt} large />
              </div>
            )}
            {turns.map(turn => (
              <TurnView key={turn.id} turn={turn} processor={processor} />
            ))}
            <div ref={feedEnd} />
          </div>
          <div className="ln-dock">
            {turns.length > 0 && (
              <PromptChips prompts={prompts} disabled={busy} onPick={sendPrompt} />
            )}
            <Composer disabled={busy} onSend={sendPrompt} />
            <p className="ln-footnote">Tour dates and some details are fictional demo data.</p>
          </div>
        </main>
        <MacroLibrary info={info} macros={macros} />
      </div>
    </MarkdownContext.Provider>
  );
}
