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
 * The Lit shell: a prompt, a transcript, and one `<a2ui-surface>` per surface.
 *
 * The shell holds no logic beyond wiring `A2aSession` to the page. The elements a test drives
 * carry fixed ids: `#prompt`, `#send`, `#caps`, `#transcript`, `#surfaces`, and `#status`.
 */

import type {LitComponentApi} from '@a2ui/lit';
import type {SurfaceModel} from '@a2ui/web_core';
import {html, nothing, render as renderTemplate} from 'lit';
import {repeat} from 'lit/directives/repeat.js';

import {A2aSession, type Capabilities, type Progress, readQuery} from './a2a-session.js';
import {markComponentIds, rendererCatalogs, type Shell} from './shell-common.js';

import '@a2ui/lit';

interface TranscriptEntry {
  readonly turn: number;
  readonly text: string;
}

export class LitShell implements Shell {
  readonly session: A2aSession<LitComponentApi>;

  private surfaces: SurfaceModel<LitComponentApi>[] = [];
  private transcript: TranscriptEntry[] = [];
  private progress: Progress = {inFlight: 0, turns: 0};
  private failure: string | null = null;
  private scheduled = false;

  constructor(private readonly container: HTMLElement) {
    const {agentUrl, capabilities, version} = readQuery();
    this.session = new A2aSession<LitComponentApi>({
      agentUrl,
      version,
      capabilities,
      catalogs: rendererCatalogs<LitComponentApi>(version),
      onText: (text, turn) => this.appendText(text, turn),
      onSurfaces: surfaces => {
        this.surfaces = surfaces;
        this.update();
      },
      onProgress: progress => {
        this.progress = progress;
        this.update();
      },
    });
    this.render();
    markComponentIds(container.querySelector('#surfaces')!);
  }

  /** Sends `text` as the next user turn; the tests call this for turns without a gesture. */
  async send(text: string): Promise<void> {
    this.failure = null;
    this.update();
    try {
      await this.session.send(text);
    } catch (e) {
      this.failure = e instanceof Error ? e.message : String(e);
      this.update();
    }
  }

  private appendText(text: string, turn: number): void {
    const last = this.transcript.at(-1);
    if (last && last.turn === turn) {
      this.transcript = [...this.transcript.slice(0, -1), {turn, text: last.text + text}];
    } else {
      this.transcript = [...this.transcript, {turn, text}];
    }
    this.update();
  }

  private submit = (event: Event): void => {
    event.preventDefault();
    const prompt = this.container.querySelector<HTMLInputElement>('#prompt')!;
    const text = prompt.value;
    if (!text) return;
    prompt.value = '';
    void this.send(text);
  };

  private changeCapabilities = (event: Event): void => {
    this.session.capabilities = (event.target as HTMLSelectElement).value as Capabilities;
  };

  /**
   * Renders on the next microtask, as a Lit element's `requestUpdate` would.
   *
   * The processor reports a new surface while it is still applying the rest of the frame, so
   * rendering right away would mount the surface before its components and data model are in.
   */
  private update(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.render();
    });
  }

  private render(): void {
    renderTemplate(
      html`
        <form id="composer" @submit=${this.submit}>
          <input id="prompt" type="text" autocomplete="off" placeholder="Message the agent" />
          <button id="send" type="submit">Send</button>
          <select id="caps" .value=${this.session.capabilities} @change=${this.changeCapabilities}>
            <option value="v1_0">v1.0</option>
            <option value="v0_9">v0.9</option>
            <option value="off">off</option>
          </select>
        </form>
        <div
          id="status"
          data-busy=${String(this.progress.inFlight > 0)}
          data-turns=${String(this.progress.turns)}
        >
          ${this.failure ? html`<span class="failure">${this.failure}</span>` : nothing}
        </div>
        <div id="transcript">
          ${this.transcript.map(
            entry => html`<p data-role="agent" data-turn=${entry.turn}>${entry.text}</p>`,
          )}
        </div>
        <div id="surfaces">
          ${repeat(
            this.surfaces,
            surface => surface.id,
            surface =>
              html`<div data-a2ui-surface=${surface.id}>
                <a2ui-surface .surface=${surface}></a2ui-surface>
              </div>`,
          )}
        </div>
      `,
      this.container,
    );
  }
}

window.a2uiShell = new LitShell(document.body);
