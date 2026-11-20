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

/** Entry point: serves the board on `PORT` (default 8788) from the built app bundle. */

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {KanbanBoard} from './board.js';
import {createHttpServer, DEFAULT_PORT, MCP_PATH} from './server.js';

const APP_HTML_PATH = fileURLToPath(new URL('./app/board.html', import.meta.url));

function readAppHtml(): string {
  try {
    return readFileSync(APP_HTML_PATH, 'utf8');
  } catch {
    throw new Error(`Board app bundle not found at ${APP_HTML_PATH}; run \`yarn build\` first.`);
  }
}

// Fail at startup rather than on the first resources/read.
readAppHtml();

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
const board = new KanbanBoard();
createHttpServer(board, {readAppHtml}).listen(port, () => {
  console.log(`[kanban-mcp] Streamable HTTP on http://localhost:${port}${MCP_PATH}`);
});
