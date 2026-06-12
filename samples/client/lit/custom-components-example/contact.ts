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
import {LitElement, html, css, nothing, HTMLTemplateResult, unsafeCSS} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {theme as uiTheme} from './theme/theme.js';
import {A2UIClient} from './client.js';
import {SnackbarAction, SnackbarMessage, SnackbarUUID, SnackType} from './types/types.js';
import {type Snackbar} from './ui/snackbar.js';
import {repeat} from 'lit/directives/repeat.js';
import {v0_8} from '@a2ui/lit';
import * as UI from '@a2ui/lit/ui';

// Demo elements.
import './ui/ui.js';
import {registerContactComponents} from './ui/custom-components/register-components.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - optional peer dependency
import {renderMarkdown} from '@a2ui/markdown-it';

// Register custom components for the contact app
registerContactComponents();

@customElement('a2ui-contact')
export class A2UIContactFinder extends SignalWatcher(LitElement) {
  connectedCallback() {
    super.connectedCallback();
  }

  @provide({context: UI.Context.themeContext})
  accessor theme: v0_8.Types.Theme = uiTheme;

  @provide({context: UI.Context.markdown})
  accessor markdownRenderer: v0_8.Types.MarkdownRenderer = async (text, options) => {
    return renderMarkdown(text, options);
  };

  @state()
  accessor #requesting = false;

  @state()
  accessor #error: string | null = null;

  @state()
  accessor renderVersion = 0;

  @state()
  accessor #lastMessages: v0_8.Types.ServerToClientMessage[] = [];

  static styles = [
    unsafeCSS(v0_8.Styles.structuralStyles),
    css`
      :host {
        display: block;
        max-width: 640px;
        margin: 0 auto;
        min-height: 100%;
      }

      #surfaces {
        display: flex;
        flex-direction: row;
        gap: 16px;
        width: 100%;
        padding: var(--bb-grid-size-3) 0;
        animation: fadeIn 1s cubic-bezier(0, 0, 0.3, 1) 0.3s backwards;
        align-items: flex-start;

        & a2ui-surface {
          width: 100%;
          flex: 1;
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

      .rotate {
        animation: spin 1s linear infinite;
      }

      .pending {
        width: 100%;
        min-height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 1s cubic-bezier(0, 0, 0.3, 1) 0.3s backwards;

        & .g-icon {
          margin-right: 8px;
        }
      }

      .error {
        color: var(--e-40);
        background-color: var(--e-95);
        border: 1px solid var(--e-80);
        padding: 16px;
        border-radius: 8px;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }

        to {
          opacity: 1;
        }
      }

      .spinner {
        width: 48px;
        height: 48px;
        border: 4px solid rgba(255, 255, 255, 0.1);
        border-left-color: var(--p-60);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .rendering-indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        color: var(--p-40);
        font-size: 14px;
        border-top: 1px solid var(--n-90);
        margin-top: 16px;
        width: 100%;

        & .g-icon {
          margin-right: 8px;
          font-size: 16px;
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
    `,
  ];

  #processor = v0_8.Data.createSignalA2uiMessageProcessor();
  #a2uiClient = new A2UIClient();
  #snackbar: Snackbar | undefined = undefined;
  #pendingSnackbarMessages: Array<{
    message: SnackbarMessage;
    replaceAll: boolean;
  }> = [];

  render() {
    return [this.#maybeRenderForm(), this.#maybeRenderData(), this.#maybeRenderError()];
  }

  #maybeRenderError() {
    if (!this.#error) return nothing;

    return html`<div class="error">${this.#error}</div>`;
  }

  #maybeRenderForm() {
    if (this.#requesting) return nothing;
    if (this.#lastMessages.length > 0) return nothing;
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
        const message: v0_8.Types.A2UIClientEventMessage = {
          request: body,
        };
        await this.#sendAndProcessMessage(message);
      }}
    >
      <h1 class="typography-f-sf typography-v-r typography-w-400 color-c-p30">Contact Finder</h1>
      <div>
        <input
          required
          value="Casey Smith"
          autocomplete="off"
          id="body"
          name="body"
          type="text"
          ?disabled=${this.#requesting}
        />
        <button type="submit" ?disabled=${this.#requesting}>
          <span class="g-icon filled-heavy">send</span>
        </button>
      </div>
    </form>`;
  }

  #maybeRenderData() {
    if (this.#requesting && this.#processor.getSurfaces().size === 0) {
      return html` <div class="pending">
        <div class="spinner"></div>
        <div class="loading-text">Awaiting an answer...</div>
      </div>`;
    }

    const surfacesMap = new Map(this.#processor.getSurfaces());
    const surfaces = Array.from(surfacesMap.entries()).sort(([a], [b]) => {
      // "org-chart-view" comes first (left), "contact-card" second (right)
      if (a === 'org-chart-view') return -1;
      if (b === 'org-chart-view') return 1;
      return a.localeCompare(b);
    });

    if (surfaces.length === 0) {
      return nothing;
    }

    return html` ${this.#requesting
        ? html`<div class="rendering-indicator">
            <span class="g-icon filled-heavy rotate">progress_activity</span>
            Rendering UI...
          </div>`
        : nothing}
      <section id="surfaces">
        ${repeat(
          surfaces,
          ([surfaceId]) => surfaceId,
          ([surfaceId, surface]) => {
            return html` <div
              style="position: relative; height: 100%; display: flex; flex-direction: column;"
            >
              <a2ui-surface
                .surface=${{...surface}}
                @a2uiaction=${async (evt: v0_8.Events.StateEvent<'a2ui.action'>) => {
                  const [target] = evt.composedPath();
                  if (!(target instanceof HTMLElement)) {
                    return;
                  }

                  const context: v0_8.Types.A2UIClientEventMessage['userAction']['context'] = {};
                  if (evt.detail.action.context) {
                    const srcContext = evt.detail.action.context;
                    for (const item of srcContext) {
                      if (item.value.literalBoolean) {
                        context[item.key] = item.value.literalBoolean;
                      } else if (item.value.literalNumber) {
                        context[item.key] = item.value.literalNumber;
                      } else if (item.value.literalString) {
                        context[item.key] = item.value.literalString;
                      } else if (item.value.path) {
                        const path = this.#processor.resolvePath(
                          item.value.path,
                          evt.detail.dataContextPath,
                        );
                        const value = this.#processor.getData(
                          evt.detail.sourceComponent,
                          path,
                          surfaceId,
                        );
                        context[item.key] = value;
                      }
                    }
                  }

                  const message: v0_8.Types.A2UIClientEventMessage = {
                    userAction: {
                      surfaceId: surfaceId,
                      name: 'ACTION: ' + evt.detail.action.name,
                      sourceComponentId: target.id,
                      timestamp: new Date().toISOString(),
                      context,
                    },
                  };

                  await this.#sendAndProcessMessage(message);
                }}
                .surfaceId=${surfaceId}
                .processor=${this.#processor}
                .enableCustomElements=${true}
              ></a2ui-surface>
            </div>`;
          },
        )}
      </section>`;
  }

  async #sendAndProcessMessage(request: v0_8.Types.A2UIClientEventMessage) {
    this.#requesting = true;
    const messages = await this.#sendMessage(request);

    this.#lastMessages = messages;

    this.renderVersion++; // Force re-render of surfaces
    this.requestUpdate();

    const cardSurface = this.#processor.getSurfaces().get('contact-card');
    if (cardSurface) {
      // Deeply log the data model for the card
    }
  }

  async #sendMessage(
    message: v0_8.Types.A2UIClientEventMessage,
  ): Promise<v0_8.Types.ServerToClientMessage[]> {
    try {
      this.#requesting = true;
      const response = await this.#a2uiClient.send(message, chunkMessages => {
        this.#processor.processMessages(chunkMessages);
        this.renderVersion++;
        this.requestUpdate();
      });

      this.#requesting = false;

      return response;
    } catch (err) {
      this.snackbar(err as string, SnackType.ERROR);
    } finally {
      this.#requesting = false;
    }

    return [];
  }

  snackbar(
    message: string | HTMLTemplateResult,
    type: SnackType,
    actions: SnackbarAction[] = [],
    persistent = false,
    id = globalThis.crypto.randomUUID(),
    replaceAll = false,
  ) {
    if (!this.#snackbar) {
      this.#pendingSnackbarMessages.push({
        message: {
          id,
          message,
          type,
          persistent,
          actions,
        },
        replaceAll,
      });
      return;
    }

    return this.#snackbar.show(
      {
        id,
        message,
        type,
        persistent,
        actions,
      },
      replaceAll,
    );
  }

  unsnackbar(id?: SnackbarUUID) {
    if (!this.#snackbar) {
      return;
    }

    this.#snackbar.hide(id);
  }
}
