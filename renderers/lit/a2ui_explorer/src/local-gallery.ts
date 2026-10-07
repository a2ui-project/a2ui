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

import {LitElement, html, nothing} from 'lit';
import {provide} from '@lit/context';
import {customElement, state} from 'lit/decorators.js';
import {MessageProcessor} from '@a2ui/web_core/v1_0';
import type {A2uiClientAction} from '@a2ui/web_core/v0_9';
import {Context} from '@a2ui/lit';
import {basicCatalog as basicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {renderMarkdown} from '@a2ui/markdown-it';
import {demoCatalog} from './demo-catalog.js';
import {getDemoItems, DemoItem, ExplorerMessage, SpecVersion} from './examples';
import {appStyles} from './local-gallery.css';

/** Structured log entry displayed in the Action Logs inspector section. */
export interface ExplorerLogEntry {
  timestamp: string;
  type: string;
  detail: unknown;
}

function formatTime(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

@customElement('local-gallery')
export class LocalGallery extends LitElement {
  @state() mockLogs: string[] = [];
  @state() eventLogs: ExplorerLogEntry[] = [];
  @state() demoItems: DemoItem[] = [];
  @state() activeItemIndex = 0;
  @state() processedMessageCount = 0;
  @state() currentCreateSurfaceMessageText = '';
  @state() messageError: string | null = null;
  @state() currentDataModelText = '{}';
  @state() dataModelError: string | null = null;
  @state() primaryColor = '#1177ee';
  @state() isLeftSidebarCollapsed = false;
  @state() isRightSidebarCollapsed = false;
  @state() isSurfaceMessageFolded = false;
  @state() isDataModelFolded = false;
  @state() isEventsLogFolded = false;
  @state() specVersion: SpecVersion = '0.9';

  private jsonInputFocused = false;
  private customMessages: ExplorerMessage[] | null = null;

  // Expose the dispatched actions log for automated integration tests to inspect
  actionLog: A2uiClientAction[] = [];

  @provide({context: Context.markdown})
  private markdownRenderer = renderMarkdown;

  private processor = new MessageProcessor(
    [demoCatalog, basicCatalogV10],
    (action: A2uiClientAction) => {
      this.log(`Action dispatched: ${action.surfaceId}`, action, action.name || 'Action');
      this.actionLog.push(action);
    },
  );

  private dataModelSubscription?: {unsubscribe: () => void};

  static override styles = [appStyles];

  private getLocalStorage(key: string): string | null {
    try {
      return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  private setLocalStorage(key: string, value: string) {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch {
      // Ignore in restricted environments
    }
  }

  override async connectedCallback() {
    super.connectedCallback();

    this.isLeftSidebarCollapsed = this.getLocalStorage('isLeftSidebarCollapsed') === 'true';
    this.isRightSidebarCollapsed = this.getLocalStorage('isRightSidebarCollapsed') === 'true';
    this.isSurfaceMessageFolded = this.getLocalStorage('isSurfaceMessageFolded') === 'true';
    this.isDataModelFolded = this.getLocalStorage('isDataModelFolded') === 'true';
    this.isEventsLogFolded = this.getLocalStorage('isEventsLogFolded') === 'true';

    let initialHash: string | undefined;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const versionParam = params.get('version');
      if (versionParam === '1.0' || versionParam === 'v1.0') {
        this.specVersion = '1.0';
      } else if (versionParam === '0.9' || versionParam === 'v0.9') {
        this.specVersion = '0.9';
      }
      const rawHash = window.location.hash.slice(1);
      if (rawHash) {
        initialHash = rawHash;
      }
    }

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('hashchange', this.handleHashChange);

    this.processor.model.onSurfaceCreated.subscribe(surface => {
      surface.onError.subscribe((err: {message?: string}) => {
        this.log(`Error on surface ${surface.id}: ${err.message ?? String(err)}`, err, 'Error');
      });
    });

    this.loadExamples(this.specVersion, initialHash);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('hashchange', this.handleHashChange);
  }

  private handleHashChange = () => {
    if (typeof window === 'undefined') return;
    const rawHash = window.location.hash.slice(1);
    if (!rawHash) return;
    const matchedIndex = this.findExampleIndex(rawHash);
    if (matchedIndex >= 0 && matchedIndex !== this.activeItemIndex) {
      this.selectItem(matchedIndex);
    }
  };

  private findExampleIndex(key: string): number {
    return this.demoItems.findIndex(
      item =>
        item.filename === key || item.filename.replace('.json', '') === key || item.id === key,
    );
  }

  private syncUrl() {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const activeItem = this.demoItems[this.activeItemIndex];
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('version', this.specVersion);
      if (activeItem) {
        url.hash = activeItem.filename.replace('.json', '');
      }
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Ignore URL update errors in test environments
    }
  }

  private isEditableElement(el: HTMLElement | null): boolean {
    if (!el) return false;
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable
    );
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const activeEl =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const focusedEl =
      (activeEl && activeEl.isConnected ? activeEl : null) || (event.target as HTMLElement | null);

    if (this.isEditableElement(focusedEl)) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }

    if (event.key === 'j') {
      this.selectNextExample();
      event.preventDefault();
    } else if (event.key === 'k') {
      this.selectPrevExample();
      event.preventDefault();
    }
  };

  selectNextExample() {
    if (!this.demoItems || this.demoItems.length === 0) return;
    const nextIndex =
      this.activeItemIndex < this.demoItems.length - 1 ? this.activeItemIndex + 1 : 0;
    this.selectItem(nextIndex);
  }

  selectPrevExample() {
    if (!this.demoItems || this.demoItems.length === 0) return;
    const prevIndex =
      this.activeItemIndex > 0 ? this.activeItemIndex - 1 : this.demoItems.length - 1;
    this.selectItem(prevIndex);
  }

  toggleLeftSidebar() {
    this.isLeftSidebarCollapsed = !this.isLeftSidebarCollapsed;
    this.setLocalStorage('isLeftSidebarCollapsed', String(this.isLeftSidebarCollapsed));
  }

  toggleRightSidebar() {
    this.isRightSidebarCollapsed = !this.isRightSidebarCollapsed;
    this.setLocalStorage('isRightSidebarCollapsed', String(this.isRightSidebarCollapsed));
  }

  toggleSurfaceMessage() {
    this.isSurfaceMessageFolded = !this.isSurfaceMessageFolded;
    this.setLocalStorage('isSurfaceMessageFolded', String(this.isSurfaceMessageFolded));
  }

  toggleDataModel() {
    this.isDataModelFolded = !this.isDataModelFolded;
    this.setLocalStorage('isDataModelFolded', String(this.isDataModelFolded));
  }

  toggleEventsLog() {
    this.isEventsLogFolded = !this.isEventsLogFolded;
    this.setLocalStorage('isEventsLogFolded', String(this.isEventsLogFolded));
  }

  private handleSectionKeydown(event: KeyboardEvent, toggleFn: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleFn();
    }
  }

  setSpecVersion(version: SpecVersion) {
    if (this.specVersion === version && this.demoItems.length > 0) return;
    const currentFilename = this.demoItems[this.activeItemIndex]?.filename;
    this.deleteActiveExampleSurface();
    this.specVersion = version;
    this.loadExamples(version, currentFilename);
  }

  loadExamples(version: SpecVersion = this.specVersion, preferredKey?: string) {
    try {
      this.demoItems = getDemoItems(version);
      if (this.demoItems.length > 0) {
        const matchedIndex = preferredKey ? this.findExampleIndex(preferredKey) : -1;
        this.selectItem(matchedIndex >= 0 ? matchedIndex : 0);
      }
    } catch (err) {
      console.error('Failed to initiate gallery:', err);
    }
  }

  selectItem(index: number) {
    // Delete the surface of the previous example, if any.
    this.deleteActiveExampleSurface();
    // Reset custom messages and load the new one
    this.customMessages = null;
    this.activeItemIndex = index;
    this.reloadExample();
    this.syncUrl();
    this.scrollToActiveExample();
  }

  private scrollToActiveExample() {
    setTimeout(() => {
      const activeEl = this.renderRoot?.querySelector('.nav-item.active');
      activeEl?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }, 0);
  }

  resetSurface() {
    this.processedMessageCount = 0;
    this.mockLogs = [];
    this.eventLogs = [];
    this.currentDataModelText = '{}';
    this.dataModelError = null;
    this.messageError = null;
    this.actionLog = [];

    // Clear old surface and subscriptions
    if (this.dataModelSubscription) {
      this.dataModelSubscription.unsubscribe();
      this.dataModelSubscription = undefined;
    }
    this.deleteActiveExampleSurface();
  }

  /**
   * Removes the surface of this.activeItemIndex, if still present.
   */
  deleteActiveExampleSurface() {
    const activeItem = this.demoItems[this.activeItemIndex];
    const surfaceId = activeItem?.id;
    if (surfaceId && this.processor.model.getSurface(surfaceId)) {
      const version = activeItem.version === '1.0' ? 'v1.0' : 'v0.9';
      this.processor.processMessages([{version, deleteSurface: {surfaceId}}]);
    }
  }

  private getActiveMessages(): ExplorerMessage[] {
    if (this.customMessages) {
      return this.customMessages;
    }
    return this.demoItems[this.activeItemIndex]?.messages ?? [];
  }

  /**
   * Advances the message processing.
   *
   * @param all Whether to process all remaining messages or just the next one.
   */
  advanceMessages(all: boolean = false) {
    const item = this.demoItems[this.activeItemIndex];
    if (!item) return;

    const messages = this.getActiveMessages();
    const toProcess = all
      ? messages.slice(this.processedMessageCount)
      : [messages[this.processedMessageCount]];

    if (toProcess.length === 0 || !toProcess[0]) return;

    const modifiedToProcess = this.applyPrimaryColorToMessages(toProcess);

    const createMsg = modifiedToProcess.find(m => 'createSurface' in m);
    if (createMsg && !this.jsonInputFocused) {
      this.currentCreateSurfaceMessageText = JSON.stringify(createMsg, null, 2);
      this.messageError = null;
    }

    this.processor.processMessages(structuredClone(modifiedToProcess));
    this.processedMessageCount += toProcess.length;

    // Subscribe to data model on first advance if not already subscribed
    if (!this.dataModelSubscription) {
      const surface = this.processor.model.getSurface(item.id);
      if (surface) {
        this.dataModelSubscription = surface.dataModel.subscribe('/', val => {
          if (!this.jsonInputFocused) {
            this.currentDataModelText = JSON.stringify(val || {}, null, 2);
            this.dataModelError = null;
          }
        });
      }
    }
  }

  /**
   * Reloads the current example by resetting the surface and reprocessing all messages.
   * This is used when switching examples or when theme properties change.
   */
  private reloadExample() {
    this.resetSurface();
    this.advanceMessages(true);
  }

  /**
   * Applies the user-selected primary color to `createSurface` messages.
   *
   * @param messages The list of messages to process.
   * @returns A new list of messages with the primary color applied to `createSurface` messages.
   */
  private applyPrimaryColorToMessages(messages: ExplorerMessage[]): ExplorerMessage[] {
    return messages.map(msg => {
      if ('createSurface' in msg && this.primaryColor && msg.version !== 'v1.0') {
        return {
          ...msg,
          createSurface: {
            ...msg.createSurface,
            theme: {
              ...msg.createSurface.theme,
              primaryColor: this.primaryColor,
            },
          },
        };
      }
      return msg;
    });
  }

  /** Handles color input events to update the primary color. */
  private onColorInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.primaryColor = input.value;
    this.reloadExample();
  }

  /** Clears the custom primary color and reloads the example. */
  private clearColor() {
    this.primaryColor = '';
    this.reloadExample();
  }

  private onSurfaceMessageFocus() {
    this.jsonInputFocused = true;
  }

  private onSurfaceMessageBlur() {
    this.jsonInputFocused = false;
    try {
      const parsed = JSON.parse(this.currentCreateSurfaceMessageText);
      this.currentCreateSurfaceMessageText = JSON.stringify(parsed, null, 2);
    } catch {
      // Ignore if invalid, don't format
    }
  }

  private onSurfaceMessageChange(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    const newValue = textarea.value;
    this.currentCreateSurfaceMessageText = newValue;

    try {
      const parsed = JSON.parse(newValue);
      this.messageError = null;

      if (!parsed || typeof parsed !== 'object' || !('createSurface' in parsed)) {
        return;
      }

      const item = this.demoItems[this.activeItemIndex];
      if (!item) return;

      const baseMessages = this.getActiveMessages();
      this.customMessages = baseMessages.map(m => ('createSurface' in m ? parsed : m));
      this.reloadExample();
    } catch (err) {
      this.messageError = err instanceof Error ? err.message : 'Invalid JSON';
    }
  }

  private onDataModelFocus() {
    this.jsonInputFocused = true;
  }

  private onDataModelBlur() {
    this.jsonInputFocused = false;
    try {
      const parsed = JSON.parse(this.currentDataModelText);
      this.currentDataModelText = JSON.stringify(parsed, null, 2);
    } catch {
      // Ignore if invalid, don't format
    }
  }

  private onDataModelChange(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    const newValue = textarea.value;
    this.currentDataModelText = newValue;

    try {
      const parsed = JSON.parse(newValue);
      this.dataModelError = null;
      const item = this.demoItems[this.activeItemIndex];
      if (!item) return;
      const surface = this.processor.model.getSurface(item.id);
      surface?.dataModel.set('/', parsed);
    } catch (err) {
      this.dataModelError = err instanceof Error ? err.message : 'Invalid JSON';
    }
  }

  clearLogs() {
    this.mockLogs = [];
    this.eventLogs = [];
  }

  log(msg: string, detail?: unknown, type: string = 'Action') {
    const now = new Date();
    const time = now.toLocaleTimeString();
    const entry = detail ? `${msg}\n${JSON.stringify(detail, null, 2)}` : msg;
    this.mockLogs = [...this.mockLogs, `[${time}] ${entry}`];
    this.eventLogs = [
      {
        timestamp: formatTime(now),
        type,
        detail: detail ?? msg,
      },
      ...this.eventLogs,
    ];
  }

  override render() {
    const activeItem = this.demoItems[this.activeItemIndex];
    const activeMessages = this.getActiveMessages();
    const surface = activeItem ? this.processor.model.getSurface(activeItem.id) : undefined;
    const canAdvance = activeItem && this.processedMessageCount < activeMessages.length;

    return html`
      <main>
        <nav
          class="nav-pane ${this.isLeftSidebarCollapsed ? 'collapsed' : ''}"
          aria-label="Examples Navigation"
        >
          <div class="nav-header">
            <h3>Examples</h3>
            <button
              class="icon-btn collapse-left-btn"
              @click=${() => this.toggleLeftSidebar()}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          </div>
          <div class="nav-list">
            ${this.demoItems.map(
              (item, i) => html`
                <div
                  class="nav-item ${i === this.activeItemIndex ? 'active' : ''}"
                  @click=${() => this.selectItem(i)}
                >
                  <h3 class="nav-title">${item.title}</h3>
                  <p class="nav-desc">${item.filename}</p>
                </div>
              `,
            )}
          </div>
        </nav>

        <section class="gallery-pane">
          <div class="preview-header">
            <div class="preview-header-left">
              ${this.isLeftSidebarCollapsed
                ? html`
                    <button
                      class="icon-btn expand-left-btn"
                      @click=${() => this.toggleLeftSidebar()}
                      title="Expand sidebar"
                      aria-label="Expand sidebar"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </button>
                  `
                : nothing}
              <div class="app-brand">
                <h1>A2UI Lit Explorer</h1>
              </div>
              <div class="header-divider"></div>
              <div class="example-info">
                <h2>${activeItem?.title || 'No selection'}</h2>
                <p class="subtitle">${activeItem?.description}</p>
              </div>
            </div>
            <div class="agent-controls">
              <fieldset class="version-controls">
                <legend>Spec version</legend>
                <div class="version-selector" role="group" aria-label="Specification version">
                  <button
                    class="version-btn ${this.specVersion === '0.9' ? 'active' : ''}"
                    data-version="0.9"
                    @click=${() => this.setSpecVersion('0.9')}
                  >
                    v0.9
                  </button>
                  <button
                    class="version-btn ${this.specVersion === '1.0' ? 'active' : ''}"
                    data-version="1.0"
                    @click=${() => this.setSpecVersion('1.0')}
                  >
                    v1.0
                  </button>
                </div>
              </fieldset>
              <fieldset class="message-controls">
                <legend>Messages: ${this.processedMessageCount} / ${activeMessages.length}</legend>
                <button @click=${() => this.resetSurface()}>Reset</button>
                <button @click=${() => this.advanceMessages(false)} ?disabled=${!canAdvance}>
                  +1 Message
                </button>
                <button @click=${() => this.advanceMessages(true)} ?disabled=${!canAdvance}>
                  All Messages
                </button>
              </fieldset>
              <fieldset class="theme-controls">
                <legend>Primary color</legend>
                <div class="color-input-group">
                  <input
                    type="color"
                    .value=${this.primaryColor || '#1177ee'}
                    @input=${this.onColorInput}
                    class="color-input"
                    aria-label="Primary color"
                  />
                  <button @click=${this.clearColor} class="clear-btn">Clear</button>
                </div>
              </fieldset>
              ${this.isRightSidebarCollapsed
                ? html`
                    <button
                      class="icon-btn expand-right-btn"
                      @click=${() => this.toggleRightSidebar()}
                      title="Expand inspector"
                      aria-label="Expand inspector"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="15 18 9 12 15 6"></polyline>
                      </svg>
                    </button>
                  `
                : nothing}
            </div>
          </div>

          <div class="preview-content">
            <div class="surface-container">
              ${surface
                ? html`<a2ui-surface .surface=${surface}></a2ui-surface>`
                : html`<div style="color: #64748b; text-align:center;">
                    Surface not initialized. Click '+1 Message' to begin.
                  </div>`}
            </div>
          </div>
        </section>

        <aside
          class="inspector-pane ${this.isRightSidebarCollapsed ? 'collapsed' : ''}"
          aria-label="Inspector Panel"
        >
          <div class="inspector-pane-header">
            <h4>Inspector</h4>
            <button
              class="icon-btn collapse-right-btn"
              @click=${() => this.toggleRightSidebar()}
              title="Collapse inspector"
              aria-label="Collapse inspector"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>

          <div
            class="inspector-section surface-section ${this.isSurfaceMessageFolded ? 'folded' : ''}"
          >
            <div
              class="inspector-header"
              role="button"
              tabindex="0"
              aria-expanded=${!this.isSurfaceMessageFolded}
              @click=${() => this.toggleSurfaceMessage()}
              @keydown=${(e: KeyboardEvent) =>
                this.handleSectionKeydown(e, () => this.toggleSurfaceMessage())}
            >
              <div class="header-left">
                <span class="toggle-icon ${!this.isSurfaceMessageFolded ? 'expanded' : ''}">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </span>
                <h4>Create Surface Message</h4>
              </div>
              <div>
                <span class="badge ${this.messageError ? 'error-badge' : ''}">
                  ${this.messageError ? 'Invalid' : 'Live'}
                </span>
              </div>
            </div>
            ${!this.isSurfaceMessageFolded
              ? html`
                  <div class="inspector-body">
                    ${this.messageError
                      ? html`
                          <div class="error-message">
                            <span class="error-icon">⚠️</span>
                            <span>${this.messageError}</span>
                          </div>
                        `
                      : nothing}
                    <textarea
                      class="surface-message-textarea"
                      .value=${this.currentCreateSurfaceMessageText}
                      @input=${this.onSurfaceMessageChange}
                      @focus=${this.onSurfaceMessageFocus}
                      @blur=${this.onSurfaceMessageBlur}
                      aria-label="Create Surface Message JSON"
                    ></textarea>
                  </div>
                `
              : nothing}
          </div>

          <div class="inspector-section data-section ${this.isDataModelFolded ? 'folded' : ''}">
            <div
              class="inspector-header"
              role="button"
              tabindex="0"
              aria-expanded=${!this.isDataModelFolded}
              @click=${() => this.toggleDataModel()}
              @keydown=${(e: KeyboardEvent) =>
                this.handleSectionKeydown(e, () => this.toggleDataModel())}
            >
              <div class="header-left">
                <span class="toggle-icon ${!this.isDataModelFolded ? 'expanded' : ''}">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </span>
                <h4>Data Model</h4>
              </div>
              <div>
                <span class="badge ${this.dataModelError ? 'error-badge' : ''}">
                  ${this.dataModelError ? 'Invalid' : 'Live'}
                </span>
              </div>
            </div>
            ${!this.isDataModelFolded
              ? html`
                  <div class="inspector-body">
                    ${this.dataModelError
                      ? html`
                          <div class="error-message">
                            <span class="error-icon">⚠️</span>
                            <span>${this.dataModelError}</span>
                          </div>
                        `
                      : nothing}
                    <textarea
                      class="data-model-textarea"
                      .value=${this.currentDataModelText}
                      @input=${this.onDataModelChange}
                      @focus=${this.onDataModelFocus}
                      @blur=${this.onDataModelBlur}
                      aria-label="Data Model JSON"
                    ></textarea>
                  </div>
                `
              : nothing}
          </div>

          <div class="inspector-section events-section ${this.isEventsLogFolded ? 'folded' : ''}">
            <div
              class="inspector-header"
              role="button"
              tabindex="0"
              aria-expanded=${!this.isEventsLogFolded}
              @click=${() => this.toggleEventsLog()}
              @keydown=${(e: KeyboardEvent) =>
                this.handleSectionKeydown(e, () => this.toggleEventsLog())}
            >
              <div class="header-left">
                <span class="toggle-icon ${!this.isEventsLogFolded ? 'expanded' : ''}">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </span>
                <h4>Action Logs</h4>
              </div>
              <div>
                <button
                  class="clear-logs-btn"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.clearLogs();
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            ${!this.isEventsLogFolded
              ? html`
                  <div class="inspector-body">
                    ${this.eventLogs.length === 0
                      ? html`<div class="empty-state">No actions logged...</div>`
                      : this.eventLogs.map(
                          entry => html`
                            <div class="log-item">
                              <div class="log-header">
                                <span class="log-time">${entry.timestamp}</span>
                                <span class="log-type">${entry.type}</span>
                              </div>
                              <pre class="log-details">
${JSON.stringify(entry.detail, null, 2)}</pre
                              >
                            </div>
                          `,
                        )}
                  </div>
                `
              : nothing}
          </div>
        </aside>
      </main>
    `;
  }
}
