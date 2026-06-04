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

import {useMemo, memo} from 'react';
import type * as Types from '@a2ui/web_core/types/types';
import type {A2UIComponentProps} from '../../types';
import {useA2UIComponent} from '../../hooks/useA2UIComponent';
import {classMapToString, stylesToObject, mergeClassMaps} from '../../lib/utils';
import MarkdownIt from 'markdown-it';

type UsageHint = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body';

interface HintedStyles {
  h1?: Record<string, string>;
  h2?: Record<string, string>;
  h3?: Record<string, string>;
  h4?: Record<string, string>;
  h5?: Record<string, string>;
  body?: Record<string, string>;
  caption?: Record<string, string>;
}

function isHintedStyles(styles: unknown): styles is HintedStyles {
  if (typeof styles !== 'object' || !styles || Array.isArray(styles)) return false;
  const expected = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'];
  return expected.some(v => v in styles);
}

/**
 * Markdown-it instance for rendering markdown text.
 * Uses synchronous import to ensure availability at first render (matches Lit renderer).
 *
 * Configuration matches Lit's markdown directive (uses MarkdownIt defaults):
 * - html: false (default) - Security: disable raw HTML
 * - linkify: false (default) - Don't auto-convert URLs/emails to links
 * - breaks: false (default) - Don't convert \n to <br>
 * - typographer: false (default) - Don't use smart quotes/dashes
 */
const markdownRenderer = new MarkdownIt();

/**
 * Maps HTML tag names to their markdown-it token names.
 * Mirrors the Lit renderer's markdown directive approach.
 */
const TAG_TO_TOKEN: Record<string, string> = {
  p: 'paragraph',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  ul: 'bullet_list',
  ol: 'ordered_list',
  li: 'list_item',
  a: 'link',
  strong: 'strong',
  em: 'em',
};

function toClassArray(classes: string[] | Record<string, boolean>): string[] {
  if (Array.isArray(classes)) return classes;
  return Object.entries(classes)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

/**
 * Render markdown to HTML, applying theme classes via markdown-it renderer rules.
 * Uses token.attrJoin() on _open tokens — same approach as the Lit renderer.
 * Safe to mutate the module-level renderer because MarkdownIt.render() is synchronous.
 */
function renderWithTheme(text: string, markdownTheme: Types.Theme['markdown']): string {
  const appliedKeys: string[] = [];
  // Cast to a generic record for dynamic token.tag lookups inside renderer rules
  const themeMap = markdownTheme as Record<string, string[] | Record<string, boolean>> | undefined;

  if (themeMap) {
    for (const [tag, classes] of Object.entries(themeMap)) {
      if (!classes) continue;
      const tokenName = TAG_TO_TOKEN[tag];
      if (!tokenName) continue;

      const key = `${tokenName}_open`;
      if (!appliedKeys.includes(key)) appliedKeys.push(key);

      markdownRenderer.renderer.rules[key] = (tokens, idx, options, _env, self) => {
        const token = tokens[idx];
        if (token) {
          const tagClasses = themeMap[token.tag];
          if (tagClasses) {
            for (const cls of toClassArray(tagClasses)) {
              token.attrJoin('class', cls);
            }
          }
        }
        return self.renderToken(tokens, idx, options);
      };
    }
  }

  const html = markdownRenderer.render(text);

  for (const key of appliedKeys) {
    delete markdownRenderer.renderer.rules[key];
  }

  return html;
}

/**
 * Text component - renders text content with markdown support.
 *
 * Structure mirrors Lit's Text component:
 *   <div class="a2ui-text">      ← :host equivalent
 *     <section class="...">      ← theme classes
 *       <h2>...</h2>             ← rendered markdown content
 *     </section>
 *   </div>
 *
 * Text is parsed as markdown and rendered as HTML (matches Lit renderer behavior).
 * Supports usageHint values: h1, h2, h3, h4, h5, caption, body
 *
 * Markdown features supported:
 * - **Bold** and *italic* text
 * - Lists (ordered and unordered)
 * - `inline code` and code blocks
 * - [Links](url) (auto-linkified URLs too)
 * - Blockquotes
 * - Horizontal rules
 *
 * Note: Raw HTML is disabled for security.
 */
export const Text = memo(function Text({node, surfaceId}: A2UIComponentProps<Types.TextNode>) {
  const {theme, resolveString} = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const textValue = resolveString(props.text);
  const usageHint = props.usageHint as UsageHint | undefined;

  // Get merged classes (matches Lit's Styles.merge)
  const classes = mergeClassMaps(
    theme.components.Text.all,
    usageHint ? theme.components.Text[usageHint] : {},
  );

  // Get additional styles based on usage hint
  const additionalStyles = useMemo(() => {
    const textStyles = theme.additionalStyles?.Text;
    if (!textStyles) return undefined;

    if (isHintedStyles(textStyles)) {
      const hint = usageHint ?? 'body';
      return stylesToObject(textStyles[hint]);
    }
    return stylesToObject(textStyles as Record<string, string>);
  }, [theme.additionalStyles?.Text, usageHint]);

  // Render markdown content (matches Lit behavior - always uses markdown)
  const renderedContent = useMemo(() => {
    if (textValue === null || textValue === undefined) {
      return null;
    }

    // Add markdown prefix based on usageHint (matches Lit behavior)
    let markdownText = textValue;
    switch (usageHint) {
      case 'h1':
        markdownText = `# ${markdownText}`;
        break;
      case 'h2':
        markdownText = `## ${markdownText}`;
        break;
      case 'h3':
        markdownText = `### ${markdownText}`;
        break;
      case 'h4':
        markdownText = `#### ${markdownText}`;
        break;
      case 'h5':
        markdownText = `##### ${markdownText}`;
        break;
      case 'caption':
        markdownText = `*${markdownText}*`;
        break;
      default:
        break; // Body - no prefix
    }

    return {__html: renderWithTheme(markdownText, theme.markdown)};
  }, [textValue, theme.markdown, usageHint]);

  if (!renderedContent) {
    return null;
  }

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties =
    node.weight !== undefined ? ({'--weight': node.weight} as React.CSSProperties) : {};

  return (
    <div className="a2ui-text" style={hostStyle}>
      <section
        className={classMapToString(classes)}
        style={additionalStyles}
        dangerouslySetInnerHTML={renderedContent}
      />
    </div>
  );
});

export default Text;
