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

import {z} from 'zod';

/** The name of the app-only tool that receives every A2UI action from the app. */
export const ACTION_TOOL_NAME = 'a2ui_action';

/** The arguments the app passes to the {@link ACTION_TOOL_NAME} tool for an A2UI action. */
export const ActionCallSchema = z.object({
  /** The action name, as set in the component's `action.event.name`. */
  name: z.string().min(1),
  /** The surface that dispatched the action. */
  surfaceId: z.string().min(1),
  /** The component that dispatched the action, when known. */
  sourceComponentId: z.string().min(1).optional(),
  /** The resolved `action.event.context` of the action. */
  context: z.record(z.string(), z.unknown()),
});

/** The arguments of the {@link ACTION_TOOL_NAME} tool. */
export type ActionCall = z.infer<typeof ActionCallSchema>;
