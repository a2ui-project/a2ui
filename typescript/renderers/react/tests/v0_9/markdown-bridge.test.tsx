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
import {act, render, screen} from '@testing-library/react';
import React, {createContext, useContext} from 'react';
import {Catalog, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';
import {
  basicCatalog,
  getMarkdownRenderer,
  setMarkdownRenderer,
} from '@a2ui/web_core/v0_9/basic_catalog';
import {
  A2uiSurface,
  MarkdownComponentContext,
  MarkdownContext,
  type MarkdownComponentProps,
  type ReactCatalogComponent,
} from '../../src';

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

/** Context the app provides above the surface, to show the component reads it. */
const Emphasis = createContext('em');

/** Renders markdown as a React element the test can find. */
function ChatMarkdown({markdown}: MarkdownComponentProps) {
  const Tag = useContext(Emphasis) as 'em' | 'strong';
  return <Tag data-testid="chat-markdown">{markdown}</Tag>;
}

describe('A2uiSurface markdown component', () => {
  it("renders web_core's Text through the component from MarkdownComponentContext", async () => {
    render(
      <MarkdownComponentContext.Provider value={ChatMarkdown}>
        <A2uiSurface surface={surfaceWith('mdc-1', 'hello')} />
      </MarkdownComponentContext.Provider>,
    );

    const rendered = await screen.findByTestId('chat-markdown');
    expect(rendered.tagName).toBe('EM');
    expect(rendered).toHaveTextContent('hello');
    expect(rendered.closest('a2ui-basic-text')).not.toBeNull();
  });

  it('renders the component in the app tree, so it reads the context above the surface', async () => {
    render(
      <Emphasis.Provider value="strong">
        <MarkdownComponentContext.Provider value={ChatMarkdown}>
          <A2uiSurface surface={surfaceWith('mdc-2', 'bold')} />
        </MarkdownComponentContext.Provider>
      </Emphasis.Provider>,
    );

    expect((await screen.findByTestId('chat-markdown')).tagName).toBe('STRONG');
  });

  it('takes precedence over MarkdownContext', async () => {
    render(
      <MarkdownContext.Provider value={renderMarkdown}>
        <MarkdownComponentContext.Provider value={ChatMarkdown}>
          <A2uiSurface surface={surfaceWith('mdc-3', 'both')} />
        </MarkdownComponentContext.Provider>
      </MarkdownContext.Provider>,
    );

    expect(await screen.findByTestId('chat-markdown')).toHaveTextContent('both');
    expect(renderMarkdown).not.toHaveBeenCalled();
  });

  it('passes Markdown with quotes and tags through unchanged', async () => {
    const markdown = 'Say "hi" & <b>wave</b>';
    render(
      <MarkdownComponentContext.Provider value={ChatMarkdown}>
        <A2uiSurface surface={surfaceWith('mdc-4', markdown)} />
      </MarkdownComponentContext.Provider>,
    );

    expect((await screen.findByTestId('chat-markdown')).textContent).toBe(markdown);
  });

  it('renders the new Markdown when the text changes', async () => {
    const surface = surfaceWith('mdc-5', 'before');
    render(
      <MarkdownComponentContext.Provider value={ChatMarkdown}>
        <A2uiSurface surface={surface} />
      </MarkdownComponentContext.Provider>,
    );
    await screen.findByText('before', {selector: '[data-testid="chat-markdown"]'});

    act(() => {
      surface.componentsModel.get('root')!.properties = {text: 'after'};
    });

    expect(
      await screen.findByText('after', {selector: '[data-testid="chat-markdown"]'}),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-markdown')).toHaveLength(1);
  });

  it('puts back the renderer the host registered when the surface unmounts', async () => {
    setMarkdownRenderer(hostRenderer);
    const {unmount} = render(
      <MarkdownComponentContext.Provider value={ChatMarkdown}>
        <A2uiSurface surface={surfaceWith('mdc-6', 'first')} />
      </MarkdownComponentContext.Provider>,
    );
    await screen.findByTestId('chat-markdown');
    unmount();

    expect(getMarkdownRenderer()).toBe(hostRenderer);
    render(<A2uiSurface surface={surfaceWith('mdc-7', 'second')} />);
    expect(await screen.findByText('second', {selector: 'strong'})).toBeInTheDocument();
  });

  it('renders plain text on a surface without the component once the last one unmounts', async () => {
    const {unmount} = render(
      <MarkdownComponentContext.Provider value={ChatMarkdown}>
        <A2uiSurface surface={surfaceWith('mdc-8', 'first')} />
      </MarkdownComponentContext.Provider>,
    );
    await screen.findByTestId('chat-markdown');
    unmount();

    expect(getMarkdownRenderer()).toBeUndefined();
    render(<A2uiSurface surface={surfaceWith('mdc-9', 'second')} />);
    expect(await screen.findByText('second')).toBeInTheDocument();
  });

  it('keeps the component while another surface with it is mounted', async () => {
    function Surfaces({both}: {both: boolean}) {
      return (
        <MarkdownComponentContext.Provider value={ChatMarkdown}>
          <A2uiSurface surface={kept} />
          {both && <A2uiSurface surface={removed} />}
        </MarkdownComponentContext.Provider>
      );
    }
    const kept = surfaceWith('mdc-10', 'kept');
    const removed = surfaceWith('mdc-11', 'removed');
    const {rerender} = render(<Surfaces both />);
    await screen.findByText('removed', {selector: '[data-testid="chat-markdown"]'});
    rerender(<Surfaces both={false} />);

    act(() => {
      kept.componentsModel.get('root')!.properties = {text: 'still kept'};
    });

    expect(
      await screen.findByText('still kept', {selector: '[data-testid="chat-markdown"]'}),
    ).toBeInTheDocument();
  });
});
