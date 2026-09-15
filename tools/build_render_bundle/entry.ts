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

import {html, nothing, css, LitElement, PropertyValues} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {z} from 'zod';
import {
  MessageProcessor,
  Catalog,
  SurfaceModel,
  ComponentContext,
  WebComponentImplementation,
  ComponentApi,
  A2uiController,
} from '@a2ui/web_core/v0_9';
import {
  BasicCatalogA2uiLitElement,
  ResolvedChildList,
  A2uiChildRef,
} from '@a2ui/web_core/v0_9/basic_catalog';
import {basicCatalog, A2uiSurface, Context} from '@a2ui/lit/v0_9';
import {renderMarkdown} from '@a2ui/markdown-it';

function getChildKey(child: any): string {
  return typeof child === 'object' && child !== null
    ? `${child.basePath ?? ''}/${child.id}`
    : String(child);
}

const passthroughSchema = z.object({}).passthrough();

// Base class for enterprise / composite components with automatic controller creation
export abstract class EnterpriseLitElement extends BasicCatalogA2uiLitElement<any> {
  protected override createController(): A2uiController<any> {
    const api = (this as any).api || {
      name: this.tagName.toLowerCase(),
      schema: passthroughSchema,
    };
    return new A2uiController(this, api);
  }
}

// ============================================================================
// Composite & Enterprise Components for A2UI
// ============================================================================

/**
 * Canvas container component commonly used in Gemini Enterprise dashboards.
 */
@customElement('a2ui-composite-canvas')
export class A2uiCanvasElement extends EnterpriseLitElement {
  static override styles = css`
    :host, a2ui-composite-canvas {
      display: flex;
      flex-direction: column;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 16px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      margin: 8px 0;
      width: 100%;
      box-sizing: border-box;
      font-family: inherit;
    }
    .canvas-header {
      margin-bottom: 12px;
      border-bottom: 1px solid #f0f0f0;
      padding-bottom: 8px;
    }
    .canvas-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: #1a73e8;
    }
    .canvas-description {
      font-size: 0.875rem;
      color: #5f6368;
      margin-top: 4px;
    }
  `;

  protected readonly api = {
    name: 'Canvas',
    schema: passthroughSchema,
  };

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : [];
    return html`
      ${props.cardTitle ? html`
        <div class="canvas-header">
          <div class="canvas-title">${props.cardTitle}</div>
          ${props.cardDescription ? html`<div class="canvas-description">${props.cardDescription}</div>` : nothing}
        </div>
      ` : nothing}
      ${repeat(children, getChildKey, child => html`${this.renderNode(child)}`)}
    `;
  }
}

/**
 * MaterialText component mapping usageHint to standard typography.
 */
@customElement('a2ui-material-text')
export class A2uiMaterialTextElement extends EnterpriseLitElement {
  static override styles = css`
    :host, a2ui-material-text {
      display: block;
      font-family: inherit;
      color: #202124;
      line-height: 1.5;
    }
    h1 { font-size: 2rem; margin: 0.5rem 0; font-weight: 500; }
    h2 { font-size: 1.5rem; margin: 0.4rem 0; font-weight: 500; }
    h3 { font-size: 1.25rem; margin: 0.3rem 0; font-weight: 500; }
    h4 { font-size: 1.1rem; margin: 0.25rem 0; font-weight: 500; }
    h5 { font-size: 1rem; margin: 0.2rem 0; font-weight: 600; }
    .caption { font-size: 0.75rem; color: #5f6368; }
    .body { font-size: 0.95rem; }
    .subtitle { font-size: 1.1rem; color: #3c4043; font-weight: 500; }
  `;

  protected readonly api = {
    name: 'MaterialText',
    schema: passthroughSchema,
  };

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const text = props.text ?? '';
    const hint = props.usageHint ?? 'body';
    switch (hint) {
      case 'h1': return html`<h1>${text}</h1>`;
      case 'h2': return html`<h2>${text}</h2>`;
      case 'h3': return html`<h3>${text}</h3>`;
      case 'h4': return html`<h4>${text}</h4>`;
      case 'h5': return html`<h5>${text}</h5>`;
      case 'caption': return html`<div class="caption">${text}</div>`;
      case 'subtitle1':
      case 'subtitle2': return html`<div class="subtitle">${text}</div>`;
      default: return html`<div class="body">${text}</div>`;
    }
  }
}

/**
 * MaterialButton component with theme colors.
 */
@customElement('a2ui-material-button')
export class A2uiMaterialButtonElement extends EnterpriseLitElement {
  static override styles = css`
    :host, a2ui-material-button {
      display: inline-block;
      margin: 4px 0;
    }
    button {
      background-color: var(--a2ui-color-primary, #1a73e8);
      color: #ffffff;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
      transition: background-color 0.2s, box-shadow 0.2s;
    }
    button:hover {
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
  `;

  protected readonly api = {
    name: 'MaterialButton',
    schema: passthroughSchema,
  };

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const label = props.label || props.text || 'Button';
    return html`<button type="button">${label}</button>`;
  }
}

/**
 * MaterialTable component for tabular data display.
 */
@customElement('a2ui-material-table')
export class A2uiMaterialTableElement extends EnterpriseLitElement {
  static override styles = css`
    :host, a2ui-material-table {
      display: block;
      width: 100%;
      overflow-x: auto;
      margin: 8px 0;
      box-sizing: border-box;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
    }
    th, td {
      border-bottom: 1px solid #e0e0e0;
      padding: 10px 14px;
      text-align: left;
    }
    th {
      background-color: #f8f9fa;
      color: #3c4043;
      font-weight: 600;
    }
    tr:hover td {
      background-color: #f1f3f4;
    }
  `;

  protected readonly api = {
    name: 'MaterialTable',
    schema: passthroughSchema,
  };

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const columns = Array.isArray(props.columns) ? props.columns : [];
    const rows = Array.isArray(props.rows) ? props.rows : [];
    return html`
      <table>
        <thead>
          <tr>
            ${columns.map((c: any) => html`<th>${c.header || c.title || c.field || ''}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map((r: any) => html`
            <tr>
              ${columns.map((c: any) => html`<td>${r[c.field] !== undefined ? r[c.field] : ''}</td>`)}
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }
}

/**
 * MaterialDialog component.
 */
@customElement('a2ui-material-dialog')
export class A2uiMaterialDialogElement extends EnterpriseLitElement {
  static override styles = css`
    :host, a2ui-material-dialog {
      display: block;
      border: 1px solid #dadce0;
      border-radius: 8px;
      padding: 16px;
      background: #ffffff;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      margin: 12px 0;
    }
  `;

  protected readonly api = {
    name: 'MaterialDialog',
    schema: passthroughSchema,
  };

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : (props.child ? [props.child] : []);
    return html`
      ${props.title ? html`<h2 style="margin-top:0;">${props.title}</h2>` : nothing}
      ${repeat(children, getChildKey, child => html`${this.renderNode(child)}`)}
    `;
  }
}

/**
 * Generic Fallback Component: renders children or content for any custom component.
 */
@customElement('a2ui-generic-component')
export class A2uiGenericComponentElement extends EnterpriseLitElement {
  static override styles = css`
    :host, a2ui-generic-component {
      display: block;
      padding: 8px;
      margin: 4px 0;
      border: 1px dashed #d1d5db;
      border-radius: 6px;
      background: #fafafa;
    }
  `;

  protected readonly api = {
    name: 'GenericComponent',
    schema: passthroughSchema,
  };

  override render() {
    const props = this.controller?.props || {};
    const children: ResolvedChildList = Array.isArray(props.children) ? props.children : (props.child ? [props.child] : []);
    return html`
      <div class="generic-container">
        ${props.title ? html`<strong>${props.title}</strong>` : nothing}
        ${props.text ? html`<div>${props.text}</div>` : nothing}
        ${repeat(children, getChildKey, child => html`${this.renderNode(child)}`)}
      </div>
    `;
  }
}

// Enterprise Component API definitions
const EnterpriseComponentApis: WebComponentImplementation[] = [
  { name: 'Canvas', tagName: 'a2ui-composite-canvas', schema: passthroughSchema },
  { name: 'MaterialText', tagName: 'a2ui-material-text', schema: passthroughSchema },
  { name: 'MaterialButton', tagName: 'a2ui-material-button', schema: passthroughSchema },
  { name: 'MaterialTable', tagName: 'a2ui-material-table', schema: passthroughSchema },
  { name: 'MaterialDialog', tagName: 'a2ui-material-dialog', schema: passthroughSchema },
  // Map standard layout components to basic catalog tags
  { name: 'MaterialColumn', tagName: 'a2ui-basic-column', schema: passthroughSchema },
  { name: 'MaterialRow', tagName: 'a2ui-basic-row', schema: passthroughSchema },
  { name: 'MaterialCard', tagName: 'a2ui-card', schema: passthroughSchema },
  { name: 'MaterialList', tagName: 'a2ui-list', schema: passthroughSchema },
  { name: 'VegaChart', tagName: 'a2ui-generic-component', schema: passthroughSchema },
  { name: 'Iframe', tagName: 'a2ui-generic-component', schema: passthroughSchema },
  { name: 'MaterialPreferencesTabs', tagName: 'a2ui-generic-component', schema: passthroughSchema },
  { name: 'MaterialInputForm', tagName: 'a2ui-generic-component', schema: passthroughSchema },
];

/**
 * Creates a Catalog with fallback proxy so unknown components resolve to generic element.
 */
function createResilientCatalog(id: string, additionalApis: WebComponentImplementation[] = []): Catalog<any> {
  const allComponents = [
    ...(Array.from((basicCatalog.components as Map<string, any>).values())),
    ...EnterpriseComponentApis,
    ...additionalApis,
  ];
  const cat = new Catalog(id, allComponents);
  const origGet = cat.components.get.bind(cat.components);
  cat.components.get = (key: string) => {
    const item = origGet(key);
    if (item) return item;
    return {
      name: key,
      tagName: 'a2ui-generic-component',
      schema: passthroughSchema,
    };
  };
  return cat;
}

// Pre-create known catalogs
const compositeCatalog = createResilientCatalog('https://www.gstatic.com/vertexaisearch/a2ui/v0_9/gemini_enterprise_composite_catalog.json');
const materialCatalog = createResilientCatalog('https://a2ui.org/specification/v0_9/material_catalog.json');
const basicShortCatalog = createResilientCatalog('basic');
const compositeShortCatalog = createResilientCatalog('gemini_enterprise_composite');
const materialShortCatalog = createResilientCatalog('material');

// Make basicCatalog also resilient
const origBasicGet = basicCatalog.components.get.bind(basicCatalog.components);
basicCatalog.components.get = (key: string) => {
  const item = origBasicGet(key);
  if (item) return item;
  // Check enterprise apis
  const ent = EnterpriseComponentApis.find(e => e.name === key);
  if (ent) return ent;
  return {
    name: key,
    tagName: 'a2ui-generic-component',
    schema: passthroughSchema,
  };
};

const defaultCatalogs = [
  basicCatalog,
  basicShortCatalog,
  compositeCatalog,
  compositeShortCatalog,
  materialCatalog,
  materialShortCatalog,
];

// ============================================================================
// Lifecycle Settling Loop (whenSettled)
// ============================================================================

/**
 * Comprehensive multi-pass lifecycle settling loop.
 * Implements fixed-point iteration across ShadowRoot and Light DOM,
 * awaiting updateComplete, font readiness, image loading, and paint frames.
 */
export async function whenSettled(root: Element | Document = document.body, maxIterations = 30): Promise<void> {
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    let hadPendingUpdates = false;
    const promises: Promise<any>[] = [];

    function traverse(node: Node | null) {
      if (!node) return;

      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as any;
        if (el.updateComplete) {
          promises.push(el.updateComplete);
          if (el.isUpdatePending) {
            hadPendingUpdates = true;
          }
        }
        if (el.shadowRoot) {
          traverse(el.shadowRoot);
        }
      }

      for (let i = 0; i < node.childNodes.length; i++) {
        traverse(node.childNodes[i]);
      }
    }

    traverse(root);

    if (promises.length > 0) {
      await Promise.all(promises);
    }

    // Flush microtasks and request an animation frame
    await new Promise(resolve => requestAnimationFrame(resolve));

    // If no updates were pending during traversal, and we ran at least 3 stabilization passes, settled!
    if (!hadPendingUpdates && iteration >= 3) {
      break;
    }
  }

  // Await font rendering readiness
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font loading errors
    }
  }

  // Await image loading with bounded timeout
  const images = Array.from((root as Element).querySelectorAll ? (root as Element).querySelectorAll('img') : document.querySelectorAll('img'));
  if (images.length > 0) {
    await Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 1500); // 1.5s max per image
        img.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        img.addEventListener('error', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }));
  }

  // Extra animation frame for paint rasterization
  await new Promise(resolve => requestAnimationFrame(resolve));
}

// ============================================================================
// Render A2UI Payload Entrypoint
// ============================================================================

export interface RenderOptions {
  width?: number;
  height?: number;
  theme?: any;
  catalogId?: string;
  timeoutMs?: number;
}

export interface RenderResult {
  success: boolean;
  surfaceId?: string;
  error?: string;
  stack?: string;
  elementCount?: number;
  dimensions?: { width: number; height: number };
}

/**
 * Renders an A2UI payload into the DOM container and awaits complete lifecycle settling.
 */
export async function renderA2UIPayload(
  payloadInput: any,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const container = document.getElementById('container') || document.body;
  container.innerHTML = '';

  try {
    let messages: any[] = [];
    if (typeof payloadInput === 'string') {
      try {
        messages = JSON.parse(payloadInput);
      } catch (e: any) {
        return { success: false, error: `Invalid JSON payload: ${e.message}` };
      }
    } else if (Array.isArray(payloadInput)) {
      messages = payloadInput;
    } else if (typeof payloadInput === 'object' && payloadInput !== null) {
      if (Array.isArray(payloadInput.messages)) {
        messages = payloadInput.messages;
      } else {
        messages = [payloadInput];
      }
    } else {
      return { success: false, error: 'Payload must be an array of messages or an object' };
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return { success: false, error: 'Empty or invalid messages payload' };
    }

    // Build active catalogs list, dynamically synthesizing any missing catalogId
    const activeCatalogs = [...defaultCatalogs];
    for (const msg of messages) {
      if (msg && msg.createSurface && msg.createSurface.catalogId) {
        const requestedCatId = msg.createSurface.catalogId;
        if (!activeCatalogs.some(c => c.id === requestedCatId)) {
          activeCatalogs.push(createResilientCatalog(requestedCatId));
        }
      }
    }

    // If options.catalogId provided and not yet registered
    if (options.catalogId && !activeCatalogs.some(c => c.id === options.catalogId)) {
      activeCatalogs.push(createResilientCatalog(options.catalogId));
    }

    const processor = new MessageProcessor(activeCatalogs, action => {
      console.log('Action dispatched in headless render:', action);
    });

    processor.processMessages(messages);

    // Find the surface created
    const surfaceMap = processor.model.surfacesMap;
    let surface: SurfaceModel<any> | undefined;

    for (const msg of messages) {
      if (msg && msg.createSurface && msg.createSurface.surfaceId) {
        surface = processor.model.getSurface(msg.createSurface.surfaceId);
        if (surface) break;
      }
    }

    if (!surface) {
      // Fallback to first available surface
      surface = surfaceMap.values().next().value;
    }

    if (!surface) {
      return { success: false, error: 'No surface was created by the payload messages' };
    }

    const surfaceEl = document.createElement('a2ui-surface') as A2uiSurface;
    surfaceEl.surface = surface;
    container.appendChild(surfaceEl);

    // Await complete lifecycle settling, bounded by timeoutMs if configured
    if (options.timeoutMs && options.timeoutMs > 0) {
      let timeoutId: any;
      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Rendering lifecycle settling timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      });
      try {
        await Promise.race([whenSettled(container), timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      await whenSettled(container);
    }

    const rect = container.getBoundingClientRect();

    return {
      success: true,
      surfaceId: surface.id,
      elementCount: container.querySelectorAll('*').length,
      dimensions: {
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
      stack: err?.stack,
    };
  }
}

// Export to window
(window as any).A2UI = {
  MessageProcessor,
  Catalog,
  basicCatalog,
  compositeCatalog,
  materialCatalog,
  A2uiSurface,
  Context,
  renderMarkdown,
  whenSettled,
  renderA2UIPayload,
  createResilientCatalog,
};

(window as any).renderA2UIPayload = renderA2UIPayload;
(window as any).whenSettled = whenSettled;
