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

import type {Catalog} from '@a2ui/web_core';

/** A catalog the app renders, as created with web_core's `Catalog`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmbedCatalog = Catalog<any>;

/** The renderers the app can be built with. */
export type EmbedRenderer = 'lit';

/** The configuration of `a2ui-embed build`, the default export of `a2ui-embed.config.*`. */
export interface EmbedBuildConfig {
  /** The catalogs the app renders. Their IDs must be unique. */
  catalogs: readonly EmbedCatalog[];
  /** The renderer the app uses. Optional (default: `'lit'`). */
  renderer?: EmbedRenderer;
  /**
   * The path of the app HTML file, relative to the config file. The catalog schema file is
   * written next to it, with `.catalog.json` in place of `.html`.
   */
  output: string;
  /** The document title of the app. Optional (default: `'A2UI app'`). */
  title?: string;
  /**
   * Whether the basic catalog's body Text renders markdown, with `@a2ui/markdown-it`. Set it to
   * `false` to show the text as typed and leave the markdown renderer out of the app. Optional
   * (default: `true`).
   */
  markdown?: boolean;
}
