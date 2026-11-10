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
 * Module-level configuration of the ReactApp component: where the host serves the runtime and
 * the sandbox proxy. Set once at startup with {@link configureReactApp}.
 */

import {
  configureSandbox,
  resetSandboxConfig,
  type SandboxConfig,
} from './shared/sandbox/sandbox_config.js';

/** The runtime's `manifest.json` (written by `@a2ui-labs/react-app-runtime`'s build). */
export interface ReactAppRuntimeManifest {
  readonly version: string;
  readonly protocolVersion: string;
  readonly importMap: {readonly imports: Readonly<Record<string, string>>};
  readonly entry: string;
  readonly stylesheet: string;
  readonly preload: readonly string[];
}

/** A manifest and the URL its relative paths resolve against. */
export interface LoadedRuntime {
  readonly manifest: ReactAppRuntimeManifest;
  readonly baseUrl: URL;
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
  /** CSS custom properties to send to the app besides the `--a2ui-*` ones. */
  readonly themeVariables?: readonly string[];
  /** Where the host serves the sandbox proxy pages; see `SandboxConfig`. */
  readonly sandbox?: Partial<SandboxConfig>;
}

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

/**
 * Loads the runtime manifest once per configuration: the configured one, or `manifest.json`
 * from the runtime directory.
 */
export function loadRuntime(fetchImpl: typeof fetch = fetch): Promise<LoadedRuntime> {
  const baseUrl = resolveRuntimeBaseUrl();
  const key = baseUrl.href;
  if (loading?.key === key) {
    return loading.promise;
  }
  const configured = currentConfig.manifest;
  const promise = configured
    ? Promise.resolve({manifest: configured, baseUrl})
    : fetchImpl(new URL('manifest.json', baseUrl).href).then(async response => {
        if (!response.ok) {
          throw new Error(`Loading the ReactApp runtime manifest failed: HTTP ${response.status}`);
        }
        return {manifest: (await response.json()) as ReactAppRuntimeManifest, baseUrl};
      });
  loading = {key, promise};
  promise.catch(() => {
    if (loading?.promise === promise) {
      loading = null;
    }
  });
  return promise;
}
