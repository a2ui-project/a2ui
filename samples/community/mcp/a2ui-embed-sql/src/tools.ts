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
 * Names, metadata and input schemas (zod raw shapes) of the sample's tools,
 * ready for `app.tool(name, config, handler)` from `@a2ui/embed/mcp/server`.
 */

import {z} from 'zod';

import {VISUALIZATIONS} from './compose/events.js';

const READ_ONLY = {readOnlyHint: true, destructiveHint: false, openWorldHint: false} as const;

/** `list_tables()`: the schema browser. */
export const LIST_TABLES_TOOL = {
  name: 'list_tables',
  config: {
    title: 'List tables',
    description:
      'Lists the tables of the read-only SQLite database with their columns and row counts, and shows a schema browser.',
    inputSchema: {},
    annotations: READ_ONLY,
  },
};

/** `query(sql, visualization?, title?)`: runs SQL and shows the result. */
export const QUERY_TOOL = {
  name: 'query',
  config: {
    title: 'Run a SQL query',
    description:
      'Runs one read-only SQLite SELECT (or WITH ... SELECT) statement, returns a text summary, and shows the result as KPI cards, a chart with a table tab, or a sortable table, chosen from the result shape. At most 500 rows are returned. Put the label or date column first for charts.',
    inputSchema: {
      sql: z
        .string()
        .min(1)
        .describe('A single SELECT or WITH statement, without a trailing semicolon.'),
      visualization: z
        .enum(VISUALIZATIONS)
        .optional()
        .describe(
          "Optional (default: 'auto'). Preferred view; ignored when the result shape does not fit.",
        ),
      title: z.string().max(120).optional().describe('Optional title shown above the result.'),
    },
    annotations: READ_ONLY,
  },
};

/** `explain(question)`: a server-side model writes the SQL and composes the view. */
export const EXPLAIN_TOOL = {
  name: 'explain',
  config: {
    title: 'Explain with a generated view',
    description:
      'Answers a natural-language question about the database: a server-side model writes the SQL, runs it, and designs the view. Prefer query when you can write the SQL yourself.',
    inputSchema: {
      question: z.string().min(1).max(500).describe('The question to answer.'),
    },
    annotations: {...READ_ONLY, openWorldHint: true},
  },
};
