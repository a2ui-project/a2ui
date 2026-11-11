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

import type {LoadedRuntime} from './react_app_config.js';

/** Id of the JSON script element the runtime reads the app from. */
export const APP_CONFIG_ELEMENT_ID = 'a2ui-react-app-config';

/** The app a document runs. */
export interface AppDocumentContent {
  readonly source: string;
  readonly compiled?: string;
  readonly title?: string;
}

/**
 * Serializes a value for an inline `<script type="application/json">`: `<` is escaped so the
 * content can never close the element, and the two line separators JSON allows but JavaScript
 * doesn't are escaped too.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Builds the app document of bridge protocol section 2: the import map with absolute URLs of
 * the runtime files, module preloads, the stylesheet, the app config and the bootstrap script.
 * The sandbox proxy adds the CSP meta tag when it loads the document.
 */
export function buildAppDocument(runtime: LoadedRuntime, content: AppDocumentContent): string {
  const {manifest, baseUrl} = runtime;
  const resolve = (path: string) => new URL(path, baseUrl).href;
  const imports: Record<string, string> = {};
  for (const [name, path] of Object.entries(manifest.importMap.imports)) {
    imports[name] = resolve(path);
  }
  const config: Record<string, string> = {source: content.source};
  if (content.compiled !== undefined) {
    config['compiled'] = content.compiled;
  }
  if (content.title !== undefined) {
    config['title'] = content.title;
  }
  const preloads = manifest.preload.map(
    path => `<link rel="modulepreload" href="${escapeAttribute(resolve(path))}" crossorigin>`,
  );
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<script type="importmap">${jsonForScript({imports})}</script>`,
    ...preloads,
    `<link rel="stylesheet" href="${escapeAttribute(resolve(manifest.stylesheet))}" crossorigin>`,
    `<script type="application/json" id="${APP_CONFIG_ELEMENT_ID}">${jsonForScript(config)}</script>`,
    `<script type="module">import {start} from ${JSON.stringify(manifest.entry)}; start();</script>`,
    '</head>',
    '<body><div id="root"></div></body>',
    '</html>',
  ].join('\n');
}
