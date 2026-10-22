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

/**
 * Client application for the standalone A2UI VegaChart catalog sample.
 *
 * Registers both `basicCatalog` (`@a2ui/lit/v0_9`) and `vegachartCatalog`
 * (`@a2ui/catalog-vegachart/v0_9`) with a `MessageProcessor` and renders a static
 * A2UI payload (`a2ui_vegachart.json`) without an LLM agent.
 */

import {provide} from '@lit/context';
import {css, html, LitElement} from 'lit';
import {customElement, state} from 'lit/decorators.js';

import {VEGACHART_CATALOG_ID, vegachartCatalog} from '@a2ui/catalog-vegachart/v0_9';
import {basicCatalog, Context} from '@a2ui/lit/v0_9';
import '@a2ui/lit/v0_9'; // Registers <a2ui-surface>.
import {renderMarkdown} from '@a2ui/markdown-it';
import {
  type A2uiMessage,
  type ComponentApi,
  MessageProcessor,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';

import surfaceMessages from './a2ui_vegachart.json';

/** Surface ID declared in `a2ui_vegachart.json`. */
export const DASHBOARD_SURFACE_ID = 'vegachart-dashboard';

/** Default catalog ID declared in `a2ui_vegachart.json`. */
export const BASIC_CATALOG_ID = basicCatalog.id;

export {VEGACHART_CATALOG_ID};

@customElement('a2ui-vegachart-app')
export class A2uiVegachartApp extends LitElement {
  /** Markdown renderer for A2UI `Text` components. */
  @provide({context: Context.markdown})
  markdownRenderer = (value: string, options?: unknown) =>
    Promise.resolve(renderMarkdown(value, options as never));

  readonly processor: MessageProcessor<ComponentApi>;

  @state() accessor surface: SurfaceModel<ComponentApi> | undefined;
  @state() accessor error = '';

  constructor() {
    super();
    this.processor = new MessageProcessor<ComponentApi>([basicCatalog, vegachartCatalog]);

    this.processor.onSurfaceCreated(surface => {
      this.surface = surface;
      surface.onError.subscribe(event => {
        this.error = event.message ?? String(event.code);
      });
    });
  }

  override connectedCallback() {
    super.connectedCallback();
    try {
      this.processor.processMessages(structuredClone(surfaceMessages) as unknown as A2uiMessage[]);
    } catch (err: unknown) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      max-width: 1280px;
      margin: 0 auto;
      padding: 32px 24px;
      box-sizing: border-box;
      color: #202124;

      --a2ui-color-primary: #1a73e8;
      --a2ui-color-primary-hover: #1557b0;
      --a2ui-color-on-primary: #ffffff;
      --a2ui-color-surface: #ffffff;
      --a2ui-color-on-surface: #202124;
      --a2ui-color-border: #dadce0;
      --a2ui-color-on-background: #202124;
      --a2ui-text-caption-color: #5f6368;

      --a2ui-border-radius: 12px;
      --a2ui-spacing-s: 8px;
      --a2ui-spacing-m: 16px;
      --a2ui-spacing-l: 24px;

      --a2ui-card-background: #ffffff;
      --a2ui-card-border: 1px solid #dadce0;
      --a2ui-card-border-radius: 12px;
      --a2ui-card-padding: 20px;
      --a2ui-card-box-shadow: 0 1px 3px rgba(60, 64, 67, 0.12);
    }

    a2ui-surface {
      display: block;
      width: 100%;
    }

    .error-banner {
      background: #fce8e6;
      border: 1px solid #f28b82;
      color: #c5221f;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
    }
  `;

  override render() {
    return html`
      ${this.error ? html`<div class="error-banner" role="alert">${this.error}</div>` : ''}
      ${this.surface
        ? html`<a2ui-surface .surface=${this.surface}></a2ui-surface>`
        : html`<p>Loading VegaChart surface...</p>`}
    `;
  }
}
