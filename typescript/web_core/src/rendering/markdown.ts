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
 * Mapping of HTML tag names to class lists applied during markdown rendering.
 */
export type MarkdownRendererTagClassMap = Record<string, string[]>;

/**
 * Configuration options for markdown rendering and styling.
 */
export interface MarkdownRendererOptions {
  /** Map of tag names to style classes applied to rendered tags. */
  tagClassMap?: MarkdownRendererTagClassMap;
  /** Display mode for rendered markdown elements. */
  renderMode?: 'inline' | 'block';
  /** Custom renderer function overriding standard markdown compilation. */
  renderer?: MarkdownRenderer;
}

/**
 * Renders markdown content to HTML asynchronously.
 *
 * Implementations must sanitize the resulting HTML to prevent security vulnerabilities.
 *
 * @param markdown The markdown string to render.
 * @param options Options configuring the markdown rendering process.
 * @returns A promise resolving to the rendered HTML string.
 */
export type MarkdownRenderer = (
  markdown: string,
  options?: MarkdownRendererOptions,
) => Promise<string>;
