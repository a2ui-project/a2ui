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
 * `explain(question)`: a server-side model writes SQL for a question, the
 * server runs it, and the model composes the A2UI layout. The layout is
 * validated against the sample catalog; when it is invalid, the
 * deterministic composer's view is used instead.
 */

import {z} from 'zod';

import {BREAKDOWN_EVENT, REFRESH_EVENT, VISUALIZATIONS} from '../compose/events.js';
import {type A2uiComponent, type A2uiView, createSurfaceMessages} from '../compose/messages.js';
import {CHART_CONFIG, chooseLayout, composeQueryView, fitRows} from '../compose/query_view.js';
import {describeComposedView, summarizeResult} from '../compose/summary.js';
import type {LayoutValidator, ValidationIssue} from '../compose/validate.js';
import {QueryError, type ReadOnlyDatabase} from '../db/database.js';
import type {QueryResult} from '../db/query_result.js';
import type {JsonModel} from './json_model.js';
import {LAYOUT_COMPONENTS, layoutPrompt, layoutSystem, SQL_SYSTEM, sqlPrompt} from './prompts.js';

/** Attempts at writing SQL that runs; the second attempt sees the first error. */
const SQL_ATTEMPTS = 2;

/** Message `explain` returns when no model is configured. */
export const NO_MODEL_MESSAGE =
  'explain is unavailable: set GEMINI_API_KEY in the server .env file. Use the query tool with SQL instead.';

const SqlAnswerSchema = z.object({
  sql: z.string().min(1),
  title: z.string().optional(),
  visualization: z.enum(VISUALIZATIONS).optional(),
});

const LayoutAnswerSchema = z.object({
  components: z.array(z.object({id: z.string(), component: z.string()}).passthrough()).min(1),
  chart: z.record(z.unknown()).optional(),
});

/** What `explain` needs. */
export interface ExplainDependencies {
  readonly db: Pick<ReadOnlyDatabase, 'query'>;
  /** The model; `undefined` when no API key is configured. */
  readonly model: JsonModel | undefined;
  /** Text description of the schema (see `summarizeTables`). */
  readonly schema: string;
  readonly catalogSchema: Record<string, unknown>;
  /** Checks the model's layout, typically `app.validate` from `@a2ui/embed/mcp/server`. */
  readonly validator: LayoutValidator;
  /** Breakdown dimensions for the fallback view of a result. Optional (default: none). */
  readonly breakdownsFor?: (result: QueryResult, labelColumn?: string) => readonly string[];
}

/** Result of {@link explain}. */
export type ExplainResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly view: A2uiView;
      readonly result: QueryResult;
      /** `model` when the model's layout was valid, `fallback` otherwise. */
      readonly layoutSource: 'model' | 'fallback';
      readonly layoutErrors: readonly ValidationIssue[];
    }
  | {readonly ok: false; readonly text: string};

/** Asks the model for SQL and runs it, retrying once with the error. */
async function writeAndRunSql(
  question: string,
  deps: ExplainDependencies & {model: JsonModel},
): Promise<{result: QueryResult; title?: string; visualization?: (typeof VISUALIZATIONS)[number]}> {
  let previousError: string | undefined;
  for (let attempt = 1; ; attempt++) {
    const answer = SqlAnswerSchema.parse(
      await deps.model.generateJson({
        system: SQL_SYSTEM,
        prompt: sqlPrompt(question, deps.schema, previousError),
      }),
    );
    try {
      const result = await deps.db.query(answer.sql);
      return {result, title: answer.title, visualization: answer.visualization};
    } catch (error) {
      if (!(error instanceof QueryError) || attempt >= SQL_ATTEMPTS) throw error;
      previousError = error.message;
    }
  }
}

/** Collects every `@path` in a value. */
function bindingPaths(value: unknown, paths: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) bindingPaths(item, paths);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === '@path' && typeof item === 'string') paths.push(item);
      else bindingPaths(item, paths);
    }
  }
  return paths;
}

/** Collects every event name in a value. */
function eventNames(value: unknown, names: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) eventNames(item, names);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'event' && typeof item === 'object' && item !== null && 'name' in item) {
        names.push(String((item as {name: unknown}).name));
      }
      eventNames(item, names);
    }
  }
  return names;
}

/** Returns true when the absolute JSON Pointer `path` resolves in `model`. */
function resolves(model: Record<string, unknown>, path: string): boolean {
  let node: unknown = model;
  for (const segment of path.split('/').slice(1)) {
    if (typeof node !== 'object' || node === null) return false;
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!(key in node)) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return true;
}

/**
 * Checks the model's components beyond the catalog schema: only layout
 * components (no `Icon`, whose icon font cannot load under the MCP Apps CSP),
 * absolute bindings must resolve in the data model, and events must be ones
 * the server handles.
 * Relative bindings are allowed for list templates.
 */
function checkLayout(
  components: readonly A2uiComponent[],
  dataModel: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const component of components) {
    if (!LAYOUT_COMPONENTS.includes(component.component)) {
      issues.push({
        componentId: component.id,
        component: component.component,
        message: `Uses ${component.component}, which is not one of the layout components.`,
      });
    }
    for (const path of bindingPaths(component)) {
      if (path.startsWith('/') && !resolves(dataModel, path)) {
        issues.push({
          componentId: component.id,
          component: component.component,
          message: `Binds to "${path}", which is not in the data model.`,
        });
      }
    }
    for (const name of eventNames(component)) {
      if (name !== REFRESH_EVENT && name !== BREAKDOWN_EVENT) {
        issues.push({
          componentId: component.id,
          component: component.component,
          message: `Sends the unknown event "${name}".`,
        });
      }
    }
  }
  return issues;
}

/**
 * Adds `layout: 'composed'` to the context of every refresh event, so that
 * refreshing the view keeps the model's components and only updates the data.
 */
export function markComposedRefresh(components: readonly A2uiComponent[]): A2uiComponent[] {
  const mark = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(mark);
    if (typeof value !== 'object' || value === null) return value;
    const record = value as Record<string, unknown>;
    const event = record['event'];
    if (
      typeof event === 'object' &&
      event !== null &&
      (event as Record<string, unknown>)['name'] === REFRESH_EVENT
    ) {
      const refresh = event as Record<string, unknown>;
      const context = (refresh['context'] ?? {}) as Record<string, unknown>;
      return {...record, event: {...refresh, context: {...context, layout: 'composed'}}};
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, mark(item)]));
  };
  return components.map(component => mark(component) as A2uiComponent);
}

/**
 * Answers a question with a query and a model-composed view. Returns a text
 * error (never throws) when no model is configured or the SQL fails.
 */
export async function explain(question: string, deps: ExplainDependencies): Promise<ExplainResult> {
  const model = deps.model;
  if (!model) return {ok: false, text: NO_MODEL_MESSAGE};

  let run: Awaited<ReturnType<typeof writeAndRunSql>>;
  try {
    run = await writeAndRunSql(question, {...deps, model});
  } catch (error) {
    return {ok: false, text: `explain could not answer the question: ${(error as Error).message}`};
  }
  const {result} = run;
  const layout = chooseLayout(result, run.visualization);
  const fallback = composeQueryView(result, {
    title: run.title,
    visualization: run.visualization,
    breakdownDimensions:
      layout.kind === 'table'
        ? undefined
        : deps.breakdownsFor?.(result, layout.kind === 'chart' ? layout.label.name : undefined),
  });

  let view = fallback;
  let layoutSource: 'model' | 'fallback' = 'fallback';
  let layoutErrors: ValidationIssue[] = [];
  try {
    const answer = LayoutAnswerSchema.parse(
      await model.generateJson({
        system: layoutSystem(deps.catalogSchema),
        prompt: layoutPrompt(question, result),
      }),
    );
    const dataModel: Record<string, unknown> = {...fallback.dataModel};
    // The chart reads the rows from /rows through withRows, so its spec has no data.
    if (answer.chart) {
      const {data: _data, ...chart} = answer.chart;
      dataModel['chart'] = {config: CHART_CONFIG, ...chart};
    }
    const candidate: A2uiView = {components: answer.components as A2uiComponent[], dataModel};
    const report = deps.validator.validate(createSurfaceMessages('explain-check', candidate));
    layoutErrors = [...report.errors, ...checkLayout(candidate.components, dataModel)];
    if (layoutErrors.length === 0) {
      view = {...candidate, components: markComposedRefresh(candidate.components)};
      layoutSource = 'model';
    }
  } catch (error) {
    layoutErrors = [{message: `The model's layout could not be read: ${(error as Error).message}`}];
  }

  const notes = [`SQL: ${result.sql}`];
  if (layoutSource === 'fallback')
    notes.push('The default layout was used because the generated layout was invalid.');
  return {
    ok: true,
    text: `${summarizeResult(result, layout, {
      viewDescription:
        layoutSource === 'model'
          ? describeComposedView(
              view.components,
              view.dataModel['chart'],
              result.rows.length,
              fitRows(result.rows).length,
            )
          : undefined,
    })}\n${notes.join('\n')}`,
    view,
    result,
    layoutSource,
    layoutErrors,
  };
}
