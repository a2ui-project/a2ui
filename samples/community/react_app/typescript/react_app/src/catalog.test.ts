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

import {basicCatalog, MessageProcessor} from '@a2ui/web_core/v1_0';
import lapTimerExample from '../../../catalog/v1/examples/lap_timer.json' with {type: 'json'};
import loanExample from '../../../catalog/v1/examples/loan_explorer.json' with {type: 'json'};
import {hasForbiddenSegment, isNameAllowed, isPathAllowed} from './allowlist.js';
import {buildAppDocument, jsonForScript} from './app_document.js';
import catalogJson from './catalog.json' with {type: 'json'};
import {REACT_APP_CATALOG_ID, reactAppCatalog} from './catalog.js';
import {ReactAppApi} from './react_app.js';
import {configureReactApp, loadRuntime, resetReactAppConfig} from './react_app_config.js';
import {readThemeTokens} from './theme_tokens.js';

const MANIFEST = {
  version: '0.1.0',
  protocolVersion: '1',
  importMap: {
    imports: {react: './react-AAAA1111.js', 'a2ui-runtime': './a2ui-runtime-BBBB2222.js'},
  },
  entry: 'a2ui-runtime',
  stylesheet: './a2ui-lite-CCCC3333.css',
  preload: ['./react-AAAA1111.js'],
};

describe('the ReactApp catalog', () => {
  it('matches catalog/v1/catalog.json', () => {
    const declared = catalogJson.components.ReactApp;

    expect(reactAppCatalog.id).toBe(REACT_APP_CATALOG_ID);
    expect(catalogJson.catalogId).toBe(REACT_APP_CATALOG_ID);
    expect(Object.keys(ReactAppApi.schema.shape).sort()).toEqual(
      Object.keys(declared.properties)
        .filter(name => name !== 'component')
        .sort(),
    );
    expect(declared.required).toEqual(['component', 'source']);
  });

  for (const [name, example] of [
    ['loan explorer', loanExample],
    ['lap timer', lapTimerExample],
  ] as const) {
    it(`accepts the ${name} example`, () => {
      const errors: unknown[] = [];
      const processor = new MessageProcessor([basicCatalog, reactAppCatalog], undefined, {
        errorHandler: error => errors.push(error),
      });

      processor.processMessages(structuredClone(example.messages) as never);

      expect(errors).toEqual([]);
      const messages = example.messages as ReadonlyArray<{
        createSurface?: {surfaceId: string};
        updateComponents?: {components: ReadonlyArray<{id: string; component: string}>};
      }>;
      const surfaceId = messages[0].createSurface!.surfaceId;
      const appId = messages
        .flatMap(message => message.updateComponents?.components ?? [])
        .find(component => component.component === 'ReactApp')!.id;
      expect(processor.model.getSurface(surfaceId)?.componentsModel.get(appId)).toBeDefined();
      processor.model.dispose();
    });
  }
});

describe('allowlists', () => {
  it('allows a path equal to or below an entry', () => {
    expect(isPathAllowed('/loan', ['/loan'])).toBeTrue();
    expect(isPathAllowed('/loan/rate', ['/loan'])).toBeTrue();
    expect(isPathAllowed('/loan/rate', ['/loan/'])).toBeTrue();
    expect(isPathAllowed('/loans', ['/loan'])).toBeFalse();
    expect(isPathAllowed('/', ['/loan'])).toBeFalse();
  });

  it('denies every path when dataPaths is absent or empty', () => {
    expect(isPathAllowed('/anything', undefined)).toBeFalse();
    expect(isPathAllowed('/anything', [])).toBeFalse();
  });

  it('allows listed names only, and none without a list', () => {
    expect(isNameAllowed('formatCurrency', ['formatCurrency'])).toBeTrue();
    expect(isNameAllowed('other', ['formatCurrency'])).toBeFalse();
    expect(isNameAllowed('other', undefined)).toBeFalse();
    expect(isNameAllowed('other', [])).toBeFalse();
  });

  it('finds prototype pollution segments, escaped or not', () => {
    expect(hasForbiddenSegment('/a/__proto__/b')).toBeTrue();
    expect(hasForbiddenSegment('/a/constructor')).toBeTrue();
    expect(hasForbiddenSegment('/a/proto~1type')).toBeFalse();
    expect(hasForbiddenSegment('/a/b')).toBeFalse();
  });
});

describe('buildAppDocument', () => {
  const runtime = {manifest: MANIFEST, baseUrl: new URL('https://runtime.example/rt/v1/')};

  it('maps every module to an absolute runtime URL and boots the entry', () => {
    const html = buildAppDocument(runtime, {
      source: 'export default function App() {}',
      title: 'Plan',
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const importMap = JSON.parse(doc.querySelector('script[type="importmap"]')!.textContent!);
    expect(importMap).toEqual({
      imports: {
        react: 'https://runtime.example/rt/v1/react-AAAA1111.js',
        'a2ui-runtime': 'https://runtime.example/rt/v1/a2ui-runtime-BBBB2222.js',
      },
    });
    expect(doc.querySelector('link[rel="stylesheet"]')!.getAttribute('href')).toBe(
      'https://runtime.example/rt/v1/a2ui-lite-CCCC3333.css',
    );
    expect(doc.querySelector('link[rel="modulepreload"]')!.getAttribute('href')).toBe(
      'https://runtime.example/rt/v1/react-AAAA1111.js',
    );
    expect(doc.querySelector('script[type="module"]')!.textContent).toBe(
      'import {start} from "a2ui-runtime"; start();',
    );
    expect(doc.getElementById('root')).not.toBeNull();
  });

  it('carries source that would otherwise close the script element', () => {
    const source =
      'const s = "</script><script>alert(1)</script>";\u2028export default () => null;';
    const html = buildAppDocument(runtime, {source});
    const doc = new DOMParser().parseFromString(html, 'text/html');

    expect(doc.querySelectorAll('script').length).toBe(3);
    const config = JSON.parse(doc.getElementById('a2ui-react-app-config')!.textContent!);
    expect(config).toEqual({source});
    expect(jsonForScript('<\u2029')).toBe('"\\u003c\\u2029"');
  });
});

describe('runtime configuration', () => {
  afterEach(() => {
    resetReactAppConfig();
  });

  it('uses a configured manifest without fetching, resolving the base URL', async () => {
    configureReactApp({runtimeBaseUrl: 'https://cdn.example/react-app/v1', manifest: MANIFEST});

    const runtime = await loadRuntime(() => Promise.reject(new Error('no fetch expected')));

    expect(runtime.baseUrl.href).toBe('https://cdn.example/react-app/v1/');
    expect(runtime.manifest).toBe(MANIFEST);
  });

  it('fetches manifest.json once per base URL', async () => {
    let fetches = 0;
    const fetchImpl = (async (url: string) => {
      fetches++;
      expect(url).toBe(new URL('/a2ui-sandbox/react-app/v1/manifest.json', document.baseURI).href);
      return new Response(JSON.stringify(MANIFEST));
    }) as unknown as typeof fetch;

    const [first, second] = await Promise.all([loadRuntime(fetchImpl), loadRuntime(fetchImpl)]);

    expect(first.manifest).toEqual(MANIFEST);
    expect(second).toBe(first);
    expect(fetches).toBe(1);
  });
});

describe('readThemeTokens', () => {
  it('reads the --a2ui-* variables that apply to the element', () => {
    const container = document.createElement('div');
    container.style.setProperty('--a2ui-color-primary', '#c8553d');
    container.style.setProperty('--a2ui-custom-accent', ' teal ');
    container.style.setProperty('--unrelated', 'x');
    const child = document.createElement('span');
    container.appendChild(child);
    document.body.appendChild(container);

    const tokens = readThemeTokens(child);

    expect(tokens.cssVars['--a2ui-color-primary']).toBe('#c8553d');
    expect(tokens.cssVars['--a2ui-custom-accent']).toBe('teal');
    expect(tokens.cssVars['--unrelated']).toBeUndefined();
    expect(tokens.colorScheme).toBe('light');
    expect(tokens.fontFaces).toBeUndefined();
    container.remove();
  });

  it('adds the configured extra variables and font faces', () => {
    const element = document.createElement('div');
    element.style.setProperty('--brand-ink', 'navy');
    document.body.appendChild(element);
    const fontFaces = [{family: 'Plex', src: 'data:font/woff2;base64,AAAA', weight: '400'}];

    const tokens = readThemeTokens(element, {themeVariables: ['--brand-ink'], fontFaces});

    expect(tokens.cssVars['--brand-ink']).toBe('navy');
    expect(tokens.fontFaces).toEqual(fontFaces);
    element.remove();
  });
});
