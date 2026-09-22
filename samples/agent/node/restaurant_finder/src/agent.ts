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

import {
  AgentCard,
  Task,
  TaskStatusUpdateEvent,
  Message,
  Part,
  TextPart,
  DataPart,
} from '@a2a-js/sdk';
import {AgentExecutor, RequestContext, ExecutionEventBus} from '@a2a-js/sdk/server';
import {GoogleGenAI, Content} from '@google/genai';
import {
  A2uiGenerator,
  basicCatalog,
  DirectJsonStreamProcessorImpl,
  CatalogConfig,
} from '@a2ui/agent';
import {confirmationExample} from './examples/confirmation.js';
import * as crypto from 'crypto';

export const agentCard: AgentCard = {
  name: 'Restaurant Agent',
  description: 'Node minimal sample.',
  protocolVersion: '0.3.0',
  version: '0.1.0',
  url: 'http://localhost:10002/a2a/json-rpc',
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    {
      id: 'find_restaurants',
      name: 'Find Restaurants Tool',
      description: 'Helps find restaurants.',
      tags: [],
    },
  ],
  capabilities: {
    streaming: true,
    extensions: [
      {
        uri: 'https://a2ui.org/a2a-extension/a2ui/v1.0',
        params: {
          version: '1.0.0',
          capabilities: {
            supportedCatalogIds: [
              'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            ],
          },
        },
      },
    ],
  },
};

const ROLE_DESCRIPTION = 'You are a helpful restaurant assistant.';
const UI_DESCRIPTION = 'You use A2UI to build interactive UIs for the user.';

const basicConf = new CatalogConfig(basicCatalog());
const generator = new A2uiGenerator([basicConf], {
  'confirmation': confirmationExample,
});

const sessionHistory = new Map<string, Content[]>();

export class RestaurantExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const {taskId, contextId, userMessage, task} = requestContext;

    if (!task) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId,
        status: {state: 'submitted', timestamp: new Date().toISOString()},
        history: [userMessage],
      };
      eventBus.publish(initialTask);
    }

    let query = '';
    for (const part of userMessage.parts) {
      if ('text' in part && part.text) {
        query = part.text;
      } else if ('data' in part && typeof part.data === 'object' && part.data !== null) {
        const dataMap = part.data as Record<string, unknown>;
        if (dataMap.version === 'v1.0' && dataMap.action && typeof dataMap.action === 'object') {
          const action = dataMap.action as Record<string, unknown>;
          query = `User submitted an action: ${action.name} with data: ${JSON.stringify(action)}`;
        }
      }
    }

    if (!query) {
      query = 'Hello!';
    }

    // Note: Inbound renderer capability negotiation is not natively supported on ServerCallContext.
    // We default to the basic catalog. A production deployment might negotiate this out-of-band
    // or via an explicit capabilities convention in metadata.
    const supportedCatalogIds = ['https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'];

    const processor = generator.createProcessor({supportedCatalogIds});

    if (!processor.activeCatalogs[0]) {
      throw new Error('No active catalog negotiated.');
    }

    const systemInstruction =
      ROLE_DESCRIPTION + '\n' + UI_DESCRIPTION + '\n' + processor.promptSnippet;
    const useStub = process.env.STUB_LLM === 'true' || !process.env.GEMINI_API_KEY;

    const workingEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {state: 'working', timestamp: new Date().toISOString()},
      final: false,
    };
    eventBus.publish(workingEvent);

    const streamProcessor = new DirectJsonStreamProcessorImpl(processor.activeCatalogs[0], {
      progressiveKeys: ['text', 'literalString'],
    });

    const history = sessionHistory.get(contextId) || [];
    history.push({role: 'user', parts: [{text: query}]});

    let fullOutput = '';

    if (useStub) {
      console.log('Using stub LLM response...');
      // Note there is no "root" key: createSurface is strict and defines no such property.
      // The root of the component tree is the component whose id is "root".
      const stubResponse = `<a2ui-json>\n{\n  "version": "v1.0",\n  "createSurface": {\n    "surfaceId": "test",\n    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",\n    "components": [\n      {\n        "id": "root",\n        "component": "Text",\n        "text": "Stub response"\n      }\n    ]\n  }\n}\n</a2ui-json>`;

      const chunks = [
        stubResponse.substring(0, 30),
        stubResponse.substring(30, 60),
        stubResponse.substring(60, 100),
        stubResponse.substring(100),
      ];

      for (const chunk of chunks) {
        fullOutput += chunk;
        const parts = streamProcessor.processChunk(chunk);
        if (parts.length > 0) {
          const messageEvent: Message = {
            kind: 'message',
            messageId: crypto.randomUUID(),
            role: 'agent',
            taskId,
            contextId,
            parts: parts.map((p): Part => {
              if (p.type === 'text') {
                const tp: TextPart = {kind: 'text', text: p.text};
                return tp;
              } else {
                const dp: DataPart = {
                  kind: 'data',
                  data: p.a2ui as unknown as Record<string, unknown>,
                };
                return dp;
              }
            }),
          };
          eventBus.publish(messageEvent);
        }
      }
    } else {
      const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

      const previousHistory = history.slice(0, -1);

      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {systemInstruction},
        history: previousHistory,
      });

      const responseStream = await chat.sendMessageStream({message: query});

      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullOutput += chunk.text;
          const parts = streamProcessor.processChunk(chunk.text);
          if (parts.length > 0) {
            const messageEvent: Message = {
              kind: 'message',
              messageId: crypto.randomUUID(),
              role: 'agent',
              taskId,
              contextId,
              parts: parts.map((p): Part => {
                if (p.type === 'text') {
                  const tp: TextPart = {kind: 'text', text: p.text};
                  return tp;
                } else {
                  const dp: DataPart = {
                    kind: 'data',
                    data: p.a2ui as unknown as Record<string, unknown>,
                  };
                  return dp;
                }
              }),
            };
            eventBus.publish(messageEvent);
          }
        }
      }
    }

    // Post-hoc integrity check: validate the full emitted payload
    // against the processor's active catalog.
    // If validation throws, the invalid UI has already started to stream,
    // but we mark the task 'failed' here to properly halt the flow
    // and indicate the error to the A2A client.
    try {
      processor.parseResponse(fullOutput);
    } catch (e) {
      console.error('A2UI Validation Error during final state check:', e);
      const errorEvent: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        status: {state: 'failed', timestamp: new Date().toISOString()},
        final: true,
      };
      eventBus.publish(errorEvent);
      return;
    }

    history.push({role: 'model', parts: [{text: fullOutput}]});
    sessionHistory.set(contextId, history);

    const completedEvent: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {state: 'completed', timestamp: new Date().toISOString()},
      final: true,
    };
    eventBus.publish(completedEvent);
  }

  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    console.log('Cancellation requested for', taskId);
  }
}
