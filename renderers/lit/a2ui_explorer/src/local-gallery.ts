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
import {MessageProcessor, A2uiMessage, A2uiClientAction} from '@a2ui/web_core/v0_9';
import {Context} from '@a2ui/lit/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';
import {demoCatalog} from './demo-catalog.js';
import {getDemoItems, DemoItem} from './examples';
import {appStyles} from './local-gallery.css';

@customElement('local-gallery')
export class LocalGallery extends LitElement {
  @state() mockLogs: string[] = [];
  @state() demoItems: DemoItem[] = [];
  @state() activeItemIndex = 0;
  @state() processedMessageCount = 0;
  @state() currentDataModelText = '{}';
  @state() primaryColor = '#1177ee';
  @state() isLeftSidebarCollapsed = false;
  @state() isRightSidebarCollapsed = false;

  // Expose the dispatched actions log for automated integration tests to inspect
  actionLog: A2uiClientAction[] = [];

  @provide({context: Context.markdown})
  private markdownRenderer = renderMarkdown;

  private processor = new MessageProcessor([demoCatalog], (action: A2uiClientAction) => {
    this.log(`Action dispatched: ${action.surfaceId}`, action);
    this.actionLog.push(action);
  });

  private dataModelSubscription?: {unsubscribe: () => void};

  static styles = [appStyles];

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

  async connectedCallback() {
    super.connectedCallback();

    this.isLeftSidebarCollapsed = this.getLocalStorage('isLeftSidebarCollapsed') === 'true';
    this.isRightSidebarCollapsed = this.getLocalStorage('isRightSidebarCollapsed') === 'true';

    window.addEventListener('keydown', this.handleKeyDown);

    this.processor.model.onSurfaceCreated.subscribe(
      (surface: {onError: {subscribe: (cb: (err: Error) => void) => void}; id: string}) => {
        surface.onError.subscribe((err: Error) => {
          this.log(`Error on surface ${surface.id}: ${err.message}`, err);
        });
      },
    );

    this.loadExamples();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const activeEl =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const targetEl = event.target as HTMLElement | null;
    const focusedEl = (activeEl && activeEl.isConnected ? activeEl : null) || targetEl;

    if (
      focusedEl &&
      (focusedEl.tagName === 'INPUT' ||
        focusedEl.tagName === 'TEXTAREA' ||
        focusedEl.tagName === 'SELECT' ||
        focusedEl.isContentEditable)
    ) {
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

  loadExamples() {
    try {
      this.demoItems = getDemoItems();
      if (this.demoItems.length > 0) {
        this.selectItem(0);
      }
    } catch (err) {
      console.error('Failed to initiate gallery:', err);
    }
  }

  selectItem(index: number) {
    // Delete the surface of the previous example, if any.
    this.deleteActiveExampleSurface();
    // Then load the new one
    this.activeItemIndex = index;
    this.reloadExample();
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
    this.currentDataModelText = '{}';
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
    const surfaceId = this.demoItems[this.activeItemIndex]?.id;
    if (surfaceId) {
      if (this.processor.model.getSurface(surfaceId)) {
        this.processor.processMessages([{version: 'v0.9', deleteSurface: {surfaceId}}]);
      }
    }
  }

  /**
   * Advances the message processing.
   *
   * @param all Whether to process all remaining messages or just the next one.
   */
  advanceMessages(all: boolean = false) {
    const item = this.demoItems[this.activeItemIndex];
    if (!item) return;

    const toProcess = all
      ? item.messages.slice(this.processedMessageCount)
      : [item.messages[this.processedMessageCount]];

    if (toProcess.length === 0) return;

    const modifiedToProcess = this.applyPrimaryColorToMessages(toProcess);

    this.processor.processMessages(structuredClone(modifiedToProcess));
    this.processedMessageCount += toProcess.length;

    // Subscribe to data model on first advance if not already subscribed
    if (!this.dataModelSubscription) {
      const surface = this.processor.model.getSurface(item.id);
      if (surface) {
        this.dataModelSubscription = surface.dataModel.subscribe('/', val => {
          this.currentDataModelText = JSON.stringify(val || {}, null, 2);
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
   * This is necessary for the explorer application to allow users to live-preview
   * theme changes by injecting the selected color into the message stream.
   * In a standard A2UI renderer deployment, this is not needed as the renderer
   * simply processes messages as received from the agent, which is responsible
   * for providing the correct theme.
   *
   * @param messages The list of messages to process.
   * @returns A new list of messages with the primary color applied to `createSurface` messages.
   */
  private applyPrimaryColorToMessages(messages: A2uiMessage[]): A2uiMessage[] {
    return messages.map(msg => {
      if ('createSurface' in msg && this.primaryColor) {
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

  log(msg: string, detail?: unknown) {
    const time = new Date().toLocaleTimeString();
    const entry = detail ? `${msg}\n${JSON.stringify(detail, null, 2)}` : msg;
    this.mockLogs = [...this.mockLogs, `[${time}] ${entry}`];
  }

  render() {
    const activeItem = this.demoItems[this.activeItemIndex];
    const surface = activeItem ? this.processor.model.getSurface(activeItem.id) : undefined;
    const canAdvance = activeItem && this.processedMessageCount < activeItem.messages.length;

    return html`
      <header>
        <div>
          <h1>A2UI Explorer</h1>
          <p class="subtitle">v0.9 Basic Catalog</p>
        </div>
      </header>
      <main>
        <nav class="nav-pane ${this.isLeftSidebarCollapsed ? 'collapsed' : ''}">
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
              <div>
                <h2>${activeItem?.title || 'No selection'}</h2>
                <p class="subtitle">${activeItem?.description}</p>
              </div>
            </div>
            <div class="agent-controls">
              <fieldset class="message-controls">
                <legend>
                  Messages: ${this.processedMessageCount} / ${activeItem?.messages.length || 0}
                </legend>
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

        <aside class="inspector-pane ${this.isRightSidebarCollapsed ? 'collapsed' : ''}">
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
          <div class="inspector-section">
            <div class="inspector-header">Data Model</div>
            <div class="inspector-body">${this.currentDataModelText}</div>
          </div>
          <div class="inspector-section">
            <div class="inspector-header">Action Logs</div>
            <div class="inspector-body log-list">
              ${this.mockLogs.length === 0
                ? html`<span style="color:#475569">No actions logged...</span>`
                : nothing}
              ${this.mockLogs.map(log => html`<div class="log-entry">${log}</div>`)}
            </div>
          </div>
        </aside>
      </main>
    `;
  }
}
