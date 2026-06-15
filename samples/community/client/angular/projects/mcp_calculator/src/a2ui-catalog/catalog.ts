/*
 * Copyright 2025 Google LLC
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

import {Catalog} from '@a2ui/angular';
import {inputBinding} from '@angular/core';

export const DEMO_CATALOG = {
  McpApp: {
    type: () => import('./mcp-app').then(r => r.McpApp),
    bindings: ({properties}) => [
      inputBinding(
        'content',
        () => ('content' in properties && properties['content']) || undefined,
      ),
      inputBinding('title', () => ('title' in properties && properties['title']) || undefined),
    ],
  },
  PongScoreBoard: {
    type: () => import('./pong-scoreboard').then(r => r.PongScoreBoard),
    bindings: ({properties}) => [
      inputBinding(
        'playerScore',
        () => ('playerScore' in properties && properties['playerScore']) || undefined,
      ),
      inputBinding(
        'cpuScore',
        () => ('cpuScore' in properties && properties['cpuScore']) || undefined,
      ),
    ],
  },
  PongLayout: {
    type: () => import('./pong-layout').then(r => r.PongLayout),
    bindings: ({properties}) => [
      inputBinding(
        'mcpComponent',
        () => ('mcpComponent' in properties && properties['mcpComponent']) || undefined,
      ),
      inputBinding(
        'scoreboardComponent',
        () =>
          ('scoreboardComponent' in properties && properties['scoreboardComponent']) || undefined,
      ),
    ],
  },
  Column: {
    type: () => import('@a2ui/angular').then(r => r.Column),
    bindings: ({properties}) => [
      inputBinding(
        'alignment',
        () => ('alignment' in properties && properties['alignment']) || undefined,
      ),
      inputBinding(
        'distribution',
        () => ('distribution' in properties && properties['distribution']) || undefined,
      ),
      inputBinding(
        'children',
        () => ('children' in properties && properties['children']) || undefined,
      ),
    ],
  },
} as Catalog;
