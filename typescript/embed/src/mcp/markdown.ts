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

import {ContextProvider} from '@lit/context';
import {Context, type MarkdownRenderer} from '@a2ui/web_core/catalogs/basic/v1';

/**
 * Shows markdown as typed. The basic catalog's Text renders its `body` variant as markdown and
 * warns when no renderer is provided; this renderer escapes the text instead.
 */
export const plainTextRenderer: MarkdownRenderer = async text =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Provides `renderer` to the basic catalog's Text elements inside `element`. */
export function provideMarkdownRenderer(element: HTMLElement, renderer: MarkdownRenderer): void {
  new ContextProvider(element, {context: Context.markdown, initialValue: renderer});
}
