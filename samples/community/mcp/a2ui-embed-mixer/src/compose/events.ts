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

/** Schemas for in-place `a2ui_action` routes and `followUp` templates. */

import {z} from 'zod';

import {SCENARIO_IDS} from '../scenarios/presets.js';

const MixOptionSchema = z.object({
  id: z.string().max(60),
  label: z.string().max(80),
  note: z.string().max(160),
  effects: z.record(z.string().max(40), z.number()),
});

export const RuntimeMixItemSchema = z.object({
  id: z.string().max(60),
  title: z.string().max(100),
  subtitle: z.string().max(160),
  icon: z.string().max(30),
  scale: z.number().min(0.25).max(3),
  unitHint: z.string().max(60),
  activeOptionId: z.string().max(60),
  recommendedId: z.string().max(60),
  options: z.array(MixOptionSchema).min(1).max(6),
});

export const MIXER_ACTIONS = {
  lock_mix: {
    scenario: z.enum(SCENARIO_IDS),
    items: z.array(RuntimeMixItemSchema).min(1).max(8),
    selectedPresetId: z.string().max(60).optional(),
  },
  snap_to_targets: {
    scenario: z.enum(SCENARIO_IDS),
    items: z.array(RuntimeMixItemSchema).min(1).max(8),
  },
} as const;

export type MixerActionName = keyof typeof MIXER_ACTIONS;
export type MixerActionArgs<Name extends MixerActionName> = z.infer<
  z.ZodObject<(typeof MIXER_ACTIONS)[Name]>
>;

export const MIXER_FOLLOW_UPS = {
  build_shopping_or_action_list: {
    template:
      'Build my {deliverable} for the {scenarioTitle} mix (preset {preset}). Use my live Goal Mixer selections attached in context.',
    argsSchema: {
      deliverable: z.string().max(100),
      scenarioTitle: z.string().max(100),
      preset: z.string().max(60),
    },
  },
} as const;
