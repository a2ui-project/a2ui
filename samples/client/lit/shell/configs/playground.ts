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

import {playgroundThemeSheet} from '../theme/playground-theme.js';
import {AppConfig} from './types.js';

/**
 * Shell configuration for the A2UI Format Playground (`?app=playground`).
 */
export const playgroundConfig: AppConfig = {
  key: 'playground',
  title: 'A2UI Decision Playground',
  placeholder: 'Describe a UI, paste JSON, or type /help',
  loadingText: ['Evaluating decision batch...', 'Binding or compiling...', 'Rendering...'],
  serverUrl: 'http://localhost:10010',
  cssOverrides: playgroundThemeSheet,
  // The playground reuses its main surface id across turns.
  clearSurfacesOnResponse: false,
  inspector: true,
  modeControls: {
    modes: ['cascade', 'binder', 'rpc', 'express', 'direct'],
    backends: ['mock', 'gemini', 'jev', 'step0'],
  },
  quickActions: [
    {
      label: 'Host Health',
      message: '/tool host',
      title: 'Binder mode: render server health metrics (0 LLM calls, redacts apiKey)',
    },
    {
      label: 'Ski Resorts',
      message: '/tool resort',
      title: 'Binder mode: render mountain resort list directly (0 LLM calls)',
    },
    {
      label: 'Transfer Quote',
      message: '/tool transfer',
      title: 'Binder mode: render wire transfer confirmation directly (0 LLM calls)',
    },
    {
      label: 'Playback Settings',
      message: '/tool settings',
      title: 'Binder mode: render editable settings form directly (0 LLM calls)',
    },
    {
      label: 'Order Details',
      message: '/tool order',
      title: 'Binder mode: render order status card directly (0 LLM calls)',
    },
    {
      label: 'Bug Report Form (RPC)',
      message: '/form bug',
      title: 'RPC mode: render v1.0 form validated via callAgentFunction decision predicate',
    },
  ],
};
