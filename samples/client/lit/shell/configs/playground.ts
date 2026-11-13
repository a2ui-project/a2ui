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

import {AppConfig} from './types.js';

/**
 * Shell configuration for the A2UI Format Playground (`?app=playground`).
 */
export const playgroundConfig: AppConfig = {
  key: 'playground',
  title: 'A2UI Format Playground',
  placeholder: 'Describe a UI, paste JSON, or type /help',
  loadingText: ['Describing the interface...', 'Planning the layout...', 'Rendering...'],
  serverUrl: 'http://localhost:10010',
  // The playground reuses its main surface id across turns.
  clearSurfacesOnResponse: false,
  inspector: true,
  quickActions: [
    {
      label: 'Host Health',
      message: '/tool host',
      title:
        'Monitor family: render server health metrics directly via decision model (0 LLM calls)',
    },
    {
      label: 'Ski Resorts',
      message: '/tool resort',
      title: 'Browse family: render mountain resort list directly via decision model (0 LLM calls)',
    },
    {
      label: 'Transfer Quote',
      message: '/tool transfer',
      title:
        'Act family: render wire transfer confirmation directly via decision model (0 LLM calls)',
    },
    {
      label: 'Playback Settings',
      message: '/tool settings',
      title:
        'Input family: render editable settings form directly via decision model (0 LLM calls)',
    },
    {
      label: 'Order Details',
      message: '/tool order',
      title: 'Inspect family: render order status view directly via decision model (0 LLM calls)',
    },
    {
      label: 'Deploy Runbook',
      message: '/tool runbook',
      title: 'Guide family: render rollout checklist directly via decision model (0 LLM calls)',
    },
  ],
};
