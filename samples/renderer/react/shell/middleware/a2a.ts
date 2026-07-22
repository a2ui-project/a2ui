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

import {IncomingMessage, ServerResponse} from 'http';
import {Plugin, ViteDevServer} from 'vite';
import {A2AClient} from '@a2a-js/sdk/client';
import {MessageSendParams, Part, SendMessageSuccessResponse, Task} from '@a2a-js/sdk';
import * as crypto from 'crypto';

const A2UI_MIME_TYPE = 'application/a2ui+json';
const enableStreaming = process.env['ENABLE_STREAMING'] !== 'false';

const fetchWithCustomHeader: typeof fetch = async (url, init) => {
  const headers = new Headers(init?.headers);
  headers.set('X-A2A-Extensions', 'https://a2ui.org/a2a-extension/a2ui/v0.9');

  const newInit = {...init, headers};
  return fetch(url, newInit);
};

const isJson = (str: string) => {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch (_err) {
    return false;
  }
};

let client: A2AClient | null = null;
const createOrGetClient = async () => {
  if (!client) {
    client = await A2AClient.fromCardUrl('http://localhost:10002/.well-known/agent-card.json', {
      fetchImpl: fetchWithCustomHeader,
    });
  }

  return client;
};

export const plugin = (): Plugin => {
  return {
    name: 'a2a-handler',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        '/a2a',
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method === 'POST') {
            let originalBody = '';
            // Cap the in-memory request body so a misbehaving shell can't
            // exhaust the dev server's heap.
            const MAX_PAYLOAD_SIZE = 1024 * 1024;

            req.on('data', chunk => {
              originalBody += chunk.toString();
              if (originalBody.length > MAX_PAYLOAD_SIZE) {
                res.statusCode = 413;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({error: 'Payload too large'}));
                req.destroy();
              }
            });

            req.on('end', async () => {
              if (res.writableEnded) return; // Aborted by size limit.

              let sendParams: MessageSendParams;

              if (isJson(originalBody)) {
                console.log('[a2a-middleware] Received JSON UI event:', originalBody);

                const clientEvent = JSON.parse(originalBody) as Record<string, unknown>;

                sendParams = {
                  message: {
                    messageId: crypto.randomUUID(),
                    role: 'user',
                    parts: [
                      {
                        kind: 'data',
                        data: clientEvent,
                        mimeType: A2UI_MIME_TYPE,
                      } as Part,
                    ],
                    kind: 'message',
                  },
                };
              } else {
                console.log('[a2a-middleware] Received text query:', originalBody);
                sendParams = {
                  message: {
                    messageId: crypto.randomUUID(),
                    role: 'user',
                    parts: [
                      {
                        kind: 'text',
                        text: originalBody,
                      },
                    ],
                    kind: 'message',
                  },
                };
              }

              const client = await createOrGetClient();

              try {
                if (enableStreaming) {
                  const stream = await client.sendMessageStream(sendParams);
                  res.statusCode = 200;

                  res.setHeader('Content-Type', 'text/event-stream');
                  res.setHeader('Cache-Control', 'no-cache');
                  res.setHeader('Connection', 'keep-alive');

                  for await (const chunk of stream) {
                    // Client disconnected; stop pulling from the agent.
                    if (res.destroyed) break;
                    // A2AClient unpacks the JSON-RPC, so chunk is an A2AStreamEventData.
                    if (chunk.kind === 'status-update' && chunk.status.message?.parts) {
                      res.write(`data: ${JSON.stringify(chunk.status.message.parts)}\n\n`);
                    } else if (chunk.kind === 'message' && chunk.parts) {
                      res.write(`data: ${JSON.stringify(chunk.parts)}\n\n`);
                    }
                  }
                  res.end();
                } else {
                  const response = await client.sendMessage(sendParams);
                  res.setHeader('Cache-Control', 'no-store');
                  if ('error' in response) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({error: response.error.message}));
                  } else {
                    const result = (response as SendMessageSuccessResponse).result as Task;
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(
                      JSON.stringify(
                        result.kind === 'task' ? result.status.message?.parts || [] : [],
                      ),
                    );
                  }
                }
              } catch (e: unknown) {
                console.error('Error during streaming:', e);
                const errorMessage = e instanceof Error ? e.message : String(e);
                if (!res.headersSent) {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({error: errorMessage}));
                } else {
                  res.write(`data: ${JSON.stringify([{kind: 'error', text: errorMessage}])}\n\n`);
                  res.end();
                }
              }
            });

            return;
          } else {
            next();
          }
        },
      );
    },
  };
};
