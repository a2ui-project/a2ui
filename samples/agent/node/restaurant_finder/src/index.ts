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

import fs from 'fs';
import path from 'path';
import {pathToFileURL} from 'url';

import type {AgentCard} from '@a2a-js/sdk';
import {DefaultRequestHandler, InMemoryTaskStore} from '@a2a-js/sdk/server';
import {agentCardHandler, jsonRpcHandler, UserBuilder} from '@a2a-js/sdk/server/express';
import express from 'express';

import {RestaurantExecutor} from './agent.js';
import {resolveLlmMode, resolveModelName, resolveSampleConfig} from './config.js';
import {GeminiBackend, type ModelBackend, StubBackend} from './model.js';
import {resolvePythonSampleDir, verifyPythonSampleAssets} from './tools.js';

const DEFAULT_PORT = 10002;

/** Builds the agent card. A2A clients such as lit read it before sending messages. */
function buildAgentCard(port: number, stub: boolean): AgentCard {
  return {
    name: stub ? 'Restaurant Agent (stub)' : 'Restaurant Agent',
    description: 'This agent helps find restaurants based on user criteria.',
    protocolVersion: '0.3.0',
    version: '1.0.0',
    url: `http://localhost:${port}/a2a/json-rpc`,
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'find_restaurants',
        name: 'Find Restaurants Tool',
        description: 'Helps find restaurants based on user criteria (e.g., cuisine, location).',
        tags: ['restaurant', 'finder'],
        examples: ['Find me the top 10 chinese restaurants in the US'],
      },
    ],
    capabilities: {streaming: true},
  };
}

/**
 * Builds the Express app and agent card without listening. Throws on invalid
 * configuration.
 *
 * @param options.env Environment to read the configuration from (default `process.env`).
 * @param options.port Port the agent card and restaurant image URLs point at (default
 *     `PORT`, or 10002).
 */
export function createApp(options: {env?: NodeJS.ProcessEnv; port?: number} = {}): {
  app: express.Express;
  agentCard: AgentCard;
} {
  const env = options.env ?? process.env;
  const port = options.port ?? (env.PORT ? parseInt(env.PORT, 10) : DEFAULT_PORT);
  const {format} = resolveSampleConfig(env);
  const mode = resolveLlmMode(env);
  const pythonDir = resolvePythonSampleDir();
  verifyPythonSampleAssets(pythonDir);

  const backend: ModelBackend =
    mode === 'stub'
      ? new StubBackend(format)
      : new GeminiBackend({
          apiKey: env.GEMINI_API_KEY!,
          modelName: resolveModelName(env),
          baseUrl: `http://localhost:${port}`,
          pythonSampleDir: pythonDir,
        });
  const agentCard = buildAgentCard(port, mode === 'stub');
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    new RestaurantExecutor(format, backend),
  );

  const app = express();

  // Hand-written CORS middleware matching Python's allow_origin_regex. The lit client
  // calls the agent from the browser.
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
  app.use('/static', express.static(path.join(pythonDir, 'images')));

  app.use(express.json());
  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({agentCardProvider: async () => agentCard}),
  );
  app.use(
    '/a2a/json-rpc',
    jsonRpcHandler({requestHandler, userBuilder: UserBuilder.noAuthentication}),
  );

  return {app, agentCard};
}

/** Checks the configuration, then serves the agent. */
export function main() {
  let mode;
  let format;
  let app;
  try {
    format = resolveSampleConfig().format;
    mode = resolveLlmMode();
    ({app} = createApp());
  } catch (e) {
    console.error(`Configuration error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;
  return app.listen(port, '0.0.0.0', () => {
    console.log(`Restaurant Agent Node Sample running on port ${port}`);
    console.log(`Format: ${format}`);
    console.log(
      mode === 'stub'
        ? 'Model: none. STUB_LLM=true, so every turn serves the canned response.'
        : `Model: ${resolveModelName()} via GEMINI_API_KEY.`,
    );
    console.log(`JSON-RPC endpoint: http://localhost:${port}/a2a/json-rpc`);
  });
}

// Serve only when run directly, so tests can import createApp.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
