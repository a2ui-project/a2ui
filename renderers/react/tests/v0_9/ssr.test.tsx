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

import React from 'react';
import {act} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {hydrateRoot, type Root} from 'react-dom/client';
import {describe, expect, it} from 'vitest';
import {Catalog, CommonSchemas, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {
  createComponentImplementation,
  type ReactComponentImplementation,
} from '../../src/v0_9/adapter';
import {A2uiSurface} from '../../src/v0_9/A2uiSurface';

const TestText = createComponentImplementation(
  {
    name: 'TestText',
    schema: z.object({
      text: CommonSchemas.DynamicString,
    }),
  },
  ({props}) => <span>{props.text}</span>,
);

function createSurface(text: string): SurfaceModel<ReactComponentImplementation> {
  const catalog = new Catalog('ssr-test', [TestText], []);
  const surface = new SurfaceModel<ReactComponentImplementation>('ssr-surface', catalog);

  surface.dataModel.set('/message', text);
  surface.componentsModel.addComponent(
    new ComponentModel('root', 'TestText', {
      text: {path: '/message'},
    }),
  );

  return surface;
}

describe('A2uiSurface server rendering', () => {
  it('renders a resolved surface on the server', () => {
    const html = renderToString(<A2uiSurface surface={createSurface('Hello from SSR')} />);

    expect(html).toContain('Hello from SSR');
  });

  it('hydrates without recoverable errors and remains reactive', async () => {
    const serverHtml = renderToString(<A2uiSurface surface={createSurface('Hydrated content')} />);
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    const clientSurface = createSurface('Hydrated content');
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    try {
      await act(async () => {
        root = hydrateRoot(container, <A2uiSurface surface={clientSurface} />, {
          onRecoverableError: error => recoverableErrors.push(error),
        });
      });

      expect(recoverableErrors).toEqual([]);
      expect(container.textContent).toBe('Hydrated content');

      await act(async () => {
        clientSurface.dataModel.set('/message', 'Updated after hydration');
      });

      expect(container.textContent).toBe('Updated after hydration');
    } finally {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    }
  });
});
