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
import {render, act, waitFor} from '@testing-library/react';
import {z} from 'zod';
import {
  A2uiSurface,
  createBinderlessComponentImplementation,
  createComponentImplementation,
  type ReactCatalogComponent,
} from '../src/index';
import {Catalog, MessageProcessor} from '@a2ui/web_core';
import {CommonSchemas} from '@a2ui/web_core/v1_0';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';

const V1_0_CATALOG_ID = basicCatalog.id;

describe('A2uiSurface v1.0 & Universal Custom Elements', () => {
  it('renders a v1.0 createSurface payload with universal basicCatalog and reacts to data updates', async () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: V1_0_CATALOG_ID,
        },
      },
      {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's1',
          path: '/greeting',
          value: 'Hello v1.0 World',
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['header_text'],
            },
            {
              id: 'header_text',
              component: 'Text',
              text: {'@path': '/greeting'},
              variant: 'body',
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1')!;
    expect(surface).toBeDefined();

    const {container} = render(<A2uiSurface surface={surface} />);
    await waitFor(() => expect(container.textContent).toContain('Hello v1.0 World'));

    await act(async () => {
      processor.processMessages([
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 's1',
            path: '/greeting',
            value: 'Updated v1.0 Greeting',
          },
        },
      ]);
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(container.textContent).toContain('Updated v1.0 Greeting'));
  });

  it('renders v1.0 TextField.placeholder, Video.posterUrl, and Slider.steps with validation errors', async () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: V1_0_CATALOG_ID,
        },
      },
      {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's1',
          path: '/form',
          value: {
            name: '',
            volume: 10,
          },
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['tf1', 'vid1', 'slider1'],
            },
            {
              id: 'tf1',
              component: 'TextField',
              label: 'Full Name',
              placeholder: 'Enter your full name',
              value: {'@path': '/form/name'},
            },
            {
              id: 'vid1',
              component: 'Video',
              url: 'https://example.com/movie.mp4',
              posterUrl: 'https://example.com/poster.jpg',
            },
            {
              id: 'slider1',
              component: 'Slider',
              label: 'Volume',
              value: {'@path': '/form/volume'},
              min: 0,
              max: 100,
              steps: 20,
              checks: [
                {
                  condition: {
                    '@call': 'numeric',
                    args: {
                      value: {'@path': '/form/volume'},
                      min: 50,
                    },
                  },
                  message: 'Volume must be at least 50',
                },
              ],
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1')!;
    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      const textInput = container.querySelector(
        'a2ui-basic-textfield input',
      ) as HTMLInputElement | null;
      expect(textInput).not.toBeNull();
      expect(textInput?.getAttribute('placeholder')).toBe('Enter your full name');

      const videoEl = container.querySelector('a2ui-video video') as HTMLVideoElement | null;
      expect(videoEl).not.toBeNull();
      expect(videoEl?.getAttribute('poster')).toBe('https://example.com/poster.jpg');

      const sliderInput = container.querySelector(
        'a2ui-slider input[type="range"]',
      ) as HTMLInputElement | null;
      expect(sliderInput).not.toBeNull();
      // step = (max - min) / steps = (100 - 0) / 20 = 5
      expect(sliderInput?.getAttribute('step')).toBe('5');

      const errorEl = container.querySelector('a2ui-slider .a2ui-error-message');
      expect(errorEl).not.toBeNull();
      expect(errorEl?.textContent).toContain('Minimum value is 50.');
    });

    await act(async () => {
      surface.dataModel.set('/form/volume', 75);
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await waitFor(() =>
      expect(container.querySelector('a2ui-slider .a2ui-error-message')).toBeNull(),
    );
  });

  it('applies v1.0 accessibility ARIA attributes onto rendered elements', async () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: V1_0_CATALOG_ID,
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {
              id: 'root',
              component: 'Column',
              children: ['accessible_text', 'hidden_text'],
            },
            {
              id: 'accessible_text',
              component: 'Text',
              text: 'Status ready',
              accessibility: {
                label: 'System status',
                description: 'Indicates whether the system is ready',
                live: 'polite',
              },
            },
            {
              id: 'hidden_text',
              component: 'Text',
              text: 'Decorative text',
              accessibility: {
                hidden: true,
              },
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1')!;
    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      const textElements = container.querySelectorAll('a2ui-basic-text');
      expect(textElements.length).toBe(2);

      const accessibleEl = textElements[0]!;
      expect(accessibleEl.getAttribute('aria-label')).toBe('System status');
      expect(accessibleEl.getAttribute('aria-description')).toBe(
        'Indicates whether the system is ready',
      );
      expect(accessibleEl.getAttribute('aria-live')).toBe('polite');

      const hiddenEl = textElements[1]!;
      expect(hiddenEl.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('resolves @index in a v1.0 List template', async () => {
    const processor = new MessageProcessor([basicCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: V1_0_CATALOG_ID,
        },
      },
      {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's1',
          path: '/items',
          value: [{title: 'First'}, {title: 'Second'}, {title: 'Third'}],
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            {
              id: 'root',
              component: 'List',
              children: {
                componentId: 'row_item',
                path: '/items',
              },
            },
            {
              id: 'row_item',
              component: 'Row',
              children: ['item_index', 'item_title'],
            },
            {
              id: 'item_index',
              component: 'Text',
              text: {
                '@call': '@index',
              },
            },
            {
              id: 'item_title',
              component: 'Text',
              text: {'@path': 'title'},
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1')!;
    const {container} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(container.textContent).toContain('0');
      expect(container.textContent).toContain('First');
      expect(container.textContent).toContain('1');
      expect(container.textContent).toContain('Second');
      expect(container.textContent).toContain('2');
      expect(container.textContent).toContain('Third');
    });
  });

  it('supports mixed component trees with Universal Custom Elements and custom React components', async () => {
    const CustomReactContainer = createComponentImplementation(
      {
        name: 'CustomReactContainer',
        schema: z.object({
          title: CommonSchemas.DynamicString,
          child: CommonSchemas.ComponentId,
        }),
      },
      ({props, buildChild}) => (
        <section data-testid="custom-react-container">
          <h4>{props.title}</h4>
          <div data-testid="custom-react-container-body">{buildChild(props.child)}</div>
        </section>
      ),
    );

    const CustomBinderlessWrapper = createBinderlessComponentImplementation(
      {
        name: 'CustomBinderlessWrapper',
        schema: z.object({
          child: CommonSchemas.ComponentId,
        }),
      },
      ({context, buildChild}) => {
        const childId = context.componentModel.properties.child as string;
        return <div data-testid="custom-binderless-wrapper">{buildChild(childId)}</div>;
      },
    );

    // A2uiSurface converts the React entries to web components when it
    // prepares the surface's catalogs, so they can be hosted inside the
    // universal containers.
    const mixedComponents: ReactCatalogComponent[] = [
      ...Array.from(basicCatalog.components.values()),
      CustomReactContainer,
      CustomBinderlessWrapper,
    ];
    const mixedCatalog = new Catalog<ReactCatalogComponent>(
      'https://example.com/mixed_v1_0.json',
      '1.0',
      mixedComponents,
      Array.from(basicCatalog.functions.values()),
    );

    const processor = new MessageProcessor([mixedCatalog]);
    processor.processMessages([
      {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'https://example.com/mixed_v1_0.json',
        },
      },
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [
            // Root is a Universal Custom Element (Card -> Column)
            {
              id: 'root',
              component: 'Card',
              child: 'main_col',
            },
            {
              id: 'main_col',
              component: 'Column',
              children: ['react_box', 'binderless_box'],
            },
            // Hosted inside Universal Column: custom React container
            {
              id: 'react_box',
              component: 'CustomReactContainer',
              title: 'Inside React Container',
              child: 'inner_universal_text',
            },
            // Hosted inside CustomReactContainer via buildChild: Universal Text
            {
              id: 'inner_universal_text',
              component: 'Text',
              text: 'Universal Child Inside React',
            },
            // Hosted inside Universal Column: custom binderless React component
            {
              id: 'binderless_box',
              component: 'CustomBinderlessWrapper',
              child: 'inner_universal_btn_text',
            },
            {
              id: 'inner_universal_btn_text',
              component: 'Text',
              text: 'Universal Child Inside Binderless React',
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s1')!;
    const {container, getByTestId} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(container.querySelector('a2ui-card')).not.toBeNull();
      expect(container.querySelector('a2ui-basic-column')).not.toBeNull();

      const reactContainer = getByTestId('custom-react-container');
      expect(reactContainer.textContent).toContain('Inside React Container');
      expect(reactContainer.textContent).toContain('Universal Child Inside React');

      const binderlessWrapper = getByTestId('custom-binderless-wrapper');
      expect(binderlessWrapper.textContent).toContain('Universal Child Inside Binderless React');
    });
  });
});
