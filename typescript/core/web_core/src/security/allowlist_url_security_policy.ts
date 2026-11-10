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

import {
  classifyBaselineUrl,
  URL_CONTEXTS,
  type UrlCheckInfo,
  type UrlContext,
  type UrlPropertyMap,
  type UrlSecurityPolicy,
  type UrlSecurityPolicyOptions,
} from './url_security_policy.js';

/**
 * Rewrites an allowed URL, for example to route it through a proxy. Returns
 * the URL to use, or `undefined` to block it.
 */
export type UrlRewriteHook = (
  url: string,
  context: UrlContext,
  info?: UrlCheckInfo,
) => string | undefined;

/** Options of {@link AllowlistUrlSecurityPolicy}. */
export interface AllowlistUrlSecurityPolicyOptions extends UrlSecurityPolicyOptions {
  /**
   * Hosts that `media` URLs may point to. Leaving it out keeps `media` at the
   * baseline checks; an empty list blocks every `http(s)` media URL.
   */
  readonly media?: readonly string[];
  /** Hosts that `navigation` URLs may point to. */
  readonly navigation?: readonly string[];
  /** Hosts that `iframe` URLs may point to. */
  readonly iframe?: readonly string[];
  /**
   * Contexts that keep allowing relative URLs even though they have a host
   * list. A context with a host list blocks relative URLs by default.
   */
  readonly allowRelative?: readonly UrlContext[];
  /**
   * Hooks that rewrite URLs the lists allowed, per context. The rewritten URL
   * still has to pass the baseline checks.
   */
  readonly rewrite?: Partial<Readonly<Record<UrlContext, UrlRewriteHook>>>;
}

interface HostMatcher {
  /** Exact hosts, or subdomain suffixes (with a leading dot) for wildcards. */
  readonly exact: ReadonlySet<string>;
  readonly suffixes: readonly string[];
  /** Whether an entry has a port, so the comparison uses `host:port`. */
  readonly withPort: boolean;
}

/**
 * A policy that limits each URL context to a list of hosts.
 *
 * Host entries are exact hosts (`cdn.example.com`) or subdomain wildcards
 * (`*.example.com`, which matches `a.example.com` and `a.b.example.com` but
 * not `example.com`), compared case-insensitively. An entry with a port
 * (`localhost:8080`) matches only that port; one without matches any port.
 *
 * Once a context has a list, relative URLs are blocked for it unless the
 * context is in `allowRelative`. URLs without a host (`data:` media,
 * `mailto:` and `tel:` links) make no request to a server, so the lists don't
 * apply to them; the baseline still limits them to their contexts.
 *
 * @example
 * ```ts
 * new MessageProcessor([basicCatalog], undefined, {
 *   urlSecurityPolicy: new AllowlistUrlSecurityPolicy({
 *     media: ['cdn.example.com', '*.googleusercontent.com'],
 *     navigation: ['*.example.com'],
 *     rewrite: {media: url => `https://proxy.example.com/?u=${encodeURIComponent(url)}`},
 *   }),
 * });
 * ```
 */
export class AllowlistUrlSecurityPolicy implements UrlSecurityPolicy {
  readonly allowSvgDataUrls: boolean;
  readonly urlProperties?: UrlPropertyMap;
  private readonly matchers: Partial<Record<UrlContext, HostMatcher>> = {};
  private readonly allowRelative: ReadonlySet<UrlContext>;
  private readonly rewrite: Partial<Readonly<Record<UrlContext, UrlRewriteHook>>>;

  /**
   * Creates an allowlist policy.
   *
   * @param options Host lists per context, plus relative URL, rewrite, SVG,
   *   and URL property options.
   * @throws {TypeError} If a host entry is not a host or a `*.` wildcard.
   */
  constructor(options: AllowlistUrlSecurityPolicyOptions = {}) {
    this.allowSvgDataUrls = options.allowSvgDataUrls ?? false;
    this.urlProperties = options.urlProperties;
    this.allowRelative = new Set(options.allowRelative ?? []);
    this.rewrite = {...options.rewrite};
    for (const context of URL_CONTEXTS) {
      const hosts = options[context];
      if (hosts !== undefined) this.matchers[context] = compileHosts(hosts, context);
    }
  }

  /** {@inheritDoc UrlSecurityPolicy.sanitizeUrl} */
  sanitizeUrl(url: string, context: UrlContext, info?: UrlCheckInfo): string | undefined {
    const kind = classifyBaselineUrl(url, context, this.allowSvgDataUrls);
    if (kind === undefined) return undefined;
    const matcher = this.matchers[context];
    if (matcher) {
      if (kind === 'relative' && !this.allowRelative.has(context)) return undefined;
      if (kind === 'http' && !matchesHost(matcher, new URL(url))) return undefined;
    }
    const rewrite = this.rewrite[context];
    return rewrite ? rewrite(url, context, info) : url;
  }
}

function compileHosts(hosts: readonly string[], context: UrlContext): HostMatcher {
  const exact = new Set<string>();
  const suffixes: string[] = [];
  let withPort = false;
  for (const entry of hosts) {
    const isWildcard = typeof entry === 'string' && entry.startsWith('*.');
    const host = normalizeHostEntry(isWildcard ? entry.slice(2) : entry);
    if (host === undefined) {
      throw new TypeError(
        `Invalid ${context} host entry '${String(entry)}': use a host such as ` +
          "'cdn.example.com', a host with a port, or a subdomain wildcard such as '*.example.com'.",
      );
    }
    if (host.includes(':') && !host.endsWith(']')) withPort = true;
    if (isWildcard) suffixes.push(`.${host}`);
    else exact.add(host);
  }
  return {exact, suffixes, withPort};
}

/**
 * Normalizes a host entry the way the URL parser normalizes hosts (lower
 * case, punycode, no trailing dot), or returns `undefined` if the entry is
 * not a bare host with an optional port.
 */
function normalizeHostEntry(entry: unknown): string | undefined {
  if (typeof entry !== 'string' || !entry || /[/?#@*\s\\]/.test(entry)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(`https://${entry}`);
  } catch {
    return undefined;
  }
  const hostname = stripTrailingDot(parsed.hostname);
  if (!hostname) return undefined;
  return parsed.port ? `${hostname}:${parsed.port}` : hostname;
}

function stripTrailingDot(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

function matchesHost(matcher: HostMatcher, url: URL): boolean {
  const hostname = stripTrailingDot(url.hostname);
  const candidates = [hostname];
  if (matcher.withPort) {
    // `URL.port` is empty for the scheme's default port.
    const port = url.port || (url.protocol === 'http:' ? '80' : '443');
    candidates.push(`${hostname}:${port}`);
  }
  return candidates.some(
    candidate =>
      matcher.exact.has(candidate) || matcher.suffixes.some(suffix => candidate.endsWith(suffix)),
  );
}
