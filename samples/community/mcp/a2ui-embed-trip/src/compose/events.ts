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

/** Action and follow-up schemas for Day & Trip Studio. */

import {z} from 'zod';

import {SCENARIO_IDS} from '../scenarios/catalog_data.js';

export const StopPayloadSchema = z.object({
  id: z.string().max(40),
  title: z.string().max(120),
  area: z.string().max(80),
  category: z.enum(['food', 'tickets', 'transit', 'stay']),
  startMin: z.number(),
  durationMin: z.number(),
  openMin: z.number(),
  closeMin: z.number(),
  cost: z.number(),
  indoor: z.boolean(),
  x: z.number(),
  y: z.number(),
  locked: z.boolean().optional(),
  note: z.string().max(200).optional(),
  optionId: z.string().max(60).optional(),
});

export const HotelPayloadSchema = z.object({
  id: z.string().max(40),
  name: z.string().max(120),
  area: z.string().max(80),
  nights: z.number(),
  totalCost: z.number(),
  transitCost: z.number(),
  x: z.number(),
  y: z.number(),
  tag: z.string().max(60),
});

export const ACTIONS = {
  lock_itinerary: {
    scenario: z.enum(SCENARIO_IDS),
    stops: z.array(StopPayloadSchema).min(1).max(10),
    hotel: HotelPayloadSchema.optional(),
    budgetCap: z.number().optional(),
  },
  rain_reschedule: {
    scenario: z.enum(SCENARIO_IDS),
    stops: z.array(StopPayloadSchema).min(1).max(10),
  },
} as const;

export const FOLLOW_UPS = {
  ask_local_spots: {
    template:
      'Suggest two quiet local spots near {neighborhood} that fit smoothly around {stopTitle} without adding much walking.',
    argsSchema: {
      neighborhood: z.string().max(80),
      stopTitle: z.string().max(80),
    },
  },
} as const;
