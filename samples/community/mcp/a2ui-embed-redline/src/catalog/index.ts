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
 * The Redline Studio custom A2UI v1.0 catalog (`redlineCatalog`).
 * Contains ONLY domain-specific negotiation components and functions (zero `basicCatalog`).
 */

import {Catalog} from '@a2ui/web_core/v1_0';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

import {A2uiBenchmarkBullet} from './benchmark_bullet.js';
import {REDLINE_CATALOG_ID} from './catalog_id.js';
import {A2uiClauseRedline} from './clause_redline.js';
import {A2uiCounterLetterPreview} from './counter_letter_preview.js';
import {A2uiExposureMeter} from './exposure_meter.js';
import {composeCounterEmail, negotiationMetrics} from './functions.js';
import {A2uiLeverageGauge} from './leverage_gauge.js';
import {A2uiMilestoneScheduleBar} from './milestone_schedule_bar.js';
import {A2uiNegotiationBoard, A2uiTwoUpRow} from './negotiation_board.js';

export {REDLINE_CATALOG_ID} from './catalog_id.js';

export const REDLINE_COMPONENTS: readonly WebComponentImplementation[] = [
  A2uiNegotiationBoard,
  A2uiTwoUpRow,
  A2uiClauseRedline,
  A2uiBenchmarkBullet,
  A2uiExposureMeter,
  A2uiLeverageGauge,
  A2uiMilestoneScheduleBar,
  A2uiCounterLetterPreview,
];

export const redlineCatalog = new Catalog<WebComponentImplementation>(
  REDLINE_CATALOG_ID,
  '1.0',
  [...REDLINE_COMPONENTS],
  [negotiationMetrics, composeCounterEmail],
  {
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: REDLINE_CATALOG_ID,
    title: 'A2UI Redline Studio Catalog',
    description:
      'Custom A2UI v1.0 catalog for lease, contract, and contractor quote redlining, financial exposure metering, deal-friction gauges, payment milestone schedules, and live counter-offer drafting.',
  },
);
