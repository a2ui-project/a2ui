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

import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {COMPONENTS_DATA_V09, MATERIAL_ICONS} from './components-data-v09';
import {V09Viewer} from './v09Viewer';
import {V09_GALLERY_WIDGETS} from '@/data/gallery';
import {scenarios} from '@/data/theater';
import type {A2UIComponent} from '@/types/widget';

const CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

function validateV09Widget(
  surfaceId: string,
  root: string,
  components: A2UIComponent[],
  data: Record<string, unknown> = {},
) {
  const processor = new MessageProcessor([basicCatalog]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: CATALOG_ID,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: components.map(c => (c.id === root ? {...c, id: 'root'} : c)),
      },
    },
  ];

  if (Object.keys(data).length > 0) {
    messages.push({
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        path: '/',
        value: data,
      },
    });
  }

  processor.processMessages(messages);
  return processor.model.getSurface(surfaceId);
}

describe('v0.9 catalog schema validation across Composer static data', () => {
  it('validates all MATERIAL_ICONS against the v0.9 basic catalog Icon schema', () => {
    expect(MATERIAL_ICONS.length).toBeGreaterThan(0);
    for (const iconName of MATERIAL_ICONS) {
      const surface = validateV09Widget(`icon-${iconName}`, 'icon', [
        {id: 'icon', component: 'Icon', name: iconName},
      ]);
      expect(surface).toBeDefined();
    }
  });

  it('validates all COMPONENTS_DATA_V09 component previews', () => {
    const componentsWithPreview = COMPONENTS_DATA_V09.flatMap(category =>
      category.components.filter(comp => comp.preview),
    );
    expect(componentsWithPreview.length).toBeGreaterThan(0);

    for (const comp of componentsWithPreview) {
      const surface = validateV09Widget(
        `preview-${comp.name}`,
        comp.preview!.root,
        comp.preview!.components,
      );
      expect(surface).toBeDefined();
    }
  });

  it('validates all generated V09_GALLERY_WIDGETS including multi-message examples', () => {
    expect(V09_GALLERY_WIDGETS.length).toBeGreaterThan(0);
    for (const entry of V09_GALLERY_WIDGETS) {
      const {widget} = entry;
      expect(widget.components.length).toBeGreaterThan(0);
      const defaultData = widget.dataStates?.[0]?.data ?? {};
      const surface = validateV09Widget(
        `gallery-${widget.id}`,
        widget.root,
        widget.components,
        defaultData,
      );
      expect(surface).toBeDefined();
    }
  });

  it('validates all generated theater scenarios have v0.9 messages', () => {
    const entries = Object.entries(scenarios);
    expect(entries.length).toBe(5);
    for (const [, messages] of entries) {
      expect(messages.length).toBeGreaterThan(0);
      for (const msg of messages) {
        expect(msg.version).toBe('v0.9');
      }
    }
  });

  it('renders fallback in V09Viewer instead of throwing when a component fails validation', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <V09Viewer
        root="bad-icon"
        components={[{id: 'bad-icon', component: 'Icon', name: 'nonexistent_snake_case_icon'}]}
      />,
    );
    expect(screen.getByText('No surface created')).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
