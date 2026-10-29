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
import {describe, it, expect} from 'vitest';
import {render, act, waitFor} from '@testing-library/react';
import {z} from 'zod';
import {Catalog, ChildListSchema, CommonSchemas, MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, useA2uiSurface} from '../src/A2uiSurface';
import {createComponentImplementation} from '../src/adapter';
import {useNodeView, useSignalValue} from '../src/node-view';
import type {ReactComponentImplementation} from '../src/react_component_implementation';

describe('useNodeView & useA2uiSurface metadata reactivity', () => {
  it('re-renders custom components on node.metadata and surface.metadataSignal changes without re-rendering sibling basic components', async () => {
    let basicRenders = 0;
    let metaViewRenders = 0;

    const BasicTextImpl = createComponentImplementation(
      {name: 'Text', schema: z.object({text: CommonSchemas.DynamicString.optional()})},
      ({props}) => {
        basicRenders++;
        return <span data-testid="basic-text">{String(props.text ?? '')}</span>;
      },
    );

    const ColumnImpl = createComponentImplementation(
      {name: 'Column', schema: z.object({children: ChildListSchema.optional()})},
      ({props, buildChild}) => {
        const children = props.children as string[] | undefined;
        return (
          <div>
            {Array.isArray(children)
              ? children.map((id, idx) => (
                  <React.Fragment key={`${id}-${idx}`}>{buildChild(id)}</React.Fragment>
                ))
              : null}
          </div>
        );
      },
    );

    const MetaProbeImpl: ReactComponentImplementation = {
      name: 'MetaProbe',
      schema: z.object({label: CommonSchemas.DynamicString.optional()}),
      metadata: {extensions: {catalog_hint: 'static-v1'}},
      render: () => null,
      view: ({node, buildChild}) => {
        metaViewRenders++;
        const {viewProps, metadata} = useNodeView(node, buildChild);
        const surface = useA2uiSurface();
        const surfaceMeta = useSignalValue(surface.metadataSignal);
        const instBadge = (metadata?.extensions?.badge as string | undefined) ?? 'none';
        const surfBadge = (surfaceMeta?.extensions?.theme_mode as string | undefined) ?? 'none';
        const catHint =
          (node.impl?.metadata?.extensions?.catalog_hint as string | undefined) ?? 'none';
        return (
          <div data-testid="meta-probe">
            {`${String(viewProps.label ?? '')}|inst:${instBadge}|surf:${surfBadge}|cat:${catHint}`}
          </div>
        );
      },
    };

    const customCatalog = new Catalog('https://example.org/meta_cat', '1.0', [
      BasicTextImpl,
      ColumnImpl,
      MetaProbeImpl,
    ]);

    const processor = new MessageProcessor([customCatalog]);
    processor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's-meta',
          catalogId: customCatalog.id,
          metadata: {extensions: {theme_mode: 'dark'}},
          components: [
            {id: 'root', component: 'Column', children: ['txt1', 'probe1']},
            {id: 'txt1', component: 'Text', text: 'Stable Sibling'},
            {
              id: 'probe1',
              component: 'MetaProbe',
              label: 'Probe',
              metadata: {extensions: {badge: 'initial'}},
            },
          ],
        },
      },
    ]);

    const surface = processor.model.getSurface('s-meta')!;
    const {getByTestId} = render(<A2uiSurface surface={surface} />);

    await waitFor(() => {
      expect(getByTestId('meta-probe').textContent).toBe(
        'Probe|inst:initial|surf:dark|cat:static-v1',
      );
    });

    const initialBasicRenders = basicRenders;
    const initialMetaRenders = metaViewRenders;

    await act(async () => {
      processor.processMessages([
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 's-meta',
            components: [
              {
                id: 'probe1',
                component: 'MetaProbe',
                label: 'Probe',
                metadata: {extensions: {badge: 'updated'}},
              },
            ],
          },
        },
      ]);
    });

    await waitFor(() => {
      expect(getByTestId('meta-probe').textContent).toBe(
        'Probe|inst:updated|surf:dark|cat:static-v1',
      );
    });

    // BasicText sibling must not re-render when only probe1's metadata changed
    expect(basicRenders).toBe(initialBasicRenders);
    expect(metaViewRenders).toBeGreaterThan(initialMetaRenders);

    // Updating metadata on txt1 itself must NOT re-render txt1 because BasicTextImpl never reads metadata
    const basicRendersBeforeTxtMeta = basicRenders;
    await act(async () => {
      surface.componentsModel.get('txt1')!.setExtension('trace_id', 't-99');
    });
    expect(basicRenders).toBe(basicRendersBeforeTxtMeta);

    // Updating surface metadata reactively updates the probe component
    await act(async () => {
      surface.setExtension('theme_mode', 'light');
    });

    await waitFor(() => {
      expect(getByTestId('meta-probe').textContent).toBe(
        'Probe|inst:updated|surf:light|cat:static-v1',
      );
    });
  });
});
