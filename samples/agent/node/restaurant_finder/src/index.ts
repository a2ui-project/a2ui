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

import express from 'express';
import {DefaultRequestHandler, InMemoryTaskStore} from '@a2a-js/sdk/server';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '@a2a-js/sdk/server/express';
import {RestaurantExecutor, agentCard} from './agent.js';

export function main() {
  const app = express();
  app.use(express.json());

  const taskStore = new InMemoryTaskStore();
  const agentExecutor = new RestaurantExecutor();

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

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10002;

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Restaurant Agent Node Sample running on port ${PORT}`);
    console.log(`JSON-RPC endpoint: http://localhost:${PORT}/a2a/json-rpc`);
  });
}

main();
