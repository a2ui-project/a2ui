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

/** Model-facing MCP tool definition for Day & Trip Studio. */

import {z} from 'zod';

import {SCENARIO_IDS} from './scenarios/catalog_data.js';

export const TRIP_STUDIO_TOOL = {
  name: 'trip_studio',
  config: {
    title: 'Day & Trip Studio',
    description:
      "Interactive Day & Trip Studio card for planning day itineraries, squeezing stops into an afternoon gap between check-in and dinner, watching hourly rain windows and walking times, or comparing weekend neighborhood hotels against a budget cap. Renders a custom A2UI v1.0 travel studio where the user shifts stop times, swaps stops or hotels client-side, and locks the plan. Make trip_studio the final tool call of your turn: never call read_file, run_command, or any other tool in parallel after trip_studio or after trip_studio returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this tool's text summary.",
    inputSchema: {
      prompt: z
        .string()
        .default('Plan an afternoon itinerary gap between 2pm check-in and 7pm dinner')
        .describe(
          'Natural-language trip request describing the time window, neighborhood, weather concern, or weekend hotel budget.',
        ),
      scenario: z
        .enum(SCENARIO_IDS)
        .optional()
        .describe(
          'Optional explicit layout preset: afternoon_gap (check-in to dinner with rain ribbon and stop swap slot), weekend_budget (budget split bar and 3-hotel swap deck), or rainy_family (family rain backups plus budget bar). Omit to infer from prompt.',
        ),
    },
    annotations: {readOnlyHint: true, openWorldHint: false},
  },
};
