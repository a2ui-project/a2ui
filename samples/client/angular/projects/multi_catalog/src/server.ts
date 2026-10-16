/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {MessageSendParams, Part, SendMessageSuccessResponse, Task} from '@a2a-js/sdk';
import {A2AClient} from '@a2a-js/sdk/client';
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {join} from 'node:path';
import {v4 as uuidv4} from 'uuid';

const AGENT_URL = process.env['AGENT_URL'] ?? 'http://localhost:10010';
const A2UI_EXTENSION = 'https://a2ui.org/a2a-extension/a2ui/v1.0';
const enableStreaming = process.env['ENABLE_STREAMING'] !== 'false';

/**
 * The catalogs that the renderer registers in app.config.ts, sent as the
 * `a2uiRendererCapabilities` of the v1.0 A2A extension. The agent picks the
 * ones it supports too, and validates each component against the catalog it
 * resolves to.
 */
const A2UI_RENDERER_CAPABILITIES = {
  'v1.0': {
    supportedCatalogIds: [
      'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      'https://a2ui.org/samples/agent/adk/multi_catalog/catalogs/1.0/dashboard_catalog.json',
    ],
  },
};

const browserDistFolder = join(import.meta.dirname, '../browser');
const app = express();
const angularApp = new AngularNodeAppEngine();
let client: A2AClient | null = null;

app.use(express.static(browserDistFolder, {maxAge: '1y', index: false, redirect: false}));

app.post('/a2a', express.json(), async (req, res) => {
  const {query, event, contextId} = req.body as {
    query?: string;
    event?: Record<string, unknown>;
    contextId?: string;
  };
  const parts: Part[] = event
    ? [{kind: 'data', data: event, metadata: {mimeType: 'application/a2ui+json'}}]
    : [{kind: 'text', text: query ?? ''}];
  const sendParams: MessageSendParams = {
    message: {
      messageId: uuidv4(),
      contextId,
      role: 'user',
      kind: 'message',
      parts,
      metadata: {
        a2uiRendererCapabilities: A2UI_RENDERER_CAPABILITIES,
        useStreaming: enableStreaming,
      },
    },
  };

  try {
    const a2aClient = await createOrGetClient();
    if (enableStreaming) {
      await handleStreamingResponse(a2aClient, sendParams, res);
    } else {
      await handleNonStreamingResponse(a2aClient, sendParams, res);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[server] Request failed:', message);
    if (!res.headersSent) {
      res.status(500).json({error: message});
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({error: message})}\n\n`);
      res.end();
    }
  }
});

async function handleStreamingResponse(
  a2aClient: A2AClient,
  sendParams: MessageSendParams,
  res: express.Response,
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);

  let events = 0;
  const start = Date.now();
  for await (const event of a2aClient.sendMessageStream(sendParams)) {
    if (event.kind !== 'task' && event.kind !== 'status-update') {
      continue;
    }
    const parts = event.status.message?.parts ?? [];
    if (parts.length > 0) {
      events++;
      console.log(`[server] +${Date.now() - start}ms event ${events}:\n${describeParts(parts)}`);
      res.write(`data: ${JSON.stringify({parts, contextId: event.contextId})}\n\n`);
    }
  }
  res.end();
  console.log(`[server] Streamed ${events} events`);
}

/** Formats the parts of an agent update for the log: text, or full A2UI messages as JSON. */
function describeParts(parts: Part[]): string {
  return parts
    .map(part => {
      if (part.kind === 'text') {
        return `text: ${JSON.stringify(part.text)}`;
      }
      if (part.kind !== 'data') {
        return part.kind;
      }
      const messages = Array.isArray(part.data) ? part.data : [part.data];
      return messages.map(message => JSON.stringify(message)).join('\n');
    })
    .join('\n');
}

async function handleNonStreamingResponse(
  a2aClient: A2AClient,
  sendParams: MessageSendParams,
  res: express.Response,
) {
  const response = await a2aClient.sendMessage(sendParams);
  if ('error' in response) {
    res.status(500).json({error: response.error.message});
    return;
  }
  const result = (response as SendMessageSuccessResponse).result as Task;
  const parts = result.kind === 'task' ? (result.status.message?.parts ?? []) : [];
  console.log(`[server] Sent ${parts.length} parts in one response:\n${describeParts(parts)}`);
  res.set('Cache-Control', 'no-store');
  res.json({parts, contextId: result.contextId});
}

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then(response => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, error => {
    if (error) {
      throw error;
    }
    console.log(
      `Node Express server listening on http://localhost:${port}` +
        ` (streaming: ${enableStreaming}, agent: ${AGENT_URL})`,
    );
  });
}

async function fetchWithA2uiExtension(url: string | URL | Request, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-A2A-Extensions', A2UI_EXTENSION);
  return fetch(url, {...init, headers});
}

async function createOrGetClient() {
  client ??= await A2AClient.fromCardUrl(`${AGENT_URL}/.well-known/agent-card.json`, {
    fetchImpl: fetchWithA2uiExtension,
  });
  return client;
}

export const reqHandler = createNodeRequestHandler(app);
