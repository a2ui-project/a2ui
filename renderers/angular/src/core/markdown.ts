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

import type {MarkdownRendererOptions} from '@a2ui/web_core';

/**
 * Note on inverted dependency direction:
 * Because root @a2ui/angular re-exports legacy v0.8 symbols (Catalog, Theme, etc.) from @a2ui/angular/v0_8,
 * the root entrypoint depends on @a2ui/angular/v0_8 in ng-packagr's dependency DAG.
 * To guarantee that both v0.8 and modern v0.9/v1.0 share a single, unified Angular Dependency Injection token
 * for MarkdownRenderer without triggering a circular entrypoint dependency error in ng-packagr, the authoritative
 * implementation currently resides in v0_8/data/markdown.ts and is re-exported here.
 *
 * TODO: When v0.8 compatibility is eventually removed and root no longer depends on @a2ui/angular/v0_8,
 * move the actual MarkdownRenderer implementation back into this module.
 */
import {
  MarkdownRenderer,
  DefaultMarkdownRenderer,
  provideMarkdownRenderer,
} from '@a2ui/angular/v0_8';

export {
  type MarkdownRendererOptions,
  MarkdownRenderer,
  DefaultMarkdownRenderer,
  provideMarkdownRenderer,
};
