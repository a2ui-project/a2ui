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

/**
 * Markdown rendering types and interfaces for A2UI components.
 *
 * Defines the contract and configuration options for custom markdown compilation
 * and tag-based CSS class mapping.
 */

import type {UrlContext} from '../security/url_security_policy.js';

/**
 * Mapping of HTML tag names to class lists applied during markdown rendering.
 */
export type MarkdownRendererTagClassMap = Record<string, string[]>;

/**
 * Configuration options for markdown rendering and styling.
 */
export interface MarkdownRendererOptions {
  /** Map of tag names to CSS class lists applied to rendered elements. */
  tagClassMap?: MarkdownRendererTagClassMap;
  /** Display mode for rendered markdown elements. */
  renderMode?: 'inline' | 'block';
  /** Custom renderer function overriding standard markdown compilation. */
  renderer?: MarkdownRenderer;
  /**
   * Checks each link and image URL in the markdown against the surface's URL
   * security policy. Returns the URL to use, possibly rewritten, or
   * `undefined` to drop it. Renderers that support links or images call it
   * with `'navigation'` for links and `'media'` for images.
   */
  sanitizeUrl?: (url: string, context: UrlContext) => string | undefined;
}

/**
 * Renders markdown content to HTML asynchronously.
 *
 * Implementations must sanitize the resulting HTML to prevent security vulnerabilities.
 *
 * @param markdown Markdown string to render.
 * @param options Options configuring the markdown rendering process.
 * @returns A promise resolving to the rendered HTML string.
 */
export type MarkdownRenderer = (
  markdown: string,
  options?: MarkdownRendererOptions,
) => Promise<string>;
