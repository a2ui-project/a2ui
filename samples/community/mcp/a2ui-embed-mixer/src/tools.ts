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

/** Model-facing `goal_mixer` tool definition (`mcp_a2ui-mixer_mixer_goal_mixer` = 32 chars). */

import {z} from 'zod';

import {SCENARIO_IDS} from './scenarios/presets.js';

export const GOAL_MIXER_TOOL = {
  name: 'goal_mixer',
  config: {
    title: 'Multi-Goal Trade-Off Mixer',
    description:
      "Interactive Multi-Goal Mixer studio for balancing competing targets in one tactile A2UI v1.0 card: weekday high-protein meal prep (calories, protein, grocery budget, weekday prep mins, Sunday 45m batch tracks), monthly surplus debt payoff vs emergency savings (cash cushion, months to debt-free, interest saved, emergency fund), or weekly hybrid training & recovery. Make `goal_mixer` the final tool call of your turn: never call `read_file`, `run_command`, or any other tool in parallel after `goal_mixer` or after `goal_mixer` returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this tool's text summary.",
    inputSchema: {
      prompt: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          "The user's multi-goal optimization request (for example weekday high-protein meal prep under budget/prep-time caps, or monthly surplus debt payoff vs emergency cash cushion).",
        ),
      scenario: z
        .enum(SCENARIO_IDS)
        .optional()
        .describe(
          'Optional explicit domain layout: meal_prep (rings + Pareto + Sunday batch Gantt + portion tiles), debt_savings (financial rings + payoff Pareto + surplus tiles), or training_week (readiness rings + block Gantt + session tiles).',
        ),
    },
    annotations: {readOnlyHint: true, openWorldHint: false},
  },
};
