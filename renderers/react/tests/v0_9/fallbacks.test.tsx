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

import {describe, it, expect, vi} from 'vitest';
import {render, act} from '@testing-library/react';
import {createComponentImplementation} from '../../src/v0_9/adapter';
import {A2uiSurface} from '../../src/v0_9/A2uiSurface';
import {
  ComponentModel,
  SurfaceModel,
  Catalog,
  CommonSchemas,
  type A2uiFallbackInfo,
} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

const ParentApiDef = {
  name: 'TestParent',
  schema: z.object({child: CommonSchemas.ComponentId}),
};
const ChildApiDef = {
  name: 'TestChild',
  schema: z.object({text: CommonSchemas.DynamicString}),
};

/** Parent references a missing `child1` — the nested-pending harness from adapter.test.tsx. */
function createParentChildSurface() {
  const TestParent = createComponentImplementation(ParentApiDef, ({props, buildChild}) => (
    <div data-testid="parent">{props.child && buildChild(props.child)}</div>
  ));
  const TestChild = createComponentImplementation(ChildApiDef, ({props}) => (
    <span data-testid="resolved">{props.text}</span>
  ));
  const catalog = new Catalog('test', [TestParent, TestChild], []);
  const surface = new SurfaceModel<any>('test-surface', catalog);
  surface.componentsModel.addComponent(new ComponentModel('root', 'TestParent', {child: 'child1'}));
  return surface;
}

describe('fallbacks', () => {
  it('renders nothing by default while pending', () => {
    const surface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing by default for unknown type', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const surface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));
    surface.componentsModel.addComponent(new ComponentModel('root', 'Nope', {}));

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(container.firstChild).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('Component implementation not found for type: Nope');
    warnSpy.mockRestore();
  });

  it('renders consumer fallback for pending (root)', () => {
    const surface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));

    const {getByTestId} = render(
      <A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="spin" />}} />,
    );

    expect(getByTestId('spin')).toBeInTheDocument();
  });

  it('renders consumer fallback for pending nested child via context', () => {
    const surface = createParentChildSurface();

    const {getByTestId} = render(
      <A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="nested-spin" />}} />,
    );

    // The fallback appears INSIDE the parent — context crossed the buildChild recursion.
    expect(getByTestId('parent')).toContainElement(getByTestId('nested-spin'));
  });

  it('function-form receives the fallback info payload', () => {
    // loading: componentId flows through.
    const pendingSurface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));
    const {getByTestId} = render(
      <A2uiSurface
        surface={pendingSurface}
        fallbacks={{loading: info => <span data-testid="loading-info">{info.componentId}</span>}}
      />,
    );
    expect(getByTestId('loading-info').textContent).toBe('root');

    // unknownComponent: componentType flows through (required in the union arm).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknownSurface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));
    unknownSurface.componentsModel.addComponent(new ComponentModel('root', 'Nope', {}));
    const unknown = render(
      <A2uiSurface
        surface={unknownSurface}
        fallbacks={{
          unknownComponent: info => <span data-testid="unknown-info">{info.componentType}</span>,
        }}
      />,
    );
    expect(unknown.getByTestId('unknown-info').textContent).toBe('Nope');
    warnSpy.mockRestore();
  });

  it('clears the fallback when the component arrives', async () => {
    const surface = createParentChildSurface();

    const {getByTestId, queryByTestId} = render(
      <A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="nested-spin" />}} />,
    );

    expect(queryByTestId('nested-spin')).not.toBeNull();

    await act(async () => {
      surface.componentsModel.addComponent(
        new ComponentModel('child1', 'TestChild', {text: 'Loaded Data'}),
      );
    });

    expect(queryByTestId('nested-spin')).toBeNull();
    expect(getByTestId('resolved').textContent).toBe('Loaded Data');
  });

  it('a new fallbacks value updates a pending child', () => {
    const surface = createParentChildSurface();

    const {rerender, queryByTestId} = render(
      <A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="a" />}} />,
    );

    expect(queryByTestId('a')).not.toBeNull();

    rerender(<A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="b" />}} />);

    expect(queryByTestId('a')).toBeNull();
    expect(queryByTestId('b')).not.toBeNull();
  });

  it('providing fallbacks does not re-render resolved children', () => {
    let parentRenderCount = 0;
    let childRenderCount = 0;

    const TestParent = createComponentImplementation(ParentApiDef, ({props, buildChild}) => {
      parentRenderCount++;
      return <div data-testid="parent">{props.child && buildChild(props.child)}</div>;
    });
    const TestChild = createComponentImplementation(ChildApiDef, ({props}) => {
      childRenderCount++;
      return <span data-testid="resolved">{props.text}</span>;
    });

    const catalog = new Catalog('test', [TestParent, TestChild], []);
    const surface = new SurfaceModel<any>('test-surface', catalog);
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'TestParent', {child: 'child1'}),
    );
    surface.componentsModel.addComponent(
      new ComponentModel('child1', 'TestChild', {text: 'Loaded Data'}),
    );

    const {getByTestId, rerender} = render(
      <A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="spin" />}} />,
    );

    expect(getByTestId('resolved').textContent).toBe('Loaded Data');
    const parentCountBefore = parentRenderCount;
    const childCountBefore = childRenderCount;

    // A NEW fallbacks object identity re-evaluates DeferredChild readers only;
    // resolved subtrees are skipped by ResolvedChild's memo.
    rerender(<A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="spin" />}} />);

    expect(parentRenderCount).toBe(parentCountBefore);
    expect(childRenderCount).toBe(childCountBefore);
  });

  it('dispatches COMPONENT_NOT_FOUND once per warned type', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const surface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));
    surface.componentsModel.addComponent(new ComponentModel('root', 'Nope', {}));
    const dispatchSpy = vi.spyOn(surface, 'dispatchError');

    const {rerender} = render(
      <A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="a" />}} />,
    );

    // The dispatch runs in a post-commit effect, out of the render phase.
    await act(async () => {});
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'COMPONENT_NOT_FOUND',
        componentId: 'root',
        componentType: 'Nope',
        message: expect.stringContaining('Nope'),
      }),
    );

    // A NEW fallbacks object identity forces DeferredChild to re-render; the
    // dispatch shares the warn-once guard, so the count must not grow.
    rerender(<A2uiSurface surface={surface} fallbacks={{loading: <div data-testid="b" />}} />);

    await act(async () => {});
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    dispatchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('dispatches again for a second distinct unknown type on the same mount', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const surface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));
    surface.componentsModel.addComponent(new ComponentModel('root', 'Nope', {}));
    const dispatchSpy = vi.spyOn(surface, 'dispatchError');

    render(<A2uiSurface surface={surface} />);
    await act(async () => {});
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Replace root with a DIFFERENT unknown type: a once-EVER guard (e.g. a
    // boolean ref) would silence it; the per-type contract requires a dispatch.
    await act(async () => {
      surface.componentsModel.removeComponent('root');
      surface.componentsModel.addComponent(new ComponentModel('root', 'Nope2', {}));
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({code: 'COMPONENT_NOT_FOUND', componentType: 'Nope2'}),
    );
    dispatchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('a type flap dispatches once per distinct unknown type', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const surface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));
    surface.componentsModel.addComponent(new ComponentModel('root', 'Nope', {}));
    const dispatchSpy = vi.spyOn(surface, 'dispatchError');

    render(<A2uiSurface surface={surface} />);

    const replaceRoot = (type: string) =>
      act(async () => {
        surface.componentsModel.removeComponent('root');
        surface.componentsModel.addComponent(new ComponentModel('root', type, {}));
      });

    // Nope -> Nope2 -> Nope: returning to an already-warned type must not
    // re-dispatch, no matter how often the agent flaps between the two.
    await replaceRoot('Nope2');
    await replaceRoot('Nope');
    await act(async () => {});

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    const dispatchedTypes = dispatchSpy.mock.calls.map(([payload]) => payload['componentType']);
    expect(dispatchedTypes).toEqual(['Nope', 'Nope2']);
    dispatchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('passes parentComponentType to nested loading fallbacks', () => {
    const surface = createParentChildSurface();

    const {getByTestId} = render(
      <A2uiSurface
        surface={surface}
        fallbacks={{loading: info => <span data-testid="pinfo">{info.parentComponentType}</span>}}
      />,
    );

    expect(getByTestId('pinfo').textContent).toBe('TestParent');
  });

  it('omits parentComponentType at the root', () => {
    const surface = new SurfaceModel<any>('test-surface', new Catalog('test', [], []));
    let captured: A2uiFallbackInfo | undefined;

    render(
      <A2uiSurface
        surface={surface}
        fallbacks={{
          loading: info => {
            captured = info;
            return null;
          },
        }}
      />,
    );

    expect(captured).toBeDefined();
    // The key must be ABSENT at the root, not present with an undefined value.
    expect('parentComponentType' in captured!).toBe(false);
  });

  it('passes parentComponentType to nested unknownComponent fallbacks', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const surface = createParentChildSurface();
    surface.componentsModel.addComponent(new ComponentModel('child1', 'Nope', {}));

    const {getByTestId} = render(
      <A2uiSurface
        surface={surface}
        fallbacks={{
          unknownComponent: info => (
            <span data-testid="uinfo">{`${info.parentComponentType}:${info.componentType}`}</span>
          ),
        }}
      />,
    );

    expect(getByTestId('uinfo').textContent).toBe('TestParent:Nope');
    warnSpy.mockRestore();
  });
});
