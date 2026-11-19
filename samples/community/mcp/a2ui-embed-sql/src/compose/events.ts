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
 * The A2UI events the views emit. Every event reaches the server through the
 * `a2ui_action` tool: `refresh` is an in-place update, `breakdown` a
 * follow-up whose text comes from a server template.
 */

import {z} from 'zod';

import {bind} from './messages.js';

/** Name of the event that re-runs the query and updates the view in place. */
export const REFRESH_EVENT = 'refresh';

/** Name of the event that asks the host model to break a metric down by a dimension. */
export const BREAKDOWN_EVENT = 'breakdown';

/** Server-side follow-up template for {@link BREAKDOWN_EVENT}. */
export const BREAKDOWN_TEMPLATE = 'Break down {metric} by {dimension}';

/** Visualizations the `query` tool accepts as a hint. */
export const VISUALIZATIONS = ['auto', 'table', 'bar', 'line', 'kpi'] as const;

/** A visualization hint. */
export type Visualization = (typeof VISUALIZATIONS)[number];

/** Context of a {@link REFRESH_EVENT}. */
export const RefreshContextSchema = z.object({
  sql: z.string().min(1),
  visualization: z.enum(VISUALIZATIONS).optional(),
  title: z.string().optional(),
  /**
   * Who designed the view: the default composer, or `explain`'s model
   * (`composed`). Refreshing a composed view keeps its components and only
   * updates its data. Optional (default: 'default').
   */
  layout: z.enum(['default', 'composed']).optional(),
});

/** Context of a {@link REFRESH_EVENT}. */
export type RefreshContext = z.infer<typeof RefreshContextSchema>;

/** Context of a {@link BREAKDOWN_EVENT}. */
export const BreakdownContextSchema = z.object({
  dimension: z.string().min(1),
  metric: z.string().min(1),
});

/** Context of a {@link BREAKDOWN_EVENT}. */
export type BreakdownContext = z.infer<typeof BreakdownContextSchema>;

/**
 * Data model path of the query a view was composed from. The refresh button
 * reads its context from here, so the SQL stays in the data model.
 */
export const QUERY_PATH = '/query';

/** The `action` of a refresh button: its context is bound to {@link QUERY_PATH}. */
export function refreshAction() {
  return {
    event: {
      name: REFRESH_EVENT,
      context: {
        sql: bind(`${QUERY_PATH}/sql`),
        visualization: bind(`${QUERY_PATH}/visualization`),
        title: bind(`${QUERY_PATH}/title`),
      },
    },
  };
}

/** The `action` of a "Break down by …" button. */
export function breakdownAction(context: BreakdownContext) {
  return {event: {name: BREAKDOWN_EVENT, context: {...context}}};
}
