/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {SignalWatcher} from '@lit-labs/signals';
import {provide} from '@lit/context';
import {LitElement, html, css, nothing} from 'lit';
import {customElement, state, query} from 'lit/decorators.js';
import {SnackbarMessage, SnackType} from './types/types.js';
import {Snackbar} from './ui/snackbar.js';
import {repeat} from 'lit/directives/repeat.js';

// A2UI
import * as v0_9 from '@a2ui/web_core/v0_9';
import {basicCatalog, Context} from '@a2ui/lit/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';

// Configurations
import {A2UIClient} from './client.js';
import {restaurantConfig, localConfig, AppConfig} from './configs/configs.js';
import {styleMap} from 'lit/directives/style-map.js';
const configs: Record<string, AppConfig> = {
  restaurant: restaurantConfig,
  local: localConfig,
};

type MarkdownRendererFn = (value: string, options?: any) => Promise<string>;

@customElement('a2ui-shell')
export class A2UILayoutEditor extends SignalWatcher(LitElement) {
  @provide({context: Context.markdown})
  accessor markdownRenderer: MarkdownRendererFn = (value: string, options?: any) => {
    return Promise.resolve(renderMarkdown(value, options));
  };

  @state()
  accessor #requesting = false;

  @state()
  accessor #lastMessages: any[] = [];

  @state()
  accessor config: AppConfig = restaurantConfig;

  @state()
  accessor #loadingTextIndex = 0;
  #loadingInterval: number | undefined;

  @state()
  accessor #isLocalMode = false;

  @state()
  accessor #localFileName = '';

  @state()
  accessor #toastMessage = '';

  @state()
  accessor #toastType = 'info';

  #toastTimeout: number | undefined;

  static styles = [
    css`
      * {
        box-sizing: border-box;
      }

      :host {
        display: block;
        max-width: 640px;
        margin: 0 auto;
        min-height: 100%;
        color: light-dark(var(--n-10), var(--n-90));
        font-family: var(--font-family);
      }

      #hero-img {
        width: 100%;
        max-width: 400px;
        aspect-ratio: 1280/720;
        height: auto;
        margin-bottom: var(--bb-grid-size-6);
        display: block;
        margin: 0 auto;
        background: var(--background-image-light) center center / contain no-repeat;
      }

      #surfaces {
        width: 100%;
        max-width: 100svw;
        padding: var(--bb-grid-size-3);
        animation: fadeIn 1s cubic-bezier(0, 0, 0.3, 1) 0.3s backwards;
      }

      form {
        display: flex;
        flex-direction: column;
        flex: 1;
        gap: 16px;
        align-items: center;
        padding: 16px 0;
        animation: fadeIn 1s cubic-bezier(0, 0, 0.3, 1) 1s backwards;

        & h1 {
          color: light-dark(var(--p-40), var(--n-90));
        }

        & > div {
          display: flex;
          flex: 1;
          gap: 16px;
          align-items: center;
          width: 100%;

          & > input {
            display: block;
            flex: 1;
            border-radius: 32px;
            padding: 16px 24px;
            border: 1px solid var(--p-60);
            background: light-dark(var(--n-100), var(--n-10));
            font-size: 16px;
          }

          & > button {
            display: flex;
            align-items: center;
            background: var(--p-40);
            color: var(--n-100);
            border: none;
            padding: 8px 16px;
            border-radius: 32px;
            opacity: 0.5;

            &:not([disabled]) {
              cursor: pointer;
              opacity: 1;
            }
          }
        }
      }

      .material-symbols {
        font-family: 'Material Symbols Outlined', sans-serif;
        font-variation-settings: 'FILL' 1;
        font-weight: normal;
        font-style: normal;
        font-size: 24px;
        line-height: 1;
        letter-spacing: normal;
        text-transform: none;
        display: inline-block;
        white-space: nowrap;
        word-wrap: normal;
        direction: ltr;
      }

      .rotate {
        animation: rotate 1s linear infinite;
      }

      .pending {
        width: 100%;
        min-height: 200px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        animation: fadeIn 1s cubic-bezier(0, 0, 0.3, 1) 0.3s backwards;
        gap: 16px;
      }

      .spinner {
        width: 48px;
        height: 48px;
        border: 4px solid rgba(255, 255, 255, 0.1);
        border-left-color: var(--p-60);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .theme-toggle {
        padding: 0;
        margin: 0;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        position: fixed;
        top: var(--bb-grid-size-3);
        right: var(--bb-grid-size-4);
        background: light-dark(var(--n-100), var(--n-0));
        border-radius: 50%;
        color: var(--p-30);
        cursor: pointer;
        width: 48px;
        height: 48px;
        font-size: 32px;

        & .material-symbols {
          font-family: 'Material Symbols Outlined';
          pointer-events: none;

          &::before {
            content: 'dark_mode';
          }
        }
      }

      @container style(--color-scheme: dark) {
        .theme-toggle .material-symbols::before {
          content: 'light_mode';
          color: var(--n-90);
        }

        #hero-img {
          background-image: var(--background-image-dark);
        }
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes pulse {
        0% {
          opacity: 0.6;
        }
        50% {
          opacity: 1;
        }
        100% {
          opacity: 0.6;
        }
      }

      .error {
        color: var(--e-40);
        background-color: var(--e-95);
        border: 1px solid var(--e-80);
        padding: 16px;
        border-radius: 8px;
      }

      .local-mode-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: light-dark(var(--p-95), var(--n-20));
        border: 1px solid light-dark(var(--p-80), var(--n-30));
        padding: 12px 20px;
        border-radius: 16px;
        margin-bottom: 24px;
        animation: fadeIn 0.5s ease-out;
      }

      .local-mode-header .file-info {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: light-dark(var(--p-35), var(--n-85));
      }

      .local-mode-header .clear-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        color: light-dark(var(--p-30), var(--n-90));
        display: flex;
        align-items: center;
        padding: 4px;
        border-radius: 50%;
        transition: background 0.2s;

        &:hover {
          background: light-dark(var(--p-90), var(--n-30));
        }
      }

      .upload-btn {
        background: transparent;
        color: var(--p-40);
        border: 1px solid var(--p-60);
        border-radius: 50%;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
        padding: 0;

        &:hover {
          background: light-dark(var(--p-95), var(--n-20));
          transform: scale(1.05);
        }
      }

      .local-header-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        margin-top: 64px;
        margin-bottom: 32px;
        animation: fadeIn 0.8s cubic-bezier(0, 0, 0.3, 1);
      }

      .local-header-section h1 {
        margin: 0 0 16px 0;
        font-size: 36px;
        font-weight: 700;
        color: light-dark(var(--p-30), var(--n-90));
        letter-spacing: -0.5px;
      }

      .local-header-section p {
        margin: 0 0 12px 0;
        max-width: 560px;
        font-size: 16px;
        color: light-dark(var(--n-20), var(--n-90));
        line-height: 1.6;
      }

      .local-header-section .support-info {
        font-size: 13px;
        color: light-dark(var(--n-40), var(--n-70));
        max-width: 560px;
        line-height: 1.5;
        margin: 0;
      }

      .local-upload-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 48px;
        background: light-dark(var(--n-98), var(--n-15));
        border: 2px dashed light-dark(var(--p-60), var(--n-35));
        border-radius: 24px;
        width: 100%;
        max-width: 560px;
        margin: 0 auto 64px auto;
        animation: fadeIn 0.8s cubic-bezier(0, 0, 0.3, 1) 0.2s backwards;
        gap: 24px;
      }

      .primary-upload-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--p-40);
        color: var(--n-100);
        border: none;
        padding: 12px 24px;
        border-radius: 32px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        margin-top: 0;

        &:hover {
          background: var(--p-30);
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
        }
      }

      .samples-section {
        margin-top: 24px;
        width: 100%;
        border-top: 1px solid light-dark(var(--n-90), var(--n-30));
        padding-top: 20px;
      }

      .samples-section h3 {
        font-size: 13px;
        font-weight: 500;
        color: light-dark(var(--n-40), var(--n-70));
        margin: 0 0 12px 0;
      }

      .samples-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        width: 100%;
      }

      .sample-btn {
        background: light-dark(var(--n-95), var(--n-25));
        color: light-dark(var(--p-30), var(--n-90));
        border: 1px solid light-dark(var(--n-85), var(--n-35));
        border-radius: 12px;
        padding: 8px 12px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;

        &:hover {
          background: var(--p-40);
          color: var(--n-100);
          border-color: var(--p-40);
          transform: translateY(-1px);
        }
      }

      .custom-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(30, 32, 35, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        padding: 14px 28px;
        border-radius: 16px;
        display: flex;
        align-items: center;
        gap: 16px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
        z-index: 2000;
        animation: slideUp 0.4s cubic-bezier(0, 0, 0.3, 1);
        max-width: 90vw;
        pointer-events: auto;
      }

      .custom-toast.error {
        background: rgba(190, 40, 40, 0.92);
        border-color: rgba(255, 255, 255, 0.2);
      }

      .toast-text {
        color: #ffffff;
        font-size: 14px;
        font-weight: 500;
      }

      .toast-close {
        background: transparent;
        border: none;
        cursor: pointer;
        color: #ffffff;
        opacity: 0.7;
        display: flex;
        align-items: center;
        padding: 2px;
        border-radius: 50%;
        transition:
          opacity 0.2s,
          background-color 0.2s;

        &:hover {
          opacity: 1;
          background: rgba(255, 255, 255, 0.15);
        }
      }

      @keyframes slideUp {
        from {
          transform: translate(-50%, 32px);
          opacity: 0;
        }
        to {
          transform: translate(-50%, 0);
          opacity: 1;
        }
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }

        to {
          opacity: 1;
        }
      }

      @keyframes rotate {
        from {
          rotate: 0deg;
        }

        to {
          rotate: 360deg;
        }
      }
    `,
  ];

  // Create a Message Processor that uses the catalogs.
  #processor = new v0_9.MessageProcessor(
    [basicCatalog],
    async (action: v0_9.A2uiClientAction): Promise<any> => {
      console.debug('Handling action', action);

      const context: Record<string, any> = {...action.context};

      if (this.#isLocalMode) {
        this.showToast(`⚡ Action dispatched: "${action.name}"`, 'info');
        return;
      }

      // Do we need to update this to a more strict v0.9 type?
      const message = {
        userAction: {
          name: action.name,
          surfaceId: action.surfaceId,
          sourceComponentId: action.sourceComponentId,
          timestamp: new Date().toISOString(),
          context,
        },
      };

      await this.#sendAndProcessMessage(message);
    },
  );
  #a2uiClient = new A2UIClient();
  @query('ui-snackbar')
  private accessor snackbar!: Snackbar;

  #pendingSnackbarMessages: Array<{
    message: SnackbarMessage;
    replaceAll: boolean;
  }> = [];

  #error: string | undefined;

  #maybeRenderError() {
    if (!this.#error) return nothing;

    return html`<div class="error">${this.#error}</div>`;
  }

  connectedCallback() {
    super.connectedCallback();

    // Load config from URL
    const urlParams = new URLSearchParams(window.location.search);
    const appKey = urlParams.get('app');
    if (appKey && !configs[appKey]) {
      this.#pendingSnackbarMessages.push({
        message: {
          id: crypto.randomUUID(),
          message: `App "${appKey}" is not available. Falling back to Restaurant Finder.`,
          type: SnackType.WARNING,
          persistent: false,
        },
        replaceAll: false,
      });
    }
    this.config = (appKey && configs[appKey]) || restaurantConfig;

    // Set the CSS Overrides for the given appKey.
    if (
      this.config.cssOverrides &&
      !document.adoptedStyleSheets.includes(this.config.cssOverrides)
    ) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.config.cssOverrides];
    }
    document.title = this.config.title;

    // Initialize client with configured URL
    this.#a2uiClient = new A2UIClient(this.config.serverUrl);
  }

  protected firstUpdated() {
    if (this.#pendingSnackbarMessages.length > 0) {
      for (const {message, replaceAll} of this.#pendingSnackbarMessages) {
        this.snackbar.show(message, replaceAll);
      }
      this.#pendingSnackbarMessages = [];
    }
  }

  render() {
    return [
      this.#renderLocalModeHeader(),
      this.#renderThemeToggle(),
      this.#maybeRenderForm(),
      this.#maybeRenderData(),
      this.#maybeRenderError(),
      this.#renderToast(),
      html`<ui-snackbar></ui-snackbar>`,
    ];
  }

  #renderLocalModeHeader() {
    if (!this.#isLocalMode) return nothing;

    return html`
      <div class="local-mode-header">
        <span class="file-info">
          Loaded local mockup: <strong>${this.#localFileName}</strong>
        </span>
        <button class="clear-btn" @click=${this.#clearLocalFile} title="Clear local mockup">
          <span class="material-symbols">close</span>
        </button>
      </div>
    `;
  }

  #renderThemeToggle() {
    return html` <div>
      <button
        @click=${(evt: Event) => {
          if (!(evt.target instanceof HTMLButtonElement)) return;
          const {colorScheme} = window.getComputedStyle(evt.target);
          if (colorScheme === 'dark') {
            document.body.classList.add('light');
            document.body.classList.remove('dark');
          } else {
            document.body.classList.add('dark');
            document.body.classList.remove('light');
          }
        }}
        class="theme-toggle"
      >
        <span class="material-symbols"></span>
      </button>
    </div>`;
  }

  #maybeRenderForm() {
    if (this.#requesting) return nothing;
    if (this.#lastMessages.length > 0) return nothing;
    if (this.#isLocalMode) return nothing;

    if (this.config.key === 'local') {
      return html`
        <div class="local-header-section">
          <h1>${this.config.title}</h1>
          <p>
            Upload an A2UI JSON mockup file to render and test your interactive layouts locally.
          </p>
          <p class="support-info">
            Supports A2UI Protocol v0.9 (Renderer v0.9.3). Only supports the basic catalog for now.
          </p>
        </div>

        <div class="local-upload-container">
          <button type="button" class="primary-upload-btn" @click=${this.#triggerFileUpload}>
            Browse JSON File
          </button>

          <input
            type="file"
            accept=".json"
            id="local-file-input"
            style="display: none"
            @change=${this.#onLocalFileChange}
          />

          <div class="samples-section">
            <h3>Or quick-load a built-in sample:</h3>
            <div class="samples-grid">
              <button
                type="button"
                class="sample-btn"
                @click=${() => this.#loadBuiltinSample('contact_card.json')}
              >
                Contact Card
              </button>
              <button
                type="button"
                class="sample-btn"
                @click=${() => this.#loadBuiltinSample('workspace_settings.json')}
              >
                Workspace Setup
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return html`<form
      @submit=${async (evt: Event) => {
        evt.preventDefault();
        if (!(evt.target instanceof HTMLFormElement)) {
          return;
        }
        const data = new FormData(evt.target);
        const body = data.get('body') ?? null;
        if (!body) {
          return;
        }
        const message = body as any;
        await this.#sendAndProcessMessage(message);
      }}
    >
      ${this.config.heroImage
        ? html`<div
            style=${styleMap({
              '--background-image-light': `url(${this.config.heroImage})`,
              '--background-image-dark': `url(${
                this.config.heroImageDark ?? this.config.heroImage
              })`,
            })}
            id="hero-img"
          ></div>`
        : nothing}
      <h1 class="app-title">${this.config.title}</h1>
      <div>
        <input
          required
          value="${this.config.placeholder}"
          autocomplete="off"
          id="body"
          name="body"
          type="text"
          ?disabled=${this.#requesting}
        />
        <button type="submit" ?disabled=${this.#requesting}>
          <span class="material-symbols">send</span>
        </button>
      </div>
    </form>`;
  }

  #startLoadingAnimation() {
    if (this.config.loadingText && this.config.loadingText.length > 1) {
      this.#loadingTextIndex = 0;
      this.#loadingInterval = window.setInterval(() => {
        this.#loadingTextIndex = (this.#loadingTextIndex + 1) % this.config.loadingText!.length;
      }, 2000);
    }
  }

  #stopLoadingAnimation() {
    if (this.#loadingInterval) {
      clearInterval(this.#loadingInterval);
      this.#loadingInterval = undefined;
    }
  }

  async #sendMessage(message: any): Promise<any[]> {
    try {
      this.#requesting = true;
      this.#startLoadingAnimation();
      const response = this.#a2uiClient.send(message);
      await response;
      this.#requesting = false;
      this.#stopLoadingAnimation();

      return response;
    } catch (err) {
      console.error(err);
    } finally {
      this.#requesting = false;
      this.#stopLoadingAnimation();
    }

    return [];
  }

  #maybeRenderData() {
    if (this.#requesting) {
      const text = this.config.loadingText
        ? this.config.loadingText[this.#loadingTextIndex]
        : 'Awaiting an answer...';

      return html` <div class="pending">
        <div class="spinner"></div>
        <div class="loading-text">${text}</div>
      </div>`;
    }

    const surfaces = Array.from(this.#processor.model.surfacesMap.entries());
    if (surfaces.length === 0) {
      return nothing;
    }
    console.debug('Rendering surfaces', surfaces);

    return html`<section id="surfaces">
      ${repeat(
        surfaces,
        ([surfaceId]) => surfaceId,
        ([, surface]) => {
          return html`<a2ui-surface .surface=${surface}></a2ui-surface>`;
        },
      )}
    </section>`;
  }

  async #sendAndProcessMessage(request) {
    const messages = await this.#sendMessage(request);
    console.debug('Received messages', messages);

    this.#lastMessages = messages;

    // this.#processor.clearSurfaces();
    // Why? Shouldn't `deleteSurface` be sent from the agent to the client?
    for (const surfaceId of Array.from(this.#processor.model.surfacesMap.keys())) {
      this.#processor.model.deleteSurface(surfaceId);
    }

    this.#processor.processMessages(messages);
  }

  #triggerFileUpload() {
    const fileInput = this.shadowRoot?.getElementById('local-file-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  #onLocalFileChange(evt: Event) {
    const fileInput = evt.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    this.#localFileName = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        const messages = Array.isArray(parsed) ? parsed : [parsed];

        this.#isLocalMode = true;

        // Clear all existing surfaces
        for (const surfaceId of Array.from(this.#processor.model.surfacesMap.keys())) {
          this.#processor.model.deleteSurface(surfaceId);
        }

        this.#processor.processMessages(messages);

        this.showToast(`Successfully loaded mockup from ${file.name}`, 'info');
      } catch (err) {
        console.error(err);
        this.showToast(
          `Failed to parse A2UI JSON: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  }

  #clearLocalFile() {
    this.#isLocalMode = false;
    this.#localFileName = '';
    for (const surfaceId of Array.from(this.#processor.model.surfacesMap.keys())) {
      this.#processor.model.deleteSurface(surfaceId);
    }
    this.showToast('Local mockup cleared.', 'info');
  }

  async #loadBuiltinSample(filename: string) {
    try {
      this.#localFileName = filename;
      const response = await fetch(`/samples/${filename}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch sample file: ${response.statusText}`);
      }
      const parsed = await response.json();
      const messages = Array.isArray(parsed) ? parsed : [parsed];

      this.#isLocalMode = true;

      // Clear all existing surfaces
      for (const surfaceId of Array.from(this.#processor.model.surfacesMap.keys())) {
        this.#processor.model.deleteSurface(surfaceId);
      }

      this.#processor.processMessages(messages);

      this.showToast(`Successfully loaded sample: ${filename}`, 'info');
    } catch (err) {
      console.error(err);
      this.showToast(
        `Failed to load sample JSON: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  }

  #renderToast() {
    if (!this.#toastMessage) return nothing;

    return html`
      <div class="custom-toast ${this.#toastType}">
        <span class="toast-text">${this.#toastMessage}</span>
        <button class="toast-close" @click=${() => (this.#toastMessage = '')}>
          <span class="material-symbols">close</span>
        </button>
      </div>
    `;
  }

  showToast(msg: string, type = 'info') {
    if (this.#toastTimeout) {
      window.clearTimeout(this.#toastTimeout);
    }
    this.#toastMessage = msg;
    this.#toastType = type;
    this.#toastTimeout = window.setTimeout(() => {
      this.#toastMessage = '';
      this.#toastTimeout = undefined;
    }, 4000);
  }
}
