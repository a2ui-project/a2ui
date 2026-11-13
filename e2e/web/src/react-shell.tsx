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

/**
 * The React shell: the same page as the Lit shell, rendered with React's `A2uiSurface`.
 *
 * The elements a test drives carry the same ids as in the Lit shell: `#prompt`, `#send`,
 * `#caps`, `#transcript`, `#surfaces`, and `#status`.
 */

import {A2uiSurface, type ReactCatalogComponent} from '@a2ui/react';
import type {SurfaceModel} from '@a2ui/web_core';
import {type FormEvent, useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';

import {A2aSession, type Capabilities, type Progress, readQuery} from './a2a-session.js';
import {markComponentIds, rendererCatalogs, type Shell} from './shell-common.js';

interface TranscriptEntry {
  readonly turn: number;
  readonly text: string;
}

function appendText(entries: TranscriptEntry[], text: string, turn: number): TranscriptEntry[] {
  const last = entries.at(-1);
  if (last && last.turn === turn) {
    return [...entries.slice(0, -1), {turn, text: last.text + text}];
  }
  return [...entries, {turn, text}];
}

function ShellPage() {
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactCatalogComponent>[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [progress, setProgress] = useState<Progress>({inFlight: 0, turns: 0});
  const [failure, setFailure] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>(() => readQuery().capabilities);
  const surfacesRef = useRef<HTMLDivElement>(null);

  const [session] = useState(() => {
    const {agentUrl, capabilities, version} = readQuery();
    return new A2aSession<ReactCatalogComponent>({
      agentUrl,
      version,
      capabilities,
      catalogs: rendererCatalogs<ReactCatalogComponent>(version),
      onText: (text, turn) => setTranscript(entries => appendText(entries, text, turn)),
      onSurfaces: setSurfaces,
      onProgress: setProgress,
    });
  });

  const send = useCallback(
    async (text: string) => {
      setFailure(null);
      try {
        await session.send(text);
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
      }
    },
    [session],
  );

  useEffect(() => {
    const shell: Shell = {session, send};
    window.a2uiShell = shell;
  }, [session, send]);

  useEffect(() => markComponentIds(surfacesRef.current!), []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = event.currentTarget.elements.namedItem('prompt') as HTMLInputElement;
    const text = prompt.value;
    if (!text) return;
    prompt.value = '';
    void send(text);
  };

  return (
    <>
      <form id="composer" onSubmit={submit}>
        <input
          id="prompt"
          name="prompt"
          type="text"
          autoComplete="off"
          placeholder="Message the agent"
        />
        <button id="send" type="submit">
          Send
        </button>
        <select
          id="caps"
          value={capabilities}
          onChange={event => {
            const value = event.target.value as Capabilities;
            session.capabilities = value;
            setCapabilities(value);
          }}
        >
          <option value="v1_0">v1.0</option>
          <option value="v0_9">v0.9</option>
          <option value="off">off</option>
        </select>
      </form>
      <div
        id="status"
        data-busy={String(progress.inFlight > 0)}
        data-turns={String(progress.turns)}
      >
        {failure ? <span className="failure">{failure}</span> : null}
      </div>
      <div id="transcript">
        {transcript.map(entry => (
          <p key={entry.turn} data-role="agent" data-turn={entry.turn}>
            {entry.text}
          </p>
        ))}
      </div>
      <div id="surfaces" ref={surfacesRef}>
        {surfaces.map(surface => (
          <div key={surface.id} data-a2ui-surface={surface.id}>
            <A2uiSurface surface={surface} />
          </div>
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<ShellPage />);
