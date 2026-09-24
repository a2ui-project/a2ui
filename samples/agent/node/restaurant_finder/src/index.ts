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

import path from 'path';
import express from 'express';
import {DefaultRequestHandler, InMemoryTaskStore} from '@a2a-js/sdk/server';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '@a2a-js/sdk/server/express';
import {RestaurantExecutor, buildAgentCard, resolveLlmMode, resolveSampleConfig} from './agent.js';
import {resolvePythonSampleDir, verifyPythonSampleAssets} from './tools.js';

export function main() {
  let config;
  let mode;
  const pythonDir = resolvePythonSampleDir();

  try {
    config = resolveSampleConfig();
    mode = resolveLlmMode();
    verifyPythonSampleAssets(pythonDir);
  } catch (e) {
    console.error(`Configuration error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10002;
  const modelName = process.env.MODEL_NAME?.trim() || 'gemini-2.5-flash';

  let agentExecutor: RestaurantExecutor;
  let agentCard;
  try {
    agentCard = buildAgentCard(config, PORT);
    agentExecutor = new RestaurantExecutor(config, PORT, pythonDir);
  } catch (e) {
    console.error(`Configuration error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const app = express();

  // Hand-written CORS middleware matching Python's allow_origin_regex
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /^http:\/\/localhost:\d+$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
      const reqHeaders = req.headers['access-control-request-headers'];
      res.setHeader('Access-Control-Allow-Headers', reqHeaders || '*');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Static images served from the shared Python sample
  const imagesDir = path.join(pythonDir, 'images');
  app.use('/static', express.static(imagesDir));

  app.use(express.json());

  // Copy the X-A2A-Extensions header into message.extensions. DefaultRequestHandler
  // drops every requested extension that the agent card does not advertise, so without
  // this the executor cannot tell "no A2UI version requested" from "another A2UI
  // version requested", and would answer a v0.9 client in v1.0 (or the reverse).
  app.use((req, _res, next) => {
    const headerExt = req.headers['x-a2a-extensions'];
    if (headerExt && req.body && typeof req.body === 'object') {
      const body = req.body as Record<string, unknown>;
      const params = body.params as Record<string, unknown> | undefined;
      if (params && params.message && typeof params.message === 'object') {
        const msg = params.message as Record<string, unknown>;
        const rawExtensions = String(headerExt)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        const existing = Array.isArray(msg.extensions) ? (msg.extensions as string[]) : [];
        msg.extensions = Array.from(new Set([...existing, ...rawExtensions]));
      }
    }
    next();
  });

  const taskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, agentExecutor);

  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({agentCardProvider: async () => agentCard}),
  );

  app.use(
    '/a2a/json-rpc',
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  app.use(
    '/v1',
    restHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Restaurant Agent Node Sample running on port ${PORT}`);
    console.log(`Version: ${config.version} | Format: ${config.format}`);
    console.log(
      mode === 'stub'
        ? 'Model: none. STUB_LLM=true, so every turn serves the canned response.'
        : `Model: ${modelName} via GEMINI_API_KEY.`,
    );
    console.log(`JSON-RPC endpoint: http://localhost:${PORT}/a2a/json-rpc`);
  });

  return server;
}

main();
