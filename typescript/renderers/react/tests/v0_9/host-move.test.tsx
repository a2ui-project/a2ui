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

import {act, fireEvent, render, screen} from '@testing-library/react';
import React, {useState} from 'react';
import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {Catalog, CommonSchemas, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';
import {basicCatalog as webCoreBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {createComponentImplementation, type ReactCatalogComponent} from '../../src';
import {A2uiSurface} from '../../src/A2uiSurface';
import {toWebComponent} from '../../src/catalog/to_web_component';
import {HostRegistry} from '../../src/host_registry';

const StatefulCounterImpl = createComponentImplementation(
  {name: 'StatefulCounter', schema: z.object({label: CommonSchemas.DynamicString.optional()})},
  ({props}) => {
    const [count, setCount] = useState(0);
    return (
      <button data-testid="stateful-counter" onClick={() => setCount(c => c + 1)}>
        {`${String(props.label ?? 'Count')}: ${count}`}
      </button>
    );
  },
);

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('toWebComponent host element move within one task', () => {
  it('preserves portal React state when a host element is reparented synchronously', async () => {
    const catalog = new Catalog<ReactCatalogComponent>('host-move-test', '0.9', [
      StatefulCounterImpl,
      webCoreBasicCatalog.components.get('List')!,
    ]);
    const surface = new SurfaceModel<ReactCatalogComponent>('surf-host-move', catalog);
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'List', {children: ['counter1']}, catalog),
    );
    surface.componentsModel.addComponent(
      new ComponentModel('counter1', 'StatefulCounter', {label: 'Clicks'}, catalog),
    );

    const {container} = render(<A2uiSurface surface={surface} />);
    await flushMicrotasks();

    const hostTag = toWebComponent(StatefulCounterImpl).tagName;
    const hostEl = container.querySelector(hostTag) as HTMLElement | null;
    expect(hostEl).not.toBeNull();
    expect(HostRegistry.forSurface(surface).entries()).toHaveLength(1);

    const button = screen.getByTestId('stateful-counter');
    expect(button).toHaveTextContent('Clicks: 0');

    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveTextContent('Clicks: 2');

    // Move the custom element host to a new wrapper inside the same container
    // within a single task (synchronously triggering disconnectedCallback and
    // connectedCallback before the deferred microtask runs).
    const parentContainer = hostEl!.parentElement!;
    const newParent = document.createElement('div');
    newParent.setAttribute('data-testid', 'new-host-parent');
    parentContainer.appendChild(newParent);

    act(() => {
      newParent.appendChild(hostEl!);
    });
    await flushMicrotasks();

    // The host remains registered and the portal's internal React state survives.
    expect(newParent.contains(hostEl)).toBe(true);
    expect(HostRegistry.forSurface(surface).entries()).toHaveLength(1);
    const movedButton = screen.getByTestId('stateful-counter');
    expect(movedButton).toHaveTextContent('Clicks: 2');

    fireEvent.click(movedButton);
    expect(movedButton).toHaveTextContent('Clicks: 3');
  });
});
