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
 * Custom A2UI v1.0 catalog for Day & Trip Studio.
 * Contains only domain-specific components and functions (zero basicCatalog components).
 */

import {Catalog} from '@a2ui/web_core/v1_0';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

import {A2uiActionFooter} from './action_footer.js';
import {A2uiBudgetSplitBar} from './budget_split_bar.js';
import {TRIP_CATALOG_ID} from './catalog_id.js';
import {selectedStopTitle, tripStats} from './functions.js';
import {A2uiRouteMinimap} from './route_minimap.js';
import {A2uiSplitStage} from './split_stage.js';
import {A2uiStudioShell} from './studio_shell.js';
import {A2uiSwapDeck} from './swap_deck.js';
import {A2uiTimelineStrip} from './timeline_strip.js';
import {A2uiWeatherRibbon} from './weather_ribbon.js';

export {TRIP_CATALOG_ID} from './catalog_id.js';
export {
  computeTripStats,
  estimateWalkMinutes,
  formatClock,
  parseHotel,
  parseStops,
  parseStopSwapsMap,
  parseSwapList,
  parseTripStats,
  parseWeatherHours,
  type CategoryTotals,
  type HotelItem,
  type SpendCategory,
  type StopDiag,
  type StopItem,
  type SwapOption,
  type TripStats,
  type WeatherCondition,
  type WeatherHour,
} from './model.js';
export {resolveSelectedStopTitle, selectedStopTitle, tripStats} from './functions.js';

export const TRIP_COMPONENTS: readonly WebComponentImplementation[] = [
  A2uiStudioShell,
  A2uiSplitStage,
  A2uiWeatherRibbon,
  A2uiTimelineStrip,
  A2uiRouteMinimap,
  A2uiSwapDeck,
  A2uiBudgetSplitBar,
  A2uiActionFooter,
];

export const tripCatalog = new Catalog<WebComponentImplementation>(
  TRIP_CATALOG_ID,
  '1.0',
  [...TRIP_COMPONENTS],
  [tripStats, selectedStopTitle],
  {
    schemaUri: 'https://json-schema.org/draft/2020-12/schema',
    schemaId: TRIP_CATALOG_ID,
    title: 'A2UI Day & Trip Studio Custom Catalog',
    description:
      'Custom A2UI v1.0 components and reactive itinerary statistics for Day & Trip Studio.',
  },
);
