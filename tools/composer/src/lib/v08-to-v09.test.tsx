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

import {StrictMode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {type ReactCatalogComponent} from '@a2ui/react';
import {
  type A2uiMessage,
  MessageProcessor,
  RELAXED_VALIDATION,
  STRICT_VALIDATION,
} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {cleanup, render, renderHook, waitFor} from '@testing-library/react';

import {useA2UISurface} from '@/components/theater/useA2UISurface';
import {V08_GALLERY_WIDGETS} from '@/data/gallery/v08';
import {scenarios} from '@/data/theater';
import {COMPONENTS_DATA} from '@/lib/components-data';
import type {A2UIComponent} from '@/types/widget';

import {normalizeV08Surface, remapRootComponent} from './v08-to-v09';
import {V09Viewer} from './v09Viewer';

const CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

function processNormalizedStrict(normalized: ReturnType<typeof normalizeV08Surface>) {
  const processor = new MessageProcessor<ReactCatalogComponent>([basicCatalog], undefined, {
    validationConfig: STRICT_VALIDATION,
  });
  const messages: A2uiMessage[] = [
    {
      version: 'v0.9',
      createSurface: {surfaceId: 'strict-test', catalogId: CATALOG_ID},
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'strict-test',
        components: normalized.components,
      },
    },
  ];
  if (Object.keys(normalized.data).length > 0) {
    messages.push({
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'strict-test',
        path: '/',
        value: normalized.data,
      },
    });
  }
  processor.processMessages(messages);
  return processor.model.getSurface('strict-test');
}

describe('normalizeV08Surface and V09Viewer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('converts all 18 v0.8 basic catalog component primitives to strict v0.9 schemas', () => {
    const components: A2UIComponent[] = [
      {
        id: 'main-col',
        component: {
          Column: {
            distribution: 'spaceBetween',
            alignment: 'stretch',
            children: {
              explicitList: [
                'row-1',
                'list-1',
                'card-1',
                'tabs-1',
                'divider-1',
                'modal-1',
                'video-1',
                'audio-1',
                'checkbox-1',
                'textfield-1',
                'datetime-1',
                'choice-1',
                'slider-1',
              ],
            },
          },
        },
      },
      {
        id: 'row-1',
        weight: 2,
        component: {
          Row: {
            distribution: 'center',
            alignment: 'center',
            children: {explicitList: ['text-1', 'img-1', 'icon-enum', 'icon-custom']},
          },
        },
      },
      {
        id: 'text-1',
        component: {Text: {text: {literalString: 'Heading'}, usageHint: 'h2'}},
      },
      {
        id: 'img-1',
        component: {
          Image: {
            url: {literalString: 'https://example.com/pic.png'},
            altText: {literalString: 'Sample image'},
            fit: 'scale-down',
            usageHint: 'avatar',
          },
        },
      },
      {
        id: 'icon-enum',
        component: {Icon: {name: {literalString: 'arrow_back'}}},
      },
      {
        id: 'icon-custom',
        component: {Icon: {name: {literalString: 'smartphone'}}},
      },
      {
        id: 'list-1',
        component: {
          List: {
            direction: 'horizontal',
            alignment: 'start',
            children: {explicitList: ['list-item-text']},
          },
        },
      },
      {
        id: 'list-item-text',
        component: {Text: {text: {literalString: 'Item'}}},
      },
      {
        id: 'card-1',
        component: {Card: {child: 'btn-1'}},
      },
      {
        id: 'btn-1',
        component: {
          Button: {
            child: 'btn-label',
            primary: true,
            action: {
              name: 'submit_form',
              context: [
                {key: 'user', value: {path: '/user/name'}},
                {key: 'count', value: {literalNumber: 3}},
              ],
            },
          },
        },
      },
      {
        id: 'btn-label',
        component: {Text: {text: {literalString: 'Submit'}}},
      },
      {
        id: 'tabs-1',
        component: {
          Tabs: {
            tabItems: [
              {title: {literalString: 'Tab A'}, child: 'tab-a-body'},
              {title: {literalString: 'Tab B'}, child: 'tab-b-body'},
            ],
          },
        },
      },
      {
        id: 'tab-a-body',
        component: {Text: {text: {literalString: 'Body A'}}},
      },
      {
        id: 'tab-b-body',
        component: {Text: {text: {literalString: 'Body B'}}},
      },
      {
        id: 'divider-1',
        component: {Divider: {axis: 'horizontal', thickness: 2}},
      },
      {
        id: 'modal-1',
        component: {Modal: {entryPointChild: 'modal-trigger', contentChild: 'modal-body'}},
      },
      {
        id: 'modal-trigger',
        component: {Button: {child: 'modal-trigger-label', action: {name: 'open'}}},
      },
      {
        id: 'modal-trigger-label',
        component: {Text: {text: {literalString: 'Open Modal'}}},
      },
      {
        id: 'modal-body',
        component: {Text: {text: {literalString: 'Modal Content'}}},
      },
      {
        id: 'video-1',
        component: {Video: {url: {literalString: 'https://example.com/v.mp4'}}},
      },
      {
        id: 'audio-1',
        component: {
          AudioPlayer: {
            url: {literalString: 'https://example.com/a.mp3'},
            description: {literalString: 'Podcast'},
          },
        },
      },
      {
        id: 'checkbox-1',
        component: {
          CheckBox: {
            label: {literalString: 'Accept terms'},
            value: {literalBoolean: true},
          },
        },
      },
      {
        id: 'textfield-1',
        component: {
          TextField: {
            label: {literalString: 'Birth Date'},
            text: {literalString: '2026-01-01'},
            textFieldType: 'date',
          },
        },
      },
      {
        id: 'datetime-1',
        component: {
          DateTimeInput: {
            value: {literalString: '2026-05-01T12:00'},
            enableDate: true,
            enableTime: true,
          },
        },
      },
      {
        id: 'choice-1',
        component: {
          MultipleChoice: {
            selections: {literalArray: ['a']},
            options: [
              {label: {literalString: 'Option A'}, value: 'a'},
              {label: {literalString: 'Option B'}, value: 'b'},
            ],
            maxAllowedSelections: 1,
            variant: 'chips',
            filterable: true,
          },
        },
      },
      {
        id: 'slider-1',
        component: {
          Slider: {
            label: {literalString: 'Volume'},
            value: {literalNumber: 40},
            minValue: 10,
          },
        },
      },
    ];

    const normalized = normalizeV08Surface({
      root: 'main-col',
      components,
      data: {user: {name: 'Ada'}},
    });

    const byId = new Map(normalized.components.map(c => [c.id, c]));
    expect(byId.get('root')?.component).toBe('Column');
    expect(byId.get('row-1')?.['weight']).toBe(2);
    expect(byId.get('img-1')?.['description']).toBe('Sample image');
    expect(byId.get('img-1')?.['fit']).toBe('scaleDown');
    expect(byId.get('icon-enum')?.['name']).toBe('arrowBack');
    expect(byId.get('icon-custom')?.['name']).toEqual({path: '/__a2ui_icons/icon-custom'});
    expect(byId.get('btn-1')?.['variant']).toBe('primary');
    expect(byId.get('btn-1')?.['action']).toEqual({
      event: {name: 'submit_form', context: {user: {path: '/user/name'}, count: 3}},
    });
    expect(byId.get('choice-1')?.component).toBe('ChoicePicker');
    expect(byId.get('choice-1')?.['variant']).toBe('mutuallyExclusive');
    expect(byId.get('choice-1')?.['displayStyle']).toBe('chips');
    expect(byId.get('textfield-1')?.['variant']).toBe('shortText');
    expect(byId.get('textfield-1')?.['value']).toBe('2026-01-01');
    expect(byId.get('slider-1')?.['min']).toBe(10);
    expect(byId.get('slider-1')?.['max']).toBe(100);

    const surface = processNormalizedStrict(normalized);
    expect(surface).toBeDefined();
    expect(surface?.componentsModel.get('root')?.type).toBe('Column');
  });

  it('remaps custom root ID without colliding when another component is named root', () => {
    const remapped = remapRootComponent('page-card', [
      {id: 'page-card', component: 'Card', child: 'root'},
      {id: 'root', component: 'Text', text: 'Nested child'},
    ]);

    expect(remapped).toEqual([
      {id: 'root', component: 'Card', child: '__displaced_root'},
      {id: '__displaced_root', component: 'Text', text: 'Nested child'},
    ]);
  });

  it('converts template valueMap objects to arrays and relativizes template item paths without mutating input data', () => {
    const originalData = {
      headerTitle: 'Top Spots',
      items: {
        item1: {name: 'Bistro One'},
        item2: {name: 'Cafe Two'},
      },
    };
    const snapshotBefore = JSON.stringify(originalData);

    const normalized = normalizeV08Surface({
      root: 'list-root',
      components: [
        {
          id: 'list-root',
          component: {
            Column: {
              children: {explicitList: ['heading', 'item-list']},
            },
          },
        },
        {
          id: 'heading',
          component: {Text: {text: {path: '/headerTitle'}}},
        },
        {
          id: 'item-list',
          component: {
            List: {
              children: {template: {componentId: 'item-row', dataBinding: '/items'}},
            },
          },
        },
        {
          id: 'item-row',
          component: {
            Row: {
              children: {explicitList: ['item-name', 'item-global-ref']},
            },
          },
        },
        {
          id: 'item-name',
          component: {Text: {text: {path: '/name'}}},
        },
        {
          id: 'item-global-ref',
          component: {Text: {text: {path: '/headerTitle'}}},
        },
      ],
      data: originalData,
    });

    expect(JSON.stringify(originalData)).toBe(snapshotBefore);
    expect(normalized.data['items']).toEqual([{name: 'Bistro One'}, {name: 'Cafe Two'}]);

    const byId = new Map(normalized.components.map(c => [c.id, c]));
    expect(byId.get('item-name')?.['text']).toEqual({path: 'name'});
    expect(byId.get('item-global-ref')?.['text']).toEqual({path: '/headerTitle'});

    const surface = processNormalizedStrict(normalized);
    expect(surface).toBeDefined();
  });

  it('validates every V08_GALLERY_WIDGETS entry against strict v0.9 MessageProcessor', () => {
    expect(V08_GALLERY_WIDGETS.length).toBe(35);
    for (const entry of V08_GALLERY_WIDGETS) {
      const {widget} = entry;
      const normalized = normalizeV08Surface({
        root: widget.root,
        components: widget.components,
        data: widget.dataStates[0]?.data ?? {},
      });
      const surface = processNormalizedStrict(normalized);
      expect(
        surface,
        `Expected gallery widget ${widget.id} to produce a valid surface`,
      ).toBeDefined();
    }
  });

  it('validates every COMPONENTS_DATA preview against v0.9 MessageProcessor', () => {
    const docsWithPreview = COMPONENTS_DATA.flatMap(cat => cat.components).filter(
      doc => doc.preview !== undefined,
    );
    expect(docsWithPreview.length).toBe(18);

    for (const doc of docsWithPreview) {
      const preview = doc.preview!;
      const normalized = normalizeV08Surface({
        root: preview.root,
        components: preview.components,
        data: preview.data ?? {},
      });
      const processor = new MessageProcessor<ReactCatalogComponent>([basicCatalog], undefined, {
        validationConfig: RELAXED_VALIDATION,
      });
      processor.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: doc.name, catalogId: CATALOG_ID}},
        {
          version: 'v0.9',
          updateComponents: {surfaceId: doc.name, components: normalized.components},
        },
        ...(Object.keys(normalized.data).length > 0
          ? [
              {
                version: 'v0.9' as const,
                updateDataModel: {surfaceId: doc.name, path: '/', value: normalized.data},
              },
            ]
          : []),
      ]);
      expect(processor.model.getSurface(doc.name)).toBeDefined();
    }
  });

  it('dispatches button actions through V09Viewer without recreating the surface on callback updates', async () => {
    const normalized = normalizeV08Surface({
      root: 'btn-root',
      components: [
        {
          id: 'btn-root',
          component: {
            Button: {
              child: 'btn-text',
              primary: true,
              action: {
                name: 'book_table',
                context: [{key: 'guests', value: {path: '/partySize'}}],
              },
            },
          },
        },
        {
          id: 'btn-text',
          component: {Text: {text: {literalString: 'Reserve'}}},
        },
      ],
      data: {partySize: 4},
    });

    const firstOnAction = vi.fn();
    const secondOnAction = vi.fn();
    const {container, rerender} = render(
      <V09Viewer
        root={normalized.root}
        components={normalized.components}
        data={normalized.data}
        onAction={firstOnAction}
      />,
    );

    const buttonHost = await waitFor(() => {
      const el = container.querySelector('a2ui-basic-button');
      expect(el).not.toBeNull();
      return el!;
    });

    rerender(
      <V09Viewer
        root={normalized.root}
        components={normalized.components}
        data={normalized.data}
        onAction={secondOnAction}
      />,
    );

    expect(container.querySelector('a2ui-basic-button')).toBe(buttonHost);
    const innerButton = await waitFor(() => {
      const btn = buttonHost.querySelector('button');
      expect(btn).not.toBeNull();
      return btn!;
    });
    innerButton.click();

    await waitFor(() => {
      expect(secondOnAction).toHaveBeenCalledTimes(1);
    });
    expect(firstOnAction).toHaveBeenCalledTimes(0);
    expect(secondOnAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'book_table',
        context: {guests: 4},
      }),
    );
  });

  it('processes all curated theater scenarios and renders V09Viewer under React StrictMode', () => {
    const entries = Object.entries(scenarios);
    expect(entries.length).toBe(4);
    for (const [scenarioId, rawMessages] of entries) {
      const {result} = renderHook(() => useA2UISurface(rawMessages as unknown[]));

      const normalized = normalizeV08Surface({
        root: result.current.root,
        components: result.current.components,
        data: result.current.data,
      });

      const onAction = vi.fn();
      const {container, unmount} = render(
        <StrictMode>
          <V09Viewer
            root={normalized.root}
            components={normalized.components}
            data={normalized.data}
            onAction={onAction}
            className={`theater-${scenarioId}`}
          />
        </StrictMode>,
      );

      const wrapper = container.querySelector(`.theater-${scenarioId}`);
      expect(wrapper).not.toBeNull();
      expect(wrapper?.children.length).toBe(1);
      unmount();
    }
  });
});
