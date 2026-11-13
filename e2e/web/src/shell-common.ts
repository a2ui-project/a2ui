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
 * What both shells share: the catalogs a renderer of each version uses, and the DOM markers the
 * tests locate components by.
 */

import {AgentFunction, type Catalog, type ComponentApi, type ProtocolVersion} from '@a2ui/web_core';
import {basicCatalog as basicCatalogV1} from '@a2ui/web_core/catalogs/basic/v1';
import {basicCatalog as basicCatalogV09} from '@a2ui/web_core/v0_9/basic_catalog';

import type {A2aSession} from './a2a-session.js';

/** What a page exposes as `window.a2uiShell`, for the turns a test sends without a gesture. */
export interface Shell {
  // The two shells render with different component types; a test reads the session's
  // version, capabilities and processor, which do not depend on it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly session: A2aSession<any>;
  send(text: string): Promise<void>;
}

declare global {
  interface Window {
    a2uiShell: Shell;
  }
}

/** Marks the element that renders a component, with the component's id. */
export const COMPONENT_ID_ATTRIBUTE = 'data-a2ui-id';

/** Marks the element that holds one surface, with the surface's id. */
export const SURFACE_ID_ATTRIBUTE = 'data-a2ui-surface';

function agentSide(name: string) {
  return (): never => {
    throw new Error(`${name} runs on the agent.`);
  };
}

/**
 * The agent functions the test agents declare in their v1.0 basic catalog.
 *
 * The renderer declares the same two, without an implementation, so a call to either
 * leaves as a `callAgentFunction` message.
 */
export const AGENT_FUNCTIONS: readonly AgentFunction[] = [
  new AgentFunction({
    name: 'lookupPrice',
    returnType: 'string',
    schema: {
      type: 'object',
      properties: {sku: {type: 'string'}},
      required: ['sku'],
      additionalProperties: false,
    },
    description: 'Returns the price of a product by its SKU.',
    handler: agentSide('lookupPrice'),
  }),
  new AgentFunction({
    name: 'failingLookup',
    returnType: 'string',
    schema: {type: 'object', properties: {}, additionalProperties: false},
    description: 'A lookup that always fails on the agent.',
    handler: agentSide('failingLookup'),
  }),
];

/** The catalogs a renderer of `version` registers, in priority order. */
export function rendererCatalogs<T extends ComponentApi>(version: ProtocolVersion): Catalog<T>[] {
  if (version === '1.0') {
    return [basicCatalogV1.copyWith({agentFunctions: AGENT_FUNCTIONS}) as unknown as Catalog<T>];
  }
  return [basicCatalogV09 as unknown as Catalog<T>];
}

interface RenderedElement extends Element {
  node?: {componentId?: string};
  context?: {componentModel?: {id?: string}};
}

/**
 * Writes each rendered component's id onto its element, as it is added.
 *
 * The web components keep the component they render in a property; a test can only locate
 * by attribute, so the shell copies the id across whenever the subtree changes.
 */
export function markComponentIds(root: Element): () => void {
  const mark = () => {
    for (const element of root.querySelectorAll<RenderedElement>('*')) {
      const id = element.node?.componentId ?? element.context?.componentModel?.id;
      if (id !== undefined && element.getAttribute(COMPONENT_ID_ATTRIBUTE) !== id) {
        element.setAttribute(COMPONENT_ID_ATTRIBUTE, id);
      }
    }
  };
  const observer = new MutationObserver(mark);
  observer.observe(root, {childList: true, subtree: true});
  mark();
  return () => observer.disconnect();
}
