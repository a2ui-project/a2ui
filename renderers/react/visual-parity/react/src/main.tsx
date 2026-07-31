/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import {A2UIProvider, initializeDefaultCatalog} from '@a2ui/react';
import {injectStyles} from '@a2ui/react/styles';
import {FixturePage} from './FixturePage';
import {getTheme, themeNames} from '../../fixtures/themes';

// Initialize the default component catalog
initializeDefaultCatalog();

// Inject A2UI structural CSS (required for litTheme utility classes)
injectStyles();

// Parse theme from URL parameter
const params = new URLSearchParams(window.location.search);
const themeName = params.get('theme');
const selectedTheme = getTheme(themeName);

// Add theme info to document for debugging
if (themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
}

// Log available themes for debugging
console.log('[Visual Parity - React] Available themes:', themeNames);
console.log('[Visual Parity - React] Selected theme:', themeName || 'default');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <A2UIProvider theme={selectedTheme}>
      <FixturePage />
    </A2UIProvider>
  </React.StrictMode>,
);
