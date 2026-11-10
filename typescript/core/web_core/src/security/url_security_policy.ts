/*
 * Copyright 2026 Google LLC
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
 * How a renderer uses a URL, which decides the rules it is checked against.
 *
 * - `media`: loaded automatically without a click, such as an image, video,
 *   or audio source.
 * - `navigation`: opened when the user acts, such as a link or `openUrl`.
 * - `iframe`: embedded in a frame.
 */
export type UrlContext = 'media' | 'navigation' | 'iframe';

/**
 * The URL context a catalog property declares with `x-a2ui-url-context`.
 * `'none'` states that a property is not a URL, even if its name looks like
 * one or a built-in list would treat it as one.
 */
export type UrlContextAnnotation = UrlContext | 'none';

/** Every URL context, in a stable order. */
export const URL_CONTEXTS: readonly UrlContext[] = ['media', 'navigation', 'iframe'];

/**
 * Details about where a URL comes from, for logging and per-component rules.
 *
 * Contexts fill in what they know: `ComponentContext.sanitizeUrl` adds the
 * surface, catalog, component type, and component ID, and the resolver adds
 * the property name.
 */
export interface UrlCheckInfo {
  /** Identifier of the surface the URL appears on. */
  readonly surfaceId?: string;
  /** Identifier of the catalog of the component or function using the URL. */
  readonly catalogId?: string;
  /** Type of the component using the URL, such as `'Image'`. */
  readonly componentType?: string;
  /** Identifier of the component instance using the URL. */
  readonly componentId?: string;
  /**
   * Name of the property holding the URL. Nested properties are written as
   * a path, with `[]` for list items, such as `'items[].imageUrl'`.
   */
  readonly propertyName?: string;
  /** Name of the function using the URL, such as `'openUrl'`. */
  readonly functionName?: string;
}

/**
 * URL properties of catalogs that a host can't annotate itself, keyed by
 * catalog ID, then component type, then property name.
 *
 * @example
 * ```ts
 * const urlProperties: UrlPropertyMap = {
 *   'https://maps.example.com/catalog.json': {MapTile: {tileUrl: 'media'}},
 * };
 * ```
 */
export type UrlPropertyMap = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, UrlContextAnnotation>>>>>
>;

/**
 * Decides which URLs a renderer may load, open, or embed.
 *
 * Set one on `MessageProcessorOptions.urlSecurityPolicy`. Every URL a policy
 * sees has already passed the built-in baseline checks, and whatever it
 * returns is checked by the baseline again, so a policy can only narrow or
 * rewrite what the baseline allows.
 */
export interface UrlSecurityPolicy {
  /**
   * Returns the URL to use, possibly rewritten (for example through a media
   * proxy), or `undefined` to block it.
   *
   * @param url The URL, exactly as the agent or data model gave it.
   * @param context How the renderer uses the URL.
   * @param info Where the URL comes from, when known.
   * @returns The URL to use, or `undefined` when it is blocked.
   */
  sanitizeUrl(url: string, context: UrlContext, info?: UrlCheckInfo): string | undefined;
  /**
   * Whether `data:image/svg+xml` URLs are allowed as `media`. The baseline
   * blocks them unless the policy opts in.
   */
  readonly allowSvgDataUrls?: boolean;
  /**
   * URL properties of catalogs the host can't annotate. An entry here wins
   * over a catalog's own `x-a2ui-url-context` annotation.
   */
  readonly urlProperties?: UrlPropertyMap;
}

/** Options shared by the built-in policies. */
export interface UrlSecurityPolicyOptions {
  /** Allows `data:image/svg+xml` URLs as `media`. Defaults to `false`. */
  readonly allowSvgDataUrls?: boolean;
  /** URL properties of catalogs the host can't annotate. */
  readonly urlProperties?: UrlPropertyMap;
}

// Control characters, spaces, DEL, and backslashes. Browsers strip or ignore
// some of them and treat backslashes as path separators, either of which can
// hide a different host from a check.
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const UNSAFE_CHARACTERS = /[\u0000-\u0020\u007f\\]/;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
// `https://` followed by a host, not by another slash (which the URL parser
// would otherwise skip, turning `https:///evil.example` into a host).
const HTTP_WITH_AUTHORITY = /^https?:\/\/[^/?#]/i;
const MEDIA_DATA_URL = /^data:(?:image|audio|video)\/[a-z0-9!#$&^_.+-]+[;,]/i;
const SVG_DATA_URL = /^data:image\/svg\+xml[;,]/i;

/**
 * The scheme-level kind of a URL that passed the baseline checks.
 */
export type BaselineUrlKind = 'http' | 'relative' | 'data' | 'mailto' | 'tel';

/**
 * Runs the built-in baseline checks every URL passes before and after a
 * policy, whatever the policy is.
 *
 * - Control characters, spaces, and backslashes are rejected anywhere in the
 *   URL, including at its ends.
 * - `http:` and `https:` URLs need `//` and a host (`https:evil.example` and
 *   protocol-relative `//evil.example` are rejected).
 * - `data:` URLs are allowed only as `media`, only with an `image/*`,
 *   `audio/*`, or `video/*` type, and not as `data:image/svg+xml` unless
 *   `allowSvgDataUrls` is set.
 * - `mailto:` and `tel:` are allowed only as `navigation`.
 * - Relative URLs are allowed as `media` and `navigation`, not as `iframe`.
 * - Every other scheme (`javascript:`, `file:`, `blob:`, and so on) is rejected.
 *
 * @param url The URL to check.
 * @param context How the renderer uses the URL.
 * @param allowSvgDataUrls Whether `data:image/svg+xml` is allowed as `media`.
 * @returns The kind of URL, or `undefined` when the baseline rejects it.
 */
export function classifyBaselineUrl(
  url: unknown,
  context: UrlContext,
  allowSvgDataUrls = false,
): BaselineUrlKind | undefined {
  if (typeof url !== 'string' || !url || UNSAFE_CHARACTERS.test(url)) return undefined;

  const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined) {
    if (url.startsWith('//')) return undefined;
    return context === 'iframe' ? undefined : 'relative';
  }
  switch (scheme) {
    case 'http':
    case 'https':
      return HTTP_WITH_AUTHORITY.test(url) && parseHostname(url) ? 'http' : undefined;
    case 'data':
      if (context !== 'media' || !MEDIA_DATA_URL.test(url)) return undefined;
      return SVG_DATA_URL.test(url) && !allowSvgDataUrls ? undefined : 'data';
    case 'mailto':
    case 'tel':
      return context === 'navigation' ? scheme : undefined;
    default:
      return undefined;
  }
}

/**
 * Returns the URL if it passes the baseline checks of
 * {@link classifyBaselineUrl}, or `undefined` if it does not.
 *
 * @param url The URL to check.
 * @param context How the renderer uses the URL.
 * @param allowSvgDataUrls Whether `data:image/svg+xml` is allowed as `media`.
 */
export function checkUrlBaseline(
  url: unknown,
  context: UrlContext,
  allowSvgDataUrls = false,
): string | undefined {
  return classifyBaselineUrl(url, context, allowSvgDataUrls) === undefined
    ? undefined
    : (url as string);
}

function parseHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The default policy: allows every URL that passes the built-in baseline
 * checks, unchanged.
 *
 * @example
 * ```ts
 * // Same as leaving `urlSecurityPolicy` unset, but also allows SVG data URLs.
 * new MessageProcessor([basicCatalog], undefined, {
 *   urlSecurityPolicy: new PermissiveUrlSecurityPolicy({allowSvgDataUrls: true}),
 * });
 * ```
 */
export class PermissiveUrlSecurityPolicy implements UrlSecurityPolicy {
  readonly allowSvgDataUrls: boolean;
  readonly urlProperties?: UrlPropertyMap;

  /**
   * Creates a permissive policy.
   *
   * @param options Optional SVG data URL opt-in and URL property map.
   */
  constructor(options: UrlSecurityPolicyOptions = {}) {
    this.allowSvgDataUrls = options.allowSvgDataUrls ?? false;
    this.urlProperties = options.urlProperties;
  }

  /** {@inheritDoc UrlSecurityPolicy.sanitizeUrl} */
  sanitizeUrl(url: string, context: UrlContext, _info?: UrlCheckInfo): string | undefined {
    return checkUrlBaseline(url, context, this.allowSvgDataUrls);
  }
}

/** The policy used where none is configured. */
export const DEFAULT_URL_SECURITY_POLICY: UrlSecurityPolicy = new PermissiveUrlSecurityPolicy();

/**
 * Checks a URL with the baseline, then the policy, then the baseline again on
 * what the policy returned. A policy that throws blocks the URL.
 *
 * Package-internal; components and functions call `sanitizeUrl` on the
 * context they receive instead.
 *
 * @param policy The policy to apply.
 * @param url The URL to check.
 * @param context How the renderer uses the URL.
 * @param info Where the URL comes from.
 * @returns The URL to use, or `undefined` when it is blocked.
 */
export function applyUrlSecurityPolicy(
  policy: UrlSecurityPolicy,
  url: unknown,
  context: UrlContext,
  info?: UrlCheckInfo,
): string | undefined {
  const allowSvg = Boolean(policy.allowSvgDataUrls);
  if (checkUrlBaseline(url, context, allowSvg) === undefined) return undefined;
  let result: unknown;
  try {
    result = policy.sanitizeUrl(url as string, context, info);
  } catch {
    return undefined;
  }
  if (typeof result !== 'string') return undefined;
  return result === url ? result : checkUrlBaseline(result, context, allowSvg);
}
