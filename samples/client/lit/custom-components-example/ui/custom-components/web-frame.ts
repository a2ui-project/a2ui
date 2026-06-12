/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {html, css} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {ifDefined} from 'lit/directives/if-defined.js';
import {Root} from '@a2ui/lit/ui';
import {v0_8} from '@a2ui/lit';

@customElement('a2ui-web-frame')
export class WebFrame extends Root {
  static override styles = [
    ...Root.styles,
    css`
      :host {
        display: block;
        width: 100%;
        border: 1px solid #eee;
        position: relative;
        overflow: hidden; /* For Aspect Ratio / Container */
      }
      iframe {
        width: 100%;
        height: 100%;
        border: none;
        background: #f5f5f5;
      }
      .controls {
        position: absolute;
        top: 20px;
        right: 20px;
        display: flex;
        gap: 10px;
        z-index: 10;
      }
      .controls button {
        width: 32px;
        height: 32px;
        font-size: 20px;
        cursor: pointer;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .controls button:hover {
        background: #f0f0f0;
      }
    `,
  ];

  /* --- Properties (Server Contract) --- */

  @property({type: String})
  accessor url: string = '';

  @property({type: String})
  accessor html: string = '';

  @property({type: Number})
  accessor height: number | undefined = undefined;

  @property({type: String})
  accessor interactionMode: 'readOnly' | 'interactive' = 'readOnly';

  @property({type: Array})
  accessor allowedEvents: string[] = [];

  // --- Internal State ---

  @query('iframe')
  accessor iframe!: HTMLIFrameElement;

  // --- Security Constants ---
  static readonly TRUSTED_DOMAINS = [
    'localhost',
    '127.0.0.1',
    'openstreetmap.org',
    'youtube.com',
    'maps.google.com',
  ];

  override render() {
    const sandboxAttr = this.#calculateSandbox();
    // Default to aspect ratio if no height. Use 16:9 or 4:3.
    const style = this.height ? `height: ${this.height}px;` : 'aspect-ratio: 4/3;';

    // Determine content: srcdoc (html) vs src (url)
    const srcRaw = this.url;
    // VERY IMPORTANT: If html is empty, do NOT pass it to srcdoc, otherwise it overrides src with blank page.
    const srcDocRaw = this.html || undefined;

    return html`
      <div style="position: relative; width: 100%; ${style}">
        <div class="controls">
          <button @click="${() => this.#zoom(1.2)}">+</button>
          <button @click="${() => this.#zoom(0.8)}">-</button>
        </div>
        <iframe
          src="${srcRaw}"
          srcdoc="${ifDefined(srcDocRaw)}"
          sandbox="${sandboxAttr}"
          referrerpolicy="no-referrer"
        ></iframe>
      </div>
    `;
  }

  #calculateSandbox(): string {
    // 1. If HTML is provided, it's treated as Trusted (but isolated)
    if (this.html) {
      if (this.interactionMode === 'interactive') {
        return 'allow-scripts allow-forms allow-popups allow-modals';
      }
      return 'allow-scripts'; // ReadOnly but scripts allowed for rendering
    }

    // 2. Parse Domain from URL
    try {
      const urlObj = new URL(this.url, window.location.href); // Handle relative URLs too
      const hostname = urlObj.hostname;

      const isTrusted = WebFrame.TRUSTED_DOMAINS.some(
        d => hostname === d || hostname.endsWith(`.${d}`),
      );

      if (!isTrusted) {
        // Untrusted: Strict Lockdown
        return '';
      }

      // Trusted
      // Always allow same-origin for trusted domains to avoid issues with local assets or CORS checks
      if (this.interactionMode === 'interactive') {
        return 'allow-scripts allow-forms allow-popups allow-modals allow-same-origin';
      } else {
        return 'allow-scripts allow-same-origin';
      }
    } catch {
      // Invalid URL -> Lockdown
      return '';
    }
  }

  // --- Event Bridge ---

  firstUpdated() {
    window.addEventListener('message', this.#onMessage);
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.#onMessage);
    super.disconnectedCallback();
  }

  #onMessage = (event: MessageEvent) => {
    // In production, verify event.origin matches this.src origin (if not opaque).
    const data = event.data;

    // Spec Protocol: { type: 'a2ui_action', action: '...', data: ... }
    if (data && data.type === 'a2ui_action') {
      const {action, data: actionData} = data; // 'data' property in message payload

      // 1. Validate Action
      if (this.allowedEvents.includes(action)) {
        // 2. Dispatch
        this.#dispatchAgentAction(action, actionData);
      } else {
        console.warn(
          `[WebFrame] Action '${action}' blocked. Not in allowedEvents:`,
          this.allowedEvents,
        );
      }
    }
    // Legacy support for 'emit' temporarily if we want to be safe, but spec implies replacement.
    // I will remove legacy to be strict.
  };

  #dispatchAgentAction(actionName: string, params: any) {
    const context: v0_8.Types.Action['context'] = [];
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string') {
          context.push({key, value: {literalString: value}});
        } else if (typeof value === 'number') {
          context.push({key, value: {literalNumber: value}});
        } else if (typeof value === 'boolean') {
          context.push({key, value: {literalBoolean: value}});
        }
      }
    }

    const action: v0_8.Types.Action = {
      name: actionName,
      context,
    };

    const eventPayload: v0_8.Events.StateEventDetailMap['a2ui.action'] = {
      eventType: 'a2ui.action',
      action,
      sourceComponentId: this.id,
      dataContextPath: this.dataContextPath,
      sourceComponent: this.component as v0_8.Types.AnyComponentNode,
    };

    this.dispatchEvent(new v0_8.Events.StateEvent(eventPayload));
  }

  // --- Zoom Controls (External) ---
  // Keeps working by sending 'zoom' to iframe.
  // We assume the iframe content knows how to handle 'zoom' message if it supports it.
  #zoom(factor: number) {
    if (this.iframe && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage({type: 'zoom', payload: {factor}}, '*');
    }
  }
}
