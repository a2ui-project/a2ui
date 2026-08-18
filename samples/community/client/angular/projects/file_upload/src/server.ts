/*
 * Copyright 2024 Google LLC
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

import 'dotenv/config';
import {MessageSendParams, Part, SendMessageResponse} from '@a2a-js/sdk';
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

import {FILE_UPLOAD_CATALOG_ID} from './a2ui-catalog/catalog';

const browserDistFolder = join(import.meta.dirname, '../browser');
const app = express();
const angularApp = new AngularNodeAppEngine();
let clientPromise: Promise<A2AClient> | null = null;
let sessionContextId: string | undefined = undefined;
const agentUrl = process.env['AGENT_URL'] || 'http://localhost:10008';

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// Proxies file uploads from the Angular client to the Python Mock Drive server
// running alongside the agent.
app.post('/api/upload', async (req, res) => {
  const url = `${agentUrl}/api/mock-drive/v3/files?uploadType=multipart`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] as string,
      },
      body: req as any,
      duplex: 'half',
    } as RequestInit);

    if (!response.ok) {
      res.status(response.status).json({error: await response.text()});
      return;
    }
    const result = await response.json();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({error: err.message});
  }
});

// Proxies A2A chat requests from the Angular client to the backend agent.
// This endpoint receives simple HTTP requests with chat parts, wraps them into
// the full A2A Message structure (including supported catalog IDs), and sends
// them to the agent using the A2A SDK.
app.post('/a2a', (req, res) => {
  let originalBody = '';

  req.on('data', chunk => {
    originalBody += chunk.toString();
  });

  req.on('end', async () => {
    let data;
    try {
      data = JSON.parse(originalBody);
    } catch (err) {
      res.status(400).json({error: 'Invalid JSON body'});
      return;
    }

    const parts: Part[] = data['parts'];

    const sendParams: MessageSendParams = {
      message: {
        contextId: sessionContextId,
        messageId: uuidv4(),
        role: 'user',
        parts,
        kind: 'message',
        metadata: {
          a2uiClientCapabilities: {
            supportedCatalogIds: [
              'https://a2ui.org/specification/v0_9/standard_catalog_definition.json',
              'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
              FILE_UPLOAD_CATALOG_ID,
            ],
          },
        },
      },
    };

    let client: A2AClient;
    try {
      client = await createOrGetClient();
    } catch (_error) {
      res.status(500).json({error: 'Failed to create A2A client.'});
      return;
    }

    let response: SendMessageResponse;
    try {
      response = await client.sendMessage(sendParams);
    } catch (_error) {
      res.status(500).json({error: 'Failed to send message.'});
      return;
    }

    res.set('Cache-Control', 'no-store');

    if ('error' in response) {
      res.status(500).json({error: JSON.stringify(response.error)});
      return;
    }

    if (
      response.result &&
      'contextId' in response.result &&
      typeof response.result.contextId === 'string'
    ) {
      sessionContextId = response.result.contextId;
    }

    res.json(response);
  });
});

app.get('/a2a/agent-card', async (req, res) => {
  try {
    const response = await fetchWithCustomHeader(`${agentUrl}/.well-known/agent-card.json`);
    if (!response.ok) {
      res.status(response.status).json({error: 'Failed to fetch agent card'});
      return;
    }
    const card = await response.json();
    res.json(card);
  } catch (_error) {
    console.error('Error fetching agent card:', _error);
    res.status(500).json({error: 'Internal server error'});
  }
});

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

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

async function fetchWithCustomHeader(url: string | URL | Request, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-A2A-Extensions', 'https://a2ui.org/a2a-extension/a2ui/v0.9');
  const newInit = {...init, headers};
  return fetch(url, newInit);
}

async function createOrGetClient() {
  if (!clientPromise) {
    clientPromise = A2AClient.fromCardUrl(`${agentUrl}/.well-known/agent-card.json`, {
      fetchImpl: fetchWithCustomHeader,
    }).catch(err => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export const reqHandler = createNodeRequestHandler(app);
