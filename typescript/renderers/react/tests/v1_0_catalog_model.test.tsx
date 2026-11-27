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

import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {Catalog, defineComponent, defineComponentApi, MessageProcessor} from '@a2ui/web_core';
import {t} from '@a2ui/web_core/catalog/model';
import {A2uiSurface} from '../src/A2uiSurface';
import {createComponentImplementation} from '../src/adapter';
import type {ReactCatalogComponentLike} from '../src/react_component_implementation';

describe('React renderer with canonical zero-Zod CatalogModel', () => {
  it('infers typed props, preserves definition, and renders reactively without Zod', async () => {
    const PanelApi = defineComponentApi(
      defineComponent({
        name: 'Panel',
        description: 'Container panel with a custom-named child slot and childList.',
        parameters: [
          t.param('heading', t.string({dynamic: true}), {required: true}),
          t.param('headerSlot', t.child()),
          t.param('cards', t.childList()),
        ],
      }),
    );

    const TagApi = defineComponentApi(
      defineComponent({
        name: 'Tag',
        checkable: true,
        parameters: [
          t.param('label', t.string({dynamic: true}), {required: true}),
          t.param('tone', t.enum(['info', 'alert'])),
          t.param('onPress', t.action()),
        ],
      }),
    );

    const PanelImpl = createComponentImplementation(PanelApi, ({props, buildChild}) => {
      // Compile-time check: props.heading is string, props.headerSlot is string | undefined,
      // props.cards is ModelResolvedChildRef[] | undefined.
      const heading: string = props.heading;
      return (
        <section data-testid="panel">
          <h1>{heading}</h1>
          {props.headerSlot && <header>{buildChild(props.headerSlot)}</header>}
          <div>
            {(props.cards ?? []).map((ref, idx) =>
              typeof ref === 'string' ? (
                <div key={`${ref}-${idx}`}>{buildChild(ref)}</div>
              ) : (
                <div key={`${ref.id}-${idx}`}>{buildChild(ref.id, ref.basePath)}</div>
              ),
            )}
          </div>
        </section>
      );
    });

    const TagImpl = createComponentImplementation(TagApi, ({props}) => {
      // Compile-time check: props.tone is 'info' | 'alert' | undefined,
      // props.setLabel is ((value: string) => void) | undefined.
      const tone: 'info' | 'alert' | undefined = props.tone;
      return (
        <button
          type="button"
          data-testid="tag-btn"
          data-tone={tone ?? 'default'}
          onClick={() => {
            props.setLabel?.('Updated');
            void props.onPress?.();
          }}
        >
          {props.label}
        </button>
      );
    });

    // pickComponentApiFields preserved definition on both implementations with zero Zod schema.
    expect(PanelImpl.definition).toBe(PanelApi.definition);
    expect(PanelImpl.schema).toBeUndefined();
    expect(TagImpl.definition).toBe(TagApi.definition);
    expect(TagImpl.schema).toBeUndefined();

    const actions: unknown[] = [];
    const catalogId = 'https://example.com/react-zero-zod';
    const catalog = new Catalog<ReactCatalogComponentLike>(
      catalogId,
      '1.0',
      [PanelImpl, TagImpl],
      [],
    );
    const processor = new MessageProcessor([catalog], action => {
      actions.push(action);
    });

    processor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId,
          components: [
            {
              id: 'root',
              component: 'Panel',
              heading: {'@path': '/heading'},
              cards: ['tag1'],
            },
            {
              id: 'tag1',
              component: 'Tag',
              label: {'@path': '/tagLabel'},
              tone: 'alert',
              onPress: {event: {name: 'tag_clicked'}},
            },
          ],
        },
      },
      {
        version: '1.0',
        updateDataModel: {
          surfaceId: 's1',
          path: '/',
          value: {heading: 'Dashboard', tagLabel: 'Initial'},
        },
      },
    ]);

    const surface = processor.model.getSurface('s1')!;
    render(<A2uiSurface surface={surface} />);

    expect(screen.getByText('Dashboard')).toBeTruthy();
    const btn = screen.getByTestId('tag-btn');
    expect(btn.textContent).toBe('Initial');
    expect(btn.getAttribute('data-tone')).toBe('alert');

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(surface.dataModel.get('/tagLabel')).toBe('Updated');
    expect(screen.getByTestId('tag-btn').textContent).toBe('Updated');
    expect(actions).toHaveLength(1);
  });
});
