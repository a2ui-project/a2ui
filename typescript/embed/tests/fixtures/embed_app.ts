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
 * The app under test: `startEmbedApp` with the basic catalog and the markdown renderer, as the
 * build command generates it. The handle is exposed on `window` so the tests can close the app.
 */
import {renderMarkdown} from '@a2ui/markdown-it';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {startEmbedApp, type EmbedAppHandle} from '../../src/mcp/index.js';

declare global {
  interface Window {
    embedApp?: EmbedAppHandle;
  }
}

window.embedApp = startEmbedApp({
  catalogs: [basicCatalog],
  appInfo: {name: 'embed-test-app', version: '0.0.0'},
  markdown: renderMarkdown,
});
