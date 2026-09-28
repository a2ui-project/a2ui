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
 * Rendering a catalog that mixes React implementations and universal Web
 * Components.
 *
 * The catalog holds React components built through
 * `createComponentImplementation`, and web_core's `Column` and `List`, whose
 * Lit implementations render their children by tag name, handing each child
 * only its context. Whatever the parent, a React child renders inside its
 * `a2ui-react-<name>` host; under a Lit parent the host finds its node in the
 * resolved tree.
 */

import {describe, it, expect, afterEach, vi} from 'vitest';
import {act, render, waitFor, within} from '@testing-library/react';
import React, {createContext, useContext} from 'react';
import {z} from 'zod';
import {
  Catalog,
  CommonSchemas,
  ComponentIdSchema,
  ComponentModel,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {
  isWebComponentImplementation,
  type A2uiWebComponentElement,
} from '@a2ui/web_core/v0_9/universal';
import {basicCatalog as webCoreBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  A2uiSurface,
  createComponentImplementation,
  type ReactCatalogComponent,
  type ReactComponentImplementation,
} from '../../src/v0_9';
import type {ReactHostElement} from '../../src/v0_9/catalog/react_host_element';
import {toWebComponent} from '../../src/v0_9/catalog/to_web_component';

const Theme = createContext('no provider');

const Badge = createComponentImplementation(
  {name: 'Badge', schema: z.object({label: CommonSchemas.DynamicString.optional()})},
  ({props}) => <span data-testid="badge">{String(props.label ?? '')}</span>,
);

const Panel = createComponentImplementation(
  {name: 'Panel', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild}) => (
    <div data-testid="panel">{props.child ? buildChild(props.child) : null}</div>
  ),
);

const Themed = createComponentImplementation({name: 'Themed', schema: z.object({})}, () => (
  <span data-testid="themed">{useContext(Theme)}</span>
));

const Thrower = createComponentImplementation({name: 'Thrower', schema: z.object({})}, () => {
  throw new Error('nested component failed');
});

/**
 * A hand-written React implementation: a plain object, with no factory and no
 * `tagName` or `element`.
 */
const HandPanel: ReactComponentImplementation = {
  name: 'HandPanel',
  schema: z.object({child: ComponentIdSchema.optional()}),
  render: ({context, buildChild}) => {
    const child = context.componentModel.properties.child as string | undefined;
    return <div data-testid="hand-panel">{child ? buildChild(child) : null}</div>;
  },
};

/** Catches the render error of a nested component. */
class CatchBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  state: {error: Error | null} = {error: null};
  static getDerivedStateFromError(error: Error) {
    return {error};
  }
  render() {
    return this.state.error ? (
      <div data-testid="caught">{`caught: ${this.state.error.message}`}</div>
    ) : (
      this.props.children
    );
  }
}

/** web_core's Lit column and list, which render their children by tag name. */
const Column = webCoreBasicCatalog.components.get('Column')!;
const List = webCoreBasicCatalog.components.get('List')!;

const catalog = new Catalog<ReactCatalogComponent>('mixed', '0.9', [
  Badge,
  Panel,
  Themed,
  Thrower,
  HandPanel,
  Column,
  List,
]);

afterEach(() => {
  vi.restoreAllMocks();
});

function surfaceWith(id: string, ...components: ComponentModel[]) {
  const surface = new SurfaceModel<ReactCatalogComponent>(id, catalog);
  for (const component of components) {
    surface.componentsModel.addComponent(component);
  }
  return surface;
}

describe('mixed React and Web Component catalogs', () => {
  it('defines the host element of a React implementation when rendering', () => {
    const surface = surfaceWith('define-all', new ComponentModel('root', 'Badge', {label: 'x'}));

    render(<A2uiSurface surface={surface} />);

    expect(catalog.components.get('Badge')).toMatchObject({tagName: 'a2ui-react-badge'});
    expect(customElements.get('a2ui-react-badge')).toBe(toWebComponent(Badge).element);
    expect(isWebComponentImplementation(Column)).toBe(true);
  });

  it('renders a Web Component root as its element, carrying the context', () => {
    const surface = surfaceWith('wc-root', new ComponentModel('root', 'Column', {children: []}));

    const {container} = render(<A2uiSurface surface={surface} />);

    const element = container.firstElementChild as A2uiWebComponentElement;
    expect(element.tagName.toLowerCase()).toBe('a2ui-basic-column');
    expect(element.context?.componentModel.id).toBe('root');
  });

  it('renders a React child inside its host under a React parent', () => {
    const surface = surfaceWith(
      'react-under-react',
      new ComponentModel('root', 'Panel', {child: 'badge-1'}),
      new ComponentModel('badge-1', 'Badge', {label: 'React inside React'}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(
      container.querySelector('a2ui-react-panel > [data-testid="panel"] > a2ui-react-badge > span'),
    ).toHaveTextContent('React inside React');
  });

  it('renders a React child inside its host under a Lit parent', async () => {
    const surface = surfaceWith(
      'react-under-lit',
      new ComponentModel('root', 'Column', {children: ['badge-1']}),
      new ComponentModel('badge-1', 'Badge', {label: 'React inside Lit'}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(
        container.querySelector('a2ui-basic-column a2ui-react-badge > [data-testid="badge"]'),
      ).toHaveTextContent('React inside Lit');
    });
  });

  it('renders a Lit child under a React parent', () => {
    const surface = surfaceWith(
      'lit-under-react',
      new ComponentModel('root', 'Panel', {child: 'column-1'}),
      new ComponentModel('column-1', 'Column', {children: []}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    const column = container.querySelector<A2uiWebComponentElement>(
      'a2ui-react-panel > [data-testid="panel"] > a2ui-basic-column',
    );
    expect(column?.context?.componentModel.id).toBe('column-1');
  });

  it('nests React, Lit and React three levels deep', async () => {
    const surface = surfaceWith(
      'react-lit-react',
      new ComponentModel('root', 'Panel', {child: 'column-1'}),
      new ComponentModel('column-1', 'Column', {children: ['badge-1']}),
      new ComponentModel('badge-1', 'Badge', {label: 'three levels'}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(
        container.querySelector(
          'a2ui-react-panel > [data-testid="panel"] > a2ui-basic-column a2ui-react-badge > span',
        ),
      ).toHaveTextContent('three levels');
    });
  });

  it('nests Lit, React and Lit three levels deep', async () => {
    const surface = surfaceWith(
      'lit-react-lit',
      new ComponentModel('root', 'Column', {children: ['panel-1']}),
      new ComponentModel('panel-1', 'Panel', {child: 'column-2'}),
      new ComponentModel('column-2', 'Column', {children: ['badge-1']}),
      new ComponentModel('badge-1', 'Badge', {label: 'lit, react, lit'}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(
        container.querySelector(
          'a2ui-basic-column a2ui-react-panel > [data-testid="panel"] > a2ui-basic-column a2ui-react-badge > span',
        ),
      ).toHaveTextContent('lit, react, lit');
    });
  });

  it('nests a hand-written React entry, Lit and a factory React entry', async () => {
    const surface = surfaceWith(
      'hand-lit-factory',
      new ComponentModel('root', 'HandPanel', {child: 'column-1'}),
      new ComponentModel('column-1', 'Column', {children: ['badge-1']}),
      new ComponentModel('badge-1', 'Badge', {label: 'hand, lit, factory'}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(
        container.querySelector(
          'a2ui-react-handpanel > [data-testid="hand-panel"] > a2ui-basic-column a2ui-react-badge > span',
        ),
      ).toHaveTextContent('hand, lit, factory');
    });
  });

  it('nests Lit, a factory React entry and a hand-written React entry', async () => {
    const surface = surfaceWith(
      'lit-factory-hand',
      new ComponentModel('root', 'Column', {children: ['panel-1']}),
      new ComponentModel('panel-1', 'Panel', {child: 'hand-1'}),
      new ComponentModel('hand-1', 'HandPanel', {child: 'badge-1'}),
      new ComponentModel('badge-1', 'Badge', {label: 'lit, factory, hand'}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(
        container.querySelector(
          'a2ui-basic-column a2ui-react-panel > [data-testid="panel"] > a2ui-react-handpanel > [data-testid="hand-panel"] > a2ui-react-badge > span',
        ),
      ).toHaveTextContent('lit, factory, hand');
    });
  });

  it('renders a hand-written React entry directly under a Lit parent', async () => {
    const surface = surfaceWith(
      'hand-under-lit',
      new ComponentModel('root', 'Column', {children: ['hand-1']}),
      new ComponentModel('hand-1', 'HandPanel', {}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(
        container.querySelector(
          'a2ui-basic-column a2ui-react-handpanel > [data-testid="hand-panel"]',
        ),
      ).not.toBeNull();
    });
  });

  it('makes a provider above A2uiSurface visible to a React component under a Lit parent', async () => {
    const surface = surfaceWith(
      'provider-through-lit',
      new ComponentModel('root', 'Column', {children: ['themed-1']}),
      new ComponentModel('themed-1', 'Themed', {}),
    );

    const {container} = render(
      <Theme.Provider value="dark">
        <A2uiSurface surface={surface} />
      </Theme.Provider>,
    );

    expect(await within(container).findByTestId('themed')).toHaveTextContent('dark');
    expect(
      container.querySelector('a2ui-basic-column a2ui-react-themed > [data-testid="themed"]'),
    ).not.toBeNull();
  });

  it('lets an error boundary above A2uiSurface catch a throw from a component under a Lit parent', async () => {
    // React reports caught render errors through console.error.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const surface = surfaceWith(
      'boundary-through-lit',
      new ComponentModel('root', 'Column', {children: ['thrower-1']}),
      new ComponentModel('thrower-1', 'Thrower', {}),
    );

    const {container} = render(
      <CatchBoundary>
        <A2uiSurface surface={surface} />
      </CatchBoundary>,
    );

    expect(await within(container).findByTestId('caught')).toHaveTextContent(
      'caught: nested component failed',
    );
  });
});

describe('React hosts under a Lit parent', () => {
  it('receive their node from the Lit parent', async () => {
    const surface = surfaceWith(
      'walk-finds-node',
      new ComponentModel('root', 'Column', {children: ['badge-1']}),
      new ComponentModel('badge-1', 'Badge', {label: 'found'}),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(container.querySelector('a2ui-react-badge > span')).toHaveTextContent('found');
    });
    const host = container.querySelector('a2ui-react-badge') as ReactHostElement;
    expect(host.node?.componentId).toBe('badge-1');
    expect(host.context).toBe(host.node?.context);
  });

  it('renders a child that arrives after its Lit parent', async () => {
    const surface = surfaceWith(
      'walk-late-child',
      new ComponentModel('root', 'Column', {children: ['badge-1']}),
    );
    const {container} = render(<A2uiSurface surface={surface} />);
    expect(container.querySelector('a2ui-react-badge > span')).toBeNull();

    await act(async () => {
      surface.componentsModel.addComponent(
        new ComponentModel('badge-1', 'Badge', {label: 'arrived late'}),
      );
    });

    await waitFor(() => {
      expect(container.querySelector('a2ui-react-badge > span')).toHaveTextContent('arrived late');
    });
  });

  it('re-renders when the data a found node binds to changes', async () => {
    const surface = surfaceWith(
      'walk-data-change',
      new ComponentModel('root', 'Column', {children: ['badge-1']}),
      new ComponentModel('badge-1', 'Badge', {label: {path: '/label'}}),
    );
    surface.dataModel.set('/label', 'before');
    const {container} = render(<A2uiSurface surface={surface} />);
    await waitFor(() => {
      expect(container.querySelector('a2ui-react-badge > span')).toHaveTextContent('before');
    });

    act(() => {
      surface.dataModel.set('/label', 'after');
    });

    expect(container.querySelector('a2ui-react-badge > span')).toHaveTextContent('after');
  });

  it('resolves template children of a Lit List at their scoped data paths', async () => {
    const surface = surfaceWith(
      'walk-template',
      new ComponentModel('root', 'List', {children: {componentId: 'item', path: '/items'}}),
      new ComponentModel('item', 'Badge', {label: {path: 'name'}}),
    );
    surface.dataModel.set('/items', [{name: 'first'}, {name: 'second'}]);

    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(
        [...container.querySelectorAll('a2ui-list a2ui-react-badge > span')].map(
          span => span.textContent,
        ),
      ).toEqual(['first', 'second']);
    });
    const paths = [...container.querySelectorAll('a2ui-react-badge')].map(
      host => (host as ReactHostElement).node?.dataPath,
    );
    expect(paths).toEqual(['/items/0', '/items/1']);
  });
});
