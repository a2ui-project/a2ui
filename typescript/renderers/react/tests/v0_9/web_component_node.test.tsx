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

import {describe, it, expect, afterEach} from 'vitest';
import {render} from '@testing-library/react';
import React from 'react';
import {z} from 'zod';
import {
  Catalog,
  ComponentModel,
  type ComponentNode,
  NodeResolver,
  SurfaceModel,
  peekValue,
} from '@a2ui/web_core/v0_9';
import type {
  A2uiWebComponentElement,
  WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import {WebComponentNode} from '../../src/web_component_node';

const TestComp: WebComponentImplementation = {
  name: 'TestComp',
  schema: z.object({}),
  tagName: 'test-wc-node-el',
  element: class extends HTMLElement implements A2uiWebComponentElement {},
};
const catalog = new Catalog<WebComponentImplementation>('test-cat', '0.9', [TestComp]);

const resolvers: NodeResolver<WebComponentImplementation>[] = [];

/** The root node of a surface whose root is a `TestComp`. */
function rootNode(surfaceId: string): ComponentNode {
  const surface = new SurfaceModel(surfaceId, catalog);
  surface.componentsModel.addComponent(new ComponentModel('root', 'TestComp', {}, catalog));
  const resolver = new NodeResolver(surface, catalog);
  resolvers.push(resolver);
  const node = peekValue(resolver.rootNode);
  if (!node) throw new Error('No root node.');
  return node;
}

describe('WebComponentNode', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    for (const resolver of resolvers.splice(0)) resolver.dispose();
  });

  it('defines the element and hands it the node and its context', () => {
    const node = rootNode('surf-1');

    const {container, rerender} = render(<WebComponentNode node={node} />);

    expect(customElements.get(TestComp.tagName)).toBe(TestComp.element);
    const el = container.querySelector(TestComp.tagName) as A2uiWebComponentElement;
    expect(el.node).toBe(node);
    expect(el.context).toBe(node.context);

    const other = rootNode('surf-2');
    rerender(<WebComponentNode node={other} />);
    expect(el.node).toBe(other);
    expect(el.context).toBe(other.context);
  });
});
