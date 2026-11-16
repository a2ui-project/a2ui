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
 * The Lit elements of the demo's `Panel` and `Badge`. They set no `api`, so
 * each instance reads its props with the schema of the catalog it was
 * rendered from: the same element serves the zod 4 and the JSON catalog.
 */

import {css, html, nothing} from 'lit';
import {A2uiLitElement} from '@a2ui/lit';
import type {ComponentApi, ComponentNode} from '@a2ui/web_core';
import {
  toWebComponentImplementation,
  type WebComponentImplementation,
} from '@a2ui/web_core/universal';

interface PanelProps {
  title: string;
  children: ComponentNode[];
}

interface BadgeProps {
  label: string;
  active: boolean;
  tone?: 'neutral' | 'accent';
}

export class DemoPanelElement extends A2uiLitElement<ComponentApi> {
  /** @nocollapse */
  static readonly tagName = 'demo-panel';

  static override styles = css`
    demo-panel {
      display: block;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 12px 16px;
      background: #fff;
    }
    demo-panel h2 {
      font-size: 1rem;
      margin: 0 0 10px;
    }
    demo-panel .badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  `;

  override render() {
    const props = this.controller?.props as PanelProps | undefined;
    if (!props) return nothing;
    return html`
      <h2>${props.title}</h2>
      <div class="badges">${props.children.map(child => this.renderNode(child))}</div>
    `;
  }
}

export class DemoBadgeElement extends A2uiLitElement<ComponentApi> {
  /** @nocollapse */
  static readonly tagName = 'demo-badge';

  static override styles = css`
    demo-badge span {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font:
        500 0.85rem system-ui,
        sans-serif;
      background: #eaeef2;
      color: #57606a;
    }
    demo-badge span.active {
      background: #1a7f37;
      color: #fff;
    }
    demo-badge span.accent {
      outline: 2px solid #8250df;
    }
  `;

  override render() {
    const props = this.controller?.props as BadgeProps | undefined;
    if (!props) return nothing;
    return html`<span
      class="${props.active ? 'active' : ''} ${props.tone ?? ''}"
      data-active=${String(props.active)}
      >${props.active ? '✔ ' : '○ '}${props.label}</span
    >`;
  }
}

const elements: Record<string, typeof DemoPanelElement | typeof DemoBadgeElement> = {
  Panel: DemoPanelElement,
  Badge: DemoBadgeElement,
};

/** Pairs a demo component API with its element. */
export function implement(api: ComponentApi): WebComponentImplementation {
  const element = elements[api.name];
  if (!element) throw new Error(`No element for component '${api.name}'.`);
  return toWebComponentImplementation(element, api);
}
