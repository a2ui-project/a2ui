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
 * Module-level configuration of the ReactApp component: where the host serves the runtime and
 * the sandbox proxy. Set once at startup with {@link configureReactApp}.
 */

import {
  configureSandbox,
  resetSandboxConfig,
  type SandboxConfig,
} from './shared/sandbox/sandbox_config.js';
import type {ThemeFontFace} from './theme_tokens.js';

/** The runtime's `manifest.json` (written by `@a2ui-labs/react-app-runtime`'s build). */
export interface ReactAppRuntimeManifest {
  readonly version: string;
  readonly protocolVersion: string;
  readonly importMap: {readonly imports: Readonly<Record<string, string>>};
  readonly entry: string;
  readonly stylesheet: string;
  readonly preload: readonly string[];
  readonly chunks?: readonly string[];
}

/** A manifest and the URL its relative paths resolve against. */
export interface LoadedRuntime {
  readonly manifest: ReactAppRuntimeManifest;
  readonly baseUrl: URL;
  /** Whether the manifest's modules and stylesheet were inlined as `data:` URLs. */
  readonly inlineDataUrls?: boolean;
}

/** Default directory of the runtime, next to the sandbox proxy. */
export const DEFAULT_RUNTIME_BASE_URL = '/a2ui-sandbox/react-app/v1/';

/** Host settings of the ReactApp component. */
export interface ReactAppConfig {
  /**
   * Directory the runtime files and `manifest.json` are served from, resolved against the
   * document base URL. It may be on another origin; the files must be served with
   * `Access-Control-Allow-Origin: *`.
   */
  readonly runtimeBaseUrl?: string;
  /** The manifest, for hosts that bundle it instead of fetching it. */
  readonly manifest?: ReactAppRuntimeManifest;
  /**
   * Whether `loadRuntime` fetches the runtime's JS modules and stylesheet on the host page and
   * turns them into `data:` URLs in the import map (with `preload` cleared). The inner sandboxed
   * frame has an opaque `"null"` origin, so its module fetches omit cookies and fail behind
   * authenticating reverse proxies (such as Uberproxy).
   *
   * Defaults to `true` when `manifest` is not pre-supplied and `runtimeBaseUrl` is omitted or
   * relative, and `false` otherwise.
   */
  readonly inlineDataUrls?: boolean;
  /** CSS custom properties to send to the app besides the `--a2ui-*` ones. */
  readonly themeVariables?: readonly string[];
  /**
   * Font faces sent to the app with the theme. The frame can't see the page's `@font-face`
   * rules, so list the faces of the fonts the `--a2ui-font-family*` variables name. `src` can be
   * a `data:` URL, or a URL on the runtime's origin: the frame's CSP allows only those for fonts.
   */
  readonly fontFaces?: readonly ThemeFontFace[];
  /** Where the host serves the sandbox proxy pages; see `SandboxConfig`. */
  readonly sandbox?: Partial<SandboxConfig>;
}

const RELATIVE_JS_SPECIFIER =
  /(?<=\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.\.?\/[^'"]+\.js)\1/g;

let currentConfig: ReactAppConfig = {};
let loading: {key: string; promise: Promise<LoadedRuntime>} | null = null;

/**
 * Configures the component. Unspecified fields keep their current values. `sandbox` is
 * forwarded to the sandbox configuration.
 */
export function configureReactApp(config: ReactAppConfig): void {
  const {sandbox, ...rest} = config;
  currentConfig = {...currentConfig, ...rest};
  loading = null;
  if (sandbox) {
    configureSandbox(sandbox);
  }
}

/** The current configuration. */
export function getReactAppConfig(): ReactAppConfig {
  return currentConfig;
}

/** Clears the configuration; tests call it in teardown. */
export function resetReactAppConfig(): void {
  currentConfig = {};
  loading = null;
  resetSandboxConfig();
}

/** The runtime directory URL of the current configuration. */
export function resolveRuntimeBaseUrl(documentBase: string = document.baseURI): URL {
  const base = currentConfig.runtimeBaseUrl ?? DEFAULT_RUNTIME_BASE_URL;
  return new URL(base.endsWith('/') ? base : `${base}/`, documentBase);
}

function isRelativeUrl(url: string | undefined): boolean {
  return url === undefined || !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url);
}

function toBase64DataUrl(text: string, mimeType: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function canonicalRelPath(targetUrl: URL, baseUrl: URL): string {
  return targetUrl.href.startsWith(baseUrl.href)
    ? `./${targetUrl.href.slice(baseUrl.href.length)}`
    : targetUrl.href;
}

function chunkSpecifier(relPath: string): string {
  return `a2ui-chunk/${relPath.replace(/^\.\//, '')}`;
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Loading the ReactApp runtime asset ${url} failed: HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Fetches the runtime's JS modules, shared/lazy chunks and stylesheet via the host's `fetchImpl`
 * and returns a manifest whose `importMap.imports` and `stylesheet` are `data:` URLs and whose
 * `preload` is empty. Relative imports between runtime files are rewritten to bare `a2ui-chunk/*`
 * specifiers in the import map so all entries share one instance of every chunk in memory.
 */
export async function inlineRuntimeAsDataUrls(
  manifest: ReactAppRuntimeManifest,
  baseUrl: URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ReactAppRuntimeManifest> {
  const rawSources = new Map<string, string>();
  const pending = new Set<string>();
  const enqueue = (path: string) => {
    if (!path || path.startsWith('data:')) {
      return;
    }
    const rel = canonicalRelPath(new URL(path, baseUrl), baseUrl);
    if (!rawSources.has(rel)) {
      pending.add(rel);
    }
  };

  for (const path of Object.values(manifest.importMap.imports)) {
    enqueue(path);
  }
  for (const path of manifest.preload) {
    enqueue(path);
  }
  for (const path of manifest.chunks ?? []) {
    enqueue(path);
  }

  const stylesheetPromise =
    manifest.stylesheet && !manifest.stylesheet.startsWith('data:')
      ? fetchText(new URL(manifest.stylesheet, baseUrl).href, fetchImpl)
      : Promise.resolve(null);

  while (pending.size > 0) {
    const batch = [...pending];
    pending.clear();
    const texts = await Promise.all(
      batch.map(rel => fetchText(new URL(rel, baseUrl).href, fetchImpl)),
    );
    for (let i = 0; i < batch.length; i++) {
      const rel = batch[i];
      const text = texts[i];
      rawSources.set(rel, text);
      const fileUrl = new URL(rel, baseUrl);
      for (const match of text.matchAll(RELATIVE_JS_SPECIFIER)) {
        enqueue(canonicalRelPath(new URL(match[2], fileUrl), baseUrl));
      }
    }
  }

  const dataUrlByRel = new Map<string, string>();
  for (const [rel, text] of rawSources) {
    const fileUrl = new URL(rel, baseUrl);
    const rewritten = text.replace(RELATIVE_JS_SPECIFIER, (_match, quote: string, spec: string) => {
      const targetRel = canonicalRelPath(new URL(spec, fileUrl), baseUrl);
      return `${quote}${chunkSpecifier(targetRel)}${quote}`;
    });
    dataUrlByRel.set(rel, toBase64DataUrl(rewritten, 'text/javascript'));
  }

  const entryRels = new Set<string>();
  const imports: Record<string, string> = {};
  for (const [name, path] of Object.entries(manifest.importMap.imports)) {
    if (path.startsWith('data:')) {
      imports[name] = path;
      continue;
    }
    const rel = canonicalRelPath(new URL(path, baseUrl), baseUrl);
    entryRels.add(rel);
    imports[name] = dataUrlByRel.get(rel) ?? path;
  }
  for (const [rel, dataUrl] of dataUrlByRel) {
    if (!entryRels.has(rel)) {
      imports[chunkSpecifier(rel)] = dataUrl;
    }
  }

  const cssText = await stylesheetPromise;
  const stylesheet = cssText !== null ? toBase64DataUrl(cssText, 'text/css') : manifest.stylesheet;

  return {
    ...manifest,
    importMap: {imports},
    stylesheet,
    preload: [],
  };
}

/**
 * Loads the runtime manifest once per configuration: the configured one, or `manifest.json`
 * from the runtime directory. When `inlineDataUrls` is enabled (the default for a relative
 * `runtimeBaseUrl`), also fetches the runtime's modules and stylesheet on the host page and
 * converts them to `data:` URLs so the inner frame makes no cross-origin network requests.
 */
export function loadRuntime(fetchImpl: typeof fetch = fetch): Promise<LoadedRuntime> {
  const baseUrl = resolveRuntimeBaseUrl();
  const inlineDataUrls =
    currentConfig.inlineDataUrls ??
    (currentConfig.manifest === undefined && isRelativeUrl(currentConfig.runtimeBaseUrl));
  const key = `${baseUrl.href}|inline=${String(inlineDataUrls)}`;
  if (loading?.key === key) {
    return loading.promise;
  }
  const configured = currentConfig.manifest;
  const manifestPromise = configured
    ? Promise.resolve(configured)
    : fetchImpl(new URL('manifest.json', baseUrl).href).then(async response => {
        if (!response.ok) {
          throw new Error(`Loading the ReactApp runtime manifest failed: HTTP ${response.status}`);
        }
        return (await response.json()) as ReactAppRuntimeManifest;
      });
  const promise = manifestPromise.then(async manifest => {
    if (!inlineDataUrls) {
      return {manifest, baseUrl, inlineDataUrls: false};
    }
    const inlined = await inlineRuntimeAsDataUrls(manifest, baseUrl, fetchImpl);
    return {manifest: inlined, baseUrl, inlineDataUrls: true};
  });
  loading = {key, promise};
  promise.catch(() => {
    if (loading?.promise === promise) {
      loading = null;
    }
  });
  return promise;
}
