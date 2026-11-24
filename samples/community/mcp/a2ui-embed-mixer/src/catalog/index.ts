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
 * The 100% custom `mixerCatalog` (`https://a2ui.org/samples/mixer_studio/v1/catalog.json`):
 * bundles ONLY custom `A2uiLitElement` components and `computeMixTotals` (zero `basicCatalog`).
 */

import type {WebComponentImplementation} from '@a2ui/web_core/universal';
import {Catalog} from '@a2ui/web_core/v1_0';

import {MIXER_CATALOG_ID} from './catalog_id.js';
import {A2uiCommitBar} from './commit_bar.js';
import {computeMixTotals} from './functions.js';
import {A2uiMixerDeck, A2uiMixerGrid, A2uiMixMicroNote} from './mixer_deck.js';
import {A2uiParetoPlane2D} from './pareto_plane_2d.js';
import {A2uiPortionScrubTile} from './portion_scrub_tile.js';
import {A2uiPrepTrackGantt} from './prep_track_gantt.js';
import {A2uiTargetRingCluster} from './target_ring_cluster.js';

export {MIXER_CATALOG_ID} from './catalog_id.js';
export {computeMixTotals, evaluateMixTotals, formatMetricValue} from './functions.js';

export const MIXER_COMPONENTS: WebComponentImplementation[] = [
  A2uiMixerDeck,
  A2uiMixerGrid,
  A2uiMixMicroNote,
  A2uiTargetRingCluster,
  A2uiPortionScrubTile,
  A2uiParetoPlane2D,
  A2uiPrepTrackGantt,
  A2uiCommitBar,
];

export const mixerCatalog = new Catalog<WebComponentImplementation>(
  MIXER_CATALOG_ID,
  '1.0',
  MIXER_COMPONENTS,
  [computeMixTotals],
  {
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: MIXER_CATALOG_ID,
    title: 'A2UI Multi-Goal Trade-Off Mixer Catalog',
    description:
      'Custom tactile multi-goal trade-off mixer catalog with animated TargetRingCluster, PortionScrubTile, ParetoPlane2D, PrepTrackGantt, MixerDeck, MixerGrid, and CommitBar.',
    declaredProtocolVersion: '1.0',
    commonTypesUri: 'common_types.json',
  },
);
