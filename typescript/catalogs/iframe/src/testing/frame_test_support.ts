/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Support for the tests of the frame components: a surface built from real A2UI messages, the
 * rendering of one of its components, and helpers to wait for a sandboxed frame.
 */

import {
  A2uiMessageSchema,
  Catalog,
  ComponentContext,
  MessageProcessor,
  type A2uiClientAction,
  type A2uiMessage,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  renderA2uiNode,
  type A2uiWebComponentElement,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import {render, type LitElement} from 'lit';
import catalogJson from '../catalog.json' with {type: 'json'};
import {IFRAME_CATALOG_ID, iframeCatalog} from '../catalog.js';

/** The parts of a component entry in the catalog schema that matter for its property names. */
interface SchemaPart {
  readonly $ref?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

/**
 * The property names a component of the bundled catalog schema accepts, apart from `id` and
 * `component`: those declared on the component entry, the shared `WebAppFrameCommon` ones, and
 * `accessibility` from the specification's `ComponentCommon`.
 */
export function catalogPropertyNames(component: keyof typeof catalogJson.components): string[] {
  const names = new Set<string>();
  const parts: readonly SchemaPart[] = catalogJson.components[component].allOf;
  for (const part of parts) {
    if (part.$ref === '#/$defs/WebAppFrameCommon') {
      for (const name of Object.keys(catalogJson.$defs.WebAppFrameCommon.properties)) {
        names.add(name);
      }
    } else if (part.$ref?.endsWith('#/$defs/ComponentCommon')) {
      names.add('accessibility');
    }
    for (const name of Object.keys(part.properties ?? {})) {
      if (name !== 'component') {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

/**
 * The iframe catalog's components together with the basic catalog's components and functions,
 * under the iframe catalog id. That is what a host composes to render the catalog's examples,
 * which mix `Column` and `Text` with the frame components and call basic functions.
 */
export function createComposedCatalog(): Catalog<WebComponentImplementation> {
  return new Catalog<WebComponentImplementation>(
    IFRAME_CATALOG_ID,
    [...basicCatalog.components.values(), ...iframeCatalog.components.values()],
    [...basicCatalog.functions.values()],
  );
}

/**
 * Parses the `messages` of an example file with the message schema, so a stale example fails
 * loudly. The messages are copied first: the data model keeps the objects it is given, and a
 * fixture module must not carry the writes of one test into the next.
 */
export function parseExampleMessages(example: {
  readonly messages: readonly unknown[];
}): A2uiMessage[] {
  return A2uiMessageSchema.array().parse(structuredClone(example.messages));
}

/** Polls until the predicate holds, failing the spec with `what` after about four seconds. */
export async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 800 && !predicate(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(predicate()).withContext(what).toBeTrue();
}

/** Lets pending messages arrive when the test expects nothing to happen. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Delivers `data` to the host as if the proxy in `frame` had posted it from `origin`. */
export function postFromFrame(
  frame: HTMLIFrameElement,
  data: unknown,
  origin = window.location.origin,
): void {
  window.dispatchEvent(new MessageEvent('message', {data, origin, source: frame.contentWindow}));
}

/**
 * The messages a same-origin frame page receives from the host, recorded by a listener inside
 * the page. Transferred ports arrive in `event.ports`, so a test can play the app's side.
 */
export class FrameInbox {
  readonly messages: MessageEvent[] = [];
  private readonly listener = (event: MessageEvent) => {
    this.messages.push(event);
  };

  constructor(private readonly target: Window) {
    target.addEventListener('message', this.listener);
  }

  /** The recorded messages whose `data.type` is `type`. */
  ofType(type: string): MessageEvent[] {
    return this.messages.filter(event => isRecord(event.data) && event.data['type'] === type);
  }

  /** Waits for the message of `type` at position `index` among those of that type. */
  async next(type: string, index = 0): Promise<MessageEvent> {
    await waitFor(() => this.ofType(type).length > index, `frame received ${type}`);
    return this.ofType(type)[index];
  }

  dispose(): void {
    this.target.removeEventListener('message', this.listener);
  }
}

/** Waits for `frame` to show the page at `href` and starts recording what the page receives. */
export async function openFrameInbox(frame: HTMLIFrameElement, href: string): Promise<FrameInbox> {
  await waitForFrameDocument(frame, href);
  return new FrameInbox(frame.contentWindow!);
}

/** The inner frame the proxy created; readable because the proxy page is same-origin. */
export function innerFrameOf(frame: HTMLIFrameElement): HTMLIFrameElement | null {
  return frame.contentDocument?.querySelector('iframe') ?? null;
}

/** Waits for the frame's document to be the given page, fully loaded. */
export async function waitForFrameDocument(frame: HTMLIFrameElement, href: string): Promise<void> {
  await waitFor(
    () =>
      frame.contentWindow?.location.href === href &&
      frame.contentDocument?.readyState === 'complete',
    `frame loaded ${href}`,
  );
}

/**
 * A surface processed from real messages and rendered with the universal element of one of its
 * components. Actions the surface emits are recorded.
 */
export class FrameTestHarness {
  readonly container: HTMLDivElement;
  readonly processor: MessageProcessor<WebComponentImplementation>;
  readonly surface: SurfaceModel;
  readonly actions: A2uiClientAction[] = [];

  constructor(
    readonly surfaceId: string,
    messages: readonly A2uiMessage[],
    readonly catalog: Catalog<WebComponentImplementation> = createComposedCatalog(),
  ) {
    this.container = document.createElement('div');
    this.container.style.width = '600px';
    document.body.appendChild(this.container);
    this.processor = new MessageProcessor<WebComponentImplementation>([catalog], action => {
      this.actions.push(action);
    });
    this.processor.processMessages([...messages]);
    const surface = this.processor.model.getSurface(surfaceId);
    if (!surface) {
      throw new Error(`The messages did not create the surface ${surfaceId}`);
    }
    this.surface = surface;
  }

  /** Renders the component and returns its element once its first update completed. */
  async renderComponent(componentId: string): Promise<LitElement & A2uiWebComponentElement> {
    render(
      renderA2uiNode(new ComponentContext(this.surface, componentId), this.catalog),
      this.container,
    );
    const element = this.container.firstElementChild as
      | (LitElement & A2uiWebComponentElement)
      | null;
    if (!element) {
      throw new Error(`Nothing was rendered for ${componentId}`);
    }
    await element.updateComplete;
    return element;
  }

  /** Replaces the properties of a component, as an `updateComponents` message would. */
  updateComponent(
    component: {readonly id: string; readonly component: string} & Record<string, unknown>,
  ): void {
    this.processor.processMessages([
      {
        version: 'v0.9',
        updateComponents: {surfaceId: this.surfaceId, components: [component]},
      },
    ]);
  }

  /** Writes a value into the surface data model, as an `updateDataModel` message would. */
  setData(path: string, value: unknown): void {
    this.processor.processMessages([
      {version: 'v0.9', updateDataModel: {surfaceId: this.surfaceId, path, value}},
    ]);
  }

  /** The actions recorded so far with the given name. */
  actionsNamed(name: string): A2uiClientAction[] {
    return this.actions.filter(action => action.name === name);
  }

  /** Waits for the next action with the given name beyond `after` recorded ones, and returns it. */
  async nextAction(name: string, after = 0): Promise<A2uiClientAction> {
    await waitFor(() => this.actionsNamed(name).length > after, `action ${name} received`);
    return this.actionsNamed(name)[after];
  }

  /** Removes the rendered element from the document, as a host would when the surface goes away. */
  clear(): void {
    render(null, this.container);
  }

  /** Removes the rendered element and disposes the surface. */
  dispose(): void {
    this.clear();
    this.container.remove();
    this.surface.dispose();
  }
}
