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

import {MarkdownItRenderer, type MarkdownItRendererOptions} from './raw-markdown.js';
import {sanitize} from './sanitizer.js';
import type {
  MarkdownRenderer,
  MarkdownRendererOptions,
  MarkdownRendererTagClassMap,
} from '@a2ui/web_core';

export type {MarkdownItRendererOptions};
export type {MarkdownRenderer, MarkdownRendererOptions, MarkdownRendererTagClassMap};

/**
 * Creates a Markdown to HTML renderer using markdown-it and dompurify.
 *
 * Without options it follows the A2UI Markdown subset, like
 * {@link renderMarkdown}. Enabling links or images renders them only when
 * their URL passes `MarkdownRendererOptions.sanitizeUrl`, which A2UI `Text`
 * components fill in with their surface's URL security policy (`navigation`
 * for links, `media` for images). Without a `sanitizeUrl`, the built-in
 * baseline checks apply. A blocked link renders as its text and a blocked
 * image as its alt text.
 *
 * @example
 * ```ts
 * setMarkdownRenderer(createMarkdownRenderer({allowLinks: true}));
 * ```
 *
 * @param rendererOptions Which elements outside the Markdown subset to render.
 * @returns A renderer to register with the A2UI renderer.
 */
export function createMarkdownRenderer(
  rendererOptions: MarkdownItRendererOptions = {},
): MarkdownRenderer {
  const renderer = new MarkdownItRenderer(rendererOptions);
  return async (value: string, options?: MarkdownRendererOptions) =>
    sanitize(renderer.render(value, options?.tagClassMap, options?.sanitizeUrl));
}

const subsetRenderer = createMarkdownRenderer();

/**
 * A Markdown to HTML renderer using markdown-it and dompurify that follows
 * the A2UI Markdown subset: links render as their text, images as their alt
 * text, and raw HTML as text. Use {@link createMarkdownRenderer} to enable
 * links or images.
 *
 * @param value The markdown code to render.
 * @param options Options for the markdown renderer.
 * @returns A promise that resolves to the rendered HTML as a string.
 */
export async function renderMarkdown(
  value: string,
  options?: MarkdownRendererOptions,
): Promise<string> {
  return subsetRenderer(value, options);
}
