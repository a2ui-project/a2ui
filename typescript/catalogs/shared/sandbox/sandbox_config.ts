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
 * Module-level configuration of where the host app serves the sandbox proxy pages. The package
 * ships them in `dist/sandbox/`; by default the host is expected to serve that directory at
 * `/a2ui-sandbox/` on its own origin.
 */

/** Directory the sandbox proxy pages are served from unless configured otherwise. */
export const DEFAULT_SANDBOX_BASE_URL = '/a2ui-sandbox/';

/** Query parameter the proxy reads to skip its security self-test. */
export const DISABLE_SECURITY_SELF_TEST_PARAM = 'disable_security_self_test';

/**
 * Which proxy page a frame loads: `html` for inline HTML content (`sandbox.html`, whose CSP keeps
 * the inner frame from loading external URLs) and `url` for an external URL (`sandbox-url.html`).
 */
export type SandboxMode = 'html' | 'url';

/** File name of the proxy page for each mode, relative to the sandbox base URL. */
export const SANDBOX_PAGES: Readonly<Record<SandboxMode, string>> = {
  html: 'sandbox.html',
  url: 'sandbox-url.html',
};

/** Sandbox proxy settings of the host app. */
export interface SandboxConfig {
  /**
   * Directory the proxy pages are served from, resolved against the document base URL. Absolute
   * URLs on another origin are allowed when the proxy page lists the host origin in its
   * `a2ui-sandbox-host-origins` meta tag.
   */
  readonly baseUrl: string;
  /**
   * Whether to append `disable_security_self_test=true` to the proxy URL. The self-test checks
   * that the proxy cannot reach the top window, which only holds when the proxy is served from
   * another origin. Left undefined, the test is disabled exactly when the resolved proxy URL is on
   * the host origin, where it could never pass.
   */
  readonly disableSecuritySelfTest?: boolean;
}

/** Inputs of {@link resolveSandboxUrl} that default to the current document. */
export interface ResolveSandboxUrlOptions {
  /** URL the configured `baseUrl` is resolved against; defaults to `document.baseURI`. */
  readonly documentBase?: string;
  /** Origin of the host page; defaults to `window.location.origin`. */
  readonly hostOrigin?: string;
}

const DEFAULT_CONFIG: SandboxConfig = {baseUrl: DEFAULT_SANDBOX_BASE_URL};

let currentConfig: SandboxConfig = DEFAULT_CONFIG;

/** Overrides part of the sandbox configuration; unspecified fields keep their current values. */
export function configureSandbox(config: Partial<SandboxConfig>): void {
  currentConfig = {
    baseUrl: config.baseUrl ?? currentConfig.baseUrl,
    disableSecuritySelfTest:
      'disableSecuritySelfTest' in config
        ? config.disableSecuritySelfTest
        : currentConfig.disableSecuritySelfTest,
  };
}

/** Returns the current sandbox configuration. */
export function getSandboxConfig(): SandboxConfig {
  return currentConfig;
}

/** Restores the default configuration; tests call it in teardown. */
export function resetSandboxConfig(): void {
  currentConfig = DEFAULT_CONFIG;
}

/**
 * Resolves the URL of the proxy page for a mode from the current configuration, including the
 * self-test query parameter when it applies. Callers use `href` for the frame `src` and `origin`
 * as the only origin they accept messages from.
 */
export function resolveSandboxUrl(mode: SandboxMode, options: ResolveSandboxUrlOptions = {}): URL {
  const documentBase = options.documentBase ?? document.baseURI;
  const hostOrigin = options.hostOrigin ?? window.location.origin;
  const {baseUrl, disableSecuritySelfTest} = currentConfig;
  const directory = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(directory + SANDBOX_PAGES[mode], documentBase);
  if (disableSecuritySelfTest ?? url.origin === hostOrigin) {
    url.searchParams.set(DISABLE_SECURITY_SELF_TEST_PARAM, 'true');
  }
  return url;
}
