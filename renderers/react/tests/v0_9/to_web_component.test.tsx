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

import {describe, it, expect} from 'vitest';
import {render, screen, waitFor, act} from '@testing-library/react';
import React from 'react';
import {z} from 'zod';
import {
  ComponentContext,
  ComponentModel,
  SurfaceModel,
  Catalog,
  CommonSchemas,
} from '@a2ui/web_core/v0_9';
import {toWebComponent} from '../../src/v0_9/catalog/to_web_component';
import {createComponentImplementation, type A2uiWebComponentElement} from '../../src/v0_9/adapter';

describe('React toWebComponent', () => {
  it('converts a ReactComponentImplementation to a WebComponentImplementation with default tagName', () => {
    const SimpleApi = {
      name: 'SimpleButton',
      schema: z.object({label: z.string()}),
    };
    const SimpleButton = createComponentImplementation(SimpleApi, ({props}) => (
      <button>{props.label}</button>
    ));

    const wcImpl = toWebComponent(SimpleButton);
    expect(wcImpl.name).toBe('SimpleButton');
    expect(wcImpl.tagName).toBe('a2ui-react-simplebutton');
    expect(customElements.get('a2ui-react-simplebutton')).toBeDefined();
  });

  it('uses custom tagName if defined on the component implementation', () => {
    const TagApi = {
      name: 'ImplTagComp',
      schema: z.object({}),
    };
    const TagComp = createComponentImplementation(TagApi, () => <div>Impl Tag</div>);
    TagComp.tagName = 'custom-impl-react-tag';

    const wcImpl = toWebComponent(TagComp);
    expect(wcImpl.tagName).toBe('custom-impl-react-tag');
    expect(customElements.get('custom-impl-react-tag')).toBeDefined();
  });

  it('returns cached WebComponentImplementation on subsequent calls with the same render function', () => {
    const CachedApi = {
      name: 'CachedComp',
      schema: z.object({}),
    };
    const CachedComp = createComponentImplementation(CachedApi, () => <div>Cached</div>);

    const wcImpl1 = toWebComponent(CachedComp);
    const wcImpl2 = toWebComponent(CachedComp);
    expect(wcImpl1).toBe(wcImpl2);
  });

  it('disambiguates tag names when two different component implementations share the same name (collision handling)', () => {
    const DuplicateApi1 = {
      name: 'DuplicateBadge',
      schema: z.object({}),
    };
    const CompA = createComponentImplementation(DuplicateApi1, () => <div>Badge A</div>);

    const DuplicateApi2 = {
      name: 'DuplicateBadge',
      schema: z.object({}),
    };
    const CompB = createComponentImplementation(DuplicateApi2, () => <div>Badge B</div>);

    const impl1 = toWebComponent(CompA);
    const impl2 = toWebComponent(CompB);

    expect(impl1.tagName).toBe('a2ui-react-duplicatebadge');
    expect(impl2.tagName).toBe('a2ui-react-duplicatebadge-1');
    expect(impl1.tagName).not.toBe(impl2.tagName);
    expect(customElements.get(impl1.tagName)).toBeDefined();
    expect(customElements.get(impl2.tagName)).toBeDefined();
  });

  it('handles multiple consecutive tag name collisions gracefully', () => {
    const MultiApi1 = {name: 'MultiCollision', schema: z.object({})};
    const Comp1 = createComponentImplementation(MultiApi1, () => <div>1</div>);

    const MultiApi2 = {name: 'MultiCollision', schema: z.object({})};
    const Comp2 = createComponentImplementation(MultiApi2, () => <div>2</div>);

    const MultiApi3 = {name: 'MultiCollision', schema: z.object({})};
    const Comp3 = createComponentImplementation(MultiApi3, () => <div>3</div>);

    const impl1 = toWebComponent(Comp1);
    const impl2 = toWebComponent(Comp2);
    const impl3 = toWebComponent(Comp3);

    expect(impl1.tagName).toBe('a2ui-react-multicollision');
    expect(impl2.tagName).toBe('a2ui-react-multicollision-1');
    expect(impl3.tagName).toBe('a2ui-react-multicollision-2');
    expect(customElements.get(impl1.tagName)).toBeDefined();
    expect(customElements.get(impl2.tagName)).toBeDefined();
    expect(customElements.get(impl3.tagName)).toBeDefined();
  });

  it('instantiates custom element and sets up display: contents', () => {
    const DisplayApi = {name: 'DisplayTest', schema: z.object({})};
    const DisplayComp = createComponentImplementation(DisplayApi, () => <div>Display</div>);
    const impl = toWebComponent(DisplayComp);

    const el = document.createElement(impl.tagName);
    document.body.appendChild(el);
    expect(el.style.display).toBe('contents');
    document.body.removeChild(el);
  });

  it('renders React component and binds context correctly', async () => {
    const BindApi = {
      name: 'BindContextComp',
      schema: z.object({title: CommonSchemas.DynamicString}),
    };
    const BindComp = createComponentImplementation(BindApi, ({props}) => (
      <h2 data-testid="title">{props.title}</h2>
    ));
    const impl = toWebComponent(BindComp);

    const catalog = new Catalog('test-catalog', [impl], []);
    const surface = new SurfaceModel('surface-test', catalog);
    const componentModel = new ComponentModel('comp-1', 'BindContextComp', {
      title: 'Hello React WC',
    });
    surface.componentsModel.addComponent(componentModel);
    const context = new ComponentContext(surface, 'comp-1', '/');

    const el = document.createElement(impl.tagName) as A2uiWebComponentElement;
    el.context = context;
    document.body.appendChild(el);

    await waitFor(() => {
      expect(el.querySelector('[data-testid="title"]')?.textContent).toBe('Hello React WC');
    });

    document.body.removeChild(el);
  });

  it('updates rendered output reactively when context is modified', async () => {
    const ReactiveApi = {
      name: 'ReactiveComp',
      schema: z.object({count: z.number().optional()}),
    };
    const ReactiveComp = createComponentImplementation(ReactiveApi, ({props}) => (
      <span data-testid="count">{String(props.count ?? 0)}</span>
    ));
    const impl = toWebComponent(ReactiveComp);

    const catalog = new Catalog('test-catalog', [impl], []);
    const surface = new SurfaceModel('surface-reactive', catalog);
    const componentModel = new ComponentModel('comp-reactive', 'ReactiveComp', {
      count: 10,
    });
    surface.componentsModel.addComponent(componentModel);
    const context1 = new ComponentContext(surface, 'comp-reactive', '/');

    const el = document.createElement(impl.tagName) as A2uiWebComponentElement;
    el.context = context1;
    document.body.appendChild(el);

    await waitFor(() => {
      expect(el.querySelector('[data-testid="count"]')?.textContent).toBe('10');
    });

    // Update properties and create new context
    componentModel.properties = {count: 42};
    const context2 = new ComponentContext(surface, 'comp-reactive', '/');
    el.context = context2;

    await waitFor(() => {
      expect(el.querySelector('[data-testid="count"]')?.textContent).toBe('42');
    });

    document.body.removeChild(el);
  });

  it('renders child components with buildChild (both native and web component children)', async () => {
    const ChildNativeApi = {
      name: 'ChildNative',
      schema: z.object({text: z.string()}),
    };
    const ChildNative = createComponentImplementation(ChildNativeApi, ({props}) => (
      <div data-testid="child-native">{props.text}</div>
    ));

    const ChildWcApi = {
      name: 'ChildWc',
      schema: z.object({text: z.string()}),
    };
    const ChildWcNative = createComponentImplementation(ChildWcApi, ({props}) => (
      <div data-testid="child-wc">{props.text}</div>
    ));
    const ChildWc = toWebComponent(ChildWcNative);

    const ParentApi = {
      name: 'ParentContainer',
      schema: z.object({
        child1: z.string().optional(),
        child2: z.string().optional(),
      }),
    };
    const ParentContainer = createComponentImplementation(ParentApi, ({props, buildChild}) => (
      <div data-testid="parent">
        {props.child1 ? buildChild(props.child1) : null}
        {props.child2 ? buildChild(props.child2) : null}
      </div>
    ));
    const ParentWc = toWebComponent(ParentContainer);

    const catalog = new Catalog('test-catalog', [ChildWc, ParentWc, ChildNative], []);
    const surface = new SurfaceModel('surface-parent', catalog);
    surface.componentsModel.addComponent(
      new ComponentModel('parent-1', 'ParentContainer', {
        child1: 'child-1',
        child2: 'child-2',
      }),
    );
    surface.componentsModel.addComponent(
      new ComponentModel('child-1', 'ChildNative', {text: 'I am Native Child'}),
    );
    surface.componentsModel.addComponent(
      new ComponentModel('child-2', 'ChildWc', {text: 'I am WC Child'}),
    );

    const context = new ComponentContext(surface, 'parent-1', '/');
    const el = document.createElement(ParentWc.tagName) as A2uiWebComponentElement;
    el.context = context;
    document.body.appendChild(el);

    await waitFor(() => {
      expect(el.querySelector('[data-testid="child-native"]')?.textContent).toBe(
        'I am Native Child',
      );
      expect(el.querySelector('[data-testid="child-wc"]')?.textContent).toBe('I am WC Child');
    });

    document.body.removeChild(el);
  });

  it('handles disconnect and cleanup gracefully', async () => {
    const CleanupApi = {name: 'CleanupComp', schema: z.object({})};
    const CleanupComp = createComponentImplementation(CleanupApi, () => (
      <div data-testid="cleanup">Active</div>
    ));
    const impl = toWebComponent(CleanupComp);

    const catalog = new Catalog('test-catalog', [impl], []);
    const surface = new SurfaceModel('surface-cleanup', catalog);
    surface.componentsModel.addComponent(new ComponentModel('comp-clean', 'CleanupComp', {}));
    const context = new ComponentContext(surface, 'comp-clean', '/');

    const el = document.createElement(impl.tagName) as A2uiWebComponentElement;
    el.context = context;
    document.body.appendChild(el);

    await waitFor(() => {
      expect(el.querySelector('[data-testid="cleanup"]')?.textContent).toBe('Active');
    });

    // Disconnect element
    await act(async () => {
      document.body.removeChild(el);
      // Wait for the unmount timer to execute cleanly
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  });
});
