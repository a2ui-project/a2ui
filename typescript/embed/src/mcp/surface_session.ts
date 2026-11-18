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
  MessageProcessor,
  type ActionPayload,
  type AgentToRendererMessage,
  type Catalog,
  type SurfaceModel,
} from '@a2ui/web_core/v1_0';
import type {ValidationConfig} from '@a2ui/web_core/validation';
import type {LitComponentApi} from '@a2ui/lit';
import type {SharedDataModel} from './model_context.js';

/**
 * The validation rules for messages from a tool result.
 *
 * Components and functions must exist in their catalog and match its schema. The references
 * between components are checked once a whole batch is applied (see `assertComplete`), so a
 * batch may send a parent before its children. Only the four surface messages are allowed: the
 * app has no channel to answer `callRendererFunction`.
 */
const MESSAGE_VALIDATION: ValidationConfig = {
  allowUnknownElements: false,
  allowDanglingReferences: true,
  allowOrphanComponents: true,
  allowMissingRoot: true,
  allowedMessages: ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'],
};

/**
 * The A2UI state of one tool result: a `MessageProcessor` and the messages applied to it.
 *
 * Batches apply atomically. Each batch is first replayed, after every batch applied before it,
 * on a scratch processor; only when that succeeds and leaves every surface complete is it
 * applied to the processor the surfaces render from. An invalid batch therefore never shows
 * partially.
 */
export class SurfaceSession {
  readonly processor: MessageProcessor<LitComponentApi>;
  private readonly applied: AgentToRendererMessage[][] = [];
  /** True while `apply` runs messages whose data model changes the user did not cause. */
  private applyingServerChange = false;

  /**
   * @param onUserDataChange Called when the user changes the data model of a surface created
   *     with `sendDataModel: true`: directly, through the components, or through messages
   *     applied with `userCaused: true`.
   */
  constructor(
    private readonly catalogs: Catalog<LitComponentApi>[],
    onAction: (action: ActionPayload) => void,
    onUserDataChange: () => void = () => {},
  ) {
    this.processor = this.createProcessor(onAction);
    this.processor.onSurfaceCreated(surface => {
      if (!surface.sendDataModel) return;
      // Messages change the data model synchronously inside `apply`, so any other change comes
      // from the components, on the user's input. The surface's disposal ends the subscription.
      surface.dataModel.subscribe('/', () => {
        if (!this.applyingServerChange) onUserDataChange();
      });
    });
  }

  /** The surfaces to render, in creation order. */
  get surfaces(): SurfaceModel<LitComponentApi>[] {
    return Array.from(this.processor.getSurfaces().values());
  }

  /** The data models of the surfaces created with `sendDataModel: true`, in creation order. */
  get sharedDataModels(): SharedDataModel[] {
    return this.surfaces
      .filter(surface => surface.sendDataModel)
      .map(surface => ({surfaceId: surface.id, dataModel: surface.dataModel.get('/')}));
  }

  /**
   * Applies `messages` if the whole batch is valid.
   *
   * @param userCaused Whether the user caused these messages, as with the result of an action
   *     they triggered. Their data model changes then call `onUserDataChange`, like the user's
   *     own edits.
   * @throws The processing or validation error of the first invalid message. The session is left
   *     unchanged.
   */
  apply(messages: AgentToRendererMessage[], {userCaused = false} = {}): void {
    const scratch = this.createProcessor();
    try {
      for (const batch of [...this.applied, messages]) {
        scratch.processMessages(structuredClone(batch));
      }
      assertComplete(scratch);
    } finally {
      scratch.dispose();
    }
    this.applyingServerChange = !userCaused;
    try {
      this.processor.processMessages(structuredClone(messages));
    } finally {
      this.applyingServerChange = false;
    }
    this.applied.push(messages);
  }

  dispose(): void {
    this.processor.dispose();
  }

  private createProcessor(
    onAction?: (action: ActionPayload) => void,
  ): MessageProcessor<LitComponentApi> {
    return new MessageProcessor<LitComponentApi>(this.catalogs, onAction, {
      version: '1.0',
      validationConfig: MESSAGE_VALIDATION,
    });
  }
}

/**
 * Checks that every surface with components has its root and no reference to a missing component.
 *
 * @throws {A2uiIntegrityError} For the first incomplete surface.
 */
function assertComplete(processor: MessageProcessor<LitComponentApi>): void {
  for (const surface of processor.getSurfaces().values()) {
    surface.componentsModel.validateTopology({
      rootId: surface.rootId,
      allowOrphanComponents: true,
    });
  }
}
