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

import {describe, it, expect, afterEach, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import React from 'react';
import {Catalog, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';
import {
  basicCatalog,
  getMarkdownRenderer,
  setMarkdownRenderer,
} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiSurface, MarkdownContext, type ReactCatalogComponent} from '../../src';

const Text = basicCatalog.components.get('Text')!;
const catalog = new Catalog<ReactCatalogComponent>('markdown-bridge', '0.9', [Text]);

function surfaceWith(id: string, text: string) {
  const surface = new SurfaceModel<ReactCatalogComponent>(id, catalog);
  surface.componentsModel.addComponent(new ComponentModel('root', 'Text', {text}, catalog));
  return surface;
}

/** Renders markdown as marked-up HTML so the test can tell it from plain text. */
const renderMarkdown = vi.fn(async (markdown: string) => `<em>${markdown}</em>`);
const hostRenderer = async (markdown: string) => `<strong>${markdown}</strong>`;

afterEach(() => {
  renderMarkdown.mockClear();
  setMarkdownRenderer(undefined);
});

describe('A2uiSurface markdown bridge', () => {
  it("renders web_core's Text through the renderer from MarkdownContext", async () => {
    render(
      <MarkdownContext.Provider value={renderMarkdown}>
        <A2uiSurface surface={surfaceWith('md-1', 'hello')} />
      </MarkdownContext.Provider>,
    );
    expect(await screen.findByText('hello', {selector: 'em'})).toBeInTheDocument();
    expect(renderMarkdown).toHaveBeenCalledWith('hello', undefined);
  });

  it('renders plain text when no renderer is configured anywhere', async () => {
    render(<A2uiSurface surface={surfaceWith('md-2', 'plain')} />);
    expect(await screen.findByText('plain')).toBeInTheDocument();
    expect(screen.queryByText('plain', {selector: 'em'})).toBeNull();
    expect(getMarkdownRenderer()).toBeUndefined();
  });

  it('leaves a renderer the host registered untouched when the context has none', async () => {
    setMarkdownRenderer(hostRenderer);
    render(<A2uiSurface surface={surfaceWith('md-3', 'plain')} />);
    expect(await screen.findByText('plain', {selector: 'strong'})).toBeInTheDocument();
  });
});
