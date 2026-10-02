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

import {describe, it, expect, afterEach} from 'vitest';
import {render} from '@testing-library/react';
import React from 'react';
import {Catalog, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';
import {getMarkdownRenderer, setMarkdownRenderer} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  A2uiSurface,
  MarkdownContext,
  Text,
  type ReactComponentImplementation,
} from '../../src/v0_9';

const catalog = new Catalog<ReactComponentImplementation>('markdown-bridge', '0.9', [Text]);

function surfaceWith(id: string, text: string) {
  const surface = new SurfaceModel<ReactComponentImplementation>(id, catalog);
  surface.componentsModel.addComponent(new ComponentModel('root', 'Text', {text}));
  return surface;
}

const renderMarkdown = async (markdown: string) => `<em>${markdown}</em>`;
const hostRenderer = async (markdown: string) => `<strong>${markdown}</strong>`;

afterEach(() => {
  setMarkdownRenderer(undefined);
});

describe('A2uiSurface markdown bridge', () => {
  it('registers the renderer from MarkdownContext with web_core', () => {
    render(
      <MarkdownContext.Provider value={renderMarkdown}>
        <A2uiSurface surface={surfaceWith('md-1', 'hello')} />
      </MarkdownContext.Provider>,
    );
    expect(getMarkdownRenderer()).toBe(renderMarkdown);
  });

  it('registers nothing when no renderer is configured anywhere', () => {
    render(<A2uiSurface surface={surfaceWith('md-2', 'plain')} />);
    expect(getMarkdownRenderer()).toBeUndefined();
  });

  it('leaves a renderer the host registered untouched when the context has none', () => {
    setMarkdownRenderer(hostRenderer);
    render(<A2uiSurface surface={surfaceWith('md-3', 'plain')} />);
    expect(getMarkdownRenderer()).toBe(hostRenderer);
  });
});
