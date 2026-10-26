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
 * The Kanban MCP server: the board tools, the `ui://kanban/board` MCP App
 * resource, and a Streamable HTTP endpoint. It knows nothing about A2UI; the
 * agent and the chat host are its two MCP clients.
 */

import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import {z} from 'zod';
import {BoardError, KanbanBoard, type Board} from './board.js';

/** URI of the board app resource; `open_board` points at it with `_meta.ui.resourceUri`. */
export const BOARD_RESOURCE_URI = 'ui://kanban/board';

/** Path of the MCP endpoint on the HTTP server. */
export const MCP_PATH = '/mcp';

/** Path of the `POST` endpoint that restores the seed board. */
export const RESET_PATH = '/reset';

/** Default port of the HTTP server. */
export const DEFAULT_PORT = 8788;

const CardSchema = z.object({
  id: z.string(),
  title: z.string(),
  assignee: z.string().optional(),
  due: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const ColumnSchema = z.object({
  id: z.string(),
  title: z.string(),
  wipLimit: z.number().optional(),
  cards: z.array(CardSchema),
});

/** Output schema of every tool: the whole board. */
const BoardOutputSchema = {columns: z.array(ColumnSchema)};

/** What `createKanbanServer` needs besides the board. */
export interface KanbanServerOptions {
  /** Returns the self-contained HTML of the board app. */
  readonly readAppHtml: () => string;
}

function boardResult(board: Board): CallToolResult {
  return {
    content: [{type: 'text', text: JSON.stringify(board)}],
    structuredContent: board as unknown as Record<string, unknown>,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {content: [{type: 'text', text: message}], isError: true};
}

/** Runs a board mutation and turns a `BoardError` into an error result instead of a protocol error. */
function mutate(run: () => Board): CallToolResult {
  try {
    return boardResult(run());
  } catch (error) {
    if (error instanceof BoardError) {
      return errorResult(error);
    }
    throw error;
  }
}

/**
 * Creates an `McpServer` over `board`. A new instance is needed per
 * Streamable HTTP request in stateless mode, so this is a factory.
 */
export function createKanbanServer(board: KanbanBoard, options: KanbanServerOptions): McpServer {
  const server = new McpServer({name: 'a2ui-kanban', version: '1.0.0'});

  server.registerTool(
    'list_board',
    {
      title: 'List board',
      description: 'Returns the whole Kanban board: columns, their WIP limits and cards.',
      inputSchema: {},
      outputSchema: BoardOutputSchema,
    },
    async () => boardResult(board.current),
  );

  server.registerTool(
    'move_task',
    {
      title: 'Move task',
      description:
        'Moves a task to another column, at the end or at a position. Does not enforce WIP limits.',
      inputSchema: {
        taskId: z.string().describe('Id of the task, for example "t1".'),
        toColumn: z.string().describe('Target column id or title, for example "review" or "Done".'),
        index: z.number().int().min(0).optional().describe('Position in the target column.'),
      },
      outputSchema: BoardOutputSchema,
    },
    async ({taskId, toColumn, index}) => mutate(() => board.moveTask(taskId, toColumn, index)),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: 'Adds a task to a column (Todo by default).',
      inputSchema: {
        title: z.string(),
        column: z.string().optional().describe('Column id or title; defaults to "todo".'),
        assignee: z.string().optional(),
        due: z.string().optional().describe('Due date as YYYY-MM-DD.'),
        tags: z.array(z.string()).optional(),
      },
      outputSchema: BoardOutputSchema,
    },
    async input => mutate(() => board.createTask(input)),
  );

  server.registerTool(
    'assign_task',
    {
      title: 'Assign task',
      description: 'Changes the assignee of a task.',
      inputSchema: {taskId: z.string(), assignee: z.string()},
      outputSchema: BoardOutputSchema,
    },
    async ({taskId, assignee}) => mutate(() => board.assignTask(taskId, assignee)),
  );

  registerAppTool(
    server,
    'open_board',
    {
      title: 'Open board',
      description:
        'Opens the interactive board app and returns the current board as its initial state.',
      inputSchema: {},
      outputSchema: BoardOutputSchema,
      _meta: {ui: {resourceUri: BOARD_RESOURCE_URI}},
    },
    async () => boardResult(board.current),
  );

  registerAppResource(
    server,
    'Kanban board app',
    BOARD_RESOURCE_URI,
    {
      description: 'The drag-and-drop Kanban board, as a self-contained MCP App.',
      mimeType: RESOURCE_MIME_TYPE,
      // The bundle has no external scripts, styles or connections.
      _meta: {ui: {csp: {connectDomains: [], resourceDomains: []}}},
    },
    async () => ({
      contents: [
        {uri: BOARD_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: options.readAppHtml()},
      ],
    }),
  );

  return server;
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

/**
 * Creates the HTTP server: `POST /mcp` (stateless Streamable HTTP, one
 * `McpServer` per request), `POST /reset`, and CORS for the browser client.
 */
export function createHttpServer(board: KanbanBoard, options: KanbanServerOptions): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCorsHeaders(res);
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === RESET_PATH && req.method === 'POST') {
      board.reset();
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(board.current));
      return;
    }
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404).end('Not found');
      return;
    }
    const server = createKanbanServer(board, options);
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('[kanban-mcp] Request failed:', error);
      if (!res.headersSent) {
        res.writeHead(500).end('Internal error');
      }
    }
  });
}
