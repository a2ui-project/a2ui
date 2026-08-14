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
import {render, screen} from '@testing-library/react';
import React from 'react';
import {
  basicCatalog,
  A2uiSurface,
  A2UIProvider,
  useA2UI,
  createComponentImplementation,
} from '../../src/v0_9';
import {Catalog, ComponentModel, SurfaceModel, CommonSchemas} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

describe('React Universal Components & A2UI Provider', () => {
  it('basicCatalog provides React component implementations for backwards compatibility', () => {
    expect(basicCatalog).toBeInstanceOf(Catalog);
    const textComp = basicCatalog.components.get('Text');
    expect(textComp).toBeDefined();
    expect('render' in textComp!).toBe(true);
  });

  it('A2UIProvider provides universal component configuration via useA2UI hook', () => {
    const TestConsumer = () => {
      const config = useA2UI();
      return <div data-testid="config-value">{String(config.useUniversalComponents)}</div>;
    };

    const {rerender} = render(
      <A2UIProvider>
        <TestConsumer />
      </A2UIProvider>,
    );
    expect(screen.getByTestId('config-value').textContent).toBe('false');

    rerender(
      <A2UIProvider useUniversalComponents={true}>
        <TestConsumer />
      </A2UIProvider>,
    );
    expect(screen.getByTestId('config-value').textContent).toBe('true');
  });

  it('A2uiSurface renders native React components by default', () => {
    const surface = new SurfaceModel('surface-native', basicCatalog);
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'Text', {text: 'Native React A2UI'}),
    );

    render(<A2uiSurface surface={surface} />);
    expect(screen.getByText('Native React A2UI')).toBeDefined();
  });

  it('A2uiSurface renders universal Web Components when useUniversalComponents is true', () => {
    const surface = new SurfaceModel('surface-universal', basicCatalog);
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'Text', {text: 'Universal Web Component A2UI'}),
    );

    const {container} = render(
      <A2UIProvider useUniversalComponents={true}>
        <A2uiSurface surface={surface} />
      </A2UIProvider>,
    );
    const customEl = container.querySelector('a2ui-basic-text');
    expect(customEl).not.toBeNull();
  });

  it('renders nested container and children in universal mode', async () => {
    const surface = new SurfaceModel('surface-universal-nesting', basicCatalog);
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'Column', {children: ['greeting']}),
    );
    surface.componentsModel.addComponent(
      new ComponentModel('greeting', 'Text', {text: 'Nested text'}),
    );

    render(
      <A2UIProvider useUniversalComponents={true}>
        <A2uiSurface surface={surface} />
      </A2UIProvider>,
    );
    expect(await screen.findByText('Nested text')).toBeDefined();
  });

  it('renders custom extra components inside universal container components', async () => {
    const CustomWidget = createComponentImplementation(
      {
        name: 'CustomWidget',
        schema: z.object({label: z.string().optional()}),
      },
      ({props}) => <div data-testid="custom-widget">{props.label ?? 'Default Widget'}</div>,
    );

    const customCatalog = new Catalog(
      basicCatalog.id,
      [...basicCatalog.components.values(), CustomWidget],
      basicCatalog.functions,
    );

    const surface = new SurfaceModel('surface-custom-extra', customCatalog);
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'Column', {children: ['widget-1']}),
    );
    surface.componentsModel.addComponent(
      new ComponentModel('widget-1', 'CustomWidget', {label: 'Hello Custom Widget'}),
    );

    render(
      <A2UIProvider useUniversalComponents={true}>
        <A2uiSurface surface={surface} />
      </A2UIProvider>,
    );

    expect(await screen.findByText('Hello Custom Widget')).toBeDefined();
  });
});
