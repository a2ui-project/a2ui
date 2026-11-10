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

import {type ReactCatalogComponent} from '@a2ui/react';
import {type A2uiMessage, MessageProcessor, STRICT_VALIDATION} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {cleanup, render, renderHook, waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {useA2UISurface} from '@/components/theater/useA2UISurface';
import {V08_GALLERY_WIDGETS} from '@/data/gallery/v08';
import {V09_GALLERY_WIDGETS} from '@/data/gallery/v09';
import {scenarios} from '@/data/theater';
import {COMPONENTS_DATA} from '@/lib/components-data';
import {COMPONENTS_DATA_V09} from '@/lib/components-data-v09';
import type {A2UIComponent} from '@/types/widget';
import {A2UIViewer} from './a2ui';
import {EMPTY_DATA, normalizeV08Surface, remapRootComponent} from './v08-to-v09';
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

describe('normalizeV08Surface, V09Viewer, and A2UIViewer', () => {
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

  it('remaps custom root IDs, collision counters, Tabs/Modal/template refs, and missing root states', () => {
    const remapped = remapRootComponent('page-card', [
      {id: 'page-card', component: 'Column', children: ['tabs-node', 'modal-node', 'list-node']},
      {id: 'tabs-node', component: 'Tabs', tabs: [{title: 'Main', child: 'root'}]},
      {id: 'modal-node', component: 'Modal', trigger: 'btn', content: 'root'},
      {
        id: 'list-node',
        component: 'List',
        children: {componentId: 'root', path: '/items'},
      },
      {id: 'btn', component: 'Text', text: 'Open'},
      {id: 'root', component: 'Text', text: 'Nested child'},
      {id: '__displaced_root', component: 'Text', text: 'Already taken'},
    ]);

    expect(remapped).toEqual([
      {id: 'root', component: 'Column', children: ['tabs-node', 'modal-node', 'list-node']},
      {id: 'tabs-node', component: 'Tabs', tabs: [{title: 'Main', child: '__displaced_root_1'}]},
      {id: 'modal-node', component: 'Modal', trigger: 'btn', content: '__displaced_root_1'},
      {
        id: 'list-node',
        component: 'List',
        children: {componentId: '__displaced_root_1', path: '/items'},
      },
      {id: 'btn', component: 'Text', text: 'Open'},
      {id: '__displaced_root_1', component: 'Text', text: 'Nested child'},
      {id: '__displaced_root', component: 'Text', text: 'Already taken'},
    ]);

    // When declared root has not arrived yet (e.g. '' before beginRendering), an unrelated
    // literal `'root'` component must still be displaced so it does not render as surface root.
    const preBegin = remapRootComponent('', [{id: 'root', component: 'Text', text: 'Not root'}]);
    expect(preBegin).toEqual([{id: '__displaced_root', component: 'Text', text: 'Not root'}]);
  });

  it('handles template shadowing, ./ and /item/ prefixes, nested templates, and shared template/root nodes', async () => {
    const originalData = {
      title: 'Top Banner',
      headerOnly: 'Global Subtitle',
      tags: {keepRootRecord: {untouched: true}},
      items: {
        item1: {
          title: 'Shadowed Item One',
          subtitle: 'Sub One',
          tags: {
            t1: {label: 'Spicy'},
            t2: {label: 'Popular'},
          },
        },
        item2: {
          title: 'Shadowed Item Two',
          subtitle: 'Sub Two',
          tags: {
            t3: {label: 'Vegan'},
          },
        },
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
              children: {explicitList: ['shared-title', 'item-list']},
            },
          },
        },
        {
          id: 'shared-title',
          component: {Text: {text: {path: '/title'}}},
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
            Column: {
              children: {
                explicitList: [
                  'shared-title',
                  'item-subtitle-dot',
                  'item-subtitle-prefix',
                  'item-global-ref',
                  'nested-tags',
                ],
              },
            },
          },
        },
        {
          id: 'item-subtitle-dot',
          component: {Text: {text: {path: './subtitle'}}},
        },
        {
          id: 'item-subtitle-prefix',
          component: {Text: {text: {path: '/item/subtitle'}}},
        },
        {
          id: 'item-global-ref',
          component: {Text: {text: {path: '/headerOnly'}}},
        },
        {
          id: 'nested-tags',
          component: {
            Row: {
              children: {template: {componentId: 'tag-text', dataBinding: '/tags'}},
            },
          },
        },
        {
          id: 'tag-text',
          component: {Text: {text: {path: '/label'}}},
        },
      ],
      data: originalData,
    });

    expect(JSON.stringify(originalData)).toBe(snapshotBefore);
    // Unrelated root `tags` record is preserved untouched.
    expect(normalized.data['tags']).toEqual({keepRootRecord: {untouched: true}});
    // Outer and nested template collections are converted to arrays.
    expect(normalized.data['items']).toEqual([
      {
        title: 'Shadowed Item One',
        subtitle: 'Sub One',
        tags: [{label: 'Spicy'}, {label: 'Popular'}],
      },
      {
        title: 'Shadowed Item Two',
        subtitle: 'Sub Two',
        tags: [{label: 'Vegan'}],
      },
    ]);

    const byId = new Map(normalized.components.map(c => [c.id, c]));
    // Root instance keeps absolute `/title`; cloned template instance relativizes to `title`.
    expect(byId.get('shared-title')?.['text']).toEqual({path: '/title'});
    expect(byId.get('shared-title__tmpl')?.['text']).toEqual({path: 'title'});
    expect(byId.get('item-subtitle-dot')?.['text']).toEqual({path: 'subtitle'});
    expect(byId.get('item-subtitle-prefix')?.['text']).toEqual({path: 'subtitle'});
    expect(byId.get('item-global-ref')?.['text']).toEqual({path: '/headerOnly'});
    expect(byId.get('nested-tags')?.['children']).toEqual({componentId: 'tag-text', path: 'tags'});
    expect(byId.get('tag-text')?.['text']).toEqual({path: 'label'});

    const surface = processNormalizedStrict(normalized);
    expect(surface).toBeDefined();

    const {container} = render(
      <V09Viewer
        root={normalized.root}
        components={normalized.components}
        data={normalized.data}
      />,
    );

    await waitFor(() => {
      const text = container.textContent ?? '';
      expect(text).toContain('Top Banner');
      expect(text).toContain('Shadowed Item One');
      expect(text).toContain('Shadowed Item Two');
      expect(text).toContain('Spicy');
      expect(text).toContain('Popular');
      expect(text).toContain('Vegan');
      expect(text).toContain('Global Subtitle');
    });
  });

  it('preserves two-way binding and seeds absent data for v0.8 path + literal* shorthand', async () => {
    const normalized = normalizeV08Surface({
      root: 'form',
      components: [
        {
          id: 'form',
          component: {
            Column: {
              children: {explicitList: ['guest-input', 'existing-input', 'submit-btn']},
            },
          },
        },
        {
          id: 'guest-input',
          component: {
            TextField: {
              label: {literalString: 'Guest Name'},
              text: {path: '/user/guestName', literalString: 'Guest'},
            },
          },
        },
        {
          id: 'existing-input',
          component: {
            TextField: {
              label: {literalString: 'Preset Name'},
              text: {path: '/user/presetName', literalString: 'IgnoredDefault'},
            },
          },
        },
        {
          id: 'submit-btn',
          component: {
            Button: {
              child: 'submit-label',
              action: {
                name: 'save',
                context: [{key: 'guest', value: {path: '/user/guestName'}}],
              },
            },
          },
        },
        {
          id: 'submit-label',
          component: {Text: {text: {literalString: 'Save'}}},
        },
      ],
      data: {user: {presetName: 'Alice'}},
    });

    const byId = new Map(normalized.components.map(c => [c.id, c]));
    expect(byId.get('guest-input')?.['value']).toEqual({path: '/user/guestName'});
    expect(byId.get('existing-input')?.['value']).toEqual({path: '/user/presetName'});
    expect(normalized.data).toEqual({
      user: {
        presetName: 'Alice',
        guestName: 'Guest',
      },
    });

    const onAction = vi.fn();
    const {container} = render(
      <V09Viewer
        root={normalized.root}
        components={normalized.components}
        data={normalized.data}
        onAction={onAction}
      />,
    );

    const inputEl = await waitFor(() => {
      const el = container.querySelector('a2ui-basic-textfield input') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      expect(el?.value).toBe('Guest');
      return el!;
    });

    inputEl.value = 'Grace';
    inputEl.dispatchEvent(new Event('input', {bubbles: true}));

    const btnEl = await waitFor(() => {
      const btn = container.querySelector('a2ui-basic-button button') as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      return btn!;
    });
    btnEl.click();

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'save',
          context: {guest: 'Grace'},
        }),
      );
    });
  });

  it('preserves arrays and existing primitives when seeding array-indexed path + literal* initializers', () => {
    const normalized = normalizeV08Surface({
      root: 'form',
      components: [
        {
          id: 'form',
          component: {
            Column: {
              children: {explicitList: ['tf-existing-arr', 'tf-missing-arr', 'tf-primitive-guard']},
            },
          },
        },
        {
          id: 'tf-existing-arr',
          component: {
            TextField: {
              label: {literalString: 'First'},
              text: {path: '/items/0/name', literalString: 'Guest'},
            },
          },
        },
        {
          id: 'tf-missing-arr',
          component: {
            TextField: {
              label: {literalString: 'Role'},
              text: {path: '/items/1/role', literalString: 'Member'},
            },
          },
        },
        {
          id: 'tf-primitive-guard',
          component: {
            TextField: {
              label: {literalString: 'User Subpath'},
              text: {path: '/user/name', literalString: 'Guest'},
            },
          },
        },
      ],
      data: {
        items: [{name: 'Ada'}, {name: 'Bob'}],
        user: 'ada',
      },
    });

    expect(Array.isArray(normalized.data['items'])).toBe(true);
    expect(normalized.data['items']).toEqual([{name: 'Ada'}, {name: 'Bob', role: 'Member'}]);
    expect(normalized.data['user']).toBe('ada');
    expect(processNormalizedStrict(normalized)).toBeDefined();
  });

  it('preserves v0.9 object maps, template absolute paths, and non-string Icon errors when specVersion is 0.9', () => {
    const v09Normalized = normalizeV08Surface({
      specVersion: '0.9',
      root: 'root',
      components: [
        {id: 'root', component: 'Column', children: ['direct-ref', 'tmpl-list']} as A2UIComponent,
        {
          id: 'direct-ref',
          component: 'Text',
          text: {path: '/items/k1/name'},
        } as A2UIComponent,
        {
          id: 'tmpl-list',
          component: 'List',
          children: {componentId: 'tmpl-icon', path: '/items'},
        } as A2UIComponent,
        {
          id: 'tmpl-icon',
          component: 'Icon',
          name: {path: '/iconName'},
        } as A2UIComponent,
      ],
      data: {
        iconName: 'home',
        items: {k1: {name: 'KeptInMap', iconName: 'star'}},
      },
    });

    // Object map at `/items` and absolute `/iconName` inside v0.9 template stay untouched.
    expect(v09Normalized.data['items']).toEqual({k1: {name: 'KeptInMap', iconName: 'star'}});
    const byId = new Map(v09Normalized.components.map(c => [c.id, c]));
    expect(byId.get('tmpl-icon')?.['name']).toEqual({path: '/iconName'});

    // Non-string primitive `Icon.name` is not coerced to `'info'` in v0.9 mode.
    const invalidIconNormalized = normalizeV08Surface({
      specVersion: '0.9',
      root: 'root',
      components: [{id: 'root', component: 'Icon', name: 123} as unknown as A2UIComponent],
    });
    expect(() => processNormalizedStrict(invalidIconNormalized)).toThrow();
  });

  it('converts root-only object maps referenced by nested templates', () => {
    const normalized = normalizeV08Surface({
      root: 'outer-list',
      components: [
        {
          id: 'outer-list',
          component: {
            List: {
              children: {template: {componentId: 'inner-row', dataBinding: '/items'}},
            },
          },
        },
        {
          id: 'inner-row',
          component: {
            Row: {
              children: {template: {componentId: 'tag-lbl', dataBinding: '/globalTags'}},
            },
          },
        },
        {
          id: 'tag-lbl',
          component: {Text: {text: {path: '/label'}}},
        },
      ],
      data: {
        items: {i1: {title: 'First'}},
        globalTags: {g1: {label: 'Featured'}},
      },
    });

    expect(normalized.data['items']).toEqual([{title: 'First'}]);
    expect(normalized.data['globalTags']).toEqual([{label: 'Featured'}]);
    const byId = new Map(normalized.components.map(c => [c.id, c]));
    expect(byId.get('inner-row')?.['children']).toEqual({
      componentId: 'tag-lbl',
      path: '/globalTags',
    });
    expect(byId.get('tag-lbl')?.['text']).toEqual({path: 'label'});
    expect(processNormalizedStrict(normalized)).toBeDefined();
  });

  it('normalizes MultipleChoice defaults, description labels, valueMap selections, DateTimeInput, empty Tabs, and prototype keys', () => {
    const normalized = normalizeV08Surface({
      root: 'col',
      components: [
        {
          id: 'col',
          component: {
            Column: {
              children: {
                explicitList: ['mc', 'dt', 'empty-tabs', 'act-btn', '__proto__', 'slash/tilde~id'],
              },
            },
          },
        },
        {
          id: 'mc',
          component: {
            MultipleChoice: {
              description: 'Pick tags',
              selections: {path: 'galleryData/favorites'},
              options: [
                {label: {literalString: 'Alpha'}, value: 'A'},
                {label: {literalString: 'Beta'}, value: 'B'},
              ],
            },
          },
        },
        {
          id: 'dt',
          component: {
            DateTimeInput: {
              value: {literalString: '2026-05-01T09:30'},
              enableTime: true,
            },
          },
        },
        {
          id: 'empty-tabs',
          component: {
            Tabs: {tabItems: []},
          },
        },
        {
          id: 'act-btn',
          component: {
            Button: {
              child: 'act-lbl',
              action: {
                name: 'run',
                context: JSON.parse(
                  '{"validLiteral":{"literal":"ok"},"validCall":{"call":"required","args":{"value":"ok"}},"invalidEmptyRecord":{},"__proto__":{"literalString":"safeProtoValue"}}',
                ) as Record<string, unknown>,
              },
            },
          },
        },
        {
          id: 'act-lbl',
          component: {Text: {text: {literalString: 'Go'}}},
        },
        {
          id: '__proto__',
          component: {Icon: {name: {literalString: 'smartphone'}}},
        },
        {
          id: 'slash/tilde~id',
          component: {Icon: {name: {literalString: 'laptop'}}},
        },
      ],
      data: {
        __a2ui_icons: {keep: 1},
        galleryData: {favorites: {'0': 'A'}},
      },
    });

    const byId = new Map(normalized.components.map(c => [c.id, c]));
    expect(byId.get('mc')?.['label']).toBe('Pick tags');
    expect(byId.get('mc')?.['variant']).toBe('multipleSelection');
    expect((normalized.data['galleryData'] as Record<string, unknown>)['favorites']).toEqual(['A']);

    expect(byId.get('dt')?.['enableDate']).toBe(true);
    expect(byId.get('dt')?.['enableTime']).toBe(true);
    expect(byId.get('empty-tabs')?.component).toBe('Column');

    const actionCtx = (
      (byId.get('act-btn')?.['action'] as Record<string, unknown>)['event'] as Record<
        string,
        unknown
      >
    )['context'] as Record<string, unknown>;
    expect(actionCtx['validLiteral']).toBe('ok');
    expect(actionCtx['validCall']).toEqual({call: 'required', args: {value: 'ok'}});
    expect(Object.hasOwn(actionCtx, 'invalidEmptyRecord')).toBe(false);
    expect(Object.getPrototypeOf(actionCtx)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(actionCtx, '__proto__')?.value).toBe('safeProtoValue');

    expect(byId.get('__proto__')?.['name']).toEqual({path: '/__a2ui_icons/icon___proto__'});
    expect(byId.get('slash/tilde~id')?.['name']).toEqual({
      path: '/__a2ui_icons/slash~1tilde~0id',
    });
    expect(normalized.data['__a2ui_icons']).toEqual({
      keep: 1,
      icon___proto__: 'smartphone',
      'slash/tilde~id': 'laptop',
    });

    const surface = processNormalizedStrict(normalized);
    expect(surface).toBeDefined();
  });

  it('validates all V08_GALLERY_WIDGETS, V09_GALLERY_WIDGETS, COMPONENTS_DATA, and COMPONENTS_DATA_V09 against strict v0.9 MessageProcessor', () => {
    expect(V08_GALLERY_WIDGETS.length).toBe(35);
    for (const {widget} of V08_GALLERY_WIDGETS) {
      const normalized = normalizeV08Surface({
        root: widget.root,
        components: widget.components,
        data: widget.dataStates[0]?.data,
      });
      expect(processNormalizedStrict(normalized), `V08 gallery widget ${widget.id}`).toBeDefined();
    }

    const basicComponentNames = new Set(basicCatalog.components.keys());
    expect(V09_GALLERY_WIDGETS.length).toBeGreaterThan(0);
    for (const {widget} of V09_GALLERY_WIDGETS) {
      const normalized = normalizeV08Surface({
        root: widget.root,
        components: widget.components,
        data: widget.dataStates[0]?.data,
      });
      const hasRoot = widget.components.some(c => c.id === widget.root);
      const onlyBasicComponents = normalized.components.every(c =>
        basicComponentNames.has(c.component),
      );
      if (hasRoot && onlyBasicComponents) {
        expect(
          processNormalizedStrict(normalized),
          `V09 gallery widget ${widget.id}`,
        ).toBeDefined();
      } else {
        const {unmount} = render(
          <V09Viewer
            root={normalized.root}
            components={normalized.components}
            data={normalized.data}
          />,
        );
        unmount();
      }
    }

    const v08Docs = COMPONENTS_DATA.flatMap(cat => cat.components).filter(
      doc => doc.preview !== undefined,
    );
    expect(v08Docs.length).toBe(18);
    for (const doc of v08Docs) {
      const preview = doc.preview!;
      const normalized = normalizeV08Surface({
        root: preview.root,
        components: preview.components,
        data: preview.data,
      });
      expect(
        processNormalizedStrict(normalized),
        `COMPONENTS_DATA preview ${doc.name}`,
      ).toBeDefined();
    }

    const v09Docs = COMPONENTS_DATA_V09.flatMap(cat => cat.components).filter(
      doc => doc.preview !== undefined,
    );
    expect(v09Docs.length).toBe(17);
    for (const doc of v09Docs) {
      const preview = doc.preview!;
      const normalized = normalizeV08Surface({
        root: preview.root,
        components: preview.components,
        data: preview.data,
      });
      expect(
        processNormalizedStrict(normalized),
        `COMPONENTS_DATA_V09 preview ${doc.name}`,
      ).toBeDefined();
    }
  });

  it('renders A2UIViewer in both 0.8 and 0.9 modes with non-enum icons, Markdown links, and stable DOM across omitted-data re-renders', async () => {
    // 1. V09Viewer preserves custom element identity across re-renders when `data` is omitted.
    const staticComponents = [{id: 'root', component: 'Text', text: 'Stable Node'}];
    expect(normalizeV08Surface({root: 'root', components: staticComponents}).data).toBe(EMPTY_DATA);

    const {container: stableContainer, rerender: rerenderStable} = render(
      <V09Viewer root="root" components={staticComponents} className="first" />,
    );
    const firstTextEl = await waitFor(() => {
      const el = stableContainer.querySelector('a2ui-basic-text');
      expect(el).not.toBeNull();
      return el!;
    });
    rerenderStable(<V09Viewer root="root" components={staticComponents} className="second" />);
    expect(stableContainer.querySelector('a2ui-basic-text')).toBe(firstTextEl);
    cleanup();

    // 2. A2UIViewer renders flat v0.9 non-enum icons (`check_circle`, `smartphone`) without throwing.
    const {container: v09IconContainer} = render(
      <A2UIViewer
        specVersion="0.9"
        root="icon-row"
        components={[
          {id: 'icon-row', component: 'Row', children: ['i1', 'i2']} as A2UIComponent,
          {id: 'i1', component: 'Icon', name: 'check_circle'} as A2UIComponent,
          {id: 'i2', component: 'Icon', name: 'arrow_back'} as A2UIComponent,
        ]}
      />,
    );
    await waitFor(() => {
      const icons = v09IconContainer.querySelectorAll('.a2ui-icon');
      expect(icons.length).toBe(2);
      expect(icons[0]?.textContent?.trim()).toBe('check_circle');
      expect(icons[1]?.textContent?.trim()).toBe('arrow_back');
    });
    cleanup();

    // 3. A2UIViewer renders Markdown links via @a2ui/markdown-it in v0.8 mode.
    const {container: mdContainer} = render(
      <A2UIViewer
        specVersion="0.8"
        root="md-text"
        components={[
          {
            id: 'md-text',
            component: {
              Text: {text: {literalString: 'Visit [More Info](https://example.com) today'}},
            },
          },
        ]}
      />,
    );
    await waitFor(() => {
      const link = mdContainer.querySelector('a[href="https://example.com"]');
      expect(link).not.toBeNull();
      expect(link?.textContent).toBe('More Info');
    });
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

  it('streams incremental prefixes and renders DOM content for all curated theater scenarios under React StrictMode', async () => {
    const entries = Object.entries(scenarios);
    expect(entries.length).toBe(4);

    for (const [scenarioId, rawMessages] of entries) {
      const msgs = rawMessages as unknown[];
      // Verify incremental streaming prefixes do not throw during normalization or processing.
      const stepStride = Math.max(1, Math.floor(msgs.length / 5));
      for (let step = 1; step <= msgs.length; step += stepStride) {
        const prefix = msgs.slice(0, step);
        const {result: prefixResult, unmount: unmountHook} = renderHook(() =>
          useA2UISurface(prefix),
        );
        if (prefixResult.current.components.length > 0) {
          const prefixNormalized = normalizeV08Surface({
            root: prefixResult.current.root,
            components: prefixResult.current.components,
            data: prefixResult.current.data,
          });
          const {unmount: unmountStep} = render(
            <V09Viewer
              root={prefixNormalized.root}
              components={prefixNormalized.components}
              data={prefixNormalized.data}
            />,
          );
          unmountStep();
        }
        unmountHook();
      }

      const {result, unmount: unmountFinalHook} = renderHook(() => useA2UISurface(msgs));
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

      await waitFor(() => {
        const wrapper = container.querySelector(`.theater-${scenarioId}`);
        expect(wrapper).not.toBeNull();
        expect((wrapper?.textContent ?? '').trim().length).toBeGreaterThan(0);
      });

      unmount();
      unmountFinalHook();
    }
  });
});
