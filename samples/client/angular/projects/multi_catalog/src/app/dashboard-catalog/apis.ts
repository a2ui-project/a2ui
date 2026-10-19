/*
 * Copyright 2024 Google LLC
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

import {ComponentApi, DynamicNumberSchema, DynamicStringSchema} from '@a2ui/web_core/v1_0';
import {z} from 'zod';

// The properties of each component, as the agent's dashboard_catalog.json
// defines them.

export const StatCardApi = {
  name: 'StatCard',
  schema: z.object({
    label: DynamicStringSchema,
    value: DynamicStringSchema,
    caption: DynamicStringSchema.optional(),
    weight: z.number().optional(),
  }),
} satisfies ComponentApi;

export const ProgressBarApi = {
  name: 'ProgressBar',
  schema: z.object({
    label: DynamicStringSchema,
    percent: DynamicNumberSchema,
    weight: z.number().optional(),
  }),
} satisfies ComponentApi;
