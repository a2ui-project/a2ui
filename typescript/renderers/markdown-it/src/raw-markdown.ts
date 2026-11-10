/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import markdownit from 'markdown-it';
import type {RenderRule} from 'markdown-it/lib/renderer.mjs';
import {
  PermissiveUrlSecurityPolicy,
  type MarkdownRendererOptions,
  type MarkdownRendererTagClassMap,
  type UrlContext,
} from '@a2ui/web_core';

/**
 * Checks a URL found in Markdown and returns the URL to use, or `undefined`
 * when it is blocked.
 */
type MarkdownUrlSanitizer = NonNullable<MarkdownRendererOptions['sanitizeUrl']>;

/** Which Markdown elements outside the A2UI Markdown subset to render. */
export interface MarkdownItRendererOptions {
  /**
   * Renders links as anchors whose `href` is checked as a `navigation` URL.
   * When `false` (the default), a link renders as its text.
   */
  readonly allowLinks?: boolean;
  /**
   * Renders images as `img` elements whose `src` is checked as a `media` URL.
   * When `false` (the default), an image renders as its alt text.
   */
  readonly allowImages?: boolean;
}

/** Applies the built-in baseline checks when the caller passes no sanitizer. */
const BASELINE_POLICY = new PermissiveUrlSecurityPolicy();
const baselineSanitizer: MarkdownUrlSanitizer = (url, context) =>
  BASELINE_POLICY.sanitizeUrl(url, context);

/** Per-render state passed to the markdown-it rules. */
interface RenderEnv {
  readonly tagClassMap?: MarkdownRendererTagClassMap;
  readonly sanitizeUrl: MarkdownUrlSanitizer;
  /** One entry per open link: whether it was rendered as an anchor. */
  readonly openLinks: boolean[];
}

/**
 * A pre-configured instance of markdown-it to render markdown in A2UI web.
 *
 * By default it follows the A2UI Markdown subset: links render as their text,
 * images as their alt text, and raw HTML as text. Links and images can be
 * enabled with {@link MarkdownItRendererOptions}; their URLs then pass
 * through the sanitizer given to {@link render}.
 *
 * This renderer does not perform any sanitization of the outgoing HTML.
 */
export class MarkdownItRenderer {
  private markdownIt = markdownit();
  private readonly allowLinks: boolean;
  private readonly allowImages: boolean;

  /**
   * Creates a renderer.
   *
   * @param options Which elements outside the Markdown subset to render.
   */
  constructor(options: MarkdownItRendererOptions = {}) {
    this.allowLinks = options.allowLinks ?? false;
    this.allowImages = options.allowImages ?? false;
    this.registerTagClassMapRules();
    this.registerUrlRules();
  }

  /**
   * Registers rules to apply tag class maps from the environment.
   */
  private registerTagClassMapRules() {
    // Proxy the "_open" default rules to apply classes to their tokens.
    // See: https://github.com/markdown-it/markdown-it/blob/master/docs/examples/renderer_rules.md#default-renderer-rules
    const rulesToProxy = [
      'paragraph_open',
      'heading_open',
      'bullet_list_open',
      'ordered_list_open',
      'list_item_open',
      'link_open',
      'strong_open',
      'em_open',
    ];

    for (const ruleName of rulesToProxy) {
      // We cache the original rule here to use it to render the token after
      // we've applied classes to it.
      // See: https://github.com/markdown-it/markdown-it/blob/master/docs/examples/renderer_rules.md#to-add-a-default-css-class-to-an-element
      const originalRule = this.markdownIt.renderer.rules[ruleName];
      this.markdownIt.renderer.rules[ruleName] = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const tagClassMap = env?.tagClassMap as MarkdownRendererTagClassMap | undefined;

        if (tagClassMap) {
          const tokenClasses = tagClassMap[token.tag] ?? [];
          for (const clazz of tokenClasses) {
            token.attrJoin('class', clazz);
          }
        }
        if (originalRule) {
          // Delegate to the original rule to render the token.
          return originalRule(tokens, idx, options, env, self);
        }
        // Fallback to the default renderToken behavior.
        return self.renderToken(tokens, idx, options);
      };
    }
  }

  /**
   * Registers rules that render links and images only when enabled and when
   * their URL passes the sanitizer, and as plain text otherwise.
   */
  private registerUrlRules() {
    const rules = this.markdownIt.renderer.rules;
    const renderLinkOpen = rules['link_open']!;
    const renderImage = rules['image'];
    const escapeHtml = this.markdownIt.utils.escapeHtml;

    const linkOpen: RenderRule = (tokens, idx, options, env: RenderEnv, self) => {
      const token = tokens[idx];
      const href = this.allowLinks
        ? checkAttr(token.attrGet('href'), 'navigation', env)
        : undefined;
      env.openLinks.push(href !== undefined);
      if (href === undefined) return '';
      token.attrSet('href', href);
      return renderLinkOpen(tokens, idx, options, env, self);
    };
    const linkClose: RenderRule = (tokens, idx, options, env: RenderEnv, self) =>
      env.openLinks.pop() ? self.renderToken(tokens, idx, options) : '';
    const image: RenderRule = (tokens, idx, options, env: RenderEnv, self) => {
      const token = tokens[idx];
      const src = this.allowImages ? checkAttr(token.attrGet('src'), 'media', env) : undefined;
      if (src !== undefined) {
        token.attrSet('src', src);
        return renderImage
          ? renderImage(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
      }
      return escapeHtml(self.renderInlineAsText(token.children ?? [], options, env));
    };

    rules['link_open'] = linkOpen;
    rules['link_close'] = linkClose;
    rules['image'] = image;
  }

  /**
   * Renders the markdown string to HTML using the internal MarkdownIt instance.
   *
   * @param value The markdown to render.
   * @param tagClassMap A map of tag names to classes to apply when rendering a tag.
   * @param sanitizeUrl Checks the URL of every enabled link and image. Defaults
   *   to the built-in baseline checks of the URL security policy.
   *
   * This method does not perform any sanitization of the outgoing HTML.
   */
  render(
    value: string,
    tagClassMap?: MarkdownRendererTagClassMap,
    sanitizeUrl: MarkdownUrlSanitizer = baselineSanitizer,
  ) {
    const env: RenderEnv = {tagClassMap, sanitizeUrl, openLinks: []};
    return this.markdownIt.render(value, env);
  }
}

function checkAttr(url: string | null, context: UrlContext, env: RenderEnv): string | undefined {
  if (!url) return undefined;
  try {
    const result = env.sanitizeUrl(url, context);
    return typeof result === 'string' && result ? result : undefined;
  } catch {
    // A sanitizer that throws blocks the URL.
    return undefined;
  }
}

/**
 * A pre-configured instance of markdown-it to render markdown in A2UI web,
 * following the A2UI Markdown subset (no links or images).
 *
 * This renderer does not perform any sanitization of the outgoing HTML.
 */
export const rawMarkdownRenderer = new MarkdownItRenderer();
