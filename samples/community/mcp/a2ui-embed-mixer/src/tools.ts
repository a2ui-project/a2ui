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

/** Model-facing `goal_mixer` tool definition (`mcp_a2ui-mixer_mixer_goal_mixer` = 31 chars). */

import {z} from 'zod';

import {SCENARIO_MODES} from './scenarios/presets.js';

export const GOAL_MIXER_TOOL = {
  name: 'goal_mixer',
  config: {
    title: 'Multi-Goal Trade-Off Mixer',
    description:
      "Interactive Multi-Goal Mixer studio for balancing any competing multi-variable targets in one tactile A2UI v1.0 card (for example wedding budget/guests/bar, home solar/battery/heat-pump sizing, half-marathon/strength/recovery, apartment commute/rent/space, startup seed runway/hiring, family weeknight routine, weekday meal prep, or debt payoff vs emergency cushion). Omit `scenario` (or pass `'auto'`) to synthesize a bespoke trade-off model for the user's exact problem. Make `goal_mixer` the final tool call of your turn: never call `read_file`, `run_command`, or any other tool in parallel after `goal_mixer` or after `goal_mixer` returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this tool's text summary.",
    inputSchema: {
      prompt: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          "The user's multi-variable optimization or trade-off request, including any target caps, budgets, hours, or constraints they care about.",
        ),
      scenario: z
        .enum(SCENARIO_MODES)
        .optional()
        .describe(
          "Always leave omitted (or pass 'auto' / 'custom') for user prompts so Goal Mixer synthesizes a bespoke Gemini model tailored to the user's exact numbers and constraints. Pass a specific preset ID only when explicitly asked for a canned preset without AI synthesis.",
        ),
    },
    annotations: {readOnlyHint: true, openWorldHint: false},
  },
};
