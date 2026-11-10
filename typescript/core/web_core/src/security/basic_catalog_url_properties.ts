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

/**
 * @fileoverview URL properties of the basic catalogs, whose published
 * documents carry no `x-a2ui-url-context` annotations.
 *
 * The code-defined basic components also mark these properties on their Zod
 * schemas (kept out of the catalog document), so the marks follow the
 * components into catalogs with other IDs. This list covers basic catalogs
 * loaded from their JSON documents.
 */

import type {UrlContextAnnotation, UrlPropertyMap} from './url_security_policy.js';

const BASIC_COMPONENT_URL_PROPERTIES: Readonly<
  Record<string, Readonly<Record<string, UrlContextAnnotation>>>
> = {
  Image: {url: 'media'},
  Video: {url: 'media', posterUrl: 'media'},
  AudioPlayer: {url: 'media'},
};

/** Identifiers of the basic catalogs, which share the theme's `iconUrl`. */
export const BASIC_CATALOG_IDS: ReadonlySet<string> = new Set([
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
]);

/**
 * URL properties of the basic catalogs, by catalog ID, then component type,
 * then property name. Renderers apply them on their own; code that checks
 * payloads against a basic catalog loaded from JSON, such as an agent, can
 * pass them where it would read `x-a2ui-url-context`.
 */
export const BASIC_CATALOG_URL_PROPERTIES: UrlPropertyMap = Object.fromEntries(
  [...BASIC_CATALOG_IDS].map(id => [id, BASIC_COMPONENT_URL_PROPERTIES]),
);
