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

import {createContext, useContext, type ComponentType} from 'react';
import type {MarkdownRenderer} from '@a2ui/web_core';

export const MarkdownContext = createContext<MarkdownRenderer | undefined>(undefined);

export const useMarkdownRenderer = () => useContext(MarkdownContext);

/** What the component in `MarkdownComponentContext` receives. */
export interface MarkdownComponentProps {
  /** The Markdown to render. */
  markdown: string;
}

/**
 * A React component that renders the Markdown of web_core's basic catalog `Text`, in place of
 * the function `MarkdownContext` takes, which returns HTML.
 *
 * The component renders inside the app's React tree, below the `A2uiSurface` that shows the
 * `Text`, so it reads the app's context. When both contexts are given, this one is used.
 * web_core's `Text` reads one Markdown renderer for the whole page, so give the component to
 * every `A2uiSurface` on the page or to none: a surface without it shows no text for its
 * Markdown while another surface has it.
 */
export const MarkdownComponentContext = createContext<
  ComponentType<MarkdownComponentProps> | undefined
>(undefined);
