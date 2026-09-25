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

import {Catalog} from '@a2ui/web_core/v0_9';
import type {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {A2uiWebAppFrameSrcdoc} from './components/web_app_frame_srcdoc.js';
import {A2uiWebAppFrameUrl} from './components/web_app_frame_url.js';

/** `$id` of the iframe catalog schema (`catalogs/iframe/catalog.json`). */
export const IFRAME_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/iframe/catalog.json';

/**
 * The iframe catalog: `WebAppFrameUrl` and `WebAppFrameSrcdoc`, ready to hand to a
 * `MessageProcessor`. A surface that mixes them with other components needs one catalog holding
 * every component it uses; build it with `new Catalog(id, [...])` from this catalog's
 * `components` and the others'.
 */
export const iframeCatalog = new Catalog<WebComponentImplementation>(IFRAME_CATALOG_ID, [
  A2uiWebAppFrameUrl,
  A2uiWebAppFrameSrcdoc,
]);
