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

import {describe, it, expect, afterEach, beforeAll, vi} from 'vitest';
import {render, act, cleanup, fireEvent, within} from '@testing-library/react';
import React, {useState} from 'react';
import {z} from 'zod';
import {
  Catalog,
  ChildListSchema,
  CommonSchemas,
  ComponentModel,
  type ComponentNode,
  NodeResolver,
  ResolvedBinding,
  SurfaceModel,
  isComponentNode,
  peekValue,
} from '@a2ui/web_core/v0_9';
import {
  registerUniversalElement,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import {prepareCatalogs} from '../../src/catalog/prepare_catalogs';
import type {ReactHostElement} from '../../src/catalog/react_host_element';
import {toWebComponent} from '../../src/catalog/to_web_component';
import {
  createBinderlessComponentImplementation,
  createComponentImplementation,
  type ReactComponentImplementation,
} from '../../src';
import {A2uiSurface} from '../../src/A2uiSurface';
import {HostRegistry} from '../../src/host_registry';

const Label = createComponentImplementation(
  {name: 'HostLabel', schema: z.object({text: CommonSchemas.DynamicString.optional()})},
  ({props}) => <span data-testid="label">{String(props.text ?? '')}</span>,
);

/** Holds React state, to show whether the portal survives a DOM move. */
const Counter = createComponentImplementation({name: 'HostCounter', schema: z.object({})}, () => {
  const [count, setCount] = useState(0);
  return (
    <button data-testid="counter" onClick={() => setCount(c => c + 1)}>
      {`count:${count}`}
    </button>
  );
});

const List = createComponentImplementation(
  {name: 'HostList', schema: z.object({children: ChildListSchema.optional()})},
  ({props, buildChild}) => (
    <div data-testid="list">
      {(props.children ?? []).map(ref =>
        typeof ref === 'string' ? (
          <React.Fragment key={ref}>{buildChild(ref)}</React.Fragment>
        ) : null,
      )}
    </div>
  ),
);

const catalog = new Catalog<ReactComponentImplementation>('host-element-test', '0.9', [
  Label,
  Counter,
  List,
]);

/** A surface whose root lists two labels (`a`, `b`) and a counter. */
function createSurface(id: string): SurfaceModel<ReactComponentImplementation> {
  const surface = new SurfaceModel<ReactComponentImplementation>(id, catalog);
  const add = (componentId: string, type: string, props: Record<string, unknown>) =>
    surface.componentsModel.addComponent(new ComponentModel(componentId, type, props, catalog));
  add('root', 'HostList', {children: ['a', 'b', 'counter']});
  add('a', 'HostLabel', {text: 'A'});
  add('b', 'HostLabel', {text: 'B'});
  add('counter', 'HostCounter', {});
  return surface;
}

/** Renders `surface` and returns the host React created for component `id`. */
function renderSurface(surface: SurfaceModel<ReactComponentImplementation>) {
  const view = render(<A2uiSurface surface={surface} />);
  const hostOf = (id: string): ReactHostElement => {
    const host = [...view.container.querySelectorAll('*')].find(
      (element): element is ReactHostElement =>
        element.localName.startsWith('a2ui-react-') &&
        (element as ReactHostElement).context?.componentModel.id === id,
    );
    if (!host) throw new Error(`No host for ${id}.`);
    return host;
  };
  return {view, hostOf};
}

const resolvers: NodeResolver<ReactComponentImplementation>[] = [];

/** The node of component `id`, resolved by a resolver of the test's own. */
function nodeOf(
  surface: SurfaceModel<ReactComponentImplementation>,
  id: string,
): ComponentNode<ReactComponentImplementation> {
  const resolver = new NodeResolver(surface, surface.defaultCatalog);
  resolvers.push(resolver);
  const visit = (value: unknown): ComponentNode<ReactComponentImplementation> | undefined => {
    if (isComponentNode(value)) {
      return value.componentId === id
        ? (value as ComponentNode<ReactComponentImplementation>)
        : visit(peekValue(value.props));
    }
    if (value instanceof ResolvedBinding) return visit(value.value);
    if (Array.isArray(value)) return value.map(visit).find(Boolean);
    if (value && typeof value === 'object') return Object.values(value).map(visit).find(Boolean);
    return undefined;
  };
  const node = visit(peekValue(resolver.rootNode));
  if (!node) throw new Error(`No node for ${id}.`);
  return node;
}

/** Creates a detached host element holding the node of component `id`. */
function createHost(
  tagName: string,
  surface: SurfaceModel<ReactComponentImplementation>,
  id: string,
): ReactHostElement {
  const host = document.createElement(tagName) as ReactHostElement;
  host.node = nodeOf(surface, id);
  return host;
}

/** Appends a container to the document; removed in `afterEach`. */
function appendContainer(): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

/** Lets deferred host unregistration (a microtask) run. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Unmount the surfaces before detaching the hosts they portal into.
  cleanup();
  document.body.textContent = '';
  for (const resolver of resolvers.splice(0)) resolver.dispose();
});

describe('toWebComponent', () => {
  it('names the host element after the implementation', () => {
    const SimpleButton = createComponentImplementation(
      {name: 'SimpleButton', schema: z.object({label: z.string()})},
      ({props}) => <button>{props.label}</button>,
    );

    const hosted = toWebComponent(SimpleButton);

    expect(hosted.tagName).toBe('a2ui-react-simplebutton');
    // The entry keeps rendering as before; only the element is added.
    expect(hosted).toMatchObject({
      name: 'SimpleButton',
      render: SimpleButton.render,
      view: SimpleButton.view,
    });
    expect(SimpleButton).not.toHaveProperty('tagName');
  });

  it('returns an entry that already names its element as is', () => {
    const handWritten: ReactComponentImplementation = {
      name: 'HandWrittenHost',
      schema: z.object({}),
      render: () => null,
    };
    const ownElement: ReactComponentImplementation & WebComponentImplementation = {
      ...handWritten,
      name: 'OwnElement',
      tagName: 'own-element',
      element: class extends HTMLElement {},
    };

    const hosted = toWebComponent(handWritten);
    expect(hosted.tagName).toBe('a2ui-react-handwrittenhost');
    expect(toWebComponent(handWritten)).toBe(hosted);
    expect(toWebComponent(hosted)).toBe(hosted);
    expect(toWebComponent(ownElement)).toBe(ownElement);
  });

  it('suffixes the tag names of implementations that share a name', () => {
    const api = {name: 'MultiCollision', schema: z.object({})};
    const first = createComponentImplementation(api, () => <div>1</div>);
    const second = createComponentImplementation(api, () => <div>2</div>);
    const third = createComponentImplementation(api, () => <div>3</div>);

    expect(toWebComponent(first).tagName).toBe('a2ui-react-multicollision');
    expect(toWebComponent(second).tagName).toBe('a2ui-react-multicollision-2');
    expect(toWebComponent(third).tagName).toBe('a2ui-react-multicollision-3');
  });

  it('does not define the host element until it renders', () => {
    const Late = createComponentImplementation({name: 'LateDefined', schema: z.object({})}, () => (
      <span data-testid="late">late</span>
    ));
    const lateCatalog = new Catalog<ReactComponentImplementation>('late-test', '0.9', [Late]);
    const surface = new SurfaceModel<ReactComponentImplementation>('surf-late', lateCatalog);
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'LateDefined', {}, lateCatalog),
    );

    expect(customElements.get('a2ui-react-latedefined')).toBeUndefined();

    const view = render(<A2uiSurface surface={surface} />);

    expect(customElements.get('a2ui-react-latedefined')).toBe(toWebComponent(Late).element);
    expect(within(view.container).getByTestId('late')).toHaveTextContent('late');
  });

  it('creates implementations without touching customElements', () => {
    vi.stubGlobal('customElements', undefined);

    const bound = createComponentImplementation(
      {name: 'NoRegistry', schema: z.object({})},
      () => null,
    );
    const binderless = createBinderlessComponentImplementation(
      {name: 'NoRegistryBinderless', schema: z.object({})},
      () => null,
    );

    expect(toWebComponent(bound).tagName).toBe('a2ui-react-noregistry');
    expect(toWebComponent(binderless).tagName).toBe('a2ui-react-noregistrybinderless');
  });
});

describe('prepareCatalogs', () => {
  it('replaces every React entry of every catalog with its web component form, once', () => {
    const Plain: ReactComponentImplementation = {
      name: 'PreparedPlain',
      schema: z.object({}),
      render: () => null,
    };
    const foreign: WebComponentImplementation = {
      name: 'PreparedForeign',
      schema: z.object({}),
      tagName: 'prepared-foreign',
      element: class extends HTMLElement {},
    };
    const defaultCatalog = new Catalog<ReactComponentImplementation>('prepared-default', '0.9', [
      Plain,
    ]);
    const extra = new Catalog<ReactComponentImplementation>('prepared-extra', '0.9', [
      Label,
      foreign as unknown as ReactComponentImplementation,
    ]);
    const surface = new SurfaceModel<ReactComponentImplementation>(
      'surf-prepared',
      defaultCatalog,
      new Map([
        [defaultCatalog.id, defaultCatalog],
        [extra.id, extra],
      ]),
    );

    prepareCatalogs(surface);

    expect(defaultCatalog.components.get('PreparedPlain')).toBe(toWebComponent(Plain));
    expect(extra.components.get('HostLabel')).toBe(toWebComponent(Label));
    expect(extra.components.get('PreparedForeign')).toBe(foreign);

    const after = [...defaultCatalog.components.values(), ...extra.components.values()];
    prepareCatalogs(surface);
    expect([...defaultCatalog.components.values(), ...extra.components.values()]).toEqual(after);
  });
});

describe('React host element', () => {
  beforeAll(() => {
    for (const implementation of catalog.components.values()) {
      registerUniversalElement(toWebComponent(implementation));
    }
  });

  it('uses display: contents once connected', () => {
    const host = document.createElement(toWebComponent(Label).tagName);
    appendContainer().appendChild(host);

    expect(host.style.display).toBe('contents');
  });

  it("holds the node React hands it, and the node's context", () => {
    const surface = createSurface('surf-props');
    const {hostOf} = renderSurface(surface);

    const host = hostOf('a');

    expect(host.localName).toBe('a2ui-react-hostlabel');
    expect(host.node?.componentId).toBe('a');
    expect(host.node?.dataPath).toBe('/');
    expect(host.context).toBe(host.node?.context);
  });

  it('registers with its surface once connected with a node, and unregisters after disconnect', async () => {
    const surface = createSurface('surf-register');
    const registry = HostRegistry.forSurface(surface);
    const host = document.createElement(toWebComponent(Label).tagName) as ReactHostElement;
    const container = appendContainer();

    container.appendChild(host);
    expect(registry.has(host)).toBe(false);

    host.node = nodeOf(surface, 'a');
    expect(registry.has(host)).toBe(true);

    host.remove();
    // Unregistration waits a microtask, in case the host is only being moved.
    expect(registry.has(host)).toBe(true);
    await flushMicrotasks();
    expect(registry.has(host)).toBe(false);
  });

  it('does not register while detached', () => {
    const surface = createSurface('surf-detached');
    const host = document.createElement(toWebComponent(Label).tagName) as ReactHostElement;
    host.node = nodeOf(surface, 'a');

    expect(HostRegistry.forSurface(surface).has(host)).toBe(false);
  });

  it('moves to the registry of the surface its new node belongs to', () => {
    const first = createSurface('surf-first');
    const second = createSurface('surf-second');
    const host = document.createElement(toWebComponent(Label).tagName) as ReactHostElement;
    appendContainer().appendChild(host);
    host.node = nodeOf(first, 'a');

    host.node = nodeOf(second, 'a');

    expect(HostRegistry.forSurface(first).has(host)).toBe(false);
    expect(HostRegistry.forSurface(second).has(host)).toBe(true);
  });

  it('receives its content from the A2uiSurface of its surface', () => {
    const surface = createSurface('surf-portal');
    renderSurface(surface);
    const host = createHost(toWebComponent(Label).tagName, surface, 'a');

    act(() => {
      appendContainer().appendChild(host);
    });

    expect(within(host).getByTestId('label')).toHaveTextContent('A');
  });

  it('re-renders its content when it is handed another node', () => {
    const surface = createSurface('surf-node');
    renderSurface(surface);
    const host = createHost(toWebComponent(Label).tagName, surface, 'a');
    act(() => {
      appendContainer().appendChild(host);
    });
    expect(within(host).getByTestId('label')).toHaveTextContent('A');

    act(() => {
      host.node = nodeOf(surface, 'b');
    });

    expect(within(host).getByTestId('label')).toHaveTextContent('B');
  });

  it('keeps React state when moved to another parent', async () => {
    const surface = createSurface('surf-move');
    renderSurface(surface);
    const from = appendContainer();
    const to = appendContainer();
    const host = createHost(toWebComponent(Counter).tagName, surface, 'counter');

    act(() => {
      from.appendChild(host);
    });

    fireEvent.click(within(host).getByTestId('counter'));
    expect(within(host).getByTestId('counter')).toHaveTextContent('count:1');

    to.appendChild(host);
    await flushMicrotasks();

    expect(HostRegistry.forSurface(surface).has(host)).toBe(true);
    expect(within(to).getByTestId('counter')).toHaveTextContent('count:1');
    expect(from.childElementCount).toBe(0);
  });
});
