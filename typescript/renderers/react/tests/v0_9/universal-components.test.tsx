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
import {act, fireEvent, render, waitFor, within} from '@testing-library/react';
import React, {createContext, useContext, useLayoutEffect, useRef} from 'react';
import {z} from 'zod';
import {
  Catalog,
  CommonSchemas,
  ComponentIdSchema,
  ComponentModel,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import type {A2uiWebComponentElement} from '@a2ui/web_core/v0_9/universal';
import {basicCatalog as webCoreBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  A2uiSurface,
  createComponentImplementation,
  type ReactCatalogComponent,
  type ReactComponentImplementation,
} from '../../src';
import type {ReactHostElement} from '../../src/catalog/react_host_element';

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

const ThemedPanel = createComponentImplementation(
  {name: 'ThemedPanel', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild}) => (
    <Theme.Provider value="from panel">
      {props.child ? buildChild(props.child) : null}
    </Theme.Provider>
  ),
);

const Thrower = createComponentImplementation({name: 'Thrower', schema: z.object({})}, () => {
  throw new Error('nested component failed');
});

/** A clickable React wrapper that counts its own clicks. */
const clicks = new Map<string, number>();
const Clicker = createComponentImplementation(
  {name: 'Clicker', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild, context}) => (
    <div
      data-testid={`clicker-${context.componentModel.id}`}
      onClick={() =>
        clicks.set(context.componentModel.id, (clicks.get(context.componentModel.id) ?? 0) + 1)
      }
    >
      {props.child ? buildChild(props.child) : null}
    </div>
  ),
);

/** Records what its layout effect finds inside its child's host on mount. */
const layoutLog: string[] = [];
const Measurer = createComponentImplementation(
  {name: 'Measurer', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild}) => {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      layoutLog.push(`measurer: ${ref.current?.firstElementChild?.childElementCount ?? 'none'}`);
    }, []);
    return <div ref={ref}>{props.child ? buildChild(props.child) : null}</div>;
  },
);
const LoggingBadge = createComponentImplementation(
  {name: 'LoggingBadge', schema: z.object({})},
  () => {
    useLayoutEffect(() => {
      layoutLog.push('badge');
    }, []);
    return <span data-testid="logging-badge">badge</span>;
  },
);

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
  override state: {error: Error | null} = {error: null};
  static getDerivedStateFromError(error: Error) {
    return {error};
  }
  override render() {
    return this.state.error ? (
      <div data-testid="caught">{`caught: ${this.state.error.message}`}</div>
    ) : (
      this.props.children
    );
  }
}

/** A catalog component that is itself an error boundary around its child. */
const Guarded = createComponentImplementation(
  {name: 'Guarded', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild}) => (
    <CatchBoundary>{props.child ? buildChild(props.child) : null}</CatchBoundary>
  ),
);

/** web_core's Lit column and list, which render their children by tag name. */
const Column = webCoreBasicCatalog.components.get('Column')!;
const List = webCoreBasicCatalog.components.get('List')!;

const catalog = new Catalog<ReactCatalogComponent>('mixed', '0.9', [
  Badge,
  Panel,
  Themed,
  ThemedPanel,
  Thrower,
  Clicker,
  Measurer,
  LoggingBadge,
  Guarded,
  HandPanel,
  Column,
  List,
]);

afterEach(() => {
  vi.restoreAllMocks();
  clicks.clear();
  layoutLog.length = 0;
});

function surfaceWith(id: string, ...components: ComponentModel[]) {
  const surface = new SurfaceModel<ReactCatalogComponent>(id, catalog);
  for (const component of components) {
    surface.componentsModel.addComponent(component);
  }
  return surface;
}

describe('mixed React and Web Component catalogs', () => {
  it('renders a Web Component root as its element, carrying the context', () => {
    const surface = surfaceWith(
      'wc-root',
      new ComponentModel('root', 'Column', {children: []}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    const element = container.firstElementChild as A2uiWebComponentElement;
    expect(element.tagName.toLowerCase()).toBe('a2ui-basic-column');
    expect(element.context?.componentModel.id).toBe('root');
  });

  it('renders a React child inside its host under a React parent', () => {
    const surface = surfaceWith(
      'react-under-react',
      new ComponentModel('root', 'Panel', {child: 'badge-1'}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: 'React inside React'}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(
      container.querySelector('a2ui-react-panel > [data-testid="panel"] > a2ui-react-badge > span'),
    ).toHaveTextContent('React inside React');
  });

  it('renders a React child inside its host under a Lit parent', async () => {
    const surface = surfaceWith(
      'react-under-lit',
      new ComponentModel('root', 'Column', {children: ['badge-1']}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: 'React inside Lit'}, catalog),
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
      new ComponentModel('root', 'Panel', {child: 'column-1'}, catalog),
      new ComponentModel('column-1', 'Column', {children: []}, catalog),
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
      new ComponentModel('root', 'Panel', {child: 'column-1'}, catalog),
      new ComponentModel('column-1', 'Column', {children: ['badge-1']}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: 'three levels'}, catalog),
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
      new ComponentModel('root', 'Column', {children: ['panel-1']}, catalog),
      new ComponentModel('panel-1', 'Panel', {child: 'column-2'}, catalog),
      new ComponentModel('column-2', 'Column', {children: ['badge-1']}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: 'lit, react, lit'}, catalog),
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
      new ComponentModel('root', 'HandPanel', {child: 'column-1'}, catalog),
      new ComponentModel('column-1', 'Column', {children: ['badge-1']}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: 'hand, lit, factory'}, catalog),
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
      new ComponentModel('root', 'Column', {children: ['panel-1']}, catalog),
      new ComponentModel('panel-1', 'Panel', {child: 'hand-1'}, catalog),
      new ComponentModel('hand-1', 'HandPanel', {child: 'badge-1'}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: 'lit, factory, hand'}, catalog),
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
      new ComponentModel('root', 'Column', {children: ['hand-1']}, catalog),
      new ComponentModel('hand-1', 'HandPanel', {}, catalog),
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
      new ComponentModel('root', 'Column', {children: ['themed-1']}, catalog),
      new ComponentModel('themed-1', 'Themed', {}, catalog),
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
      new ComponentModel('root', 'Column', {children: ['thrower-1']}, catalog),
      new ComponentModel('thrower-1', 'Thrower', {}, catalog),
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

/**
 * Each React host's content portals the hosts below it, so the React tree
 * nests like the DOM: what a component provides, catches or listens for
 * applies to the components it renders, through any Lit component in between.
 */
describe('the React tree nests like the DOM', () => {
  it('passes a provider from a component to a child under a Lit component', async () => {
    const surface = surfaceWith(
      'provider-through-component',
      new ComponentModel('root', 'ThemedPanel', {child: 'col'}, catalog),
      new ComponentModel('col', 'Column', {children: ['themed-1']}, catalog),
      new ComponentModel('themed-1', 'Themed', {}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(await within(container).findByTestId('themed')).toHaveTextContent('from panel');
  });

  it('dispatches a React event once to each handler above the target', async () => {
    const surface = surfaceWith(
      'events-through-hosts',
      new ComponentModel('root', 'Clicker', {child: 'mid'}, catalog),
      new ComponentModel('mid', 'Clicker', {child: 'col'}, catalog),
      new ComponentModel('col', 'Column', {children: ['leaf']}, catalog),
      new ComponentModel('leaf', 'Clicker', {child: 'badge-1'}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: 'click me'}, catalog),
    );
    let above = 0;
    const {container} = render(
      <div
        onClick={() => {
          above++;
        }}
      >
        <A2uiSurface surface={surface} />
      </div>,
    );
    const badge = await within(container).findByTestId('badge');

    await act(async () => {
      fireEvent.click(badge);
    });

    expect([...clicks]).toEqual([
      ['leaf', 1],
      ['mid', 1],
      ['root', 1],
    ]);
    expect(above).toBe(1);
  });

  it('lets a component that is an error boundary catch a throw from its child', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const surface = surfaceWith(
      'boundary-in-component',
      new ComponentModel('root', 'Panel', {child: 'guard'}, catalog),
      new ComponentModel('guard', 'Guarded', {child: 'thrower-1'}, catalog),
      new ComponentModel('thrower-1', 'Thrower', {}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(await within(container).findByTestId('caught')).toHaveTextContent(
      'caught: nested component failed',
    );
    expect(container.querySelector('[data-testid="panel"] [data-testid="caught"]')).not.toBeNull();
  });

  it("mounts a React child's content before its parent's layout effect, as React does", async () => {
    const surface = surfaceWith(
      'layout-order-react',
      new ComponentModel('root', 'Measurer', {child: 'badge-1'}, catalog),
      new ComponentModel('badge-1', 'LoggingBadge', {}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);
    await within(container).findByTestId('logging-badge');

    expect(layoutLog).toEqual(['badge', 'measurer: 1']);
  });

  it("mounts a child's content under a Lit component after its parent's layout effect", async () => {
    const surface = surfaceWith(
      'layout-order-lit',
      new ComponentModel('root', 'Measurer', {child: 'col'}, catalog),
      new ComponentModel('col', 'Column', {children: ['badge-1']}, catalog),
      new ComponentModel('badge-1', 'LoggingBadge', {}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);
    await within(container).findByTestId('logging-badge');

    // The Lit column renders its children, and so creates the child's host,
    // after the parent has committed; the child's content follows the host.
    expect(layoutLog).toEqual(['measurer: 0', 'badge']);
  });
});

describe('React hosts under a Lit parent', () => {
  it('receive their node from the Lit parent', async () => {
    const surface = surfaceWith(
      'walk-finds-node',
      new ComponentModel('root', 'Column', {children: ['badge-1']}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: 'found'}, catalog),
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
      new ComponentModel('root', 'Column', {children: ['badge-1']}, catalog),
    );
    const {container} = render(<A2uiSurface surface={surface} />);
    expect(container.querySelector('a2ui-react-badge > span')).toBeNull();

    await act(async () => {
      surface.componentsModel.addComponent(
        new ComponentModel('badge-1', 'Badge', {label: 'arrived late'}, catalog),
      );
    });

    await waitFor(() => {
      expect(container.querySelector('a2ui-react-badge > span')).toHaveTextContent('arrived late');
    });
  });

  it('re-renders when the data a found node binds to changes', async () => {
    const surface = surfaceWith(
      'walk-data-change',
      new ComponentModel('root', 'Column', {children: ['badge-1']}, catalog),
      new ComponentModel('badge-1', 'Badge', {label: {path: '/label'}}, catalog),
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
      new ComponentModel(
        'root',
        'List',
        {children: {componentId: 'item', path: '/items'}},
        catalog,
      ),
      new ComponentModel('item', 'Badge', {label: {path: 'name'}}, catalog),
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
