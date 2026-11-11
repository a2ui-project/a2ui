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
 * Entry point of the runtime (`a2ui-runtime` in the import map). The app document's bootstrap
 * script imports it and calls {@link start}, which runs the lifecycle of bridge protocol
 * section 2: initialize, transpile, import, render, report.
 */

import type {ComponentType} from 'react';
import {createRoot} from 'react-dom/client';

import {AppRoot, ErrorCard, isComponentType, type ErrorCardProps} from './app_root.js';
import {linkBindings} from './bindings.js';
import {BridgeClient, DEFAULT_REQUEST_TIMEOUT_MS} from './bridge_client.js';
import {forwardConsole, watchCspViolations, watchUncaughtErrors} from './diagnostics.js';
import {unavailableModuleMessage, unresolvedImport} from './error_messages.js';
import {loadFontFaces} from './fonts.js';
import {watchContentHeight} from './resize.js';
import {RuntimeSession, setSession, toErrorDetails, type ErrorPhase} from './session.js';
import {findDataPaths} from './source_scan.js';
import {applyTheme, type ThemeTokens} from './theme.js';

/** Version of the bridge protocol this runtime speaks. */
export const PROTOCOL_VERSION = '1';

/** Version of the runtime package, sent in `initialize`. */
export const RUNTIME_VERSION = '0.1.0';

/** Id of the JSON script element that carries the app config in the app document. */
export const APP_CONFIG_ELEMENT_ID = 'a2ui-react-app-config';

/** What the host puts in the app document. */
export interface AppConfig {
  readonly source: string;
  readonly compiled?: string;
  readonly title?: string;
}

interface InitializeResult {
  readonly protocolVersion?: string;
  readonly theme?: ThemeTokens;
  readonly dataSnapshot?: Record<string, unknown>;
  readonly deniedPaths?: string[];
}

/** Milliseconds since the document's time origin. */
function now(): number {
  return Math.round(performance.now());
}

function readConfig(doc: Document): AppConfig {
  const element = doc.getElementById(APP_CONFIG_ELEMENT_ID);
  const parsed: unknown = JSON.parse(element?.textContent ?? '{}');
  const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  return {
    source: typeof record['source'] === 'string' ? record['source'] : '',
    compiled: typeof record['compiled'] === 'string' ? record['compiled'] : undefined,
    title: typeof record['title'] === 'string' ? record['title'] : undefined,
  };
}

function moduleUrl(code: string): string {
  return URL.createObjectURL(new Blob([code], {type: 'text/javascript'}));
}

/**
 * Imports the app module from source text. Bare imports resolve through the import map, and an
 * `a2ui:bindings` import gets a bindings module made for the names the app imports.
 */
async function importModule(code: string): Promise<Record<string, unknown>> {
  const urls: string[] = [];
  const track = (source: string) => {
    const url = moduleUrl(source);
    urls.push(url);
    return url;
  };
  const url = track(linkBindings(code, track));
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } finally {
    for (const created of urls) {
      URL.revokeObjectURL(created);
    }
  }
}

/**
 * Starts the app in this document. Resolves once the app rendered or its error card is shown.
 */
export async function start(): Promise<void> {
  const timings: Record<string, number> = {runtimeReady: now()};
  const rootElement = document.getElementById('root') ?? document.body;
  const root = createRoot(rootElement);
  const client = new BridgeClient(window.parent, window);
  const session = new RuntimeSession(client);
  setSession(session);
  forwardConsole(client);
  watchUncaughtErrors(session);
  watchCspViolations(session);

  const config = readConfig(document);
  const title = config.title ?? 'App';

  const fail = (phase: ErrorPhase, card: Omit<ErrorCardProps, 'title'>, error?: unknown) => {
    const details = toErrorDetails(error ?? new Error(card.message));
    session.reportError(phase, {
      ...details,
      message: card.message,
      ...(card.line !== undefined ? {line: card.line} : {}),
      ...(card.column !== undefined ? {column: card.column} : {}),
    });
    root.render(<ErrorCard title={title} {...card} />);
  };

  let init: InitializeResult;
  try {
    init = await client.request<InitializeResult>(
      'reactApp/initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        runtimeVersion: RUNTIME_VERSION,
        paths: findDataPaths(config.source),
      },
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    fail('bridge', {heading: 'The app could not connect to the page.', message: String(error)});
    return;
  }
  timings['initialized'] = now();
  client.onNotification('theme/changed', params => {
    // Fonts first: charts re-embed on the theme change and wait for them.
    void loadFontFaces(params['fontFaces']);
    applyTheme(params as ThemeTokens);
  });
  // The fonts load while the source is transpiled and imported; the first render waits for them.
  const fontsLoaded = loadFontFaces(init.theme?.fontFaces);
  applyTheme(init.theme ?? {});
  const snapshot = init.dataSnapshot ?? {};
  const denied = new Set(init.deniedPaths ?? []);
  session.store.seed(
    snapshot,
    findDataPaths(config.source).filter(path => !denied.has(path)),
  );

  let code = config.compiled;
  let transpileMs = 0;
  if (code === undefined) {
    const started = performance.now();
    try {
      // Sucrase is its own chunk, so apps that arrive compiled never load it.
      const {transpileApp} = await import('./transpile.js');
      code = transpileApp(config.source);
    } catch (error) {
      const position = error as {line?: number; column?: number};
      fail(
        'compile',
        {
          heading: 'The app has a syntax error.',
          message: error instanceof Error ? error.message : String(error),
          line: position.line,
          column: position.column,
          source: config.source,
        },
        error,
      );
      return;
    }
    transpileMs = Math.round(performance.now() - started);
  }

  let app: ComponentType;
  try {
    const module = await importModule(code);
    if (!isComponentType(module['default'])) {
      throw new Error('The app must default-export a component: export default function App() {…}');
    }
    app = module['default'];
  } catch (error) {
    const specifier = unresolvedImport(error);
    if (specifier !== undefined) {
      fail(
        'load',
        {
          heading: 'The app imports a module that is not available.',
          message: unavailableModuleMessage(specifier),
        },
        error,
      );
      return;
    }
    fail(
      'load',
      {
        heading: 'The app could not be loaded.',
        message: String((error as Error)?.message ?? error),
      },
      error,
    );
    return;
  }
  timings['compiled'] = now();
  await fontsLoaded;

  await new Promise<void>(resolve => {
    root.render(
      <AppRoot
        app={app}
        title={title}
        onError={error => {
          session.reportError('render', toErrorDetails(error));
          resolve();
        }}
        onCommit={() => {
          // Two animation frames: the first runs before the paint, the second after it.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              timings['rendered'] = now();
              client.notify('ui/rendered', {timings: {...timings, transpileMs}});
              resolve();
            }),
          );
        }}
      />,
    );
  });
  watchContentHeight(rootElement, height => client.notify('ui/resize', {height}));
}
