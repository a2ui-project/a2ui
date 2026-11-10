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

import type {SandboxCsp} from '../shared/sandbox/sandbox.js';

/**
 * Checks a URL against the surface's URL security policy, as
 * `ComponentContext.sanitizeUrl` does: returns the URL to use, or `undefined`
 * when it is blocked.
 */
export type CspUrlSanitizer = (url: string, context: UrlContext) => string | undefined;

/** The URL context each `_meta.ui.csp` list is checked as. */
export const CSP_DOMAIN_URL_CONTEXTS = {
  connectDomains: 'media',
  resourceDomains: 'media',
  frameDomains: 'iframe',
  baseUriDomains: 'navigation',
} as const satisfies Record<keyof SandboxCsp, UrlContext>;

// A CSP host source: optional scheme, a host (`*`, `*.example.com`, a host
// name, or a bracketed IPv6 address), an optional port (digits or `*`), and
// an optional path.
const HOST_SOURCE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?|\[[0-9a-f:.]+\])(?::(\d+|\*))?(\/[^\s;,]*)?$/i;
// A CSP scheme source, such as `https:`.
const SCHEME_SOURCE = /^([a-z][a-z0-9+.-]*):$/i;
// Schemes a CSP source may name, mapped to the scheme of the URL the policy
// checks. WebSocket connections are checked as the HTTP URL of their handshake.
const CHECKED_SCHEMES: Readonly<Record<string, string>> = {
  http: 'http',
  https: 'https',
  ws: 'http',
  wss: 'https',
};
// Schemes that load no resource from a server. The lists of a URL security
// policy don't apply to them, so they are kept as the app declared them.
const LOCAL_SCHEMES = new Set(['blob', 'data']);
// A port that is unlikely to be on a host allowlist, used with the default
// port to check a source with a port wildcard.
const PROBE_PORT = '1';

/**
 * Returns the URLs that must all pass the policy for a CSP source expression
 * to be kept, or `undefined` when the source can't be mapped to URLs and is
 * dropped.
 *
 * - A host source becomes a URL with the same scheme, host, port, and path
 *   (`/` when it has none). A source without a scheme is checked as `https`,
 *   and `ws`/`wss` as `http`/`https`.
 * - Host wildcards stay in the host: `*.example.com` is checked as
 *   `https://*.example.com/` and `*` as `https://*\/`. A host allowlist
 *   compares the `*` label literally, so a wildcard source only passes a
 *   wildcard entry that covers it (`*.example.com` or `*.com`), never an exact
 *   host such as `cdn.example.com`.
 * - A scheme source (`https:`) allows every host, so it is checked as
 *   `https://*\/`.
 * - A port wildcard (`:*`) is checked with the default port and with port 1,
 *   so it passes only when the policy allows any port.
 *
 * @param source A CSP source expression from a `_meta.ui.csp` list.
 */
export function cspSourceToUrls(source: string): string[] | undefined {
  const schemeOnly = SCHEME_SOURCE.exec(source);
  if (schemeOnly) {
    const scheme = CHECKED_SCHEMES[schemeOnly[1].toLowerCase()];
    return scheme ? [`${scheme}://*/`] : undefined;
  }
  const match = HOST_SOURCE.exec(source);
  if (!match) return undefined;
  const [, rawScheme, host, port, path] = match;
  const scheme = rawScheme === undefined ? 'https' : CHECKED_SCHEMES[rawScheme.toLowerCase()];
  if (!scheme) return undefined;
  const urlPath = path ?? '/';
  if (port === '*') {
    return [`${scheme}://${host}${urlPath}`, `${scheme}://${host}:${PROBE_PORT}${urlPath}`];
  }
  return [`${scheme}://${host}${port === undefined ? '' : `:${port}`}${urlPath}`];
}

/**
 * Returns whether the policy allows a CSP source expression in the given URL
 * context.
 *
 * Every URL from {@link cspSourceToUrls} must be allowed. A policy that
 * rewrites a URL to another scheme or host (for example to route it through a
 * proxy) doesn't allow the source: the app would still connect to the original
 * host directly. `data:` and `blob:` sources load nothing from a server and are
 * always kept.
 *
 * @param source A CSP source expression from a `_meta.ui.csp` list.
 * @param context How the app uses the source.
 * @param sanitize The policy check, usually the component's `sanitizeUrl`.
 */
export function isCspSourceAllowed(
  source: string,
  context: UrlContext,
  sanitize: CspUrlSanitizer,
): boolean {
  if (LOCAL_SCHEMES.has(SCHEME_SOURCE.exec(source)?.[1].toLowerCase() ?? '')) return true;
  const urls = cspSourceToUrls(source);
  if (!urls) return false;
  return urls.every(url => {
    const allowed = sanitize(url, context);
    return allowed !== undefined && sameSchemeAndHost(allowed, url);
  });
}

function sameSchemeAndHost(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual);
    const b = new URL(expected);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

/**
 * Removes the sources the URL security policy doesn't allow from each
 * `_meta.ui.csp` list, so the CSP the app runs under is the overlap of what
 * it asks for and what the host allows.
 *
 * `connectDomains` and `resourceDomains` are checked as `media`,
 * `frameDomains` as `iframe`, and `baseUriDomains` as `navigation` (see
 * {@link isCspSourceAllowed}). Lists the app didn't set stay unset; a list
 * whose sources are all removed becomes empty, which the sandbox treats like
 * an unset list.
 *
 * @param csp The app's `_meta.ui.csp`.
 * @param sanitize The policy check, usually the component's `sanitizeUrl`.
 * @returns A new CSP object with only the allowed sources.
 */
export function capCspByUrlPolicy(csp: SandboxCsp, sanitize: CspUrlSanitizer): SandboxCsp {
  const capped: Partial<Record<keyof SandboxCsp, readonly string[]>> = {};
  for (const [key, context] of Object.entries(CSP_DOMAIN_URL_CONTEXTS) as Array<
    [keyof SandboxCsp, UrlContext]
  >) {
    const domains = csp[key];
    if (!Array.isArray(domains)) continue;
    capped[key] = domains.filter(
      (source): source is string =>
        typeof source === 'string' && isCspSourceAllowed(source.trim(), context, sanitize),
    );
  }
  return capped;
}
