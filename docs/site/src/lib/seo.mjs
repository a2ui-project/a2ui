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

import {normalizeBasePrefix} from './spec-schemas.mjs';

export const DEFAULT_SITE_ORIGIN = 'https://a2ui.org';
export const SITE_NAME = 'A2UI';
export const DEFAULT_OG_IMAGE_PATH = '/assets/a2ui_gallery_examples.png';
export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';

/**
 * Strips any `#fragment` suffix from a URL string while preserving path and query.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function stripHashFromUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const hashIndex = rawUrl.indexOf('#');
  return hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex);
}

/**
 * Builds the `robots.txt` body for root production builds vs subpath (`ASTRO_BASE`)
 * preview builds.
 *
 * @param {{site?: string | URL, base?: string}} [options]
 * @returns {string}
 */
export function buildRobotsTxt({site = DEFAULT_SITE_ORIGIN, base = ''} = {}) {
  const basePrefix = normalizeBasePrefix(base);
  if (basePrefix) {
    return ['User-agent: *', 'Disallow: /', ''].join('\n');
  }
  const sitemapHref = new URL('/sitemap-index.xml', site || DEFAULT_SITE_ORIGIN).href;
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /pr-preview/',
    '',
    `Sitemap: ${sitemapHref}`,
    '',
  ].join('\n');
}
