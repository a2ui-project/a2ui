/*
 * Copyright 2026 Google LLC
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
 * The catalogs the client renders with: the basic catalog, the ReactApp catalog, and the demo
 * catalog, which declares the agent's functions without implementing them so calls go to the
 * agent as `callAgentFunction`.
 */
import frauncesUrl from '@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2?inline';
import plex400Url from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?inline';
import plex500Url from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?inline';
import plex600Url from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?inline';
import {configureReactApp, reactAppCatalog, type ThemeFontFace} from '@a2ui-labs/react-app';
import type {ReactCatalogComponent} from '@a2ui/react';
import {basicCatalog, Catalog, type FunctionApi} from '@a2ui/web_core/v1_0';
import {z} from 'zod';

/** Must match `DEMO_CATALOG_ID` in the agent. */
export const DEMO_CATALOG_ID = 'https://a2ui.org/labs/react_app/demo/v1/catalog.json';

const estimateTravelTime: FunctionApi = {
  name: 'estimateTravelTime',
  returnType: 'number',
  schema: z.object({stops: z.array(z.unknown())}),
};

const querySales: FunctionApi = {
  name: 'querySales',
  returnType: 'array',
  schema: z.object({region: z.string(), from: z.string(), to: z.string()}),
};

/**
 * Schema-only functions make a catalog of declarations; `Catalog`'s type parameter defaults to
 * implemented functions, hence the cast (see the SDK friction notes in the README).
 */
const demoCatalog = new Catalog(DEMO_CATALOG_ID, '1.0', [], [estimateTravelTime, querySales]);

/**
 * The page's fonts, for the app frames: they can't fetch the page's files (opaque origin), so
 * the faces travel as data: URLs in the theme and apps match the native components.
 */
const woff2 = (url: string) => `url(${url}) format("woff2")`;
const fontFaces: ThemeFontFace[] = [
  {family: 'IBM Plex Sans', src: woff2(plex400Url), weight: '400'},
  {family: 'IBM Plex Sans', src: woff2(plex500Url), weight: '500'},
  {family: 'IBM Plex Sans', src: woff2(plex600Url), weight: '600'},
  {family: 'Fraunces Variable', src: woff2(frauncesUrl), weight: '100 900'},
];

/** Where the dev server serves the runtime and the sandbox proxy (see vite.config.ts). */
configureReactApp({runtimeBaseUrl: '/a2ui-sandbox/react-app/v1/', fontFaces});

/** The catalogs, in the order the agent's prompt lists them. */
export const catalogs = [basicCatalog, demoCatalog, reactAppCatalog] as unknown as Array<
  Catalog<ReactCatalogComponent>
>;
