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
 * 100% custom Space & Seating Planner catalog (`canvasCatalog`) with zero
 * `basicCatalog` components.
 */

import {Catalog, type WebComponentImplementation} from '@a2ui/web_core/v1_0';

import {CANVAS_CATALOG_ID} from './catalog_id.js';
import {A2uiCanvasSplit} from './canvas_split.js';
import {CANVAS_FUNCTIONS} from './functions.js';
import {A2uiPieceTray} from './piece_tray.js';
import {A2uiPlanActionBar} from './plan_action_bar.js';
import {A2uiPlanCanvas} from './plan_canvas.js';
import {A2uiPlannerFrame} from './planner_frame.js';
import {A2uiPresetStrip} from './preset_strip.js';
import {A2uiRuleScoreboard} from './rule_scoreboard.js';
import {A2uiSelectionInspector} from './selection_inspector.js';

export {CANVAS_CATALOG_ID} from './catalog_id.js';

export const CANVAS_COMPONENTS: readonly WebComponentImplementation[] = [
  A2uiPlannerFrame,
  A2uiCanvasSplit,
  A2uiPlanCanvas,
  A2uiRuleScoreboard,
  A2uiPieceTray,
  A2uiPresetStrip,
  A2uiSelectionInspector,
  A2uiPlanActionBar,
];

export const canvasCatalog = new Catalog<WebComponentImplementation>(
  CANVAS_CATALOG_ID,
  '1.0',
  [...CANVAS_COMPONENTS],
  [...CANVAS_FUNCTIONS],
  {
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: CANVAS_CATALOG_ID,
    title: 'A2UI Space & Seating Planner Catalog',
    description:
      'Custom 2D SVG floorplan and banquet seating planner catalog with live spatial/social constraint evaluation and zero basicCatalog components.',
  },
);
