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

import {createContext} from '@lit/context';

/**
 * A map of tag names to a list of classnames to be applied to a tag.
 *
 * For example, if you want to apply the class "my-class" to all "h1" tags,
 * you would use `{"h1": ["my-class"]}`.
 */
export type MarkdownRendererTagClassMap = Record<string, string[]>;

/**
 * The options for the markdown renderer passed from A2UI.
 *
 * This includes the tagClassMap, which is a map of tag names to a list of
 * classnames to be applied to each tag, and configuration for the sanitizer.
 */
export type MarkdownRendererOptions = {
  tagClassMap?: MarkdownRendererTagClassMap;
};

/**
 * Renders `markdown` using `options`.
 *
 * Implementations MUST sanitize the resulting HTML to prevent XSS vulnerabilities.
 *
 * @returns A promise that resolves to the rendered, sanitized HTML as a string.
 */
export type MarkdownRenderer = (
  markdown: string,
  options?: MarkdownRendererOptions,
) => Promise<string>;

/**
 * The markdown renderer context.
 *
 * This is used by the Text widget to render markdown content.
 */
export const markdown = createContext<MarkdownRenderer | undefined>(Symbol.for('A2UIMarkdown'));
