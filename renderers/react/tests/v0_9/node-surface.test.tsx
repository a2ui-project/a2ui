/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, expect, beforeEach} from 'vitest';
import React from 'react';
import {render, screen, act, fireEvent} from '@testing-library/react';
import {z} from 'zod';
import {
  Catalog,
  CommonSchemas,
  ComponentModel,
  SurfaceModel,
  componentReference,
  componentReferenceList,
  type A2uiClientAction,
} from '@a2ui/web_core/v0_9';
import {
  createComponentImplementation,
  type ReactComponentImplementation,
} from '../../src/v0_9/adapter';
import {A2uiNodeSurface} from '../../src/v0_9/A2uiNodeSurface';
import {basicCatalog} from '../../src/v0_9/catalog/basic';

/** View render counts, keyed per component instance. */
const renders = new Map<string, number>();
function bump(key: string): void {
  renders.set(key, (renders.get(key) ?? 0) + 1);
}
function rendersOf(key: string): number {
  return renders.get(key) ?? 0;
}

const TextImpl = createComponentImplementation(
  {name: 'Text', schema: z.object({text: CommonSchemas.DynamicString.optional()})},
  ({props, context}) => {
    bump(`Text:${context.componentModel.id}@${context.dataContext.path}`);
    return <span>{String(props.text ?? '')}</span>;
  },
);

const ColumnImpl = createComponentImplementation(
  {name: 'Column', schema: z.object({children: componentReferenceList().optional()})},
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
  {name: 'Card', schema: z.object({child: componentReference().optional()})},
  ({props, buildChild, context}) => {
    bump(`Card:${context.componentModel.id}`);
    return <div>{props.child ? buildChild(props.child as string) : null}</div>;
  },
);

const TextFieldImpl = createComponentImplementation(
  {name: 'TextField', schema: z.object({value: CommonSchemas.DynamicString.optional()})},
  ({props, context}) => {
    bump(`TextField:${context.componentModel.id}@${context.dataContext.path}`);
    const setValue = (props as {setValue?: (value: string) => void}).setValue;
    return (
      <input
        data-testid={`input-${context.dataContext.path}`}
        value={String(props.value ?? '')}
        onChange={event => setValue?.(event.target.value)}
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

function setup() {
  const catalog = new Catalog<ReactComponentImplementation>('node-react-test', [
    TextImpl,
    ColumnImpl,
    CardImpl,
    ButtonImpl,
    TextFieldImpl,
  ]);
  const surface = new SurfaceModel<ReactComponentImplementation>('surf-1', catalog);
  return surface;
}

function add(surface: SurfaceModel, id: string, type: string, props: Record<string, unknown>) {
  surface.componentsModel.addComponent(new ComponentModel(id, type, props));
}

beforeEach(() => {
  renders.clear();
});

describe('A2uiNodeSurface', () => {
  it('renders a resolved tree end to end', () => {
    const surface = setup();
    add(surface, 'root', 'Column', {children: ['greeting', 'card1']});
    add(surface, 'greeting', 'Text', {text: 'Hello'});
    add(surface, 'card1', 'Card', {child: 'inner'});
    add(surface, 'inner', 'Text', {text: 'Inner'});

    render(<A2uiNodeSurface surface={surface} />);

    expect(screen.getByText('Hello')).toBeDefined();
    expect(screen.getByText('Inner')).toBeDefined();
  });

  it('re-renders only the component whose data changed', () => {
    const surface = setup();
    surface.dataModel.set('/username', 'Alice');
    add(surface, 'root', 'Column', {children: ['static', 'bound']});
    add(surface, 'static', 'Text', {text: 'Static'});
    add(surface, 'bound', 'Text', {text: {path: '/username'}});

    render(<A2uiNodeSurface surface={surface} />);
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

    render(<A2uiNodeSurface surface={surface} />);
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

    render(<A2uiNodeSurface surface={surface} />);
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

    render(<A2uiNodeSurface surface={surface} />);

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

  it('renders the shipped basic catalog unchanged, via DeferredChild for unmarked refs', () => {
    const surface = new SurfaceModel<ReactComponentImplementation>('surf-basic', basicCatalog);
    add(surface, 'root', 'Column', {children: ['t1', 'card1']});
    add(surface, 't1', 'Text', {text: 'hello from nodes'});
    add(surface, 'card1', 'Card', {child: 't2'});
    add(surface, 't2', 'Text', {text: 'inside the card'});

    const {container} = render(<A2uiNodeSurface surface={surface} />);

    expect(container.textContent).toContain('hello from nodes');
    expect(container.textContent).toContain('inside the card');
  });

  it('input components write scoped values using only synthesized setters', () => {
    const surface = setup();
    surface.dataModel.set('/items', [{value: 'a'}, {value: 'b'}]);
    add(surface, 'root', 'Column', {children: {componentId: 'field', path: '/items'}});
    add(surface, 'field', 'TextField', {value: {path: 'value'}});

    render(<A2uiNodeSurface surface={surface} />);
    const second = screen.getByTestId('input-/items/1') as HTMLInputElement;
    expect(second.value).toBe('b');

    fireEvent.change(second, {target: {value: 'edited'}});

    expect(surface.dataModel.get('/items/1/value')).toBe('edited');
    expect((screen.getByTestId('input-/items/1') as HTMLInputElement).value).toBe('edited');
    expect(surface.dataModel.get('/items/0/value')).toBe('a');
  });

  it('works under StrictMode: renders, updates, and unmounts cleanly', () => {
    const surface = setup();
    add(surface, 'root', 'Text', {text: 'strict'});

    const {unmount} = render(
      <React.StrictMode>
        <A2uiNodeSurface surface={surface} />
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

    const {unmount} = render(<A2uiNodeSurface surface={surface} />);
    expect(screen.getByText('Alice')).toBeDefined();

    unmount();
    expect(() => surface.dataModel.set('/username', 'Bob')).not.toThrow();
  });
});
