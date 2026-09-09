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

import Module from 'module';

if (process.env.REACT_VERSION === '18') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalResolve = (Module as any)._resolveFilename;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Module as any)._resolveFilename = function (
    request: string,
    parent: any,
    isMain: boolean,
    options: any,
  ) {
    if (request === 'react') return originalResolve.call(this, 'react-18', parent, isMain, options);
    if (request === 'react/jsx-runtime')
      return originalResolve.call(this, 'react-18/jsx-runtime', parent, isMain, options);
    if (request === 'react/jsx-dev-runtime')
      return originalResolve.call(this, 'react-18/jsx-dev-runtime', parent, isMain, options);
    if (request === 'react-dom')
      return originalResolve.call(this, 'react-dom-18', parent, isMain, options);
    if (request === 'react-dom/client')
      return originalResolve.call(this, 'react-dom-18/client', parent, isMain, options);
    if (request === 'react-dom/server')
      return originalResolve.call(this, 'react-dom-18/server', parent, isMain, options);
    if (request === '@testing-library/react')
      return originalResolve.call(this, '@testing-library/react-18', parent, isMain, options);
    return originalResolve.call(this, request, parent, isMain, options);
  };
}

import '@testing-library/jest-dom/vitest';
import {beforeAll} from 'vitest';
import {initializeDefaultCatalog} from '../src';

// Initialize the default catalog before all tests
beforeAll(() => {
  initializeDefaultCatalog();
});
