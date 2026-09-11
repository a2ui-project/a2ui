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
 * Rendering a catalog that mixes native React components and Web Components.
 *
 * The catalog holds one of each: a React `Badge` and a `Panel` built through
 * `createComponentImplementation`, and web_core's `Column`, whose Lit
 * implementation resolves its children by tag name.
 */

import {describe, it, expect} from 'vitest';
import {render, screen} from '@testing-library/react';
import React from 'react';
import {z} from 'zod';
import {
  Catalog,
  CommonSchemas,
  ComponentIdSchema,
  ComponentModel,
  SurfaceModel,
  isWebComponentImplementation,
  type A2uiWebComponentElement,
} from '@a2ui/web_core/v0_9';
import {basicCatalog as webCoreBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiSurface, createComponentImplementation} from '../../src/v0_9';
import type {ReactCatalogComponent} from '../../src/v0_9/react_component_implementation';

const Badge = createComponentImplementation(
  {name: 'Badge', schema: z.object({label: CommonSchemas.DynamicString.optional()})},
  ({props}) => <span data-testid="badge">{String(props.label ?? '')}</span>,
);

const Panel = createComponentImplementation(
  {name: 'Panel', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild}) => (
    <div data-testid="panel">{props.child ? buildChild(props.child as string) : null}</div>
  ),
);

/** web_core's Lit column, which resolves its children through the DOM. */
const Column = webCoreBasicCatalog.components.get('Column')!;

function surfaceWith(
  id: string,
  ...components: ComponentModel[]
): SurfaceModel<ReactCatalogComponent> {
  const catalog = new Catalog<ReactCatalogComponent>('mixed', [Badge, Panel, Column], []);
  const surface = new SurfaceModel<ReactCatalogComponent>(id, catalog);
  for (const component of components) {
    surface.componentsModel.addComponent(component);
  }
  return surface;
}

describe('mixed React and Web Component catalogs', () => {
  it('registers a custom element for every React implementation', () => {
    expect(Badge.tagName).toBe('a2ui-react-badge');
    expect(customElements.get('a2ui-react-badge')).toBeDefined();
  });

  it('renders a React implementation through its view', async () => {
    const surface = surfaceWith(
      'react-root',
      new ComponentModel('root', 'Badge', {label: 'Native React'}),
    );

    render(<A2uiSurface surface={surface} />);

    expect(await screen.findByTestId('badge')).toHaveTextContent('Native React');
  });

  it('renders a Web Component implementation as its element, carrying the context', async () => {
    const surface = surfaceWith('wc-root', new ComponentModel('root', 'Column', {children: []}));

    const {container} = render(<A2uiSurface surface={surface} />);

    expect(isWebComponentImplementation(Column)).toBe(true);
    const element = container.querySelector<A2uiWebComponentElement>('a2ui-basic-column');
    expect(element).not.toBeNull();
    expect(element!.context?.componentModel.id).toBe('root');
  });

  it('renders a Web Component child under a React parent', async () => {
    const surface = surfaceWith(
      'wc-under-react',
      new ComponentModel('root', 'Panel', {child: 'column-1'}),
      new ComponentModel('column-1', 'Column', {children: []}),
    );

    render(<A2uiSurface surface={surface} />);

    const panel = await screen.findByTestId('panel');
    expect(panel.querySelector('a2ui-basic-column')).not.toBeNull();
  });

  it('renders a React child under a Web Component parent', async () => {
    const surface = surfaceWith(
      'react-under-wc',
      new ComponentModel('root', 'Column', {children: ['badge-1']}),
      new ComponentModel('badge-1', 'Badge', {label: 'React inside Lit'}),
    );

    render(<A2uiSurface surface={surface} />);

    expect(await screen.findByTestId('badge')).toHaveTextContent('React inside Lit');
  });
});
