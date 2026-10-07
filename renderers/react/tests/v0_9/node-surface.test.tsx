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

import {describe, it, expect, beforeEach} from 'vitest';
import React, {createContext, useContext} from 'react';
import {render, screen, act, fireEvent, within} from '@testing-library/react';
import {z} from 'zod';
import {
  Catalog,
  CommonSchemas,
  ComponentModel,
  NodeResolver,
  SurfaceModel,
  ChildListSchema,
  ComponentIdSchema,
  getValue,
  type A2uiClientAction,
} from '@a2ui/web_core/v0_9';
import {
  createComponentImplementation,
  type ReactCatalogComponent,
  type ReactComponentImplementation,
} from '../../src';

import type {ReactHostElement} from '../../src/catalog/react_host_element';
import {toWebComponent} from '../../src/catalog/to_web_component';
import {A2uiSurface} from '../../src/A2uiSurface';
import {HostRegistry} from '../../src/host_registry';
import {basicCatalog as webCoreBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';

/** View render counts, keyed per component instance. */
const renders = new Map<string, number>();
function bump(key: string): void {
  renders.set(key, (renders.get(key) ?? 0) + 1);
}
function rendersOf(key: string): number {
  return renders.get(key) ?? 0;
}

/** The tag of the host element `implementation` renders inside. */
function tagOf(implementation: ReactComponentImplementation): string {
  return toWebComponent(implementation).tagName;
}

const TextImpl = createComponentImplementation(
  {name: 'Text', schema: z.object({text: CommonSchemas.DynamicString.optional()})},
  ({props, context}) => {
    bump(`Text:${context.componentModel.id}@${context.dataContext.path}`);
    return <span>{String(props.text ?? '')}</span>;
  },
);

const ColumnImpl = createComponentImplementation(
  {name: 'Column', schema: z.object({children: ChildListSchema.optional()})},
  ({props, buildChild, context}) => {
    bump(`Column:${context.componentModel.id}`);
    const children = props.children as Array<string | {id: string; basePath: string}> | undefined;
    return (
      <div>
        {Array.isArray(children)
          ? children.map((ref, index) =>
              typeof ref === 'string' ? (
                <React.Fragment key={`${ref}-${index}`}>{buildChild(ref)}</React.Fragment>
              ) : (
                <React.Fragment key={`${ref.id}-${ref.basePath}`}>
                  {buildChild(ref.id, ref.basePath)}
                </React.Fragment>
              ),
            )
          : null}
      </div>
    );
  },
);

const CardImpl = createComponentImplementation(
  {name: 'Card', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild, context}) => {
    bump(`Card:${context.componentModel.id}`);
    return <div>{props.child ? buildChild(props.child as string) : null}</div>;
  },
);

const TextFieldImpl = createComponentImplementation(
  {name: 'TextField', schema: z.object({value: CommonSchemas.DynamicString.optional()})},
  ({props, context}) => {
    bump(`TextField:${context.componentModel.id}@${context.dataContext.path}`);
    // The missing optional chaining is deliberate: shipped input views call
    // their setters unguarded.
    const setValue = (props as {setValue: (value: string) => void}).setValue;
    return (
      <input
        data-testid={`input-${context.dataContext.path}`}
        data-setter={typeof setValue}
        value={String(props.value ?? '')}
        onChange={event => setValue(event.target.value)}
      />
    );
  },
);

const ButtonImpl = createComponentImplementation(
  {name: 'Button', schema: z.object({action: CommonSchemas.Action.optional()})},
  ({props, context}) => {
    bump(`Button:${context.componentModel.id}`);
    return (
      <button
        data-testid={`btn-${context.componentModel.id}`}
        onClick={() => (props.action as (() => void) | undefined)?.()}
      >
        go
      </button>
    );
  },
);

/** Renders its own node's instanceId, making node identity visible in the DOM. */
const ProbeImpl: ReactComponentImplementation = {
  name: 'Probe',
  schema: z.object({}),
  render: () => <span>probe</span>,
  view: ({node}) => <span>{`id:${node.instanceId}`}</span>,
};

// A factory-created implementation with `view` removed: the shape an older
// catalog holds, rendering through ReactWrapper and MemoizedRender.
const factoryItem = createComponentImplementation(
  {name: 'FactoryItem', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild}) => <div>{props.child ? buildChild(props.child as string) : null}</div>,
);
const FactoryRenderOnlyImpl: ReactComponentImplementation = {
  name: factoryItem.name,
  schema: factoryItem.schema,
  render: factoryItem.render,
};

const DashCollidingScoperImpl: ReactComponentImplementation = {
  name: 'DashCollidingScoper',
  schema: z.object({first: ComponentIdSchema.optional(), second: ComponentIdSchema.optional()}),
  render: ({buildChild}) => (
    <div>
      {buildChild('a', '/b-/c')}
      {buildChild('a-/b', '/c')}
    </div>
  ),
};

const CollidingScoperImpl: ReactComponentImplementation = {
  name: 'CollidingScoper',
  schema: z.object({first: ComponentIdSchema.optional(), second: ComponentIdSchema.optional()}),
  render: ({buildChild}) => (
    <div>
      {buildChild('kid@x', '/y')}
      {buildChild('kid', 'x@/y')}
    </div>
  ),
};

/** Render-only: no `view`, reads raw component ids from the model. */
const RawItemImpl: ReactComponentImplementation = {
  name: 'RawItem',
  schema: z.object({
    child: ComponentIdSchema.optional(),
    children: ChildListSchema.optional(),
  }),
  render: ({context, buildChild}) => {
    const properties = context.componentModel.properties;
    const childId = properties.child as string | undefined;
    const childIds = properties.children as string[] | undefined;
    return (
      <div>
        {childId ? buildChild(childId) : null}
        {Array.isArray(childIds)
          ? childIds.map((id, index) => (
              <React.Fragment key={`${id}-${index}`}>{buildChild(id)}</React.Fragment>
            ))
          : null}
      </div>
    );
  },
};

/**
 * A child reference typed as a bare string, which is what a catalog gets when
 * it replaces `ComponentIdSchema`'s description instead of using `componentId()`.
 * The resolver cannot identify the property, so the id reaches `buildChild`.
 */
const UnmarkedParentImpl = createComponentImplementation(
  {name: 'UnmarkedParent', schema: z.object({child: z.string().optional()})},
  ({props, buildChild}) => <div>{props.child ? buildChild(props.child as string) : null}</div>,
);

const Theme = createContext('no provider');
const PanelTheme = createContext('no panel provider');

/** Reads React context, to show what reaches a nested component. */
const ThemedImpl = createComponentImplementation({name: 'Themed', schema: z.object({})}, () => {
  const theme = useContext(Theme);
  const panelTheme = useContext(PanelTheme);
  return <span data-testid="themed">{`${theme}/${panelTheme}`}</span>;
});

/** Provides React context around its child, which reaches the child. */
const PanelImpl = createComponentImplementation(
  {name: 'Panel', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild}) => (
    <PanelTheme.Provider value="from panel">
      {props.child ? buildChild(props.child as string) : null}
    </PanelTheme.Provider>
  ),
);

function setup() {
  const catalog = new Catalog<ReactComponentImplementation>('node-react-test', '0.9', [
    TextImpl,
    ColumnImpl,
    CardImpl,
    ButtonImpl,
    TextFieldImpl,
    ProbeImpl,
    RawItemImpl,
    FactoryRenderOnlyImpl,
    CollidingScoperImpl,
    DashCollidingScoperImpl,
    UnmarkedParentImpl,
    ThemedImpl,
    PanelImpl,
  ]);
  const surface = new SurfaceModel<ReactComponentImplementation>('surf-1', catalog);
  return surface;
}

/**
 * A surface whose `List` is web_core's Lit list, a parent that creates its
 * children's hosts itself. Only such hosts register; React renders the
 * content of its own hosts as children.
 */
function setupWithLitList() {
  const catalog = new Catalog<ReactCatalogComponent>('node-react-lit-test', '0.9', [
    TextImpl,
    webCoreBasicCatalog.components.get('List')!,
  ]);
  return new SurfaceModel<ReactCatalogComponent>('surf-lit', catalog);
}

function add(surface: SurfaceModel, id: string, type: string, props: Record<string, unknown>) {
  const catalog = surface.defaultCatalog;
  if (!catalog) throw new Error('add() needs a surface with a default catalog');
  surface.componentsModel.addComponent(new ComponentModel(id, type, props, catalog));
}

beforeEach(() => {
  renders.clear();
});

/** Lets deferred host unregistration (a microtask) run. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('A2uiSurface', () => {
  it('renders a resolved tree end to end', () => {
    const surface = setup();
    add(surface, 'root', 'Column', {children: ['greeting', 'card1']});
    add(surface, 'greeting', 'Text', {text: 'Hello'});
    add(surface, 'card1', 'Card', {child: 'inner'});
    add(surface, 'inner', 'Text', {text: 'Inner'});

    render(<A2uiSurface surface={surface} />);

    expect(screen.getByText('Hello')).toBeDefined();
    expect(screen.getByText('Inner')).toBeDefined();
  });

  it('re-renders only the component whose data changed', () => {
    const surface = setup();
    surface.dataModel.set('/username', 'Alice');
    add(surface, 'root', 'Column', {children: ['static', 'bound']});
    add(surface, 'static', 'Text', {text: 'Static'});
    add(surface, 'bound', 'Text', {text: {path: '/username'}});

    render(<A2uiSurface surface={surface} />);
    expect(screen.getByText('Alice')).toBeDefined();

    const columnBefore = rendersOf('Column:root');
    const staticBefore = rendersOf('Text:static@/');
    const boundBefore = rendersOf('Text:bound@/');

    act(() => {
      surface.dataModel.set('/username', 'Bob');
    });

    expect(screen.getByText('Bob')).toBeDefined();
    expect(rendersOf('Text:bound@/')).toBe(boundBefore + 1);
    expect(rendersOf('Text:static@/')).toBe(staticBefore);
    expect(rendersOf('Column:root')).toBe(columnBefore);
  });

  it('shows a placeholder for a missing component and upgrades it in place', () => {
    const surface = setup();
    add(surface, 'root', 'Column', {children: ['late']});

    render(<A2uiSurface surface={surface} />);
    expect(screen.getByText(/Loading late/)).toBeDefined();

    act(() => {
      add(surface, 'late', 'Text', {text: 'Arrived'});
    });

    expect(screen.queryByText(/Loading late/)).toBeNull();
    expect(screen.getByText('Arrived')).toBeDefined();
  });

  it('renders template children and keeps existing items mounted on append', () => {
    const surface = setup();
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'item', path: '/items'}});
    add(surface, 'item', 'Text', {text: {path: 'name'}});

    render(<A2uiSurface surface={surface} />);
    expect(screen.getByText('A')).toBeDefined();
    expect(screen.getByText('B')).toBeDefined();

    const item0Before = rendersOf('Text:item@/items/0');
    const item1Before = rendersOf('Text:item@/items/1');

    act(() => {
      surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}, {name: 'C'}]);
    });

    expect(screen.getByText('C')).toBeDefined();
    expect(rendersOf('Text:item@/items/0')).toBe(item0Before);
    expect(rendersOf('Text:item@/items/1')).toBe(item1Before);
  });

  it('dispatches actions with context resolved at click time', async () => {
    const surface = setup();
    const actions: A2uiClientAction[] = [];
    surface.onAction.subscribe(action => {
      actions.push(action);
    });
    surface.dataModel.set('/current_id', 'stale');
    add(surface, 'root', 'Button', {
      action: {event: {name: 'submit', context: {itemId: {path: '/current_id'}}}},
    });

    render(<A2uiSurface surface={surface} />);

    act(() => {
      surface.dataModel.set('/current_id', 'fresh');
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-root'));
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.name).toBe('submit');
    expect(actions[0]?.context).toEqual({itemId: 'fresh'});
  });

  it('builds children for an implementation that has render but no view', () => {
    // The shape `ReactComponentImplementation` documents as supported: `render`
    // is required and `view` is optional. `render` receives ids from the
    // component model, so this pins that they still resolve.
    const RenderOnly: ReactComponentImplementation = {
      name: 'RenderOnly',
      schema: z.object({child: ComponentIdSchema.optional()}),
      render: ({context, buildChild}) => {
        const childId = context.componentModel.properties.child as string | undefined;
        return <div>{childId ? buildChild(childId) : null}</div>;
      },
    };
    const catalog = new Catalog<ReactComponentImplementation>('render-only', '0.9', [
      RenderOnly,
      TextImpl,
    ]);
    const surface = new SurfaceModel<ReactComponentImplementation>('surf-render-only', catalog);
    add(surface, 'root', 'RenderOnly', {child: 'kid'});
    add(surface, 'kid', 'Text', {text: 'child of a render-only parent'});

    render(<A2uiSurface surface={surface} />);

    expect(screen.getByText('child of a render-only parent')).toBeDefined();
  });

  it('renders children declared as a plain array of component ids', () => {
    // z.array(ComponentIdSchema): the marker sits on the elements, not the
    // property. The resolver classifies it as a child list.
    const PlainList = createComponentImplementation(
      {name: 'PlainList', schema: z.object({children: z.array(ComponentIdSchema).optional()})},
      ({props, buildChild}) => (
        <div>
          {Array.isArray(props.children)
            ? (props.children as string[]).map(id => (
                <React.Fragment key={id}>{buildChild(id)}</React.Fragment>
              ))
            : null}
        </div>
      ),
    );
    const catalog = new Catalog<ReactComponentImplementation>('plain-list', '0.9', [
      PlainList,
      TextImpl,
    ]);
    const surface = new SurfaceModel<ReactComponentImplementation>('surf-plain-list', catalog);
    add(surface, 'root', 'PlainList', {children: ['a', 'b']});
    add(surface, 'a', 'Text', {text: 'first child'});
    add(surface, 'b', 'Text', {text: 'second child'});

    render(<A2uiSurface surface={surface} />);

    expect(screen.getByText('first child')).toBeDefined();
    expect(screen.getByText('second child')).toBeDefined();
    expect(screen.queryByText(/Unresolved child reference/)).toBeNull();
  });

  it('reports an unmarked child reference and names the schema fix', () => {
    const surface = setup();
    const errors: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      errors.push(e as Record<string, unknown>);
    });
    add(surface, 'root', 'UnmarkedParent', {child: 'kid'});
    add(surface, 'kid', 'Text', {text: 'never reached'});

    render(<A2uiSurface surface={surface} />);

    expect(screen.getByText(/does not mark the referencing property/)).toBeDefined();
    expect(screen.queryByText('never reached')).toBeNull();
    const reported = errors.filter(e => e.code === 'UNRESOLVED_CHILD_REFERENCE');
    expect(reported).toHaveLength(1);
    expect(String(reported[0]?.message)).toContain('componentId()');
  });

  it('reports unresolved references after render, so error subscribers may set state', async () => {
    const surface = setup();
    add(surface, 'root', 'UnmarkedParent', {child: 'lost'});
    add(surface, 'lost', 'Text', {text: 'x'});

    // A subscriber that sets state would trigger React's cannot-update
    // warning if the report were dispatched during render.
    const ErrorCounter: React.FC = () => {
      const [count, setCount] = React.useState(0);
      React.useEffect(() => {
        const sub = surface.onError.subscribe(() => setCount(c => c + 1));
        return () => sub.unsubscribe();
      }, []);
      return <span>{`errors:${count}`}</span>;
    };

    const warnings: string[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(String(args[0]));
    };
    try {
      render(
        <>
          <ErrorCounter />
          <A2uiSurface surface={surface} />
        </>,
      );
      expect(await screen.findByText('errors:1')).toBeDefined();
    } finally {
      console.error = consoleError;
    }
    expect(warnings.filter(w => w.includes('Cannot update a component'))).toHaveLength(0);
  });

  it('reports a buildChild call for a data path the payload never created', () => {
    // A marked single ref resolves at the parent's path; asking for another
    // path names the instances that do exist instead of blaming the schema.
    const Scoper: ReactComponentImplementation = {
      name: 'Scoper',
      schema: z.object({child: ComponentIdSchema.optional()}),
      render: ({context, buildChild}) => {
        const childId = context.componentModel.properties.child as string | undefined;
        return <div>{childId ? buildChild(childId, '/somewhere/else') : null}</div>;
      },
    };
    const catalog = new Catalog<ReactComponentImplementation>('scoper', '0.9', [Scoper, TextImpl]);
    const surface = new SurfaceModel<ReactComponentImplementation>('surf-scoper', catalog);
    add(surface, 'root', 'Scoper', {child: 'kid'});
    add(surface, 'kid', 'Text', {text: 'scoped child'});

    render(<A2uiSurface surface={surface} />);

    expect(screen.getByText(/instances exist at \//)).toBeDefined();
    expect(screen.queryByText(/does not mark the referencing property/)).toBeNull();
  });

  it('input components write scoped values through unwrapped bindings', () => {
    const surface = setup();
    surface.dataModel.set('/items', [{value: 'a'}, {value: 'b'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'field', path: '/items'}});
    add(surface, 'field', 'TextField', {value: {path: 'value'}});

    render(<A2uiSurface surface={surface} />);
    const second = screen.getByTestId('input-/items/1') as HTMLInputElement;
    expect(second.value).toBe('b');

    fireEvent.change(second, {target: {value: 'edited'}});

    expect(surface.dataModel.get('/items/1/value')).toBe('edited');
    expect((screen.getByTestId('input-/items/1') as HTMLInputElement).value).toBe('edited');
    expect(surface.dataModel.get('/items/0/value')).toBe('a');
  });

  it('renders a component whose id matches a duplicate token as its own subtree', () => {
    // A literal component named 'a#2' next to duplicates of 'a': the literal
    // is its own node, not shadowed by the second reference to 'a'.
    const surface = setup();
    add(surface, 'root', 'Column', {children: ['a#2', 'a', 'a']});
    add(surface, 'a#2', 'Probe', {});
    add(surface, 'a', 'Probe', {});

    render(<A2uiSurface surface={surface} />);
    const texts = screen.getAllByText(/^id:/).map(e => e.textContent);
    expect(texts).toEqual(['id:a~12', 'id:a', 'id:a#2']);
  });

  it('renders each duplicate child reference with its own node', () => {
    const surface = setup();
    add(surface, 'root', 'Column', {children: ['a', 'a']});
    add(surface, 'a', 'Probe', {});

    const {container} = render(<A2uiSurface surface={surface} />);

    const hosts = [...container.querySelectorAll(tagOf(ProbeImpl))] as ReactHostElement[];
    expect(hosts.map(host => host.node?.instanceId)).toEqual(['a', 'a#2']);
    expect(hosts.map(host => host.textContent)).toEqual(['id:a', 'id:a#2']);
  });

  it('tracks child arrival and removal under a factory-created render-only parent', async () => {
    // Binder props don't change when a marked child arrives, so the memoized
    // renderer must re-render on the builder's identity alone.
    const surface = setup();
    add(surface, 'root', 'FactoryItem', {child: 'late'});

    render(<A2uiSurface surface={surface} />);
    expect(screen.getByText(/Loading/)).toBeDefined();

    await act(async () => {
      add(surface, 'late', 'Text', {text: 'arrived'});
    });
    expect(screen.queryByText(/Loading/)).toBeNull();
    expect(screen.getByText('arrived')).toBeDefined();

    await act(async () => {
      surface.componentsModel.removeComponent('late');
    });
    expect(screen.queryByText('arrived')).toBeNull();
  });

  it('reports each unresolved reference pair, not conflating look-alike pairs', () => {
    const surface = setup();
    const reported: string[] = [];
    surface.onError.subscribe(e => {
      reported.push((e as {code: string}).code);
    });
    add(surface, 'root', 'CollidingScoper', {first: 'kid@x', second: 'kid'});
    add(surface, 'kid@x', 'Text', {text: 'one'});
    add(surface, 'kid', 'Text', {text: 'two'});

    render(<A2uiSurface surface={surface} />);
    expect(reported.filter(code => code === 'UNRESOLVED_CHILD_REFERENCE')).toHaveLength(2);
  });

  it('keys look-alike unresolved notices distinctly', () => {
    // ('a', '/b-/c') and ('a-/b', '/c') joined with '-' produce the same
    // React key; duplicate sibling keys transfer state across ids on
    // reorder.
    const surface = setup();
    add(surface, 'root', 'DashCollidingScoper', {first: 'a', second: 'a-/b'});
    add(surface, 'a', 'Text', {text: 'one'});
    add(surface, 'a-/b', 'Text', {text: 'two'});

    const warnings: string[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      render(<A2uiSurface surface={surface} />);
    } finally {
      console.error = consoleError;
    }
    expect(warnings.filter(w => w.includes('same key'))).toEqual([]);
  });

  it('resolves marked children of a render-only implementation inside a template', () => {
    const surface = setup();
    const reported: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      reported.push(e as Record<string, unknown>);
    });
    surface.dataModel.set('/items', [{}]);
    add(surface, 'root', 'Column', {children: {componentId: 'item', path: '/items'}});
    add(surface, 'item', 'RawItem', {child: 'kid'});
    add(surface, 'kid', 'Text', {text: 'kid text'});

    render(<A2uiSurface surface={surface} />);
    expect(screen.getByText('kid text')).toBeDefined();
    expect(reported.map(r => r.code)).toEqual([]);
  });

  it('resolves a marked child whose id looks like an occurrence token', () => {
    const surface = setup();
    const reported: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      reported.push(e as Record<string, unknown>);
    });
    add(surface, 'root', 'RawItem', {child: 'kid#2'});
    add(surface, 'kid#2', 'Text', {text: 'hash kid'});

    render(<A2uiSurface surface={surface} />);
    expect(screen.getByText('hash kid')).toBeDefined();
    expect(reported.map(r => r.code)).toEqual([]);
  });

  it('resolves raw ids and view tokens through separate namespaces', () => {
    // The token namespace assigns 'a#2' to the second occurrence of 'a'; the
    // raw id 'a#2' must still reach the component with that literal id. Raw
    // duplicate references collapse onto the first instance; a raw string
    // cannot name a later occurrence.
    const surface = setup();
    const reported: Array<Record<string, unknown>> = [];
    surface.onError.subscribe(e => {
      reported.push(e as Record<string, unknown>);
    });
    add(surface, 'root', 'RawItem', {children: ['a', 'a', 'a#2']});
    add(surface, 'a', 'Text', {text: 'alpha'});
    add(surface, 'a#2', 'Text', {text: 'literal'});

    render(<A2uiSurface surface={surface} />);
    expect(screen.getAllByText('alpha')).toHaveLength(2);
    expect(screen.getByText('literal')).toBeDefined();
    expect(reported.map(r => r.code)).toEqual([]);
  });

  it('keeps rendering a component removed before its render commits', () => {
    const surface = setup();
    // Delay the resolver's deletion delivery past the removal, as any
    // subscriber registered ahead of it does in production.
    surface.componentsModel.onDeleted.subscribe(async () => {
      await Promise.resolve();
    });
    const resolver = new NodeResolver(surface, surface.defaultCatalog);
    add(surface, 'root', 'Text', {text: 'hi'});
    const root = getValue(resolver.rootNode);
    expect(root).toBeDefined();
    surface.componentsModel.removeComponent('root');

    const View = root!.impl!.view!;
    render(<View node={root!} buildChild={() => null} />);
    expect(screen.getByText('hi')).toBeDefined();
    resolver.dispose();
  });

  it('calling a nested setter whose prop was omitted is a no-op, not a crash', () => {
    // The binder synthesized setters at every nesting level; a custom
    // catalog with an optional nested dynamic must keep that contract.
    const Grouped = createComponentImplementation(
      {
        name: 'Grouped',
        schema: z.object({
          group: z.object({value: CommonSchemas.DynamicString.optional()}).optional(),
        }),
      },
      ({props}) => {
        const group = props.group as {setValue: (v: string) => void} | undefined;
        return (
          <input
            data-testid="nested-input"
            data-setter={typeof group?.setValue}
            onChange={event => group?.setValue(event.target.value)}
          />
        );
      },
    );
    const catalog = new Catalog<ReactComponentImplementation>('grouped', '0.9', [Grouped]);
    const surface = new SurfaceModel<ReactComponentImplementation>('surf-grouped', catalog);
    add(surface, 'root', 'Grouped', {group: {}});

    render(<A2uiSurface surface={surface} />);
    const input = screen.getByTestId('nested-input');
    // A throw inside an event handler is reported, not propagated, so assert
    // the setter's existence directly.
    expect(input.dataset.setter).toBe('function');
    fireEvent.change(input, {target: {value: 'typed'}});
    expect(surface.dataModel.get('/group/value')).toBeUndefined();
  });

  it('typing into an input whose value prop was omitted is a no-op, not a crash', () => {
    const surface = setup();
    add(surface, 'root', 'TextField', {label: 'Name'});

    render(<A2uiSurface surface={surface} />);
    const input = screen.getByTestId('input-/') as HTMLInputElement;
    expect(input.dataset.setter).toBe('function');

    // A setter must exist even though the payload omitted `value`; shipped
    // views call it unguarded.
    fireEvent.change(input, {target: {value: 'typed'}});

    expect(surface.dataModel.get('/value')).toBeUndefined();
  });

  it('works under StrictMode: renders, updates, and unmounts cleanly', () => {
    const surface = setup();
    add(surface, 'root', 'Text', {text: 'strict'});

    const {unmount} = render(
      <React.StrictMode>
        <A2uiSurface surface={surface} />
      </React.StrictMode>,
    );
    expect(screen.getByText('strict')).toBeDefined();

    const rootModel = surface.componentsModel.get('root');
    expect(rootModel).toBeDefined();
    act(() => {
      if (rootModel) {
        rootModel.properties = {text: 'updated'};
      }
    });
    expect(screen.getByText('updated')).toBeDefined();

    unmount();
    expect(() => surface.dataModel.set('/x', 1)).not.toThrow();
  });

  it('unmounts cleanly and later data changes are inert', () => {
    const surface = setup();
    surface.dataModel.set('/username', 'Alice');
    add(surface, 'root', 'Text', {text: {path: '/username'}});

    const {unmount} = render(<A2uiSurface surface={surface} />);
    expect(screen.getByText('Alice')).toBeDefined();

    unmount();
    expect(() => surface.dataModel.set('/username', 'Bob')).not.toThrow();
  });
});

describe('host elements', () => {
  it('renders every node inside its host element', () => {
    const surface = setup();
    add(surface, 'root', 'Column', {children: ['greeting', 'card1']});
    add(surface, 'greeting', 'Text', {text: 'Hello'});
    add(surface, 'card1', 'Card', {child: 'inner'});
    add(surface, 'inner', 'Text', {text: 'Inner'});

    const {container} = render(<A2uiSurface surface={surface} />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.localName).toBe(tagOf(ColumnImpl));
    expect(root.style.display).toBe('contents');
    expect(
      container.querySelector(`${tagOf(ColumnImpl)} > div > ${tagOf(TextImpl)} > span`),
    ).toHaveTextContent('Hello');
    expect(
      container.querySelector(
        `${tagOf(ColumnImpl)} > div > ${tagOf(CardImpl)} > div > ${tagOf(TextImpl)} > span`,
      ),
    ).toHaveTextContent('Inner');
  });

  it('defines and renders a component from another available catalog in its host', () => {
    const ExtraImpl = createComponentImplementation({name: 'Extra', schema: z.object({})}, () => (
      <span>extra</span>
    ));
    const extraCatalog = new Catalog<ReactComponentImplementation>('node-extra-test', '0.9', [
      ExtraImpl,
    ]);
    const base = setup();
    const surface = new SurfaceModel<ReactComponentImplementation>(
      'surf-extra',
      base.defaultCatalog,
      new Map([[extraCatalog.id, extraCatalog]]),
    );
    add(surface, 'root', 'Column', {children: ['extra']});
    surface.componentsModel.addComponent(new ComponentModel('extra', 'Extra', {}, extraCatalog));

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(customElements.get(tagOf(ExtraImpl))).toBe(toWebComponent(ExtraImpl).element);
    expect(
      container.querySelector(`${tagOf(ColumnImpl)} > div > ${tagOf(ExtraImpl)} > span`),
    ).toHaveTextContent('extra');
  });

  it('renders a hand-written implementation, with no tag name or element, inside its host', () => {
    const HandWrittenImpl: ReactComponentImplementation = {
      name: 'HandWritten',
      schema: z.object({}),
      render: () => <span>hand-written</span>,
    };
    const surface = new SurfaceModel<ReactComponentImplementation>(
      'surf-hand-written',
      new Catalog<ReactComponentImplementation>('node-hand-written-test', '0.9', [HandWrittenImpl]),
    );
    add(surface, 'root', 'HandWritten', {});

    const {container} = render(<A2uiSurface surface={surface} />);

    expect('tagName' in HandWrittenImpl).toBe(false);
    expect(container.querySelector('a2ui-react-handwritten > span')).toHaveTextContent(
      'hand-written',
    );
  });

  it("hands each host its own node, and the node's context", () => {
    const surface = setup();
    surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'item', path: '/items'}});
    add(surface, 'item', 'Text', {text: {path: 'name'}});

    const {container} = render(<A2uiSurface surface={surface} />);

    const hosts = [...container.querySelectorAll(tagOf(TextImpl))] as ReactHostElement[];
    expect(hosts.map(host => host.node?.dataPath)).toEqual(['/items/0', '/items/1']);
    expect(hosts.map(host => host.context)).toEqual(hosts.map(host => host.node?.context));
    expect(hosts.map(host => host.textContent)).toEqual(['A', 'B']);
  });

  it('renders a template child added to the data later in its own host', async () => {
    const surface = setup();
    surface.dataModel.set('/items', [{name: 'A'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'item', path: '/items'}});
    add(surface, 'item', 'Text', {text: {path: 'name'}});
    const {container} = render(<A2uiSurface surface={surface} />);

    await act(async () => {
      surface.dataModel.set('/items', [{name: 'A'}, {name: 'B'}]);
    });

    const hosts = [...container.querySelectorAll(tagOf(TextImpl))];
    expect(hosts.map(host => host.textContent)).toEqual(['A', 'B']);
  });

  it('renders a child that arrives after its parent in a host once it arrives', async () => {
    const surface = setup();
    add(surface, 'root', 'Card', {child: 'late'});
    const {container} = render(<A2uiSurface surface={surface} />);
    expect(container.querySelector(tagOf(TextImpl))).toBeNull();

    await act(async () => {
      add(surface, 'late', 'Text', {text: 'Arrived'});
    });

    expect(container.querySelector(`${tagOf(CardImpl)} ${tagOf(TextImpl)}`)).toHaveTextContent(
      'Arrived',
    );
  });

  it('renders a component its parent lists twice at the same data path in both hosts', () => {
    const surface = setup();
    add(surface, 'root', 'Column', {children: ['kid', 'kid']});
    add(surface, 'kid', 'Text', {text: 'Twice'});

    const {container} = render(<A2uiSurface surface={surface} />);

    const hosts = [...container.querySelectorAll(tagOf(TextImpl))];
    expect(hosts.map(host => host.textContent)).toEqual(['Twice', 'Twice']);
  });

  it('renders a placeholder, not a host, for a component that has not arrived', () => {
    const surface = setup();
    add(surface, 'root', 'Card', {child: 'late'});

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(container.querySelector(`${tagOf(CardImpl)} > div`)).toHaveTextContent(
      '[Loading late...]',
    );
    expect(container.querySelector(tagOf(TextImpl))).toBeNull();
  });

  it('moves every registered host to the new surface when the surface prop changes', async () => {
    const first = setupWithLitList();
    add(first, 'root', 'List', {children: ['kid']});
    add(first, 'kid', 'Text', {text: 'first surface'});
    const second = setupWithLitList();
    add(second, 'root', 'List', {children: ['kid', 'kid2']});
    add(second, 'kid', 'Text', {text: 'second surface'});
    add(second, 'kid2', 'Text', {text: 'second surface'});

    const {container, rerender} = render(<A2uiSurface surface={first} />);
    await flushMicrotasks();
    expect(container).toHaveTextContent('first surface');

    rerender(<A2uiSurface surface={second} />);
    await flushMicrotasks();

    expect(container).toHaveTextContent('second surface');
    expect(container).not.toHaveTextContent('first surface');
    expect(container.querySelectorAll(tagOf(TextImpl))).toHaveLength(2);
    expect(HostRegistry.forSurface(first).entries()).toHaveLength(0);
    expect(HostRegistry.forSurface(second).entries()).toHaveLength(2);
  });

  it('unregisters every host on unmount', async () => {
    const surface = setupWithLitList();
    add(surface, 'root', 'List', {children: ['kid', 'kid2']});
    add(surface, 'kid', 'Text', {text: 'kid'});
    add(surface, 'kid2', 'Text', {text: 'kid2'});

    const {unmount} = render(<A2uiSurface surface={surface} />);
    await flushMicrotasks();
    expect(HostRegistry.forSurface(surface).entries()).toHaveLength(2);

    unmount();
    await flushMicrotasks();

    expect(HostRegistry.forSurface(surface).entries()).toHaveLength(0);
  });
});

describe('React context across hosts', () => {
  it('passes React context from a parent component to its child components', async () => {
    const surface = setup();
    add(surface, 'root', 'Panel', {child: 'themed'});
    add(surface, 'themed', 'Themed', {});

    const {container} = render(
      <Theme.Provider value="from app">
        <A2uiSurface surface={surface} />
      </Theme.Provider>,
    );

    expect(await within(container).findByTestId('themed')).toHaveTextContent('from app/from panel');
  });
});
