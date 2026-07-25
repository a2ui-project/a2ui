/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {v0_8} from '@a2ui/lit';
import {registerMcpComponents} from './ui/custom-components/register-components.js';
import {componentRegistry} from '@a2ui/lit/ui';

type A2TextPayload = {
  kind: 'text';
  text: string;
};

type A2DataPayload = {
  kind: 'data';
  data: v0_8.Types.ServerToClientMessage;
};

type A2AServerPayload = Array<A2DataPayload | A2TextPayload> | {error: string};

export class A2UIClient {
  #ready: Promise<void> = Promise.resolve();
  get ready() {
    return this.#ready;
  }

  async send(
    message: v0_8.Types.A2UIClientEventMessage,
  ): Promise<v0_8.Types.ServerToClientMessage[]> {
    const catalog = componentRegistry.getInlineCatalog();
    const finalMessage = {
      ...message,
      metadata: {
        a2uiClientCapabilities: {
          inlineCatalogs: [catalog],
        },
      },
    };

    const response = await fetch('/a2a', {
      body: JSON.stringify(finalMessage),
      method: 'POST',
    });

    if (response.ok) {
      const data = (await response.json()) as A2AServerPayload;
      const messages: v0_8.Types.ServerToClientMessage[] = [];
      if ('error' in data) {
        throw new Error(data.error);
      } else {
        for (const item of data) {
          if (typeof item === 'object' && item !== null && 'kind' in item) {
            if (item.kind === 'text') continue;
            if (item.kind === 'data') {
              messages.push(item.data);
            }
          } else {
            // Assume it's a raw ServerToClientMessage
            messages.push(item as unknown as v0_8.Types.ServerToClientMessage);
          }
        }
      }
      return messages;
    }

    const text = await response.text();
    let errorMsg = text;
    try {
      const errorObj = JSON.parse(text);
      if (errorObj && typeof errorObj === 'object' && 'error' in errorObj) {
        errorMsg = errorObj.error;
      }
    } catch (e) {
      // Not JSON, use raw text
    }
    throw new Error(errorMsg);
  }
}

registerMcpComponents();
