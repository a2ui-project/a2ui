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

import {describe, it, expect} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import React from 'react';
import {TestWrapper, TestRenderer, createSimpleMessages} from '../../utils';
import {litTheme, defaultTheme} from '../../../../src/v0_8';

describe('Text Component', () => {
  describe('Basic Rendering', () => {
    it('should render text with literal string', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Hello World'},
        usageHint: 'body',
      });

      render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText('Hello World')).toBeInTheDocument();
      });
    });

    it('should render text with whitespace only', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '   '},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      // Surface should exist with whitespace content
      const surface = container.querySelector('.a2ui-surface');
      expect(surface).toBeInTheDocument();
    });

    it('should render empty string', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: ''},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      expect(container.querySelector('.a2ui-surface')).toBeInTheDocument();
    });
  });

  describe('Usage Hints', () => {
    const usageHints = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'] as const;

    usageHints.forEach(hint => {
      it(`should render with usageHint="${hint}"`, async () => {
        const messages = createSimpleMessages('text-1', 'Text', {
          text: {literalString: `${hint} text`},
          usageHint: hint,
        });

        render(
          <TestWrapper>
            <TestRenderer messages={messages} />
          </TestWrapper>,
        );

        await waitFor(() => {
          expect(screen.getByText(`${hint} text`)).toBeInTheDocument();
        });
      });
    });

    // Note: All Text components now render as <section> to match Lit renderer DOM structure.
    // The usageHint only affects CSS classes, not the wrapper element.
    it('should render h1 with section wrapper (Lit DOM structure)', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Main Title'},
        usageHint: 'h1',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        // Text always renders as <section> to match Lit renderer
        const section = container.querySelector('section');
        expect(section).toBeInTheDocument();
        expect(section?.textContent?.trim()).toBe('Main Title');
      });
    });

    it('should render h2 with section wrapper (Lit DOM structure)', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Section Title'},
        usageHint: 'h2',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const section = container.querySelector('section');
        expect(section).toBeInTheDocument();
        expect(section?.textContent?.trim()).toBe('Section Title');
      });
    });

    it('should render caption with section wrapper (Lit DOM structure)', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Caption text'},
        usageHint: 'caption',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const section = container.querySelector('section');
        expect(section).toBeInTheDocument();
        expect(section?.textContent?.trim()).toBe('Caption text');
      });
    });

    it('should render body with section wrapper (Lit DOM structure)', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Body text'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const section = container.querySelector('section');
        expect(section).toBeInTheDocument();
        expect(section?.textContent?.trim()).toBe('Body text');
      });
    });
  });

  describe('Theme Support', () => {
    it('should apply default theme classes', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Themed text'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper theme={defaultTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        // Default theme (litTheme) uses layout-w-100 and layout-g-2 classes for Text.all
        const section = container.querySelector('section');
        expect(section).toBeInTheDocument();
        expect(section?.classList.contains('layout-w-100')).toBe(true);
      });
    });

    it('should apply lit theme classes for h1', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Lit theme text'},
        usageHint: 'h1',
      });

      const {container} = render(
        <TestWrapper theme={litTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        // Lit theme components.Text.h1 uses typography-sz-hs class
        const section = container.querySelector('section');
        expect(section).toBeInTheDocument();
        expect(section?.classList.contains('typography-sz-hs')).toBe(true);
      });
    });

    it('should apply body variant classes from lit theme', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Body text'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper theme={litTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        // Lit theme body variant inherits from 'all' which has layout-w-100
        const section = container.querySelector('section');
        expect(section).toBeInTheDocument();
        expect(section?.classList.contains('layout-w-100')).toBe(true);
      });
    });
  });

  describe('Markdown Rendering', () => {
    it('should render bold text', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'This is **bold** text'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const strong = container.querySelector('strong');
        expect(strong).toBeInTheDocument();
        expect(strong?.textContent).toBe('bold');
      });
    });

    it('should render italic text', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'This is *italic* text'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const em = container.querySelector('em');
        expect(em).toBeInTheDocument();
        expect(em?.textContent).toBe('italic');
      });
    });

    it('should render inline code', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Use the `console.log()` function'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const code = container.querySelector('code');
        expect(code).toBeInTheDocument();
        expect(code?.textContent).toBe('console.log()');
      });
    });

    it('should render unordered lists', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '- Item 1\n- Item 2\n- Item 3'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const ul = container.querySelector('ul');
        expect(ul).toBeInTheDocument();
        const items = container.querySelectorAll('li');
        expect(items.length).toBe(3);
      });
    });

    it('should render ordered lists', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '1. First\n2. Second\n3. Third'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const ol = container.querySelector('ol');
        expect(ol).toBeInTheDocument();
        const items = container.querySelectorAll('li');
        expect(items.length).toBe(3);
      });
    });

    it('should render links', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Visit [Google](https://google.com)'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const link = container.querySelector('a');
        expect(link).toBeInTheDocument();
        expect(link?.getAttribute('href')).toBe('https://google.com');
        expect(link?.textContent).toBe('Google');
      });
    });

    it('should render plain URLs as text (auto-linkify not enabled)', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Check out https://example.com for more'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        // Auto-linkify is not enabled in markdown-it by default
        // URLs without markdown link syntax render as plain text
        expect(container.textContent).toContain('https://example.com');
      });
    });

    it('should render blockquotes', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '> This is a quote'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const blockquote = container.querySelector('blockquote');
        expect(blockquote).toBeInTheDocument();
      });
    });

    it('should render code blocks', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '```\nconst x = 1;\n```'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const pre = container.querySelector('pre');
        expect(pre).toBeInTheDocument();
        const code = pre?.querySelector('code');
        expect(code).toBeInTheDocument();
      });
    });

    it('should preserve line breaks in text', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'Line 1\nLine 2'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        // Line breaks are preserved in the text content
        expect(container.textContent).toContain('Line 1');
        expect(container.textContent).toContain('Line 2');
      });
    });
  });

  describe('Markdown Theme Classes', () => {
    it('should apply theme classes to markdown elements', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '- List item'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper theme={litTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const ul = container.querySelector('ul');
        expect(ul).toBeInTheDocument();
        // litTheme.markdown.ul includes typography-f-s class
        expect(ul?.classList.contains('typography-f-s')).toBe(true);
      });
    });

    it('should apply paragraph classes from theme', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: 'A paragraph of text.'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper theme={litTheme}>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const p = container.querySelector('p');
        expect(p).toBeInTheDocument();
        // litTheme.markdown.p includes typography-sz-bm class
        expect(p?.classList.contains('typography-sz-bm')).toBe(true);
      });
    });
  });

  describe('Security', () => {
    it('should not render raw HTML', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '<script>alert("xss")</script>'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        // Script tag should not be rendered
        const script = container.querySelector('script');
        expect(script).not.toBeInTheDocument();
        // The text should be escaped and visible
        expect(container.textContent).toContain('<script>');
      });
    });

    it('should not render onclick handlers', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '<div onclick="alert(1)">Click me</div>'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        // Should be escaped, not rendered as HTML
        const div = container.querySelector('[onclick]');
        expect(div).not.toBeInTheDocument();
      });
    });

    it('should not render iframe tags', async () => {
      const messages = createSimpleMessages('text-1', 'Text', {
        text: {literalString: '<iframe src="https://evil.com"></iframe>'},
        usageHint: 'body',
      });

      const {container} = render(
        <TestWrapper>
          <TestRenderer messages={messages} />
        </TestWrapper>,
      );

      await waitFor(() => {
        const iframe = container.querySelector('iframe');
        expect(iframe).not.toBeInTheDocument();
      });
    });
  });
});
