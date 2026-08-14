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
import {ComponentContext, ComponentModel, SurfaceModel, Catalog} from '@a2ui/web_core/v0_9';
import {WebComponentNode} from '../../src/v0_9/web_component_node';
import type {A2uiWebComponentElement} from '../../src/v0_9/adapter';

describe('WebComponentNode', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders custom element and binds context to element instance', () => {
    const tagName = 'test-wc-node-el';
    if (!customElements.get(tagName)) {
      customElements.define(
        tagName,
        class extends HTMLElement implements A2uiWebComponentElement {
          context?: ComponentContext;
        },
      );
    }

    const surface = new SurfaceModel('test-surface', new Catalog('test-cat', [], []));
    surface.componentsModel.addComponent(new ComponentModel('test-id', 'TestComp', {}));
    surface.componentsModel.addComponent(new ComponentModel('test-id-2', 'TestComp', {}));

    const ctx = new ComponentContext(surface, 'test-id', '/');

    const {container, rerender} = render(<WebComponentNode tagName={tagName} context={ctx} />);
    const el = container.querySelector(tagName) as A2uiWebComponentElement;
    expect(el).not.toBeNull();
    expect(el.context).toBe(ctx);

    const ctx2 = new ComponentContext(surface, 'test-id-2', '/');
    rerender(<WebComponentNode tagName={tagName} context={ctx2} />);
    expect(el.context).toBe(ctx2);
  });
});
