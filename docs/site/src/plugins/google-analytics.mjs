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

import {normalizeBasePrefix} from '../lib/spec-schemas.mjs';

export const DEFAULT_GA_MEASUREMENT_ID = 'G-YX9TPV8DCC';

function validateMeasurementId(measurementId) {
  if (typeof measurementId !== 'string' || !/^G-[A-Z0-9]+$/i.test(measurementId)) {
    throw new Error(`Invalid Google Analytics measurement ID: "${measurementId}"`);
  }
}

export function buildGoogleAnalyticsSnippet(measurementId = DEFAULT_GA_MEASUREMENT_ID) {
  validateMeasurementId(measurementId);
  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>`,
    '<script>',
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js', new Date());",
    `gtag('config', '${measurementId}');`,
    '</script>',
  ].join('\n');
}

/**
 * Injects the Google Analytics (`gtag.js`) loader and config snippet before
 * `</head>` on full HTML documents, skipping static `<meta http-equiv="refresh">`
 * redirect stubs and documents where the tag is already present.
 */
export function injectGoogleAnalyticsHead(html, measurementId = DEFAULT_GA_MEASUREMENT_ID) {
  validateMeasurementId(measurementId);
  if (/<meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?/i.test(html)) {
    return html;
  }
  if (html.includes(`https://www.googletagmanager.com/gtag/js?id=${measurementId}`)) {
    return html;
  }
  if (!/<\/head>/i.test(html)) {
    return html;
  }
  const snippet = buildGoogleAnalyticsSnippet(measurementId);
  return html.replace(/<\/head>/i, match => `${snippet}\n${match}`);
}

export async function onRequest(_context, next) {
  const response = await next();
  if (
    !response.body ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304 ||
    (response.status >= 300 && response.status < 400)
  ) {
    return response;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) {
    return response;
  }

  const measurementId =
    // eslint-disable-next-line no-undef
    typeof __A2UI_GA_ID__ !== 'undefined' ? __A2UI_GA_ID__ : DEFAULT_GA_MEASUREMENT_ID;
  const originalHtml = await response.text();
  const updatedHtml = injectGoogleAnalyticsHead(originalHtml, measurementId);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(updatedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function isPrPreviewBase(base) {
  const normalized = normalizeBasePrefix(base);
  return normalized === '/pr-preview' || normalized.startsWith('/pr-preview/');
}

export function shouldEnableGoogleAnalytics({command, base} = {}) {
  if (command !== 'build') {
    return false;
  }
  return !isPrPreviewBase(base);
}

/**
 * Astro integration that injects Google Analytics (`gtag.js`) globally into the
 * `<head>` of every HTML page rendered by Astro (both Starlight docs routes and
 * standalone `.astro` pages) during production `astro build` runs, skipping
 * local `astro dev` and `/pr-preview/` pull-request preview builds.
 *
 * @param {string} [measurementId]
 * @returns {import('astro').AstroIntegration}
 */
export function googleAnalytics(measurementId = DEFAULT_GA_MEASUREMENT_ID) {
  validateMeasurementId(measurementId);
  return {
    name: 'a2ui-google-analytics',
    hooks: {
      'astro:config:setup': ({addMiddleware, command, config, updateConfig}) => {
        if (!shouldEnableGoogleAnalytics({command, base: config?.base})) {
          return;
        }
        updateConfig({
          vite: {
            define: {
              __A2UI_GA_ID__: JSON.stringify(measurementId),
            },
          },
        });
        addMiddleware({
          entrypoint: new URL(import.meta.url),
          order: 'post',
        });
      },
    },
  };
}
