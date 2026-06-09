/*
 * Copyright 2025 Google LLC
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

import {AgentCard, Part, SendMessageSuccessResponse} from '@a2a-js/sdk';
import {A2aService as A2aServiceInterface} from '@a2a_chat_canvas/interfaces/a2a-service';
import {Inject, Injectable, PLATFORM_ID} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';
import {CatalogService} from './catalog_service';

@Injectable({providedIn: 'root'})
export class A2aService implements A2aServiceInterface {
  private contextId?: string;
  private isBrowser: boolean;

  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private catalogService: CatalogService,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  async sendMessage(parts: Part[], signal?: AbortSignal): Promise<SendMessageSuccessResponse> {
    const currentCatalogUris = this.catalogService.catalogUris;
    console.log('Attaching supported A2UI catalogs to message: ', currentCatalogUris);
    const response = await fetch('/a2a', {
      body: JSON.stringify({
        parts: parts,
        metadata: {
          a2uiClientCapabilities: {
            supportedCatalogIds: currentCatalogUris,
          },
        },
        contextId: this.contextId,
      }),
      method: 'POST',
      signal,
    });

    if (response.ok) {
      const json = (await response.json()) as SendMessageSuccessResponse & {contextId?: string};
      if (json.contextId || json.result?.contextId) {
        this.contextId = json.contextId || json.result?.contextId;
      }
      return json;
    }

    const error = (await response.json()) as {error: string};
    throw new Error(error.error);
  }

  async getAgentCard(): Promise<AgentCard> {
    if (!this.isBrowser) {
      return {iconUrl: 'rizz-agent.png'} as AgentCard;
    }
    const response = await fetch('/a2a/agent-card');
    if (!response.ok) {
      throw new Error('Failed to fetch agent card');
    }
    const card = (await response.json()) as AgentCard;
    // Override iconUrl to use local asset
    card.iconUrl = 'rizz-agent.png';
    return card;
  }
}
