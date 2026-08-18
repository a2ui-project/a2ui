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

import {AgentCard, Part, SendMessageSuccessResponse} from '@a2a-js/sdk';
import {A2aService} from '@a2a_chat_canvas/interfaces/a2a-service';
import {Inject, Injectable, PLATFORM_ID} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';
import {TelemetryLoggerService} from './telemetry-logger-service';
import {MockDriveUploadService} from './mock-drive-upload-service';
import {z} from 'zod';

const actionMessageSchema = z
  .string()
  .transform((str, ctx) => {
    if (!str.trim().startsWith('{')) {
      ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Not a JSON object'});
      return z.NEVER;
    }
    try {
      return JSON.parse(str);
    } catch {
      ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Invalid JSON'});
      return z.NEVER;
    }
  })
  .pipe(
    z
      .object({
        action: z.any().optional(),
      })
      .passthrough(),
  );

@Injectable({
  providedIn: 'root',
})
export class A2aServiceImpl implements A2aService {
  private isBrowser: boolean;

  constructor(
    @Inject(PLATFORM_ID) platformId: object,
    private telemetry: TelemetryLoggerService,
    private driveService: MockDriveUploadService,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  async sendMessage(parts: Part[], signal?: AbortSignal): Promise<SendMessageSuccessResponse> {
    const newParts: Part[] = [];

    for (const p of parts) {
      const isTextPart = 'text' in p && typeof p.text === 'string';
      if (isTextPart) {
        const parseResult = actionMessageSchema.safeParse(p.text);
        if (parseResult.success) {
          const parsed = parseResult.data;
          if (parsed.action) {
            const action = parsed.action;

            // When an upload completes, we extract the large inline base64 data and append
            // them as dedicated A2A FileParts. This prevents bloating the text action payload
            // while preserving the fileId for pointer resolution.
            if (action.name === 'upload_complete' && Array.isArray(action.context?.files)) {
              let hasExtractedFiles = false;

              for (const uploadedFile of action.context.files) {
                if (!uploadedFile.inlineData || !uploadedFile.fileId) {
                  continue;
                }

                const mimeType =
                  uploadedFile.mimeType ||
                  uploadedFile.metadata?.mimeType ||
                  'application/octet-stream';

                // Strip the data URL prefix if present (e.g., "data:image/png;base64,...")
                const base64Data = uploadedFile.inlineData.includes(',')
                  ? uploadedFile.inlineData.split(',')[1]
                  : uploadedFile.inlineData;

                // Append as a dedicated file part
                // @ts-ignore
                newParts.push({
                  kind: 'file',
                  file: {bytes: base64Data, mimeType},
                  metadata: {fileId: uploadedFile.fileId},
                });

                // Remove inlineData from the JSON payload to reduce size
                delete uploadedFile.inlineData;
                hasExtractedFiles = true;
              }

              // Replace the text part with the modified JSON payload to omit inlineData,
              // while preserving the fileId for pointer resolution.
              if (hasExtractedFiles) {
                p.text = JSON.stringify(parsed);
              }
            }

            this.telemetry.log({
              card: 'action',
              title: `A2UI Action Dispatched: ${action.name || 'event'}`,
              detail: {
                name: action.name,
                context: action.context,
              },
            });
          }
        } else {
          // The previous check attempts to parse the text as a JSON action.
          // If it fails (parseResult.success === false), it means it's a normal plain-text chat message from the user.
          this.enrichPromptWithContext(p);
        }
      }
      newParts.push(p);
    }

    const response = await fetch('/a2a', {
      body: JSON.stringify({parts: newParts}),
      method: 'POST',
      signal,
    });

    if (response.ok) {
      const data = (await response.json()) as SendMessageSuccessResponse;
      this.handleAgentResponse(data);
      return data;
    }

    const error = (await response.json()) as {error: string};
    this.telemetry.log({
      card: 'agent',
      title: 'Agent Resolution Error',
      detail: {error: error.error},
    });
    throw new Error(error.error);
  }

  async getAgentCard(): Promise<AgentCard> {
    if (!this.isBrowser) {
      return {} as AgentCard;
    }
    const response = await fetch('/a2a/agent-card');
    if (!response.ok) {
      throw new Error('Failed to fetch agent card');
    }
    const card = (await response.json()) as AgentCard;

    const skills =
      (
        card as unknown as {
          skills?: {id?: string; name?: string; description?: string; tags?: string[]}[];
        }
      ).skills || [];

    for (const skill of skills) {
      this.telemetry.log({
        card: 'agent',
        title: `Agent Skill Ready: ${skill.name || skill.id || 'Skill'}`,
        detail: {
          agentName: card.name,
          skillId: skill.id,
          description: skill.description,
          tags: skill.tags,
        },
      });
    }

    return card;
  }

  private enrichPromptWithContext(p: Part) {
    const uploadedFiles = this.driveService.uploadedFiles();
    if (
      uploadedFiles.length > 0 &&
      'text' in p &&
      typeof p.text === 'string' &&
      this.isPromptRequestingFileContext(p.text)
    ) {
      const contextItems = uploadedFiles.map(
        f => `fileId="${f.fileId}", fileName="${f.fileName}", mimeType="${f.mimeType}"`,
      );
      const contextStr = contextItems.map(item => `  - ${item}`).join('\n');
      p.text = `${p.text}\n\n[Host IoC Context: UploadedFiles\n${contextStr}\n]`;

      this.telemetry.log({
        card: 'websocket',
        title: 'Attached IoC File Pointers to Chat Prompt',
        detail: {
          promptText: p.text.split('\n')[0],
          filesIncluded: uploadedFiles.length,
          inlineDataBytes: 0,
          note: '0 Base64 bytes transmitted in prompt (Pointer-only)',
        },
      });
    }
  }
  /**
   * Evaluates whether the user's prompt text suggests they are asking about
   * uploaded files or documents. Uses word roots (e.g., `summariz`) to match
   * variants like summarize, summarizes, summarizing, summarization.
   */
  private isPromptRequestingFileContext(text: string): boolean {
    return /summariz|analy|explain|file|doc|upload|read/i.test(text);
  }

  private handleAgentResponse(data: SendMessageSuccessResponse) {
    this.telemetry.log({
      card: 'agent',
      title: 'Agent Inference & UI Stream',
      detail: data,
    });

    // Intercept data model update to show Steps 4 and 5
    let parts: any[] = [];
    if (data.result && (data.result as any).parts) {
      parts = (data.result as any).parts;
    } else if (data.result && (data.result as any).history?.length) {
      parts = (data.result as any).history[(data.result as any).history.length - 1].parts || [];
    }

    if (parts) {
      for (const p of parts) {
        if ('a2ui' in p && Array.isArray(p.a2ui)) {
          for (const msg of p.a2ui) {
            if (
              msg.updateDataModel &&
              (msg.updateDataModel.path === '/uploaded_file' ||
                msg.updateDataModel.path === '/uploaded_files')
            ) {
              this.telemetry.log({
                card: 'websocket',
                title: 'Step 4: Agent responds with datamodel update to hydrate',
                detail: {payload: msg.updateDataModel},
              });
              setTimeout(() => {
                this.telemetry.log({
                  card: 'resolver',
                  title: 'Step 5: The button is hydrated with a new ID',
                  detail: {newId: msg.updateDataModel.value?.fileId},
                });
              }, 500); // slight delay to represent hydration time
            }
          }
        }
      }
    }
  }
}
