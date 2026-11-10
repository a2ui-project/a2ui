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

import type {UrlContext} from '@a2ui/web_core';

/**
 * Checks a URL against the surface's URL security policy, as
 * `ComponentContext.sanitizeUrl` does: returns the URL to use, or `undefined`
 * when it is blocked.
 */
export type ChartUrlSanitizer = (url: string, context: UrlContext) => string | undefined;

/** Options Vega passes to `loader.sanitize`; `context` says how the URL is used. */
export interface VegaSanitizeOptions {
  readonly context?: string;
  readonly [key: string]: unknown;
}

/**
 * What `loader.sanitize` resolves to: the attributes of the link or request.
 * Vega's own loader also sets a non-enumerable `localFile` flag.
 */
export interface VegaSanitizedUrl {
  href: string;
  readonly localFile?: boolean;
  [key: string]: unknown;
}

/** The part of a Vega loader (`vega.loader()`) Vega calls while rendering a spec. */
export interface VegaLoaderLike {
  sanitize(uri: string, options?: VegaSanitizeOptions): Promise<VegaSanitizedUrl>;
  load(uri: string, options?: VegaSanitizeOptions): Promise<string>;
}

/** The base loader methods the policy loader delegates to. */
export interface VegaBaseLoader {
  sanitize(uri: string, options?: VegaSanitizeOptions): Promise<VegaSanitizedUrl>;
  http(url: string, options?: VegaSanitizeOptions): Promise<string>;
  file(path: string): Promise<string>;
}

/** Message of the error a blocked URL rejects with; it never includes the URL. */
export const BLOCKED_CHART_URL_MESSAGE = 'URL blocked by the URL security policy';

/**
 * Returns a Vega loader that checks every URL in a spec against the URL
 * security policy before Vega fetches, loads, or opens it.
 *
 * Vega sends every URL through the loader: data URLs through `load` (and so
 * `sanitize`), image marks through `sanitize` with `context: 'image'`, and the
 * `href` channel through `sanitize` with `context: 'href'`. `href` URLs are
 * checked as `navigation` and every other URL as `media`. A blocked URL
 * rejects, so Vega doesn't request or open it; an allowed one, possibly
 * rewritten, goes through the base loader's own checks and `baseURL`
 * handling, and is fetched by the base loader.
 *
 * The policy check runs synchronously when Vega calls the loader, so `base`
 * may still be loading.
 *
 * @param base The loader to delegate to, usually `vega.loader()`, or a
 *   promise of it.
 * @param sanitizeUrl The policy check, usually the component's `sanitizeUrl`.
 */
export function createUrlPolicyLoader(
  base: VegaBaseLoader | Promise<VegaBaseLoader>,
  sanitizeUrl: ChartUrlSanitizer,
): VegaLoaderLike {
  const ready = Promise.resolve(base);
  // A base that fails to load rejects each call that awaits it, not here.
  ready.catch(() => {});
  const loader: VegaLoaderLike = {
    async sanitize(uri, options) {
      const context: UrlContext = options?.context === 'href' ? 'navigation' : 'media';
      const allowed = typeof uri === 'string' ? sanitizeUrl(uri, context) : undefined;
      if (allowed === undefined) {
        throw new Error(BLOCKED_CHART_URL_MESSAGE);
      }
      return (await ready).sanitize(allowed, options);
    },
    async load(uri, options) {
      const sanitized = await loader.sanitize(uri, options);
      const resolved = await ready;
      return sanitized.localFile
        ? resolved.file(sanitized.href)
        : resolved.http(sanitized.href, options);
    },
  };
  return loader;
}
