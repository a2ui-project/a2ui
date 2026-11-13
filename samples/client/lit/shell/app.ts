/*
 * Copyright 2024 Google LLC
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
import {A2UIClientTurnResult, PlaygroundTurnTrace} from './types/inspector.js';
import './ui/inspector.js';
import {Snackbar} from './ui/snackbar.js';
import {repeat} from 'lit/directives/repeat.js';

// A2UI
import * as v0_9 from '@a2ui/web_core/v0_9';
import {basicCatalog as v1BasicCatalog, injectBasicCatalogStyles} from '@a2ui/web_core/v1_0';
import {basicCatalog, Context} from '@a2ui/lit/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';

// Configurations
import {A2UIClient} from './client.js';
import {restaurantConfig, localConfig, playgroundConfig, AppConfig} from './configs/configs.js';
import {styleMap} from 'lit/directives/style-map.js';
const configs: Record<string, AppConfig> = {
  restaurant: restaurantConfig,
  local: localConfig,
  playground: playgroundConfig,
};

type MarkdownRendererFn = (value: string, options?: any) => Promise<string>;

/**
 * Shell application element hosting A2UI demo apps, local JSON mockups,
 * and the Format Playground split-screen pipeline inspector.
 */
@customElement('a2ui-shell')
export class A2UILayoutEditor extends SignalWatcher(LitElement) {
  /** Markdown renderer callback provided via Lit context to child A2UI components. */
  @provide({context: Context.markdown})
  markdownRenderer: MarkdownRendererFn = (value: string, options?: any) => {
    return Promise.resolve(renderMarkdown(value, options));
  };

  @state()
  private _requesting = false;

  @state()
  private _lastMessages: any[] = [];

  /** Active shell application configuration selected via the `?app=` URL query parameter. */
  @state()
  config: AppConfig = restaurantConfig;

  @state()
  private _loadingTextIndex = 0;
  private _loadingInterval: number | undefined;

  @state()
  private _isLocalMode = false;

  @state()
  private _localFileName = '';

  @state()
  private _toastMessage = '';

  @state()
  private _toastType = 'info';

  @state()
  private _trace: PlaygroundTurnTrace | null = null;

  @state()
  private _inspectorOpen = true;

  private _toastTimeout: number | undefined;

  static override styles = [
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

      :host([inspector-layout]) {
        max-width: 1480px;
        padding: 0 16px;
      }

      :host([inspector-layout][inspector-collapsed]) {
        max-width: 720px;
      }

      .workspace-grid {
        display: grid;
        grid-template-columns: minmax(420px, 620px) minmax(440px, 1fr);
        gap: 20px;
        align-items: start;
        width: 100%;
      }

      .workspace-grid.inspector-collapsed {
        grid-template-columns: minmax(0, 1fr);
      }

      @media (max-width: 960px) {
        .workspace-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      .canvas-column {
        min-width: 0;
      }

      .inspector-column {
        min-width: 0;
        position: sticky;
        top: 16px;
        max-height: calc(100vh - 32px);
        overflow: auto;
      }

      .inspector-drawer-toggle {
        padding: 0 12px;
        margin: 0;
        border: 1px solid var(--p-60);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        position: fixed;
        top: var(--bb-grid-size-3);
        right: calc(var(--bb-grid-size-4) + 56px);
        background: light-dark(var(--n-100), var(--n-10));
        border-radius: 999px;
        color: light-dark(var(--p-40), var(--n-90));
        cursor: pointer;
        height: 48px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        z-index: 10;
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

        &.instant {
          animation: none;
        }
      }

      form {
        display: flex;
        flex-direction: column;
        flex: 1;
        gap: 16px;
        align-items: center;
        padding: 16px 0;
        animation: fadeIn 1s cubic-bezier(0, 0, 0.3, 1) 1s backwards;

        &.compact {
          animation: none;
          padding: 16px 12px 8px;
        }

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

      .pending-inline {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 6px 12px;
        font-size: 13px;
        opacity: 0.75;

        & .spinner {
          width: 16px;
          height: 16px;
          border-width: 2px;
        }
      }

      .quick-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 12px 12px;

        & .quick-actions-label {
          font-size: 12px;
          font-weight: 500;
          opacity: 0.75;
          margin-right: 4px;
        }

        & .quick-action-btn {
          border: 1px solid var(--p-60);
          background: light-dark(var(--n-100), var(--n-20));
          color: light-dark(var(--p-40), var(--n-90));
          border-radius: 999px;
          padding: 6px 12px;
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          transition:
            background 0.15s ease,
            transform 0.1s ease;

          &:not([disabled]) {
            cursor: pointer;

            &:hover {
              background: light-dark(rgba(81, 84, 179, 0.1), rgba(160, 163, 255, 0.18));
            }

            &:active {
              transform: scale(0.98);
            }
          }

          &[disabled] {
            opacity: 0.5;
          }
        }
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

      .app-error {
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
  private _processor = new v0_9.MessageProcessor<any>(
    [basicCatalog, v1BasicCatalog],
    async (action: v0_9.A2uiClientAction): Promise<any> => {
      console.debug('Handling action', action);

      const context: Record<string, any> = {...action.context};

      if (this._isLocalMode) {
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
  private _a2uiClient!: A2UIClient;
  @query('ui-snackbar')
  private snackbar!: Snackbar;

  private _pendingSnackbarMessages: Array<{
    message: SnackbarMessage;
    replaceAll: boolean;
  }> = [];

  private _error: string | undefined;

  /**
   * Renders an application-level error banner when `_error` is set.
   *
   * @return The error banner template, or `nothing`.
   */
  #maybeRenderError() {
    if (!this._error) return nothing;

    return html`<div class="app-error">${this._error}</div>`;
  }

  /**
   * Initializes catalog styles, resolves the app configuration from the URL,
   * adopts app-specific CSS overrides, and creates the A2UI client.
   */
  override connectedCallback() {
    super.connectedCallback();
    injectBasicCatalogStyles();

    // Load config from URL
    const urlParams = new URLSearchParams(window.location.search);
    const appKey = urlParams.get('app');
    if (appKey && !configs[appKey]) {
      this._pendingSnackbarMessages.push({
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
      Array.isArray(document.adoptedStyleSheets) &&
      !document.adoptedStyleSheets.includes(this.config.cssOverrides)
    ) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.config.cssOverrides];
    }
    document.title = this.config.title;

    // Initialize client with configured URL
    this._a2uiClient = new A2UIClient(this.config.serverUrl);
  }

  /**
   * Synchronizes host layout classes and attributes with the inspector state after each update.
   */
  protected override updated() {
    const inspectorEnabled = this.#isInspectorEnabled();
    this.classList.toggle('inspector-layout', inspectorEnabled);
    this.classList.toggle('inspector-collapsed', inspectorEnabled && !this._inspectorOpen);
    this.toggleAttribute('inspector-layout', inspectorEnabled);
    this.toggleAttribute('inspector-collapsed', inspectorEnabled && !this._inspectorOpen);
  }

  /**
   * Checks whether the split-screen pipeline inspector is active for the current app.
   *
   * @return `true` when the active config enables the inspector and local mode is off.
   */
  #isInspectorEnabled(): boolean {
    return Boolean(this.config.inspector) && !this._isLocalMode;
  }

  /**
   * Toggles the visibility of the split-screen inspector drawer.
   */
  #toggleInspector = () => {
    this._inspectorOpen = !this._inspectorOpen;
  };

  /**
   * Resets the A2A conversation session, clears all active surfaces, and resets the trace.
   */
  #resetSession = () => {
    this._a2uiClient.resetSession();
    for (const surfaceId of Array.from(this._processor.model.surfacesMap.keys())) {
      this._processor.model.deleteSurface(surfaceId);
    }
    this._lastMessages = [];
    this._trace = null;
  };

  /**
   * Flushes any queued snackbar messages once the shell DOM is first rendered.
   */
  protected override firstUpdated() {
    if (this._pendingSnackbarMessages.length > 0) {
      for (const {message, replaceAll} of this._pendingSnackbarMessages) {
        this.snackbar.show(message, replaceAll);
      }
      this._pendingSnackbarMessages = [];
    }
  }

  /**
   * Renders the shell layout, including the optional split-screen pipeline inspector.
   *
   * @return The shell template array.
   */
  override render() {
    if (this.#isInspectorEnabled()) {
      return [
        this.#renderLocalModeHeader(),
        this.#renderInspectorToggle(),
        this.#renderThemeToggle(),
        html`<div class="workspace-grid ${this._inspectorOpen ? '' : 'inspector-collapsed'}">
          <div class="canvas-column">
            ${this.#maybeRenderForm()} ${this.#maybeRenderQuickActions()} ${this.#maybeRenderData()}
            ${this.#maybeRenderError()}
          </div>
          ${this._inspectorOpen
            ? html`<aside class="inspector-column" aria-label="Pipeline Inspector">
                <playground-inspector
                  .trace=${this._trace}
                  .loading=${this._requesting}
                  @toggle-inspector=${this.#toggleInspector}
                  @reset-session=${this.#resetSession}
                ></playground-inspector>
              </aside>`
            : nothing}
        </div>`,
        this.#renderToast(),
        html`<ui-snackbar></ui-snackbar>`,
      ];
    }

    return [
      this.#renderLocalModeHeader(),
      this.#renderThemeToggle(),
      this.#maybeRenderForm(),
      this.#maybeRenderQuickActions(),
      this.#maybeRenderData(),
      this.#maybeRenderError(),
      this.#renderToast(),
      html`<ui-snackbar></ui-snackbar>`,
    ];
  }

  /**
   * Renders the floating button to re-open the pipeline inspector when collapsed.
   *
   * @return The toggle button template, or `nothing` when the inspector is open.
   */
  #renderInspectorToggle() {
    if (this._inspectorOpen) {
      return nothing;
    }
    return html`<button
      type="button"
      class="inspector-drawer-toggle"
      @click=${this.#toggleInspector}
      aria-expanded="false"
      title="Show pipeline inspector"
    >
      <span class="material-symbols">visibility</span>
      <span>Show Inspector</span>
    </button>`;
  }

  /**
   * Renders the banner indicating that a local JSON mockup file is currently loaded.
   *
   * @return The local mode header template, or `nothing` when not in local mode.
   */
  #renderLocalModeHeader() {
    if (!this._isLocalMode) return nothing;

    return html`
      <div class="local-mode-header">
        <span class="file-info">
          Loaded local mockup: <strong>${this._localFileName}</strong>
        </span>
        <button class="clear-btn" @click=${this.#clearLocalFile} title="Clear local mockup">
          <span class="material-symbols">close</span>
        </button>
      </div>
    `;
  }

  /**
   * Renders the light/dark color-scheme toggle button.
   *
   * @return The theme toggle button template.
   */
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

  /**
   * Renders the prompt input form or the local JSON upload section when applicable.
   *
   * @return The form template, or `nothing` when hidden.
   */
  #maybeRenderForm() {
    const clearsSurfaces = this.config.clearSurfacesOnResponse ?? true;
    if ((this._requesting || this._lastMessages.length > 0) && clearsSurfaces) {
      return nothing;
    }
    if (this._isLocalMode) return nothing;
    if (this.config.key === 'local') {
      return this.#renderLocalUploadSection();
    }

    const showHero = this.#shouldShowHero(clearsSurfaces);
    return html`<form
      class=${showHero ? '' : 'compact'}
      @submit=${(evt: Event) => this.#onFormSubmit(evt, clearsSurfaces)}
    >
      ${this.#maybeRenderHero(showHero)}
      ${showHero ? html`<h1 class="app-title">${this.config.title}</h1>` : nothing}
      <div>
        <input
          required
          value=${clearsSurfaces ? this.config.placeholder : ''}
          placeholder=${clearsSurfaces ? '' : this.config.placeholder}
          autocomplete="off"
          id="body"
          name="body"
          type="text"
          ?disabled=${this._requesting}
        />
        <button type="submit" ?disabled=${this._requesting}>
          <span class="material-symbols">send</span>
        </button>
      </div>
    </form>`;
  }

  /**
   * Determines whether the hero banner and full title should be shown above the prompt input.
   *
   * @param clearsSurfaces Whether the active app clears surfaces on every response.
   * @return `true` when the hero header should be displayed.
   */
  #shouldShowHero(clearsSurfaces: boolean): boolean {
    if (clearsSurfaces) return true;
    return (
      this._lastMessages.length === 0 &&
      this._trace === null &&
      this._processor.model.surfacesMap.size === 0
    );
  }

  /**
   * Renders the themed hero image block when enabled and configured.
   *
   * @param showHero Whether the hero block should be visible.
   * @return The hero element template, or `nothing`.
   */
  #maybeRenderHero(showHero: boolean) {
    if (!showHero || !this.config.heroImage) return nothing;
    return html`<div
      style=${styleMap({
        '--background-image-light': `url(${this.config.heroImage})`,
        '--background-image-dark': `url(${this.config.heroImageDark ?? this.config.heroImage})`,
      })}
      id="hero-img"
    ></div>`;
  }

  /**
   * Handles prompt form submission and dispatches the user message to the A2UI server.
   *
   * @param evt The form submit event.
   * @param clearsSurfaces Whether the active app clears surfaces on each turn.
   */
  async #onFormSubmit(evt: Event, clearsSurfaces: boolean) {
    evt.preventDefault();
    if (!(evt.target instanceof HTMLFormElement)) return;
    const formEl = evt.target;
    const body = new FormData(formEl).get('body') ?? null;
    if (!body) return;
    if (!clearsSurfaces) {
      formEl.reset();
    }
    await this.#sendAndProcessMessage(body as any);
  }

  /**
   * Renders the local file upload and built-in sample selector for the local mockup mode.
   *
   * @return The local upload section template.
   */
  #renderLocalUploadSection() {
    return html`
      <div class="local-header-section">
        <h1>${this.config.title}</h1>
        <p>Upload an A2UI JSON mockup file to render and test your interactive layouts locally.</p>
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

  /**
   * Renders the quick-action pill buttons configured for the active app.
   *
   * @return The quick actions bar template, or `nothing`.
   */
  #maybeRenderQuickActions() {
    const actions = this.config.quickActions;
    if (!actions?.length || this._isLocalMode) return nothing;
    const clearsSurfaces = this.config.clearSurfacesOnResponse ?? true;
    if (this._requesting && clearsSurfaces) return nothing;

    return html`<div class="quick-actions" aria-label="Tool mode examples">
      <span class="quick-actions-label">Tool mode (0 LLM calls):</span>
      ${actions.map(
        action =>
          html`<button
            type="button"
            class="quick-action-btn"
            title=${action.title ?? ''}
            ?disabled=${this._requesting}
            @click=${() => this.#sendAndProcessMessage(action.message)}
          >
            ${action.label}
          </button>`,
      )}
    </div>`;
  }

  /**
   * Starts cycling through `config.loadingText` entries while a request is pending.
   */
  #startLoadingAnimation() {
    const loadingText = this.config.loadingText;
    if (loadingText && loadingText.length > 1) {
      this._loadingTextIndex = 0;
      this._loadingInterval = window.setInterval(() => {
        this._loadingTextIndex = (this._loadingTextIndex + 1) % loadingText.length;
      }, 2000);
    }
  }

  /**
   * Stops the loading text rotation timer if one is active.
   */
  #stopLoadingAnimation() {
    if (this._loadingInterval) {
      clearInterval(this._loadingInterval);
      this._loadingInterval = undefined;
    }
  }

  /**
   * Sends a single turn message to the A2UI backend while managing loading state.
   *
   * @param message User text or client action object to send.
   * @return The turn result containing A2UI wire messages and optional inspector trace.
   */
  async #sendMessage(message: any): Promise<A2UIClientTurnResult> {
    try {
      this._requesting = true;
      this.#startLoadingAnimation();
      // The catalogs that the processor renders, sent with every request.
      const response = this._a2uiClient.sendTurn(
        message,
        this._processor.getRendererCapabilities({versions: ['v0.9', '1.0']}),
        {inspector: Boolean(this.config.inspector)},
      );
      await response;
      this._requesting = false;
      this.#stopLoadingAnimation();

      return response;
    } catch (err) {
      console.error(err);
    } finally {
      this._requesting = false;
      this.#stopLoadingAnimation();
    }

    return {messages: [], trace: null, contextId: null};
  }

  /**
   * Renders the active A2UI surfaces and loading spinner.
   *
   * @return The surface container template, or `nothing` when no surfaces exist.
   */
  #maybeRenderData() {
    const clearsSurfaces = this.config.clearSurfacesOnResponse ?? true;
    const surfaces = Array.from(this._processor.model.surfacesMap.entries());
    const text = this.config.loadingText
      ? this.config.loadingText[this._loadingTextIndex]
      : 'Awaiting an answer...';

    if (this._requesting && (clearsSurfaces || surfaces.length === 0)) {
      return html` <div class="pending">
        <div class="spinner"></div>
        <div class="loading-text">${text}</div>
      </div>`;
    }

    if (surfaces.length === 0) {
      return nothing;
    }
    console.debug('Rendering surfaces', surfaces);

    return html`
      ${this._requesting
        ? html`<div class="pending-inline">
            <div class="spinner"></div>
            <span>${text}</span>
          </div>`
        : nothing}
      <section id="surfaces" class=${clearsSurfaces ? '' : 'instant'}>
        ${repeat(
          surfaces,
          ([surfaceId]) => surfaceId,
          ([, surface]) => {
            return html`<a2ui-surface .surface=${surface}></a2ui-surface>`;
          },
        )}
      </section>
    `;
  }

  /**
   * Sends a turn request, updates the inspector trace, prunes superseded surfaces,
   * and feeds the incoming wire messages into the A2UI message processor.
   *
   * @param request User prompt string or client action payload.
   */
  async #sendAndProcessMessage(request) {
    const result = await this.#sendMessage(request);
    const messages = result.messages as any[];
    console.debug('Received messages', messages);

    this._lastMessages = messages;
    if (result.trace !== null) {
      this._trace = result.trace;
    }

    if (this.config.clearSurfacesOnResponse ?? true) {
      this.#deleteAllSurfaces();
    } else {
      this.#pruneTurnSurfacesBeforeBatch(messages);
    }

    this._processor.processMessages(messages);
  }

  /**
   * Deletes all surfaces currently stored in the message processor model.
   */
  #deleteAllSurfaces() {
    for (const surfaceId of Array.from(this._processor.model.surfacesMap.keys())) {
      this._processor.model.deleteSurface(surfaceId);
    }
  }

  /**
   * Checks whether any message in a batch creates a turn-scoped render surface.
   *
   * @param messages Incoming A2UI wire message batch.
   * @return `true` if a `turn-*` render surface (not `-status`, `-footer`, or `-compare`) is created.
   */
  #createsTurnRenderSurface(messages: any[]): boolean {
    return messages.some(msg => {
      const id = msg?.createSurface?.surfaceId;
      return (
        typeof id === 'string' &&
        id.startsWith('turn-') &&
        !id.endsWith('-status') &&
        !id.endsWith('-footer') &&
        !id.endsWith('-compare')
      );
    });
  }

  /**
   * Prunes previous turn-scoped surfaces, stale `'main'` surfaces when switching
   * to turn-scoped render surfaces, and re-created surfaces before applying a batch.
   *
   * @param messages Incoming A2UI wire message batch.
   */
  #pruneTurnSurfacesBeforeBatch(messages: any[]) {
    const deletedInBatch = new Set<string>();
    for (const msg of messages) {
      const deletedId = msg?.deleteSurface?.surfaceId;
      if (typeof deletedId === 'string') {
        deletedInBatch.add(deletedId);
      }
    }
    if (this.#createsTurnRenderSurface(messages) && this._processor.model.surfacesMap.has('main')) {
      this._processor.model.deleteSurface('main');
    }
    for (const surfaceId of Array.from(this._processor.model.surfacesMap.keys())) {
      if (surfaceId.startsWith('turn-')) {
        this._processor.model.deleteSurface(surfaceId);
      }
    }
    for (const msg of messages) {
      const createdId = msg?.createSurface?.surfaceId;
      if (
        typeof createdId === 'string' &&
        !deletedInBatch.has(createdId) &&
        this._processor.model.surfacesMap.has(createdId)
      ) {
        this._processor.model.deleteSurface(createdId);
      }
    }
  }

  /**
   * Opens the hidden file input dialog for local JSON mockup uploads.
   */
  #triggerFileUpload() {
    const fileInput = this.shadowRoot?.getElementById('local-file-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  /**
   * Reads and processes an uploaded local A2UI JSON mockup file.
   *
   * @param evt File input change event.
   */
  #onLocalFileChange(evt: Event) {
    const fileInput = evt.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    this._localFileName = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        const messages = Array.isArray(parsed) ? parsed : [parsed];

        this._isLocalMode = true;
        this._trace = null;

        // Clear all existing surfaces
        for (const surfaceId of Array.from(this._processor.model.surfacesMap.keys())) {
          this._processor.model.deleteSurface(surfaceId);
        }

        this._processor.processMessages(messages);

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

  /**
   * Exits local mockup mode and clears all loaded surfaces.
   */
  #clearLocalFile() {
    this._isLocalMode = false;
    this._localFileName = '';
    this._trace = null;
    for (const surfaceId of Array.from(this._processor.model.surfacesMap.keys())) {
      this._processor.model.deleteSurface(surfaceId);
    }
    this.showToast('Local mockup cleared.', 'info');
  }

  /**
   * Fetches and renders a built-in JSON sample file in local mockup mode.
   *
   * @param filename File name under `/samples/` to fetch.
   */
  async #loadBuiltinSample(filename: string) {
    try {
      this._localFileName = filename;
      const response = await fetch(`/samples/${filename}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch sample file: ${response.statusText}`);
      }
      const parsed = await response.json();
      const messages = Array.isArray(parsed) ? parsed : [parsed];

      this._isLocalMode = true;

      // Clear all existing surfaces
      for (const surfaceId of Array.from(this._processor.model.surfacesMap.keys())) {
        this._processor.model.deleteSurface(surfaceId);
      }

      this._processor.processMessages(messages);

      this.showToast(`Successfully loaded sample: ${filename}`, 'info');
    } catch (err) {
      console.error(err);
      this.showToast(
        `Failed to load sample JSON: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  }

  /**
   * Renders the transient toast notification banner when `_toastMessage` is non-empty.
   *
   * @return The toast element template, or `nothing`.
   */
  #renderToast() {
    if (!this._toastMessage) return nothing;

    return html`
      <div class="custom-toast ${this._toastType}">
        <span class="toast-text">${this._toastMessage}</span>
        <button class="toast-close" @click=${() => (this._toastMessage = '')}>
          <span class="material-symbols">close</span>
        </button>
      </div>
    `;
  }

  /**
   * Displays a transient toast notification at the bottom of the viewport.
   *
   * @param msg Notification text to display.
   * @param type Visual style variant (`info` or `error`).
   */
  showToast(msg: string, type = 'info') {
    if (this._toastTimeout) {
      window.clearTimeout(this._toastTimeout);
    }
    this._toastMessage = msg;
    this._toastType = type;
    this._toastTimeout = window.setTimeout(() => {
      this._toastMessage = '';
      this._toastTimeout = undefined;
    }, 4000);
  }
}
