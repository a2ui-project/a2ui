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

import {LitElement, html, css, nothing} from 'lit';
import {provide} from '@lit/context';
import {customElement, state} from 'lit/decorators.js';
import {MessageProcessor, A2uiMessage} from '@a2ui/web_core/v0_9';
import {basicCatalog, Context} from '@a2ui/lit/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';
import {getDemoItems, DemoItem} from './examples';
import {appStyles} from './local-gallery.css';

@customElement('local-gallery')
export class LocalGallery extends LitElement {
  @state() accessor mockLogs: string[] = [];
  @state() accessor demoItems: DemoItem[] = [];
  @state() accessor activeItemIndex = 0;
  @state() accessor processedMessageCount = 0;
  @state() accessor currentDataModelText = '{}';
  @state() accessor primaryColor = '#1177ee';

  @provide({context: Context.markdown})
  private accessor markdownRenderer = renderMarkdown;

  private processor = new MessageProcessor([basicCatalog], (action: any) => {
    this.log(`Action dispatched: ${action.surfaceId}`, action);
  });

  private dataModelSubscription?: {unsubscribe: () => void};

  static styles = [appStyles];

  async connectedCallback() {
    super.connectedCallback();

    this.processor.model.onSurfaceCreated.subscribe((surface: any) => {
      surface.onError.subscribe((err: any) => {
        this.log(`Error on surface ${surface.id}: ${err.message}`, err);
      });
    });

    this.loadExamples();
  }

  loadExamples() {
    try {
      this.demoItems = getDemoItems();
      if (this.demoItems.length > 0) {
        this.selectItem(0);
      }
    } catch (err) {
      console.error(`Failed to initiate gallery:`, err);
    }
  }

  selectItem(index: number) {
    this.activeItemIndex = index;
    this.reloadExample();
  }

  resetSurface() {
    this.processedMessageCount = 0;
    this.mockLogs = [];
    this.currentDataModelText = '{}';

    // Clear old surface and subscriptions
    if (this.dataModelSubscription) {
      this.dataModelSubscription.unsubscribe();
      this.dataModelSubscription = undefined;
    }

    const item = this.demoItems[this.activeItemIndex];
    if (item && this.processor.model.getSurface(item.id)) {
      this.processor.processMessages([{version: 'v0.9', deleteSurface: {surfaceId: item.id}}]);
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

    this.processor.processMessages(modifiedToProcess);
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

  log(msg: string, detail?: any) {
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
        <nav class="nav-pane">
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
        </nav>

        <section class="gallery-pane">
          <div class="preview-header">
            <div>
              <h2>${activeItem?.title || 'No selection'}</h2>
              <p class="subtitle">${activeItem?.description}</p>
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

        <aside class="inspector-pane">
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
