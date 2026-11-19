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
 * The sample's domain layer: tool and action handlers that return a text
 * summary for the model and A2UI messages for the app, independent of the
 * MCP plumbing `@a2ui/embed` provides.
 */

import {randomUUID} from 'node:crypto';

import {
  dimensionColumns,
  groupedDimensions,
  isLookupTable,
  pickBreakdowns,
  reachableTables,
  referencedTables,
} from './compose/breakdowns.js';
import type {RefreshContext, Visualization} from './compose/events.js';
import {
  type A2uiMessage,
  createSurfaceMessages,
  updateSurfaceDataMessages,
  updateSurfaceMessages,
} from './compose/messages.js';
import {chooseLayout, composeQueryView} from './compose/query_view.js';
import {summarizeResult, summarizeTables} from './compose/summary.js';
import {composeTablesView} from './compose/tables_view.js';
import {type LayoutValidator, MessageValidator} from './compose/validate.js';
import type {ReadOnlyDatabase, TableInfo} from './db/database.js';
import type {QueryResult} from './db/query_result.js';
import {explain} from './explain/explain.js';
import type {JsonModel} from './explain/json_model.js';

/** What a handler returns: the model-facing summary and the app-facing messages. */
export interface ToolOutput {
  readonly text: string;
  readonly a2ui: readonly A2uiMessage[];
}

/** Arguments of the `query` tool. */
export interface QueryArgs {
  readonly sql: string;
  readonly visualization?: Visualization;
  readonly title?: string;
}

/** Handlers of the sample's tools and actions. */
export class SqlTools {
  private tablesCache?: TableInfo[];

  /**
   * @param validator Checks the layouts `explain` composes. Optional (default: a
   *     validator for `catalogSchema`); the server passes `app.validate`.
   */
  constructor(
    private readonly db: ReadOnlyDatabase,
    private readonly catalogSchema: Record<string, unknown>,
    private readonly model: JsonModel | undefined,
    private readonly newSurfaceId: () => string = () => `sql-${randomUUID()}`,
    private readonly validator: LayoutValidator = new MessageValidator(catalogSchema),
  ) {}

  private tables(): TableInfo[] {
    return (this.tablesCache ??= this.db.listTables());
  }

  /**
   * Dimensions offered as "Break down by …" buttons for a result, from the
   * tables the query mentions and the tables they reach through foreign keys.
   */
  breakdownsFor(result: QueryResult, labelColumn?: string): string[] {
    const tables = this.tables();
    const candidates = reachableTables(referencedTables(result.sql, tables), tables).flatMap(
      ({table, hops}) =>
        dimensionColumns([table]).map(({column}) => ({
          name: `${table.name}.${column}`,
          distinctValues: this.db.distinctCount(table.name, column),
          hops,
          lookup: isLookupTable(table),
        })),
    );
    return pickBreakdowns(candidates, groupedDimensions(result.sql, labelColumn, tables));
  }

  /** `list_tables()`. */
  listTables(): ToolOutput {
    const tables = this.tables();
    return {
      text: summarizeTables(tables),
      a2ui: createSurfaceMessages(this.newSurfaceId(), composeTablesView(tables)),
    };
  }

  private async runQuery(args: QueryArgs) {
    const result = await this.db.query(args.sql);
    const layout = chooseLayout(result, args.visualization);
    const view = composeQueryView(result, {
      visualization: args.visualization,
      title: args.title,
      breakdownDimensions:
        layout.kind === 'table'
          ? undefined
          : this.breakdownsFor(result, layout.kind === 'chart' ? layout.label.name : undefined),
    });
    return {text: summarizeResult(result, layout), view};
  }

  /** `query(sql, visualization?, title?)`. Rejects with `QueryError` for invalid or failing SQL. */
  async query(args: QueryArgs): Promise<ToolOutput> {
    const {text, view} = await this.runQuery(args);
    return {text, a2ui: createSurfaceMessages(this.newSurfaceId(), view)};
  }

  /**
   * The `refresh` action: re-runs the query and updates the surface in place.
   * A default view is composed again; a view `explain`'s model designed
   * (`layout: 'composed'`) keeps its components and only gets new data.
   */
  async refresh(context: RefreshContext, surfaceId: string): Promise<ToolOutput> {
    const {text, view} = await this.runQuery(context);
    if (context.layout === 'composed') {
      return {
        text: `${text}\nThe view keeps the layout explain designed; only its data was updated.`,
        a2ui: updateSurfaceDataMessages(surfaceId, view),
      };
    }
    return {text, a2ui: updateSurfaceMessages(surfaceId, view)};
  }

  /** `explain(question)`. Returns `a2ui: []` with an explanatory text when it cannot answer. */
  async explain(question: string): Promise<ToolOutput> {
    const outcome = await explain(question, {
      db: this.db,
      model: this.model,
      schema: summarizeTables(this.tables()),
      catalogSchema: this.catalogSchema,
      validator: this.validator,
      breakdownsFor: (result, label) => this.breakdownsFor(result, label),
    });
    if (!outcome.ok) return {text: outcome.text, a2ui: []};
    return {text: outcome.text, a2ui: createSurfaceMessages(this.newSurfaceId(), outcome.view)};
  }
}
