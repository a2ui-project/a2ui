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

import {html, nothing, render, type TemplateResult} from 'lit';
import {repeat} from 'lit/directives/repeat.js';
import {A2uiSurface, type LitComponentApi} from '@a2ui/lit';
import type {SurfaceModel} from '@a2ui/web_core/v1_0';
import {EMBED_ROOT_CLASS} from './theme.js';

// Referenced so bundlers keep the module that defines `<a2ui-surface>`.
void A2uiSurface;

/** What the app shows in place of surfaces. */
export type EmbedStatus =
  | {kind: 'waiting'}
  /** A tool result without A2UI content: there is nothing to show. */
  | {kind: 'empty'}
  | {kind: 'loading'}
  | {kind: 'cancelled'}
  | {kind: 'error'; title: string; message: string};

/**
 * Renders the app: a status, an error card or the surfaces, plus a dismissible notice for errors
 * that leave the surfaces in place.
 */
export class EmbedView {
  readonly element: HTMLElement;
  private content: EmbedStatus | (() => SurfaceModel<LitComponentApi>[]) = {kind: 'waiting'};
  private notice: string | undefined;
  private busy = false;

  constructor(root: HTMLElement) {
    this.element = root.ownerDocument.createElement('div');
    this.element.className = EMBED_ROOT_CLASS;
    root.append(this.element);
    this.update();
  }

  /** Shows a status or an error card instead of surfaces. */
  showStatus(status: EmbedStatus): void {
    this.content = status;
    this.notice = undefined;
    this.update();
  }

  /** Shows the surfaces `getSurfaces` returns; call {@link update} when they change. */
  showSurfaces(getSurfaces: () => SurfaceModel<LitComponentApi>[]): void {
    this.content = getSurfaces;
    this.notice = undefined;
    this.update();
  }

  /** Shows a notice above the content, or hides it. */
  setNotice(message: string | undefined): void {
    this.notice = message;
    this.update();
  }

  /** Marks the content as busy while actions are in flight. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.update();
  }

  /** Renders the current state. */
  update(): void {
    render(
      html`${this.renderNotice()}
        <div class="${EMBED_ROOT_CLASS}__content" aria-busy=${this.busy ? 'true' : 'false'}>
          ${this.renderContent()}
        </div>`,
      this.element,
    );
  }

  dispose(): void {
    render(nothing, this.element);
    this.element.remove();
  }

  private renderNotice(): TemplateResult | typeof nothing {
    if (this.notice === undefined) {
      return nothing;
    }
    return html`<div class="${EMBED_ROOT_CLASS}__notice" role="alert">
      <span class="${EMBED_ROOT_CLASS}__notice-text">${this.notice}</span>
      <button
        type="button"
        class="${EMBED_ROOT_CLASS}__notice-dismiss"
        @click=${() => this.setNotice(undefined)}
      >
        Dismiss
      </button>
    </div>`;
  }

  private renderContent(): TemplateResult | typeof nothing {
    const content = this.content;
    if (typeof content === 'function') {
      return html`${repeat(
        content(),
        surface => surface.id,
        surface => html`<a2ui-surface .surface=${surface}></a2ui-surface>`,
      )}`;
    }
    switch (content.kind) {
      case 'waiting':
      case 'empty':
        return nothing;
      case 'loading':
        return html`<p class="${EMBED_ROOT_CLASS}__status" role="status">Loading…</p>`;
      case 'cancelled':
        return html`<p class="${EMBED_ROOT_CLASS}__status" role="status">
          The tool call was cancelled.
        </p>`;
      case 'error':
        return html`<div class="${EMBED_ROOT_CLASS}__error" role="alert">
          <p class="${EMBED_ROOT_CLASS}__error-title">${content.title}</p>
          <p class="${EMBED_ROOT_CLASS}__error-message">${content.message}</p>
        </div>`;
    }
  }
}
