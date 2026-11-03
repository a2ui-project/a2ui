#!/usr/bin/env bash
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REACT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${REACT_DIR}/../../.." && pwd)"

REACT_PKG="${REACT_DIR}/package.json"
ROOT_LOCK="${REPO_ROOT}/yarn.lock"

# Dependency files temporarily modified during React 17 testing.
# Note: a2ui_explorer is an internal React 19 Vite app (using react-dom/client)
# and is intentionally excluded from the React 17 unit/build matrix.
SWAPPED_FILES=("${REACT_PKG}" "${ROOT_LOCK}")

echo "=== Testing @a2ui/react with React 17 ==="

# Preflight: ensure no uncommitted changes in dependency files
if ! git -C "${REPO_ROOT}" diff --quiet HEAD -- "${SWAPPED_FILES[@]}"; then
  echo "Error: Uncommitted changes detected in package.json or yarn.lock."
  echo "Please commit or stash your changes before running the React 17 test matrix."
  exit 1
fi

DEPS_SWAPPED=false

cleanup() {
  trap - EXIT INT TERM
  echo "=== Restoring original React 19 dependencies ==="
  git -C "${REPO_ROOT}" checkout -- "${SWAPPED_FILES[@]}"
  if [[ "${DEPS_SWAPPED}" == "true" ]]; then
    yarn --cwd "${REPO_ROOT}" install
    yarn --cwd "${REACT_DIR}" clean
  fi
}
trap cleanup EXIT INT TERM

# Temporarily swap devDependencies to React 17 before building
echo "=== Swapping to React 17 dependencies ==="
yarn --cwd "${REACT_DIR}" add -D \
  "react@^17.0.2" \
  "react-dom@^17.0.2" \
  "@types/react@^17.0.0" \
  "@types/react-dom@^17.0.0" \
  "@testing-library/react@^12.1.5"

DEPS_SWAPPED=true

# Verify that @a2ui/react resolves React 17 rather than hoisted React 19
node -e "
  const {createRequire} = require('node:module');
  const req = createRequire(process.argv[1]);
  const version = req('react/package.json').version;
  if (!version.startsWith('17.')) {
    console.error('Expected React 17, but resolved React ' + version);
    process.exit(1);
  }
  console.log('Verified resolved React version: ' + version);
" "${REACT_PKG}"

# Clear wireit cache so tsup + dts and vitest run fresh against @types/react@17 and react@17
yarn --cwd "${REACT_DIR}" clean

echo "=== Building @a2ui/react (including .d.ts type-checking) under React 17 ==="
yarn --cwd "${REACT_DIR}" build

# Verify that no automatic JSX runtime imports (react/jsx-runtime) leaked into dist/
echo "=== Verifying zero react/jsx-runtime imports in dist/ ==="
if grep -rn "jsx-runtime" "${REACT_DIR}/dist/"; then
  echo "Error: Found react/jsx-runtime reference in dist/ output (breaks React < 17.0.2 ESM consumers)."
  exit 1
fi

# Smoke-test built ESM and CJS entry points in dist/ under plain Node ESM/CJS
# module resolution (no Vite aliases or bundler overrides) with React 17.
echo "=== Smoke-testing packaged dist/ ESM and CJS entry points under React 17 (no Vite) ==="
(
  cd "${REACT_DIR}"
  node --input-type=module -e "
    import {createRequire} from 'node:module';
    import {JSDOM} from 'jsdom';
    import React from 'react';
    import ReactDOM from 'react-dom';
    import {Catalog, CommonSchemas, ComponentModel, SurfaceModel} from '@a2ui/web_core/v0_9';
    import {z} from 'zod';

    const dom = new JSDOM('<!doctype html><html><body><div id=\"root\"></div></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Element = dom.window.Element;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.MutationObserver = dom.window.MutationObserver;
    globalThis.customElements = dom.window.customElements;

    // Resolve via package.json 'exports' map (bare specifiers) and direct dist/ paths
    const esmRoot = await import('@a2ui/react');
    const esmV09 = await import('@a2ui/react/v0_9');
    const esmV08 = await import('@a2ui/react/v0_8');
    await import('@a2ui/react/styles');

    const req = createRequire(import.meta.url);
    const ReactDOMServer = req('react-dom/server');
    const ReactTestUtils = req('react-dom/test-utils');
    const cjsRoot = req('@a2ui/react');
    const cjsV09 = req('@a2ui/react/v0_9');
    const cjsV08 = req('@a2ui/react/v0_8');
    req('@a2ui/react/styles');

    if (typeof esmRoot.A2uiSurface !== 'function' || typeof cjsRoot.A2uiSurface !== 'function') {
      throw new Error('Expected A2uiSurface export on ESM and CJS root entry points');
    }
    if (typeof esmV09.A2uiSurface !== 'function' || typeof cjsV09.A2uiSurface !== 'function') {
      throw new Error('Expected A2uiSurface export on ESM and CJS v0_9 entry points');
    }
    if (typeof esmV08.A2UIProvider !== 'function' || typeof cjsV08.A2UIProvider !== 'function') {
      throw new Error('Expected A2UIProvider export on ESM and CJS v0_8 entry points');
    }

    // 1. Verify SSR + client DOM rendering from @a2ui/react/v0_8 (dist/v0_8/index.js) under React 17
    esmV08.initializeDefaultCatalog();
    const v08Html = ReactDOMServer.renderToString(
      React.createElement(
        esmV08.A2UIProvider,
        null,
        React.createElement('span', null, 'react17-dist-v08-ssr-ok'),
      ),
    );
    if (!v08Html.includes('react17-dist-v08-ssr-ok')) {
      throw new Error('Unexpected SSR output from dist/v0_8/index.js: ' + v08Html);
    }

    function V08Harness() {
      const {processMessages} = esmV08.useA2UI();
      React.useEffect(() => {
        processMessages([
          {
            surfaceUpdate: {
              surfaceId: '@default',
              components: [
                {
                  id: 'root-v08',
                  component: {
                    Text: {text: {literalString: 'Hello v0.8 from packaged dist on React 17'}},
                  },
                },
              ],
            },
          },
          {beginRendering: {surfaceId: '@default', root: 'root-v08'}},
        ]);
      }, [processMessages]);
      return React.createElement(esmV08.A2UIRenderer, {surfaceId: '@default'});
    }

    const container = document.getElementById('root');
    ReactTestUtils.act(() => {
      ReactDOM.render(
        React.createElement(esmV08.A2UIProvider, null, React.createElement(V08Harness)),
        container,
      );
    });
    if (!container.innerHTML.includes('Hello v0.8 from packaged dist on React 17')) {
      throw new Error('Unexpected v0.8 DOM render from dist/v0_8/index.js: ' + container.innerHTML);
    }
    ReactDOM.unmountComponentAtNode(container);

    // 2. Verify client DOM rendering + reactive data update from @a2ui/react (dist/index.js)
    //    (v0.9 / v1.0) using React 17 ReactDOM.render with zero Vite/bundler overrides.
    const TextApi = {name: 'Text', schema: z.object({text: CommonSchemas.DynamicString.optional()})};
    const TextImpl = esmRoot.createComponentImplementation(TextApi, ({props}) =>
      React.createElement('p', {'data-testid': 'dist-text'}, String(props.text ?? '')),
    );
    const catalog = new Catalog('dist-cat', '0.9', [TextImpl]);
    const surface = new SurfaceModel('s-dist', catalog);
    surface.dataModel.set('/greeting', 'Hello from packaged dist on React 17');
    surface.componentsModel.addComponent(
      new ComponentModel('root', 'Text', {text: {path: '/greeting'}}, catalog),
    );

    ReactTestUtils.act(() => {
      ReactDOM.render(React.createElement(esmRoot.A2uiSurface, {surface}), container);
    });
    if (!container.innerHTML.includes('Hello from packaged dist on React 17')) {
      throw new Error('Unexpected client DOM render from dist/index.js: ' + container.innerHTML);
    }
    ReactTestUtils.act(() => {
      surface.dataModel.set('/greeting', 'Updated from packaged dist on React 17');
    });
    if (!container.innerHTML.includes('Updated from packaged dist on React 17')) {
      throw new Error('Unexpected reactive update from dist/index.js: ' + container.innerHTML);
    }
    ReactDOM.unmountComponentAtNode(container);
  "
)

echo "=== Running unit tests against src/ under React 17 ==="
TZ=UTC yarn --cwd "${REACT_DIR}" test:unit

echo "=== Running unit tests against packaged dist/ exports under React 17 ==="
(cd "${REACT_DIR}" && TZ=UTC A2UI_TEST_DIST=1 npx vitest run)

echo "=== React 17 test matrix passed successfully! ==="
